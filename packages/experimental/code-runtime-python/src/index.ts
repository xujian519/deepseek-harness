/**
 * CPython subprocess code runtime: a fresh `python3` process runs each model program under an
 * asyncio event loop with top-level ``await``. Binding calls travel on fd 3 as JSON-lines,
 * leaving stdout/stderr free for the program's own output. This is containment, not a security
 * boundary: model code has bash-equivalent trust, contained by a tempdir-only environment,
 * RLIMIT_CPU + RLIMIT_AS, wall-clock timeout, and SIGTERM→grace→SIGKILL on the process group.
 *
 * The package also owns the versionless fd-3 wire protocol itself; its host-side codec and
 * hostile-frame validators are re-exported so every consumer of the wire shares one vocabulary.
 * @module @deepseek-ai/dsh-experimental-code-runtime-python
 */

import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime'
import type { CodeBindingErrorClass, CodeBindingFunction, CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { Config, ResolvedConfig } from './config.ts'
import { hostFrameParseCeiling, resolveInterpreter, resolveRuntimeConfig } from './config.ts'
import type { LiveRun, ValidatedNamespace } from './supervisor.ts'
import { superviseChildRun } from './supervisor.ts'

// Re-export the fd-3 wire vocabulary so the runtime and its tests share one
// import surface; the protocol layer owns the definitions.
export type { BootMessage, ChildToHost, ReplyMessage } from './protocol.ts'
export {
  checkDoneValue,
  encodeJsonPlain,
  hasNonLosslessNumber,
  hasUnsafeIntegerToken,
  logTruncationMarker,
  validateChildFrame,
} from './protocol.ts'
// The fragment-accumulation primitive the fd-3 frame reader shares with the
// output ledger; it moved out of this module but keeps this import surface.
export { detachResidual } from './output-ledger.ts'
// The configuration surface the plugin declares, and the two host-facing
// derivations from it that this module's tests drive directly.
export type { Config } from './config.ts'
export { hostFrameParseCeiling, resolvePythonBin } from './config.ts'
// The child supervisor's entry point and the process-identity reader its
// escalation guard uses; the supervisor owns the child, this module owns the
// plugin.
export { readProcessStart } from './supervisor.ts'

/**
 * The seam's language-portable identifier subset (see
 * `CodeBindingNamespace.global`) — identical to Python's identifier grammar,
 * so the shared contract needs no per-backend mapping here.
 */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The seam's cross-language reserved-word union: the portable-identifier
 * contract promises a namespace list valid here is valid on every backend, so
 * a JS keyword like `typeof` is refused even though it is a legal Python name.
 */
const RESERVED_NAMES = PORTABLE_RESERVED_WORDS

/**
 * The seam's shared backend-owned globals (`console` is the worker's slot;
 * `__dsh_main__`/`__builtins__`/`__name__` are this bootstrap's wrapper and
 * seeded module globals). Shared so a namespace list valid on one backend is
 * valid on all — colliding with an owned slot would be silently overwritten
 * (or overwrite builtins), so the seam rejects them up front.
 */
const RUNTIME_OWNED_GLOBALS = RESERVED_BINDING_GLOBALS

/**
 * The seam's shared error-member exclusions (`RESERVED_ERROR_MEMBERS` +
 * dunder-form names) — enforced identically here and in the worker backend so
 * an errorClass valid on one backend is valid on all. Several dunders are
 * constrained CPython descriptors whose `setattr` raises while constructing
 * the very rejection it was meant to carry; the exact set is an interpreter
 * version detail, hence the dunder-wide rule at the seam.
 */
const EXCEPTION_RESERVED_MEMBERS = RESERVED_ERROR_MEMBERS

const DUNDER = DUNDER_MEMBER

/**
 * The `py/` scripts the interpreter must be able to open: the entry script plus
 * every module it imports from its own directory. Kept beside the built JS so a
 * consumer package with `files: ['lib', 'py']` ships both.
 */
const PY_SCRIPTS = ['bootstrap.py', 'protocol.py']

/**
 * Copy the `py/` scripts to a real filesystem directory and return the entry
 * script's path there.
 *
 * The interpreter is an EXTERNAL process, so it can only open paths the OS
 * resolves. Inside the single-file Python-SDK executable, `import.meta.url`
 * resolves into pkg's virtual filesystem, which Node reads through its patched
 * `fs` but `python3` cannot see at all — the spawn fails with ENOENT on a path
 * that exists as far as the host is concerned. `bootstrap.py` additionally
 * inserts its own directory on `sys.path` to import the sibling `protocol.py`,
 * so both files must land in the SAME real directory.
 *
 * The copy is unconditional rather than gated on a bundled-runtime probe: the
 * read goes through Node's `fs` either way, and one code path means the
 * packaged deployment runs what the tests exercise. Placement is under
 * `os.tmpdir()` with `0o700` keeps the scripts off other users' reach, but NOT
 * the model's: the child runs as the same UID as the host, so a program can
 * rewrite the very files it was started from. Hence one copy per RUN, discarded
 * at settlement — a rewrite then damages only the run that performed it, which
 * is what fresh-subprocess-per-run already promises. Sharing one copy across
 * runs made an overwritten `bootstrap.py` break the next run.
 *
 * Deliberately SYNCHRONOUS. An `await` here would open an async boundary in
 * `run()` before the run is registered with the supervisor and before the abort
 * listener is installed, so a disposal or an abort landing in that window would
 * be missed: `teardown` would see no runs and return while the continuation
 * went on to spawn a subprocess, and an `addEventListener('abort')` installed
 * afterwards does not replay an event that already fired. Three small
 * filesystem operations per run are not worth that class of race, and
 * `superviseChildRun` already runs synchronously up to `spawn`.
 *
 * A failed copy removes the directory here, so a partial attempt never outlives
 * the call that made it; a successful one is the caller's to remove, which it
 * derives from the returned path.
 *
 * @returns the absolute path of the materialized entry script.
 */
function materializePyScripts(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-code-runtime-python-'))
  const source = fileURLToPath(new URL('../py/', import.meta.url))
  try {
    for (const name of PY_SCRIPTS) copyFileSync(join(source, name), join(dir, name))
  } catch (error: unknown) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Swallows only a failure to remove the partial staging directory. The
      // caller reports the copy failure that got us here, which is the
      // diagnosable one; nothing else can act on a temp dir we cannot unlink.
    }
    throw error
  }
  return join(dir, 'bootstrap.py')
}






/**
 * The experimental {@link CodeRuntime} backend (private, not released) registering as `codeRuntime`. Every
 * cap is validated config; every long-running operation honors the request's
 * `AbortSignal`; every disposer awaits child-process exit.
 */
export class PythonCodeRuntime extends CodeRuntime {
  static Config: z<Config> = z.object({
    cpuSeconds: z.number().default(60),
    maxWallMs: z.number().default(600_000),
    addressSpaceMb: z.number().default(512),
    maxLogBytes: z.number().default(65_536),
    maxValueBytes: z.number().default(32_768),
    graceMs: z.number().default(3_000),
    pythonBin: z.string().default('python3'),
  })

  readonly language = 'python'
  readonly isolation = 'process'

  private readonly config: ResolvedConfig
  private readonly pythonBin: string
  // The frame cap this instance enforces: the protocol cap, or the host's
  // heap-derived parse ceiling when a constrained heap makes the protocol cap
  // unsafe to parse (see {@link hostFrameParseCeiling}). Computed per
  // instance so the config gate and the inbound checks agree.
  private readonly frameParseCapBytes = hostFrameParseCeiling()
  private readonly live = new Set<LiveRun>()
  private disposed = false

  /* jscpd:ignore-start -- parallel to code-runtime-worker: sibling backends keep symmetric constructor/teardown/run shapes. */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    // Reject at load on Windows: the bootstrap imports the POSIX-only `resource`
    // module for RLIMIT_CPU/RLIMIT_AS, spawns with a positional fd 3, and
    // terminates via negative-PID process-group signals — none of which exist
    // on Windows. Registering ctx.codeRuntime there would let assembly succeed
    // and defer the failure to the first run. The asymmetry with the worker
    // backend is intentional: that backend is cross-platform; this one is not.
    if (process.platform === 'win32') {
      throw new Error('dsh-code-runtime-python: this backend requires a Unix platform (POSIX rlimits, fd-3 stdio, process-group signals); it cannot run on Windows')
    }
    this.config = resolveRuntimeConfig(config, this.frameParseCapBytes)
    this.pythonBin = resolveInterpreter(this.config.pythonBin)
    ctx.effect(() => () => this.teardown(), 'python code-runtime teardown')
  }

  /**
   * Dispose to quiescence: fail every in-flight run as aborted and AWAIT each
   * child's exit so no subprocess that stays in the child's process group
   * outlives the fiber. A descendant that escaped the group with `setsid()` /
   * `start_new_session=True` is unreachable by `kill(-pid)` and is the documented
   * exception (see the package README's Known Limitations); the process-group
   * teardown reaps everything that stays in the group.
   */
  private async teardown(): Promise<void> {
    this.disposed = true
    const runs = [...this.live]
    for (const run of runs) run.settle({ kind: 'abort', message: 'runtime disposed' })
    // Awaiting `finished` is also what clears staging: that promise resolves
    // inside the run's own `settle`, which removes its directory first. So there
    // is deliberately no sweep here — a second pass could only ever find an
    // empty set, and an unreachable cleanup path is worse than none, since it
    // reads as the real guarantee while never running.
    await Promise.all(runs.map(run => run.finished))
  }

  /**
   * Execute one program in a fresh Python subprocess. Success resolves with
   * `result.value` (and no `result.error`); failure — parse failure, thrown
   * exception, invalid completion, output overflow, budget expiry, abort, or
   * substrate death — resolves with `result.error` set (classified by
   * `CodeRunFailure.kind`). The method rejects only for seam misuse.
   */
  async run(request: CodeRunRequest): Promise<CodeRunResult> {
    if (this.disposed) throw new Error('dsh-code-runtime-python: run() after disposal')
    const bindings = this.validateBindings(request)
    if (request.signal?.aborted) {
      return { logs: [], error: { kind: 'abort', message: errorMessage(request.signal.reason) } }
    }
    let bootstrapPath: string
    try {
      // The interpreter is an external process, so the entry script has to sit
      // on the real filesystem; see materializePyScripts. One copy PER RUN,
      // synchronously, so no async boundary opens before the supervisor
      // registers the run and installs the abort listener.
      bootstrapPath = materializePyScripts()
    } catch (error: unknown) {
      // A full or read-only temp filesystem, or a packaged asset the deployment
      // failed to ship, is a SUBSTRATE failure — the same class as a child that
      // cannot start. The seam permits rejection only for misuse, so this
      // resolves as `worker-exit` rather than throwing out of `run()`.
      return { logs: [], error: { kind: 'worker-exit', message: `failed to stage the python bootstrap: ${errorMessage(error)}` } }
    }
    return await this.execute(request, bindings, bootstrapPath)
  }
  /* jscpd:ignore-end */

  /**
   * Reject (seam misuse) malformed binding namespaces: non-identifier or
   * reserved globals/error classes, duplicates, and colliding or
   * runtime-owned injected globals.
   */
  private validateBindings(request: CodeRunRequest): Map<string, ValidatedNamespace> {
    const bindings = new Map<string, ValidatedNamespace>()
    // Every name the bootstrap injects into the program's one global namespace:
    // namespace globals plus error-class names. They must be a collision-free
    // set that avoids the runtime's own slots, or a later injection silently
    // overwrites an earlier one (or the completion/builtins slot) and the run
    // fails obscurely at execution time.
    const injectedGlobals = new Set<string>()
    const claimGlobal = (name: string, role: string): void => {
      if (RUNTIME_OWNED_GLOBALS.has(name)) {
        throw new Error(`dsh-code-runtime-python: ${role} ${JSON.stringify(name)} collides with a runtime-owned global`)
      }
      if (injectedGlobals.has(name)) {
        throw new Error(`dsh-code-runtime-python: ${role} ${JSON.stringify(name)} collides with another injected global`)
      }
      injectedGlobals.add(name)
    }
    for (const namespace of request.bindings) {
      // Snapshot the caller-supplied fields into plain values ONCE. The
      // namespace and errorClass objects may expose `global`/`name`/
      // `memberNameProperty` through getters: validation reads each several
      // times, and the ORIGINAL errorClass object would otherwise be retained
      // for the boot frame, whose JSON.stringify re-reads it after validation.
      // A getter that changes or throws on a later read would turn the
      // seam-misuse rejection into a worker-exit (or inject a different name
      // than validation approved); reading each field once here and keeping
      // the plain copy makes validation and the boot frame agree.
      const global = namespace.global
      if (!IDENTIFIER.test(global) || RESERVED_NAMES.has(global)) {
        throw new Error(`dsh-code-runtime-python: binding global ${JSON.stringify(global)} is not a usable Python identifier`)
      }
      if (bindings.has(global)) {
        throw new Error(`dsh-code-runtime-python: duplicate binding global ${JSON.stringify(global)}`)
      }
      claimGlobal(global, 'binding global')
      // The error class becomes a program global and its member property an
      // attribute name, so both face the Python identifier rules; the member
      // additionally must be assignable on a BaseException instance.
      const errorClass = namespace.errorClass
      let validatedErrorClass: CodeBindingErrorClass | undefined
      if (errorClass) {
        const name = errorClass.name
        const memberNameProperty = errorClass.memberNameProperty
        if (!IDENTIFIER.test(name) || RESERVED_NAMES.has(name)) {
          throw new Error(`dsh-code-runtime-python: errorClass.name ${JSON.stringify(name)} is not a usable Python identifier`)
        }
        // Any non-empty own attribute name is settable via setattr (the
        // program reads exotic names like `tool-name` with getattr), matching
        // the seam contract and the worker backend — only the seam-excluded
        // and protocol-reserved members below are refused.
        if (memberNameProperty.length === 0) {
          throw new Error('dsh-code-runtime-python: errorClass.memberNameProperty must be a non-empty attribute name')
        }
        if (EXCEPTION_RESERVED_MEMBERS.has(memberNameProperty) || DUNDER.test(memberNameProperty)) {
          throw new Error(`dsh-code-runtime-python: errorClass.memberNameProperty ${JSON.stringify(memberNameProperty)} is a reserved error member and cannot be assigned`)
        }
        claimGlobal(name, 'errorClass.name')
        validatedErrorClass = { name, memberNameProperty }
      }
      // Snapshot the callables into a plain own-property record before the
      // child can dispatch. `namespace.functions` is caller-supplied, so it may
      // expose members through getters or a Proxy; reading one of them inside
      // the fd-3 `data` callback would throw OUTSIDE the dispatcher's try and
      // terminate the host (defensive-patterns contain-callback-exceptions).
      // Reading every member here, in run()'s synchronous validation segment,
      // turns that throw into the seam-misuse rejection run() reserves for
      // malformed bindings. The snapshot is also the single key set the boot
      // frame advertises AND dispatch reads, so a getter whose keys differ
      // between reads cannot desynchronize the child's allowed names from what
      // the host will actually call. The record is null-prototype: the seam
      // contract treats member names like `__proto__` or `constructor` as
      // ordinary own properties, and a plain `{}` assignment of `__proto__`
      // would hit the prototype setter instead of creating the own property.
      const functions = Object.create(null) as Record<string, CodeBindingFunction>
      for (const name of Object.keys(namespace.functions)) {
        // Only callables enter the snapshot: a getter exposing a non-function
        // member would otherwise assign a value the dispatcher's `typeof fn
        // !== 'function'` check rejects anyway, and keeping it out of the
        // snapshot keeps the boot frame's name list and the dispatch key set
        // one and the same.
        const fn = namespace.functions[name]
        if (typeof fn === 'function') functions[name] = fn
      }
      bindings.set(global, { functions, ...validatedErrorClass ? { errorClass: validatedErrorClass } : {} })
    }
    return bindings
  }

  /**
   * Spawn the child for one validated run and drive it to settlement. The
   * process itself belongs to `superviseChildRun`; this builds its inputs.
   */
  private execute(
    request: CodeRunRequest,
    bindings: Map<string, ValidatedNamespace>,
    bootstrapPath: string,
  ): Promise<CodeRunResult> {
    return superviseChildRun({
      pythonBin: this.pythonBin,
      config: this.config,
      frameParseCapBytes: this.frameParseCapBytes,
      program: request.program,
      signal: request.signal,
      bindings,
      bootstrapPath,
      liveRuns: this.live,
    })
  }
}

export default PythonCodeRuntime
