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

import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { accessSync, copyFileSync, constants as fsConstants, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getHeapStatistics } from 'node:v8'
import type { Duplex } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CodeRuntime, DUNDER_MEMBER, PORTABLE_RESERVED_WORDS, RESERVED_BINDING_GLOBALS, RESERVED_ERROR_MEMBERS } from '@deepseek-ai/dsh-code-runtime'
import type { CodeBindingErrorClass, CodeBindingFunction, CodeJsonValue, CodeRunFailure, CodeRunRequest, CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { assertNever, snapshotJsonValue } from '@deepseek-ai/dsh-util-values'
import { errorMessage } from '@deepseek-ai/dsh-value'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { capMessage } from './cost.ts'
import { MAX_PENDING_CHUNKS, OutputLedger, detachResidual } from './output-ledger.ts'
import type { BootMessage, ChildToHost, ReplyMessage } from './protocol.ts'
import { checkDoneValue, encodeJsonPlain, hasUnsafeIntegerToken, validateChildFrame } from './protocol.ts'

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

/** Plugin config: every cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * RLIMIT_CPU in whole seconds (a positive integer — `setrlimit` in the child
   * rejects a float). The child sets the soft limit to `cpuSeconds` and the
   * hard limit to `cpuSeconds + 1`: the kernel delivers SIGXCPU at the soft
   * limit, which the host classifies as a `timeout`; the +1s hard limit is a
   * SIGKILL backstop for a program that traps SIGXCPU. Granularity is seconds —
   * a coarser counterpart to the worker backend's millisecond `computeMs`.
   */
  cpuSeconds?: number
  /** Wall-clock ceiling in milliseconds; backstops CPU time for programs awaiting a promise nobody resolves. */
  maxWallMs?: number
  /**
   * RLIMIT_AS in mebibytes; caps address space so a runaway allocation fails
   * cleanly. Not applied on Darwin, where the dyld shared cache mapped into
   * every process at exec exceeds any practical cap and the kernel rejects
   * the call; `cpuSeconds` and `maxWallMs` still bound the run there. Bounds
   * `maxLogBytes`/`maxValueBytes` at load on EVERY platform (this static check
   * runs on Darwin too, where only the runtime `setrlimit` is skipped): each
   * budget times a worst-case Unicode expansion must fit this byte count minus a
   * fixed interpreter baseline, so a near-budget output cannot breach the address
   * space during the child's build-and-encode.
   */
  addressSpaceMb?: number
  /**
   * Shared byte budget for captured log text (host-side ledger). Bounded at load
   * against `addressSpaceMb`: the child builds and encodes a near-budget entry
   * under RLIMIT_AS with several copies live at once, so this cap times the
   * worst-case Unicode expansion must fit the address space left after the
   * interpreter baseline (see `addressSpaceMb`) — a load-time rejection, not a
   * runtime clamp. Also bounded at load by the host's configured heap like
   * `maxValueBytes` (see its JSDoc): the effective frame cap minus the frame
   * envelope.
   */
  maxLogBytes?: number
  /**
   * Byte cap for the completion value. Bounded at load against `addressSpaceMb`
   * the same way `maxLogBytes` is: the child builds and encodes a near-budget
   * value under RLIMIT_AS with several copies live at once, so this cap times the
   * worst-case Unicode expansion must fit the address space left after the
   * interpreter baseline. Both budgets are ALSO bounded at load by the host's
   * configured heap: the effective frame cap (the protocol cap, or a lower
   * heap-derived ceiling when the host heap cannot safely parse a near-cap
   * frame — see `hostFrameParseCeiling`) minus the frame envelope, so a budget
   * whose honest frame could OOM the host's own JSON.parse is rejected up
   * front.
   */
  maxValueBytes?: number
  /** SIGTERM→SIGKILL grace period on kill, matching bash-local's default. */
  graceMs?: number
  /**
   * Absolute path, relative path, or basename of a CPython 3.10+ interpreter.
   * Resolved and validated once at plugin load under a five-second force-kill
   * deadline; a basename searches `PATH`.
   */
  pythonBin?: string
}

/** {@link Config} with all defaults filled. */
type ResolvedConfig = Required<Config>

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
 * `execute` before the run is registered in `live` and before the abort
 * listener is installed, so a disposal or an abort landing in that window would
 * be missed: `teardown` would see no runs and return while the continuation
 * went on to spawn a subprocess, and an `addEventListener('abort')` installed
 * afterwards does not replay an event that already fired. Three small
 * filesystem operations per run are not worth that class of race, and `execute`
 * already runs synchronously up to `spawn`.
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
 * A frame's RAW length is capped before JSON.parse: the 64 MiB fd-3 frame
 * parse cap bounds the bytes, not the decoded structure, and a compact wide
 * frame near that ceiling (e.g. a huge array of tiny elements) could decode to
 * far more host memory than the wire admitted — an OOM inside the receive
 * path. 64 MiB raw admits every legal config (the widest in-tree completion
 * and binding frames are ~12 MB) while bounding decode amplification to a
 * roughly constant factor of the wire bytes. The unframed-buffer counter is
 * checked against this same cap BEFORE a `Buffer.concat` join, so an oversized
 * frame is dropped at one copy of its wire bytes. A hostile-peer invariant,
 * not a deployment choice.
 */
const FRAME_PARSE_CAP_BYTES = 64 * 1024 * 1024

/**
 * Replies the host retains before fd 3 accepts them. The drain loop writes one
 * reply per iteration and waits for `drain` when the pipe is full; a child
 * that never reads its replies (hostile or wedged) leaves the pipe full, so
 * every call frame it keeps sending adds a reply the drain cannot write, and
 * the backlog would grow without bound until the wall clock. 1024 keeps
 * legitimate concurrent gathers (measured queue depths reach 11) far below
 * the ceiling while bounding the hostile backlog; the run settles as a
 * worker-exit past it, like the frame cap settles an oversized frame. A
 * framing invariant, not a deployment choice.
 */
const MAX_PENDING_REPLIES = 1024

/**
 * Bytes a frame spends on its own JSON structure around a capped payload, used
 * to bound `maxLogBytes`/`maxValueBytes` against {@link FRAME_PARSE_CAP_BYTES}
 * (the receive path rejects raw frames past that cap, settling the run as a
 * worker-exit).
 * The widest carrier is `{"type":"log","text":"","truncated":true}` at 41
 * bytes; 64 rounds that up so adding a field to either frame does not silently
 * invalidate the bound. A protocol constant, not a deployment choice.
 */
const FRAME_ENVELOPE_BYTES = 64

/**
 * Smallest `maxLogBytes` the backend can honor. The truncation marker alone
 * (`logTruncationMarker`) must serialize within the budget, or a marker-only
 * truncated run returns more than the configured cap: the marker text is
 * `[dsh-code-runtime-python] log capture truncated at <N> bytes` — 51 fixed
 * characters (the bracketed prefix `[dsh-code-runtime-python] log capture
 * truncated at ` counts both square brackets) plus the digits of N plus 6 —
 * and its serialized form adds 4 (two quotes, two array brackets), so the
 * smallest N that admits its own marker is 63 (51 + 2 + 6 + 4 = 63); 64 is the
 * floor with one byte of room. The marker itself remains envelope, not
 * payload, so a truncated run with admitted entries serializes to at most
 * `maxLogBytes + marker + envelope`.
 * `maxValueBytes` has no floor beyond the positive-integer requirement: a
 * completion can be as small as a single byte (`1`), and the done-frame
 * envelope is seam protocol cost, not the advertised completion budget.
 */
const MIN_LOG_BYTES = 64

/**
 * Extra time added to `graceMs` before the post-kill close-deadline force-settles
 * a run whose `close` never fires (a setsid-escaped orphan holds our inherited
 * stdio; see the `closeDeadline` arm in {@link PythonCodeRuntime.execute}). It
 * covers the OS reaping the killed child itself after SIGKILL — not a deployment
 * choice but a fixed safety margin, so it is a constant rather than a config knob.
 */
const CLOSE_REAP_MARGIN_MS = 2_000

/**
 * Worst-case peak child-process bytes a one-`maxLogBytes`/`maxValueBytes`-budget
 * output can transiently occupy while the child charges and frames it, expressed
 * as a multiple of the budget. The child's ledgers trigger on CHARACTER count
 * against a serialized-BYTE budget, and an astral character is one character but
 * four bytes of CPython `str` storage and four UTF-8 bytes — so a budget's worth
 * of astral characters is ~4x the budget in each string that holds it. The
 * heaviest path holds THREE such copies at once: a single
 * `sys.stdout.write(line + "\n")` keeps the caller's `text` argument (alive for
 * the whole `write` call, ~4x), the line slice `text[pos:newline]` handed to
 * `LogBuffer.push` (~4x), and the `text.encode("utf-8")` copy `_push_locked`
 * takes to charge and ship it (~4x). The settlement `flush_line` path holds only
 * two (its `"".join(...)` and that encode copy — it drops the pending chunks
 * before pushing), so the newline path is the binding worst case. Twelve covers
 * those three simultaneous ~4x copies. The interpreter baseline is NOT in this
 * multiple — it is reserved separately as {@link INTERPRETER_BASELINE_BYTES} —
 * because it is a fixed cost, not one that scales with the budget. Used to bound
 * `maxLogBytes`/`maxValueBytes` against `addressSpaceMb` at load, with a `>=` so
 * a budget whose worst-case peak exactly equals the room left after the baseline
 * is rejected (that peak plus the baseline is the whole address space, the
 * RLIMIT_AS edge), so a legitimate near-budget output truncates (log) or fails
 * as `output-limit` (value) rather than breaching `RLIMIT_AS` as `worker-exit`.
 * A fixed safety invariant tying the budgets to the address space, not a knob.
 */
const OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE = 12

/**
 * Fixed address-space headroom reserved for the CPython interpreter itself
 * (loaded modules, the asyncio loop, import machinery) before the output-budget
 * multiple claims the rest. The budget check subtracts this from `addressSpaceMb`
 * so a budget sized right at `addressSpaceMb / MULTIPLE` — which the multiple
 * alone would admit — cannot leave the peak output allocation plus the
 * interpreter over the limit. Sized against ADDRESS SPACE, which is what
 * `RLIMIT_AS` bounds, not resident set: the bootstrap's own measurement is
 * 30.23 MiB of mappings for a `python3 -I` child (see `_make_cpu_enforcer`,
 * which also records the 64 MiB glibc per-thread arena reservation that pushes
 * it to 102.37 MiB when threads are used). 64 MiB is roughly twice the measured
 * baseline, leaving room for allocator arenas and import jitter. The value is a
 * fixed safety margin, not a deployment knob.
 */
const INTERPRETER_BASELINE_BYTES = 64 * 1024 * 1024

/**
 * Worst-case peak host-heap bytes the PARSE of one inbound fd-3 frame can
 * transiently occupy, expressed as a multiple of the frame's raw bytes.
 * `JSON.parse` of a wide container materializes the object's property storage
 * and key strings on top of the raw text; the WORST shape is a dict of many
 * SHORT UNIQUE keys, which forces V8's dictionary-mode property storage
 * (~32-64 bytes per entry) plus one interned string per key (header + data)
 * plus string-table growth: measured 6.4x for a 3,000,000-key frame (~31 MB
 * raw) on a 1 GiB heap, trending up with key count (a flat unique-key array
 * is ~4x, a repeated-key dict ~3x). On a constrained heap the parse also
 * retains the raw frame string while the object builds, so the safety factor
 * is 16x — ~2.5x over the measured worst shape, ~1.6x over the claimed
 * GC-headroom bound. Used with the host's configured heap limit to derive the
 * largest frame whose parse cannot OOM the host process. This bounds the
 * HOST's parse; {@link OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE} bounds
 * the CHILD's build and encode under RLIMIT_AS, a different resource. A fixed
 * safety invariant, not a knob.
 */
const HOST_PARSE_WORST_CASE_MULTIPLE = 16

/**
 * Fixed host-heap headroom reserved for the application itself (the dsh
 * fiber, plugins, and this runtime's own state) before the frame-parse
 * multiple claims the rest: the effective frame cap is derived from
 * `heap_size_limit - HOST_PARSE_BASELINE_BYTES`, so a constrained host's
 * parse ceiling never spends the application's working set. A fixed safety
 * margin, not a knob.
 */
const HOST_PARSE_BASELINE_BYTES = 64 * 1024 * 1024

/**
 * The largest inbound fd-3 frame the HOST can parse without risking a
 * process-level OOM on its current heap: the configured heap limit (honoring
 * `--max-old-space-size`) minus the application baseline, divided by the
 * worst-case parse multiple, floored to the protocol frame cap. The
 * raw-byte cap alone does not protect the heap — `JSON.parse` of a
 * ≤64 MiB wide-object frame materializes several times that in property
 * storage — so the effective cap is the smaller of the two. A default Node
 * heap (~4 GiB) never binds; a constrained host (e.g.
 * `--max-old-space-size=256` reports a ~300 MiB limit) lowers it to ~14 MiB,
 * and the load gate rejects budgets that cannot cross it.
 * @param heapLimit - the host's configured heap limit; the live
 * `heap_size_limit` when omitted. A parameter so the derivation is unit
 * testable against simulated heap sizes.
 * @returns the effective frame parse cap in bytes.
 */
export function hostFrameParseCeiling(heapLimit: number = getHeapStatistics().heap_size_limit): number {
  return Math.min(FRAME_PARSE_CAP_BYTES, Math.floor((heapLimit - HOST_PARSE_BASELINE_BYTES) / HOST_PARSE_WORST_CASE_MULTIPLE))
}

/**
 * Interval between process-group liveness probes while settlement waits for an
 * escalated SIGKILL to empty the group (see the `killing` branch in
 * {@link PythonCodeRuntime.execute}'s settle). A poll rather than an event
 * because the group members are the model's own descendants, which the host does
 * not `wait()` for and gets no exit signal from; the probe is a signal-0
 * `process.kill(-pid, 0)`, so the interval only bounds how promptly a now-empty
 * group is noticed, capped by `graceMs + CLOSE_REAP_MARGIN_MS`.
 */
const GROUP_REAP_POLL_MS = 50

/**
 * A process's start time, as the identity half of (pid, started).
 *
 * A pid is reusable the moment the kernel reaps it, so signalling one that a
 * later process inherited would terminate an unrelated process group. Start
 * time is what distinguishes the original from its replacement: `kill(pid, 0)`
 * answers "does this number exist", which is true for both.
 *
 * Linux reads field 22 of `/proc/<pid>/stat` (starttime in clock ticks); the
 * field is positional after the comm field's closing parenthesis, which is
 * parsed from the LAST such character because a process name may contain one.
 * Darwin has no `/proc`, so the caller gets `undefined` there and `killGroup`
 * signals the pgid without the identity re-check rather than paying a `ps`
 * fork on a teardown path. Any read failure is `undefined` for the same
 * reason: this
 * hardens a narrow race and must never be the thing that breaks teardown.
 * @param pid - the process to read.
 * @returns its start time, or undefined when unavailable.
 */
export function readProcessStart(pid: number): string | undefined {
  /* v8 ignore next -- one arm per platform: the Linux coverage lane always takes the read path, and Darwin always this one. */
  if (process.platform !== 'linux') return undefined
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    // Field 22 overall; the slice above dropped pid and comm, so it is index 19.
    return fields[19]
  } catch {
    return undefined
  }
}

/**
 * Resolve `pythonBin` to one executable absolute path at plugin load. A basename
 * (the default `python3`) searches the current process `PATH`; the child receives
 * no `PATH`, so Node's own lookup would otherwise fall back to the platform
 * default (`/usr/bin:/bin`) and miss interpreters
 * that live only on the caller's `PATH` (Nix, pyenv, Homebrew, conda). An
 * absolute path is verified in place, and an explicitly relative path is first
 * resolved against the load-time working directory. When no candidate is an
 * executable regular file, `undefined` is returned and the load check rejects
 * the configuration: falling back to the bare name would let spawn's scrubbed env
 * execvp silently start a system interpreter from the platform default PATH
 * that the caller never asked for.
 * @param bin - the configured interpreter (absolute path, relative path, or bare command).
 * @returns an absolute path when resolvable, else `undefined`.
 */
export function resolvePythonBin(bin: string): string | undefined {
  const executableFile = (candidate: string): string | undefined => {
    try {
      accessSync(candidate, fsConstants.X_OK)
      return statSync(candidate).isFile() ? candidate : undefined
    } catch {
      // Missing, inaccessible, and non-stat-able candidates are ordinary
      // lookup misses; the constructor reports the final load error.
      return undefined
    }
  }
  if (isAbsolute(bin)) return executableFile(bin)
  if (bin.includes('/')) return executableFile(resolve(bin))
  const path = process.env.PATH
  /* v8 ignore next -- PATH is set in every environment the runtime boots in; the guard is defensive. */
  if (path === undefined) return undefined
  for (const dir of path.split(delimiter)) {
    // An empty PATH segment (a `::`, implicitly CWD on POSIX) and a RELATIVE
    // segment (`bin` or `.`) are skipped: a basename must never resolve against
    // the working directory, and the returned candidate must be an absolute
    // path — spawn() resolves a relative pythonBin against the host CWD, which
    // is outside the seam contract.
    if (dir === '' || !isAbsolute(dir)) continue
    const executable = executableFile(join(dir, bin))
    if (executable !== undefined) return executable
  }
  return undefined
}

/** Lowest CPython version supported by the bootstrap and its traceback behavior. */
const MIN_CPYTHON = { major: 3, minor: 10 } as const

/** Fixed load-time probe bound; a configured executable must not hang plugin activation. */
const PYTHON_PROBE_TIMEOUT_MS = 5_000

/** The only host environment fact exposed to the child. */
function pythonEnvironment(): NodeJS.ProcessEnv {
  return { TMPDIR: tmpdir() }
}

/** Fail load unless `bin` is a responsive CPython 3.10+ interpreter. */
function validatePythonBin(bin: string): void {
  let output: string
  try {
    output = execFileSync(bin, [
      '-I',
      '-c',
      'import sys; print(sys.implementation.name, sys.version_info.major, sys.version_info.minor, sys.version_info.micro)',
    ], {
      encoding: 'utf8',
      env: pythonEnvironment(),
      timeout: PYTHON_PROBE_TIMEOUT_MS,
      // The configured executable is outside our control. Force-kill it at the
      // deadline so a wrapper that ignores SIGTERM cannot block plugin load.
      killSignal: 'SIGKILL',
      maxBuffer: 1_024,
    }).trim()
  } catch (error: unknown) {
    throw new Error(`dsh-code-runtime-python: config.pythonBin ${JSON.stringify(bin)} failed the CPython version probe: ${errorMessage(error)}`)
  }
  const match = /^(\S+) (\d+) (\d+) (\d+)$/.exec(output)
  if (match === null) {
    throw new Error(`dsh-code-runtime-python: config.pythonBin ${JSON.stringify(bin)} did not report a CPython version`)
  }
  const [, implementation, majorText, minorText, patchText] = match
  const major = Number(majorText)
  const minor = Number(minorText)
  if (implementation !== 'cpython') {
    throw new Error(`dsh-code-runtime-python: config.pythonBin ${JSON.stringify(bin)} must be CPython, got ${implementation}`)
  }
  if (major < MIN_CPYTHON.major || (major === MIN_CPYTHON.major && minor < MIN_CPYTHON.minor)) {
    throw new Error(`dsh-code-runtime-python: config.pythonBin ${JSON.stringify(bin)} must be CPython ${MIN_CPYTHON.major}.${MIN_CPYTHON.minor} or newer, got ${implementation} ${majorText}.${minorText}.${patchText}`)
  }
}

// Fatal UTF-8 decoder for fd-3 frames: `toString('utf8')` replaces illegal
// bytes with U+FFFD, which would silently corrupt a completion or binding
// payload a forged frame smuggled in; a fatal decode throws instead and the
// frame is dropped. Non-stream mode keeps it stateless across lines.
const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true })

/** One namespace after seam validation: its callables plus the optional typed-rejection contract. */
interface ValidatedNamespace {
  functions: Record<string, CodeBindingFunction>
  errorClass?: CodeBindingErrorClass
}

/**
 * One in-flight run's host-side state, tracked for disposal so teardown can
 * fail every live run as `abort` and AWAIT each child's exit.
 */
interface LiveRun {
  kill(sig: NodeJS.Signals): void
  settle(failure: CodeRunFailure): void
  finished: Promise<void>
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
    this.config = config as ResolvedConfig
    for (const [key, value] of Object.entries(this.config)) {
      if (typeof value === 'number' && !(Number.isFinite(value) && value > 0)) {
        throw new Error(`dsh-code-runtime-python: config.${key} must be a positive number, got ${String(value)}`)
      }
    }
    // cpuSeconds crosses to the child's setrlimit(RLIMIT_CPU) raw; a float
    // raises TypeError inside every child (a late per-run failure). Reject it
    // at load. maxLogBytes/maxValueBytes get their own integer gate below (the
    // child int()-truncates them, so a float would diverge from the host);
    // maxWallMs/graceMs/addressSpaceMb are consumed as numbers where a fraction
    // is harmless.
    if (!Number.isInteger(this.config.cpuSeconds)) {
      throw new Error(`dsh-code-runtime-python: config.cpuSeconds must be a positive integer, got ${String(this.config.cpuSeconds)}`)
    }
    // Finite is not the same as representable as an rlimit. `cpuSeconds` and its
    // `+ 1` hard limit both cross to `setrlimit` as integers, and `1e100` clears
    // `Number.isInteger` while being far past the safe range, so it cannot round
    // -trip: the child sees a different number than was configured. The `+ 1` is
    // what gets checked because that is the larger of the two values sent.
    if (!Number.isSafeInteger(this.config.cpuSeconds + 1)) {
      throw new Error(`dsh-code-runtime-python: config.cpuSeconds must be at most ${Number.MAX_SAFE_INTEGER - 1} (it and its +1 hard limit cross to setrlimit as exact integers), got ${String(this.config.cpuSeconds)}`)
    }
    // `addressSpaceMb` is multiplied by 1 MiB before it is framed, and a large
    // finite value overflows to `Infinity` there — which `encodeJsonPlain`
    // renders as `null`, so the child receives no limit at all and every run
    // ends in a bootstrap exception rather than a load-time configuration error.
    // Checking the DERIVED byte count is what catches it; the input itself looks
    // ordinary. Safe-integer, not merely finite, since the value must survive
    // the JSON round trip exactly.
    if (!Number.isSafeInteger(this.config.addressSpaceMb * 1024 * 1024)) {
      throw new Error(`dsh-code-runtime-python: config.addressSpaceMb must be at most ${Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024))} (its byte count crosses the wire as an exact integer), got ${String(this.config.addressSpaceMb)}`)
    }
    // `pythonBin` reaches `spawn` as the executable path, where values the
    // string schema admits fail late and unhelpfully. An empty string makes
    // `spawn` throw `ERR_INVALID_ARG_VALUE` synchronously, and an embedded NUL
    // throws `ERR_INVALID_ARG_TYPE` — both from inside `run()`, so the method
    // REJECTS instead of resolving the `worker-exit` the seam promises for a
    // child that cannot start. A basename with no `PATH` match would silently
    // fall to execvp's platform default `PATH` under the minimal spawn
    // environment (see the resolvePythonBin JSDoc), so it is rejected here
    // too. All three are self-contained configuration errors that fail at
    // load.
    if (this.config.pythonBin === '' || this.config.pythonBin.includes('\0')) {
      throw new Error(`dsh-code-runtime-python: config.pythonBin must be a non-empty path without NUL bytes, got ${JSON.stringify(this.config.pythonBin)}`)
    }
    // `maxWallMs` and `graceMs` are armed with setTimeout, which clamps any
    // delay past MAX_TIMER_DELAY_MS to 1 ms without a word — turning a
    // generous ceiling into an instant timeout and a generous grace period into
    // an instant SIGKILL. `graceMs` is checked against the margin the
    // close-deadline adds on top, since that sum is what gets armed.
    if (this.config.maxWallMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`dsh-code-runtime-python: config.maxWallMs must not exceed ${MAX_TIMER_DELAY_MS} (setTimeout clamps a larger delay to 1ms), got ${String(this.config.maxWallMs)}`)
    }
    if (this.config.graceMs + CLOSE_REAP_MARGIN_MS > MAX_TIMER_DELAY_MS) {
      throw new Error(`dsh-code-runtime-python: config.graceMs must not exceed ${MAX_TIMER_DELAY_MS - CLOSE_REAP_MARGIN_MS} (its close deadline adds ${CLOSE_REAP_MARGIN_MS}ms, and setTimeout clamps a larger delay to 1ms), got ${String(this.config.graceMs)}`)
    }
    // The output caps are budgets for a payload that has to cross fd 3 inside
    // one frame, and the framing ceiling is fixed. A cap above what a frame can
    // carry is unsatisfiable: a completion or log entry that the cap admits
    // arrives as an over-ceiling frame and fails the run as `worker-exit`
    // instead of the `output-limit` the cap describes — a silent inversion, so
    // it fails at load. Both budgets are metered in SERIALIZED (JSON-escaped)
    // bytes — the host log ledger charges the serialized cost via
    // `jsonStringCostUpTo`, which walks to the cap without allocating the escaped
    // copy, `checkDoneValue` measures the escaped form, and the producing-side
    // `_cap_message` in the child also caps by serialized cost (which is why a
    // capped diagnostic still fits its frame) — so a payload admitted under the
    // cap occupies at most `cap + envelope` bytes on the wire; escaping is
    // already inside the charge and must not be multiplied in again. The
    // receive-side `capMessage` backstop is the one exception to this argument:
    // it bills a forged `done.error.message` by RAW bytes, but that output goes
    // into `CodeRunResult.error.message` and never re-crosses a frame-bounded
    // channel, so it is not part of the wire-width bound (see its JSDoc). The
    // admissible cap is therefore `parse-cap - envelope`: the receive path
    // rejects raw frames past the effective parse cap (`frameParseCapBytes` —
    // the protocol cap, or the host's heap-derived ceiling when a constrained
    // heap makes the protocol cap unsafe to parse; see hostFrameParseCeiling)
    // before decoding (the run settles as a worker-exit; a hostile
    // compact-wide-frame OOM guard), so a budget must not exceed what an
    // honest child's frame can actually carry through that parser.
    for (const key of ['maxLogBytes', 'maxValueBytes'] as const) {
      // Require an integer: the child reads these budgets through `int(...)`,
      // which silently floors a float, so `maxLogBytes: 3.5` would truncate at 3
      // bytes child-side while the host meters and marks at 3.5 — the two sides
      // enforcing different public config. Reject the float at load, as the
      // worker backend does for its byte budgets.
      if (!Number.isInteger(this.config[key])) {
        throw new Error(`dsh-code-runtime-python: config.${key} must be a positive integer (the child reads it as an int, so a float diverges from the host), got ${String(this.config[key])}`)
      }
      const limit = this.frameParseCapBytes - FRAME_ENVELOPE_BYTES
      if (this.config[key] > limit) {
        // Only a host whose heap is below the protocol cap reaches the
        // heap-constrained note; the constrained-heap rejection is exercised
        // by the subprocess load test, but subprocess runs are not
        // coverage-instrumented, so the note's arm is not schedulable from the
        // instrumented suite (whose heap never binds).
        /* v8 ignore next -- the heap-constrained message arm needs a host heap below the protocol cap. */
        const heapNote = this.frameParseCapBytes < FRAME_PARSE_CAP_BYTES ? ` — this host's heap limits the parse to ${this.frameParseCapBytes} bytes, so the protocol cap of ${FRAME_PARSE_CAP_BYTES} would be unsafe` : ''
        throw new Error(`dsh-code-runtime-python: config.${key} must not exceed ${limit} (a payload that large cannot cross the fd-3 frame PARSER, which rejects raw frames past ${this.frameParseCapBytes} bytes before decoding to bound host memory${heapNote} — a larger budget would admit a config whose honest child frames the host then rejects as a worker-exit), got ${String(this.config[key])}`)
      }
      // Reject a log budget too small to honor: the truncation marker alone
      // must serialize within the budget, or a marker-only truncated run
      // returns more than the configured cap. (With admitted entries the
      // marker is envelope, so the serialized logs run to
      // `maxLogBytes + marker + envelope`.)
      if (key === 'maxLogBytes' && this.config[key] < MIN_LOG_BYTES) {
        throw new Error(`dsh-code-runtime-python: config.maxLogBytes must be at least ${MIN_LOG_BYTES} (a smaller budget cannot serialize the truncation marker itself, so a marker-only truncated run would return more than the configured cap), got ${String(this.config[key])}`)
      }
    }
    // The child builds, charges, and frames a `maxLogBytes` log entry or a
    // `maxValueBytes` completion value under `RLIMIT_AS`, and both paths trigger
    // on CHARACTER count against a serialized-BYTE budget. An astral character is
    // one character but four bytes of `str` storage and four UTF-8 bytes, so a
    // budget's worth of them peaks at three simultaneous ~4x copies (the caller's
    // write argument, the line slice or joined pending handed to push, and the
    // encode push takes to charge and ship it). A budget approaching
    // `addressSpaceMb` therefore makes a LEGITIMATE near-budget output breach the
    // address space and die as `worker-exit` instead of truncating (log) or
    // failing as `output-limit` (value). Metering every child write against the
    // address space at runtime is the wrong fix — an exact serialized-cost check
    // is either a full encode (the allocation being avoided) or a per-character
    // Python loop that burns the CPU budget — so the incompatible pair is rejected
    // at load: each budget times the worst-case multiple must fit the address
    // space. Checked on every platform, not just where `RLIMIT_AS` is enforced:
    // the incompatibility is a property of the config values, and the child OOMs
    // on a Linux deployment regardless of the host that assembled the config, so a
    // uniform load-time rejection is the fail-loud contract (Darwin skips only the
    // runtime `setrlimit`).
    const addressSpaceBytes = this.config.addressSpaceMb * 1024 * 1024
    // Room left for the peak output allocation after the interpreter's own fixed
    // footprint. A budget must fit MULTIPLE times over into THIS, not the whole
    // address space, so a budget sized right at `addressSpaceMb / MULTIPLE` — which
    // the multiple alone would admit — cannot leave the peak plus the interpreter
    // over the limit.
    const budgetableBytes = addressSpaceBytes - INTERPRETER_BASELINE_BYTES
    // The largest budget that fits: the peak (budget * MULTIPLE) must leave room,
    // so a budget whose peak exactly equals `budgetableBytes` is rejected — that
    // peak plus the reserved baseline is the whole address space, the RLIMIT_AS
    // edge. `ceil(budgetableBytes / MULTIPLE) - 1` is the last integer strictly
    // under `budgetableBytes / MULTIPLE`.
    // Reject a too-small address space on its own terms FIRST. Once
    // `budgetableBytes` is zero or negative no budget can pass, and the loop
    // below would report "a limit of -1" (or -2796203 at addressSpaceMb 32) while
    // naming `maxLogBytes` -- pointing the operator at the knob that is not the
    // problem. The baseline is what `addressSpaceMb` must clear here.
    if (budgetableBytes <= 0) {
      throw new Error(`dsh-code-runtime-python: config.addressSpaceMb must exceed the ${INTERPRETER_BASELINE_BYTES}-byte interpreter baseline with room for the output budgets, so the child has address space left to build and encode them; got ${String(this.config.addressSpaceMb)} MiB (${addressSpaceBytes} bytes)`)
    }
    const admissibleBudget = Math.ceil(budgetableBytes / OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE) - 1
    for (const key of ['maxLogBytes', 'maxValueBytes'] as const) {
      if (this.config[key] * OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE >= budgetableBytes) {
        throw new Error(`dsh-code-runtime-python: config.${key} times the ${OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE}x worst-case Unicode expansion must fit within the ${budgetableBytes} bytes left after the ${INTERPRETER_BASELINE_BYTES}-byte interpreter baseline within the ${addressSpaceBytes}-byte addressSpaceMb, so a near-budget output truncates rather than breaching RLIMIT_AS as worker-exit; got ${String(this.config[key])} against a limit of ${admissibleBudget}`)
      }
    }
    // Resolve and validate the executable ONCE, after the pure config checks.
    // Re-resolving a basename in each run would let a later PATH change silently
    // switch interpreters, while an unchecked explicit path would turn
    // self-contained misconfiguration into a late worker-exit. A missing or
    // unsupported interpreter is a load failure. Later filesystem mutation is
    // outside config validation; a missing executable settles as worker-exit.
    const pythonBin = resolvePythonBin(this.config.pythonBin)
    if (pythonBin === undefined) {
      const explicit = isAbsolute(this.config.pythonBin) || this.config.pythonBin.includes('/')
      throw new Error(`dsh-code-runtime-python: config.pythonBin ${JSON.stringify(this.config.pythonBin)} ${explicit ? 'is not an executable regular file' : 'does not resolve on PATH'}`)
    }
    validatePythonBin(pythonBin)
    this.pythonBin = pythonBin
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
      // synchronously, so no async boundary opens before `execute` registers the
      // run and installs the abort listener.
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

  /** Spawn the child for one validated run and drive it to settlement. */
  private execute(
    request: CodeRunRequest,
    bindings: Map<string, ValidatedNamespace>,
    bootstrapPath: string,
  ): Promise<CodeRunResult> {
    // This run's own staging directory, removed at settlement.
    const bootstrapDir = dirname(bootstrapPath)
    // Explicit pipe count of 4 puts the framed-JSON channel at fd 3 in the child.
    // The constructor resolved and validated the interpreter once; runs keep that
    // exact path even if the host later changes PATH.
    // `spawn` can throw SYNCHRONOUSLY — a descriptor-exhausted host (EMFILE) or a
    // libuv-level failure surfaces here, before the Promise executor and its
    // settlement path exist. Left uncaught it would REJECT run() (the seam
    // permits rejection only for misuse) and strand this run's staging directory,
    // which only settle() removes. Catch it, unlink the directory, and resolve a
    // `worker-exit` — the same class as the async ENOENT `error` event below.
    let child: ChildProcessWithoutNullStreams
    let proto: Duplex | null
    try {
      // `-u` keeps the interpreter's own stdout/stderr UNBUFFERED: a program
      // that writes through `sys.__stdout__`/`sys.__stderr__` (or C-stdio
      // layered on the same fds) must have those bytes visible to the host's
      // stray capture immediately — a block-buffered wrapper would otherwise
      // hold them until an explicit flush, and the host SIGTERMs the child
      // right after the done frame, before any finalization-time flush could
      // run. The `_LogStream` replacement of `sys.stdout`/`sys.stderr` is
      // unaffected (it is a Python object, not the C-level stdio buffer).
      child = spawn(this.pythonBin, ['-u', '-I', bootstrapPath], {
        // Preserve only the platform temp directory. macOS system Python emits a
        // startup warning when TMPDIR is absent; ambient credentials, PATH, HOME,
        // and other host state remain unavailable to model code.
        env: pythonEnvironment(),
        detached: true, // Own process group — kill(-pid, sig) reaches subprocesses the model program spawns.
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      })
      // Fd 3 is a duplex pipe carrying protocol frames. Node types extra stdio
      // entries as `Stream | null`; the runtime shape with `'pipe'` is a duplex,
      // so we narrow at the boundary rather than smearing casts below. Stdout
      // and stderr are guaranteed non-null under `'pipe'` and typed as such.
      proto = child.stdio[3] as Duplex | null
      /* v8 ignore next 3 -- `'pipe'` stdio always populates fd 3; guarding Node's `Stream | null` typing widening. */
      if (proto === null) {
        throw new Error('dsh-code-runtime-python: python subprocess spawned without a fd-3 pipe')
      }
      // Close the host's stdin write handle immediately: the program is an
      // async body that reads nothing from fd 0, and a live pipe here would
      // hold a host-side handle open past the run — a setsid-escaped descendant
      // inheriting fd 0 would keep the host process from exiting even after the
      // closeDeadline forced settlement. The child (and any descendant) reads
      // EOF on fd 0 instead, and no host handle survives.
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- the boot-write-failure fake child has no stdin.
      child.stdin?.destroy()
    } catch (error: unknown) {
      try {
        rmSync(bootstrapDir, { recursive: true, force: true })
      } catch {
        // Same swallow as settle()'s removal: `force` already absorbs a missing
        // directory, so only a filesystem-level refusal reaches here, and the
        // staging copy holds nothing but two checked-in scripts.
      }
      return Promise.resolve({ logs: [], error: { kind: 'worker-exit' as const, message: `python spawn error: ${errorMessage(error)}` } })
    }

    return new Promise<CodeRunResult>((resolve) => {
      let settled = false
      // One ledger per run: it holds the `logs` this promise resolves with, the
      // shared byte budget every log entry and stray byte is billed against, and
      // the truncation state the `log` frame arm and the finish paths funnel
      // into.
      const ledger = new OutputLedger(this.config.maxLogBytes)
      child.stdout.on('data', (chunk: Buffer) => { ledger.captureStdout(chunk) })
      child.stderr.on('data', (chunk: Buffer) => { ledger.captureStderr(chunk) })
      child.stdout.on('end', () => { ledger.flushStdout() })
      child.stderr.on('end', () => { ledger.flushStderr() })

      // Line-framed JSON reader over fd 3. The unframed buffer is bounded: a
      // hostile program can loop `os.write(3, b"A"*4096)` with no newline to
      // exhaust HOST memory, which the child's RLIMIT_AS does not cover. It is
      // a memory-safety bound only: legitimate `call` frames may be large
      // (binding traffic has no seam byte cap), so it never keys off
      // maxValueBytes.
      // Buffered as raw chunks with a running byte counter: appending is O(1)
      // per chunk (a string `+=` accumulator would re-copy the whole prefix on
      // every pipe chunk — quadratic on a large frame), joins happen only when
      // a newline actually arrived, and the ceiling check reads the counter.
      let pendingChunks: Buffer[] = []
      // Fragments already merged into finished blocks. Kept separate from
      // `pendingChunks` so sealing never re-copies what earlier seals produced;
      // the two together are the unframed buffer, and `pendingBytes` counts both.
      let sealedBlocks: Buffer[] = []
      let pendingBytes = 0
      proto.on('data', (chunk: Buffer) => {
        // Once settled, stop accumulating: a hostile child that keeps flooding
        // fd 3 between finish() and close must not regrow the host buffer.
        /* v8 ignore next -- post-settlement data needs the child to outrace close after we decided. */
        if (settled) return
        // Schedule ONE post-batch outstanding-call check per macrotask. The
        // check must see the TRUE count — the live count is inflated by this
        // batch's own frames (the finallys run on the microtask queue, which
        // drains only when the macrotask ends), and a per-event snapshot is
        // stale when flowing mode fires several 'data' events within one
        // macrotask before any microtask drains. setImmediate runs after the
        // current macrotask's microtasks, so the count is exact; the flag
        // dedupes the check across the events of one macrotask. The threshold
        // is STRICT: exactly MAX_PENDING_REPLIES outstanding calls are allowed,
        // so a program that returns with calls it never awaited still
        // completes (the done frame settles the run; the check no-ops on
        // `settled`).
        if (!postBatchCheckPending) {
          postBatchCheckPending = true
          setImmediate(() => {
            postBatchCheckPending = false
            /* v8 ignore next -- the done frame can settle the run between the schedule and this callback. */
            if (settled) return
            if (pendingCalls > MAX_PENDING_REPLIES) {
              finish({ error: { kind: 'worker-exit', message: `call backlog exceeded ${MAX_PENDING_REPLIES} in-flight binding calls (a binding never settled)` } })
            }
          })
        }
        pendingChunks.push(chunk)
        pendingBytes += chunk.length
        // Check the counter BEFORE the join, not the joined line afterwards:
        // Buffer.concat allocates a second copy of everything held, so a line
        // measured after the concat had already cost twice the ceiling — the
        // ceiling this check exists to enforce. The counter is exact and free,
        // and the retained chunks are released here so the rejected payload is
        // not still held while the run settles.
        //
        // The counter charges the whole unframed buffer, which over-counts by at
        // most the newline-bearing chunk's own length (one pipe read): the
        // residual carried in is always a partial line, so nothing but the
        // current line can be larger than that. That over-count is deliberate and
        // load-bounded on the OTHER side: the config cap is `parse-cap - envelope`,
        // and a legitimate near-cap frame plus a following chunk's leading bytes
        // could in principle nudge the counter over the cap for one read window
        // — but only when maxLogBytes/maxValueBytes is configured within one
        // pipe read of the 64 MiB cap, orders of magnitude past the 32/64 KiB
        // defaults.
        //
        // The cap is enforced ONLY when the held bytes are still a single
        // unframed line (this chunk carries no newline, and earlier
        // newline-bearing chunks were joined immediately): a frame past the cap
        // would otherwise be fully `Buffer.concat`-ed (a second copy of its
        // bytes) and only then dropped in the line loop — the peak-memory
        // doubling this pre-concat check exists to prevent. Dropping the
        // oversized unframed buffer before the join keeps the peak at one copy
        // of the wire bytes. When this chunk DOES carry a newline the buffer
        // holds several frames, so the FIRST-FRAME check below (not this
        // counter, which charges them all) decides.
        if (pendingBytes > this.frameParseCapBytes && !chunk.includes(0x0a)) {
          pendingChunks = []
          sealedBlocks = []
          pendingBytes = 0
          finish({ error: { kind: 'worker-exit', message: `protocol frame exceeded ${this.frameParseCapBytes} bytes on fd 3` } })
          return
        }
        // Bound the FRAGMENT COUNT as well as the byte total, but only AFTER the
        // ceiling check above: sealing first would `Buffer.concat` an already
        // over-ceiling payload and allocate a second copy of it before the
        // rejection ran, which is the peak-memory doubling that check exists to
        // prevent.
        //
        // Fragment count needs its own bound because the ceiling meters payload
        // bytes only, while each retained chunk is a separate Buffer with object
        // and backing-store overhead no byte count sees: 5000 single-byte
        // newline-free writes produced 5000 chunks holding 5031 bytes, so a
        // program pacing such writes could accumulate millions of objects inside
        // the wall budget and exhaust the host heap far below the ceiling.
        //
        // Sealing appends to a list of finished blocks instead of re-merging
        // everything held. Concatenating the whole buffer at each threshold
        // re-copied the entire accumulated prefix every time, so the cumulative
        // copy volume was quadratic, not the amortized O(1) an earlier revision
        // of this comment claimed: 10 MiB trickled a byte at a time copies
        // 53.7 GB that way, and 64 MiB copies 2.2 TB. Here each byte is copied
        // once into its block and never again, so the total stays linear, and the
        // block list is itself bounded — every block holds at least
        // `MAX_PENDING_CHUNKS - 1` bytes, so reaching the 64 MiB cap admits
        // at most a few hundred thousand of them.
        // Sealing runs ONLY on a newline-free chunk, and after the newline
        // branch below: a chunk carrying a newline must reach the join (and its
        // first-frame check) rather than being sealed into a block the check
        // would then not scan for newlines. That keeps the invariant
        // `sealedBlocks hold newline-free prefixes only` true, so the
        // first-frame scan below can charge each sealed block's whole length
        // toward the first frame without missing a newline inside it.
        if (chunk.includes(0x0a)) {
          // First-FRAME check before the join: measure the bytes up to the
          // first newline across the held chunks. The byte counter cannot
          // serve here — it charges the whole buffer, which legitimately
          // holds several frames each within the cap. A first frame past the
          // cap is dropped before the join (one copy of its wire bytes);
          // later frames in the same buffer are handled line by line in the
          // loop below.
          let firstFrameLen = 0
          let sawNewline = false
          // Sealed blocks hold newline-free prefixes only (see the sealing
          // gate below), so they are entirely part of the first frame.
          for (const b of sealedBlocks) firstFrameLen += b.length
          for (const c of pendingChunks) {
            const nl = c.indexOf(0x0a)
            if (nl >= 0) {
              firstFrameLen += nl
              sawNewline = true
              break
            }
            firstFrameLen += c.length
          }
          if (sawNewline && firstFrameLen > this.frameParseCapBytes) {
            pendingChunks = []
            sealedBlocks = []
            pendingBytes = 0
            finish({ error: { kind: 'worker-exit', message: `protocol frame exceeded ${this.frameParseCapBytes} bytes on fd 3` } })
            return
          }
          let buffered = Buffer.concat(sealedBlocks.length > 0 ? [...sealedBlocks, ...pendingChunks] : pendingChunks)
          sealedBlocks = []
          let newline: number
          while ((newline = buffered.indexOf(0x0a)) >= 0) {
            const line = buffered.subarray(0, newline)
            buffered = buffered.subarray(newline + 1)
            /* v8 ignore next -- an empty line comes only from a forged `\n\n` write. */
            if (line.length === 0) continue
            // No per-line cap check here: the pre-join counter (single unframed
            // line) and the first-frame check (newline-bearing chunk) above
            // reject any frame past FRAME_PARSE_CAP_BYTES before this join, so
            // every line in this loop is within the cap by construction — a
            // per-line check would be dead code.
            // `toString('utf8')` would silently REPLACE illegal bytes with
            // U+FFFD, corrupting a completion or binding payload a forged
            // frame smuggled in (the honest child's lossless encoder never
            // emits non-UTF-8, so such a frame is hostile traffic). The fatal
            // decode throws on them and the frame is dropped — not accepted
            // with a mangled value — the same treatment as the unsafe-integer
            // check below.
            let text: string
            try {
              text = UTF8_FATAL.decode(line)
            } catch {
              continue
            }
            // JSON.parse would silently ROUND an integer token outside the
            // safe range before validation could see it, so a forged frame
            // could smuggle a corrupted value into a dispatch or completion.
            // An honest child never emits one (its validator rejects unsafe
            // ints), so such a frame is hostile traffic: drop it like any
            // other junk frame.
            if (hasUnsafeIntegerToken(text)) continue
            let parsed: unknown
            try {
              parsed = JSON.parse(text) as unknown
            } catch {
              continue // Junk frames drop silently (hostile-peer stance).
            }
            const message = validateChildFrame(parsed)
            if (message) handleFrame(message)
          }
          // Carry the residual forward as a fresh, right-sized copy, NOT the
          // `subarray` view: a view keeps the whole joined-frame allocation from
          // the `Buffer.concat` above alive, so a large frame followed by a tiny
          // trailing fragment would pin megabytes while `pendingBytes` reported
          // only the fragment's length. See {@link detachResidual}.
          pendingChunks = detachResidual(buffered)
          pendingBytes = buffered.length
        } else if (pendingChunks.length >= MAX_PENDING_CHUNKS) {
          // A newline-free run past the fragment-count bound: seal the held
          // chunks into one finished block (amortized O(1) per byte, see the
          // comment above the count bound) and keep accumulating. The gate on
          // `chunk.includes(0x0a)` is the ELSE half of the newline branch, so a
          // newline-bearing chunk never lands in a sealed block.
          sealedBlocks.push(Buffer.concat(pendingChunks))
          pendingChunks = []
        }
      })

      // Duplicate-call suppression against the honest child's id SEQUENCE, not
      // a set of every id seen. `dispatch` sends consecutive ids from 0 with no
      // gaps — it advances its counter only after the write succeeds, so a call
      // rejected before reaching the wire consumes nothing — which makes the
      // next legitimate id exactly `nextCallId`.
      //
      // Retaining a set instead let a program write an unbounded run of unique
      // forged ids, each below the 64 MiB per-frame parse cap so nothing
      // rejected them, and grow host memory for the whole run. Accepting any
      // id above a high-water mark would have been just as wrong in the other
      // direction: one forged `{"id": 9999}` would starve every honest call
      // after it. The exact successor is the only test that both bounds the
      // retained state to one number and cannot be poisoned by a forgery.
      let nextCallId = 0

      // Set by run() when the boot frame is written; the fd-3 handler calls it
      // on boot-ack to send the run frame (see the seam's boot->boot-ack->run
      // order). scoped per run. An object holder so the cross-closure
      // assignment is a property write (eslint's prefer-const cannot see the
      // reassignment through the closure).
      const bootAckGate: { run?: () => void } = {}
      const handleFrame = (message: ChildToHost): void => {
        /* v8 ignore next -- late frame after settlement; defensive against forged post-settlement traffic. */
        if (settled) return
        switch (message.type) {
          case 'boot-ack':
            // The child accepted the boot frame (namespaces built); the run
            // frame goes out now, not with the boot frame.
            bootAckGate.run?.()
            return
          case 'log':
            if (message.truncated === true) {
              ledger.markChildTruncated()
              return
            }
            ledger.admitFrame(message.text, message.open === true)
            return
          case 'done': {
            // The call-backlog cap must also hold when the child finishes in
            // the SAME batch as its flood: the post-macrotask check no-ops once
            // this done frame settles the run, so a done arriving right after
            // more than MAX_PENDING_REPLIES call frames in one data event would
            // otherwise complete successfully with the outstanding closures
            // left behind (a single sub-64 KiB write can carry 1025 compact
            // calls plus a done). The strict threshold lets exactly
            // MAX_PENDING_REPLIES outstanding calls — a program that returned
            // without awaiting its calls — complete normally.
            if (pendingCalls > MAX_PENDING_REPLIES) {
              finish({ error: { kind: 'worker-exit', message: `call backlog exceeded ${MAX_PENDING_REPLIES} in-flight binding calls (a binding never settled)` } })
              return
            }
            if (message.error) {
              finish({ error: { kind: message.error.kind, message: capMessage(message.error.message, this.config.maxValueBytes) } })
              return
            }
            if (message.value === undefined) {
              finish({})
              return
            }
            // Re-enforce the completion budget and number losslessness
            // host-side: a forged done frame bypasses the Python-side
            // _done_with_value check, and validateChildFrame no longer scans
            // the value (an unbounded scan would push every member of a wide
            // forgery before any cap ran). checkDoneValue folds both jobs into
            // one bounded, iterative traversal — iterative because the seam's
            // CodeJsonValue has no depth limit and an honest deep-but-small
            // completion must cross intact rather than dying on stringify
            // recursion; bounded because it stops at the cap without
            // materializing the encoding, rejecting a forged value anywhere
            // below the 64 MiB frame parse cap before it forces host-side copies.
            // The seam forbids substituting a rendered/truncated value, so an
            // oversized value fails the run as output-limit and a non-lossless
            // number as invalid-output. The value is JSON-plain by construction
            // (it came from JSON.parse of the frame), the traversal's precondition.
            const check = checkDoneValue(message.value, this.config.maxValueBytes)
            if (!check.ok) {
              finish(check.reason === 'over-budget'
                ? { error: { kind: 'output-limit', message: `completion value exceeded ${this.config.maxValueBytes} bytes` } }
                : { error: { kind: 'invalid-output', message: 'completion value contained a non-lossless number' } })
              return
            }
            finish({ value: message.value as CodeJsonValue })
            return
          }
          case 'call': {
            if (message.id !== nextCallId) return
            nextCallId += 1
            const record = bindings.get(message.global)?.functions
            const fn = record && Object.hasOwn(record, message.name) ? record[message.name] : undefined
            if (typeof fn !== 'function') {
              // `call.global` and `call.name` are attacker-controlled strings
              // with no byte cap of their own — only the 64 MiB fd-3 frame
              // parse cap — so each is sliced to `maxValueBytes` CODE UNITS
              // BEFORE it reaches the template. Interpolating them whole would
              // copy them into the message, `JSON.stringify` would copy the
              // escaped form, `encodeJsonPlain` the frame, and the pipe write
              // again: four full-size host allocations off one below-ceiling
              // forgery, past every hostile-peer bound the log and done-error
              // paths apply. Nothing past the first `maxValueBytes` code units
              // of either field can survive the byte cap anyway, so the slices
              // lose only text `capMessage` would drop, and that final cap
              // gives this reply the same budget and marker as a forged done
              // error.
              const cap = this.config.maxValueBytes
              const target = `${message.global.slice(0, cap)}.${message.name.slice(0, cap)}`
              // JSON.stringify on the WHOLE capped target would still allocate
              // the escaped form — up to ~6x under control-heavy input, a
              // multi-hundred-MB spike near the maxValueBytes ceiling that no
              // hostile-peer bound would have admitted. The message only needs
              // to identify the binding, so the escaped form is built from a
              // 1 KiB prefix; capMessage then enforces the reply budget.
              const preview = JSON.stringify(target.slice(0, 1024))
              sendReply({ type: 'reply', id: message.id, ok: false, message: capMessage(`unknown binding ${preview}`, cap) })
              return
            }
            // Count the outstanding binding call before dispatch and release the
            // slot in the async body's finally. The CAP CHECK runs in the data
            // handler's post-macrotask pass (where the finallys have drained),
            // not here: a per-frame check would see every frame of one event as
            // in-flight and false-positive on a legitimate gather of more than
            // MAX_PENDING_REPLIES instant calls.
            pendingCalls += 1
            void (async () => {
              try {
                const resolved = await fn(message.args)
                // Drop a reply the run no longer needs BEFORE snapshotting it.
                // `sendReply` also checks `settled`, but only after this value has
                // been walked and copied: a binding that resolves a wide value
                // after `maxWallMs`, an abort, or dispose already settled the run
                // would spend host heap on a frame that is then discarded, and
                // binding resolution carries no seam-level byte cap to bound it.
                // oxlint-disable-next-line typescript/no-unnecessary-condition -- the run can settle while this binding is awaited.
                if (settled) return
                // The seam requires a lossy resolution to REJECT descriptively,
                // not silently coerce: a raw JSON.stringify would turn NaN/
                // Infinity into null and drop undefined fields. Snapshot through
                // the same lossless-JSON boundary the worker backend uses (also
                // iterative, so a deeply nested value cannot overflow the stack).
                const value = snapshotJsonValue(resolved)
                if (value === undefined) {
                  sendReply({ type: 'reply', id: message.id, ok: false, message: 'binding resolution must be lossless JSON' })
                  return
                }
                sendReply({ type: 'reply', id: message.id, ok: true, value })
              } catch (error: unknown) {
                // Check `settled` before formatting the error: a rejection that
                // arrives after `maxWallMs`, an abort, or dispose has already
                // settled the run, and `errorMessage(error)` runs hostile getters
                // before `sendReply` peeks at `settled`. Dropping the framed
                // reply early spares the host heap and time for a run whose
                // outcome is already fixed.
                // (oxlint block-disable so both `v8 ignore next` and the rule
                // suppression land on the `if`: `settled` flips true mid-wait,
                // invisible to the type-aware lint, which narrows it to false.)
                /* oxlint-disable typescript/no-unnecessary-condition */
                /* v8 ignore next -- a rejection arriving after settlement is not schedulable from a test. */
                if (settled) return
                /* oxlint-enable typescript/no-unnecessary-condition */
                sendReply({ type: 'reply', id: message.id, ok: false, message: errorMessage(error) })
              } finally {
                // Release the in-flight slot on every exit — reply written,
                // resolution rejected, or the run settling mid-wait (the
                // `settled` early returns above). Without this, a binding that
                // never resolves would leak its slot past the cap check and the
                // flood bound would erode.
                pendingCalls -= 1
              }
            })()
            return
          }
          /* v8 ignore next -- closed-union backstop; the compiler rejects a new child frame here. */
          default:
            assertNever(message, 'python runtime child frame')
        }
      }

      // Write one reply frame with the iterative encoder: a binding
      // resolution has no seam-level depth or byte cap, so a deeply nested
      // value must not die on JSON.stringify's recursion. The payload is
      // JSON-plain by construction (snapshotJsonValue output, or literal
      // strings/numbers), which is encodeJsonPlain's precondition. A closed
      // pipe (child already gone) is swallowed since the close path settles
      // the run.
      //
      // Replies are encoded and written ONE AT A TIME, waiting for `drain`
      // whenever fd 3's buffer is full. Binding resolution carries no
      // seam-level byte cap, so a program that resolves several large values in
      // one `asyncio.gather` round would otherwise encode them all in the same
      // turn and queue every frame in the writable stream's buffer -- measured
      // to exhaust a 256 MiB Node heap, which kills the whole host process
      // rather than failing this one run. Pacing changes no model-visible
      // behavior: the child matches each reply to its `call` by id from a pump
      // that reads fd 3 continuously, so arrival order was never observable,
      // and the bindings themselves still run concurrently. Only the host's peak
      // memory and the flush timing change.
      const replyQueue: ReplyMessage[] = []
      // Replies queued but not yet written, tracked separately from
      // `replyQueue.length`: the drain loop clears consumed slots to `undefined`
      // but does not shrink the array until it finishes, so `length` counts
      // consumed frames too. The counter is what the cap in `sendReply` reads.
      let pendingReplies = 0
      // Binding calls dispatched but not yet settled (the async body below
      // still awaits the binding's promise). The reply backlog cap only counts
      // RESOLVED calls — `pendingReplies` grows after the await — so a child
      // flooding calls against a binding that never settles would accumulate
      // one async closure per frame until the wall clock without tripping it.
      // Counted here before dispatch and released in the body's finally; the
      // data handler schedules a post-macrotask check (see there) that settles
      // the run as worker-exit when the true outstanding count passes
      // MAX_PENDING_REPLIES.
      let pendingCalls = 0
      // Dedupes the post-batch outstanding-call check across the 'data' events
      // of one macrotask (see the data handler).
      let postBatchCheckPending = false
      let draining = false
      // Resolve when fd 3 can take another frame, OR when it is gone: a pipe
      // destroyed under the drain (child exited, close-deadline teardown) never
      // emits 'drain' again, so waiting on that event alone would hang the
      // drain forever — `draining` stays true and the unconsumed queue is
      // pinned with the closure. `once` plus the manual detach removes every
      // listener whichever event wins, so a long backpressure wait leaves none
      // behind.
      const waitForDrain = (): Promise<void> => new Promise<void>((resolvePromise) => {
        const finish = (): void => {
          proto.off('drain', finish)
          proto.off('close', finish)
          proto.off('error', finish)
          resolvePromise()
        }
        proto.once('drain', finish)
        proto.once('close', finish)
        proto.once('error', finish)
      })
      const drainReplies = async (): Promise<void> => {
        if (draining) return
        draining = true
        let head = 0
        try {
          while (head < replyQueue.length) {
            // Needs the run to settle between two queued frames. Measured queue
            // depths reach 11 without the wall clock landing inside that window.
            /* v8 ignore next -- see above; not schedulable from a test. */
            if (settled) break
            // A pipe destroyed under us (child exited, close deadline) will
            // never emit 'drain' again; short-circuit before the write so the
            // remaining frames are dropped by the `finally` below.
            if (proto.destroyed) break
            // Read by index, not `shift()`: a large `asyncio.gather` of wide
            // bindings awaiting fd 3's `drain` can queue many frames, and each
            // `shift()` re-slices the remaining array (O(n) per pop, O(n²) over
            // the whole drain). A head cursor keeps the cost linear; the `finally`
            // below discards everything consumed once the drain ends. The consumed
            // slot is CLEARED here (not just advanced past) so a wide payload the
            // pipe has already taken is released immediately: under sustained
            // backpressure the drain loop can live across many `await drain`
            // ticks, and leaving the slot set would pin the written value's bytes
            // in `replyQueue` for the whole busy period, making host memory grow
            // with cumulative processing rather than the current backlog.
            const payload = replyQueue[head] as ReplyMessage
            replyQueue[head] = undefined as unknown as ReplyMessage
            head += 1
            pendingReplies -= 1
            // Compact the consumed prefix once it reaches the backlog bound:
            // the array never shrinks until the drain finishes, and a child
            // that reads replies just fast enough to keep the drain alive but
            // never empty would otherwise grow the backing store linearly with
            // cumulative throughput (consumed slots are undefined, but `length`
            // keeps counting them). The splice is O(head) once per
            // MAX_PENDING_REPLIES consumed frames — amortized O(1) per reply.
            if (head >= MAX_PENDING_REPLIES) {
              replyQueue.splice(0, head)
              head = 0
            }
            // Encode inside the loop, not up front: a queued reply the run no
            // longer needs is dropped by the `settled` check above without ever
            // being serialized.
            if (!proto.write(`${encodeJsonPlain(payload)}\n`)) {
              await waitForDrain()
            }
          }
        } catch {
          // Pipe closed under us (child exited), or `drain` never arrives because
          // the child died. The close path settles the run either way.
        } finally {
          draining = false
          pendingReplies = 0
          replyQueue.length = 0
        }
      }
      const sendReply = (payload: ReplyMessage): void => {
        /* v8 ignore next -- `settled` covers a race where the child exits between decision and write. */
        if (settled) return
        // A child that stops reading fd 3 leaves the drain loop blocked on
        // `drain` forever while its call frames keep resolving into replies:
        // the backlog would grow without bound until the wall clock, pinning
        // every binding result the child provokes. Cap the retained backlog and
        // settle the run as a worker-exit, the same hostile-peer bound the
        // frame cap applies to inbound bytes.
        if (pendingReplies >= MAX_PENDING_REPLIES) {
          finish({ error: { kind: 'worker-exit', message: `reply queue exceeded ${MAX_PENDING_REPLIES} pending frames on fd 3 (the child stopped consuming its replies)` } })
          return
        }
        pendingReplies += 1
        replyQueue.push(payload)
        void drainReplies()
      }

      // Escalate SIGTERM → grace → SIGKILL on the entire process group. Idempotent
      // via `killing`.
      let killing = false
      let graceTimer: NodeJS.Timeout | undefined
      // A backstop for the one case `close` cannot cover: model code that starts
      // a descendant with `os.setsid()`/`start_new_session=True` moves it into a
      // fresh process group, so the SIGTERM/SIGKILL aimed at the child's group
      // (`kill(-pid)`) never reaches it. If that orphan inherited stdout/stderr/
      // fd 3 and outlives the run, those pipes stay open and `close` never fires
      // — leaving run() (and a teardown awaiting `finished`) hung indefinitely.
      // finish() arms this deadline; when it fires we detach our stream handles
      // and settle on the already-decided result regardless of the orphan.
      let closeDeadline: NodeJS.Timeout | undefined
      // The leader's start time, read once while it is certainly alive. `child.pid`
      // keeps its numeric value after the leader is reaped (Node clears the
      // internal handle, not the field), and `close` can trail `exit` by seconds
      // while a pipe-holding descendant keeps the streams open. Signalling
      // `-child.pid` in that window is a RAW syscall -- `child.kill()` would
      // refuse, having dropped its handle, but `process.kill` has no such guard --
      // so a recycled pgid would receive this run's SIGTERM and armed SIGKILL.
      // `groupEmpty()` cannot cover it: it reports whether the group has members,
      // not whether they are OURS, and it runs only after the first signal.
      // The repository already takes this position in
      // packages/subprocess/subprocess-local (`ProcessIdentity`, "preventing
      // teardown escalation after PID reuse"); this is the same guard, kept local
      // because a dependency on that package would be a new architectural edge.
      const leaderStarted = child.pid === undefined ? undefined : readProcessStart(child.pid)
      const killGroup = (sig: NodeJS.Signals): void => {
        try {
          /* v8 ignore next -- undefined pid means spawn never produced a process; finish() short-circuits before reaching kill(). */
          if (child.pid === undefined) return
          // A pid alone cannot answer this: `process.kill(pid, 0)` succeeds just
          // as well for a REPLACEMENT process holding the recycled number. Only
          // the start time distinguishes the two, so a reading that DISAGREES
          // means the number now belongs to another process and must not be
          // signalled.
          //
          // An ABSENT reading is the ordinary case, not a mismatch: once the
          // leader is reaped its `/proc/<pid>/stat` is gone, while the group it
          // led can still hold survivors that this teardown exists to reap. So
          // only a present-and-different reading blocks the signal; undefined
          // falls through, which is also the behavior on platforms with no
          // `/proc` to read.
          const nowStarted = readProcessStart(child.pid)
          // The refusal arm needs a real pid recycled into a new group leader
          // between spawn and teardown, which no test can schedule; the reader
          // itself is covered directly by the process-identity test.
          /* v8 ignore next -- unreachable without real pid reuse; see above. */
          if (leaderStarted !== undefined && nowStarted !== undefined && nowStarted !== leaderStarted) return
          process.kill(-child.pid, sig)
        } catch {
          // ESRCH — the process already died. Nothing to do.
        }
      }
      const kill = (): void => {
        /* v8 ignore next -- kill() is idempotent; tests do not double-invoke it. */
        if (killing) return
        killing = true
        killGroup('SIGTERM')
        // Escalate to SIGKILL after the grace window. The timer is `unref`'d so a
        // pending SIGKILL never keeps the host process alive on its own; the
        // guarantee that a same-group survivor is actually reaped before the fiber
        // goes quiescent is enforced by settle() awaiting the group's death (see
        // there), NOT by this timer firing during host lifetime. A setsid-escaped
        // orphan in a FRESH group is the different case `closeDeadline` in finish()
        // covers, since `close` never fires there.
        graceTimer = setTimeout(() => { killGroup('SIGKILL') }, this.config.graceMs)
        graceTimer.unref()
      }
      // True once the group has no members left: a signal-0 probe to the whole
      // group (`kill(-pid, 0)`) throws ESRCH when empty (EPERM would still mean a
      // member exists). Only meaningful once a spawn produced a pid.
      const groupEmpty = (): boolean => {
        /* v8 ignore next -- pid is always defined once escalation runs; the guard narrows the type. */
        if (child.pid === undefined) return true
        try {
          process.kill(-child.pid, 0)
          return false
        } catch (error: unknown) {
          return (error as NodeJS.ErrnoException).code === 'ESRCH'
        }
      }

      let finishResolve!: () => void
      const finished = new Promise<void>((done) => { finishResolve = done })
      let resolved = false
      // The decided terminal result for a live child, recorded by finish() and
      // read by the `close` handler that settles it once the pipes have drained.
      let decided: Omit<CodeRunResult, 'logs'>

      // The single settlement point: resolve run() with the decided result and
      // mark the fiber quiescent. Idempotent — the first call wins, so a later
      // `close` after done/timeout/abort is absorbed as a no-op.
      const settle = (result: Omit<CodeRunResult, 'logs'>): void => {
        if (resolved) return
        resolved = true
        if (closeDeadline !== undefined) clearTimeout(closeDeadline)
        // The child has exited by now (settle runs on `close`, or on a spawn
        // that produced no pid), so its staging directory is no longer read and
        // this run's copy goes away with it. Removed SYNCHRONOUSLY, before
        // `resolve` below: a fire-and-forget removal left the directory on disk
        // when `run()` resolved, so a caller could not observe the "gone by
        // settlement" contract at all. Two files cost nothing to unlink here.
        try {
          rmSync(bootstrapDir, { recursive: true, force: true })
        } catch {
          // Swallows only a failure to remove this run's staging directory —
          // `force` already absorbs a missing one, so what remains is a
          // filesystem-level refusal. The run's own outcome is already decided
          // and must still be delivered; the directory holds no secret, only a
          // copy of two checked-in scripts. teardown deliberately does not
          // sweep staging (its staging is cleared inside each run's settle), so
          // a removal failure here is the one case the "gone by settlement"
          // contract degrades on.
        }
        resolve({ ...result, logs: ledger.lines })
        // Mark the fiber quiescent for THIS run: drop it from `live` and resolve
        // `finished` (what teardown awaits). Deferred until the process group is
        // actually empty — dropping from `live` before then would let a
        // `dispose()` that races a just-resolved run() snapshot an empty `live`
        // and return while a same-group survivor is still alive, making teardown's
        // "no SAME-GROUP subprocess outlives the fiber" guarantee false for that
        // window (a setsid escapee is the documented exception — see teardown's
        // JSDoc). Keeping the run in `live` until the group is reaped is exactly
        // what makes a concurrent teardown await it.
        const finalize = (): void => {
          this.live.delete(live)
          finishResolve()
        }
        // `finished` is what teardown awaits to honor "no same-group subprocess
        // outlives the fiber". When no escalation ran (normal completion, no
        // kill) or the group is already empty, cancel the pending SIGKILL and
        // finalize now. Clearing it is what bounds the PID-reuse hazard: an armed
        // `kill(-pid)` left to fire up to graceMs later could hit a RECYCLED pgid
        // once the kernel reused the leader's pid, SIGKILLing an unrelated group.
        // So the timer stays armed only while a real survivor exists — a
        // same-group descendant that ignored SIGTERM but released the pipes,
        // still alive here because its `close` is what got us to settle. In that
        // case withhold finalize and poll the group on REF'd timers (a
        // short-lived host would otherwise exit before the unref'd SIGKILL fired,
        // reparenting the survivor to init), clearing the timer the moment the
        // group empties. The wait is bounded by `graceMs + CLOSE_REAP_MARGIN_MS`
        // in the normal case; if the host event loop was blocked past both timers
        // the deadline branch below sends SIGKILL itself and grants ONE more reap
        // margin, so the outer bound is `graceMs + 2 * CLOSE_REAP_MARGIN_MS`.
        if (!killing || groupEmpty()) {
          if (graceTimer !== undefined) clearTimeout(graceTimer)
          finalize()
          return
        }
        const deadline = Date.now() + this.config.graceMs + CLOSE_REAP_MARGIN_MS
        // Once the deadline forces us to send SIGKILL ourselves, allow one more
        // reap window for the kernel to tear the group down before giving up:
        // SIGKILL is asynchronous, so the group is not gone the instant it is
        // sent. `finalize` only runs on a confirmed-empty group, except at this
        // final hard bound where nothing more can be done.
        let hardDeadline = 0
        const pollGroup = (): void => {
          if (groupEmpty()) {
            // The group is gone; the grace SIGKILL is moot. Cancel it (it may not
            // have fired yet) and finalize. graceTimer is always defined here:
            // pollGroup runs only when `killing` is set, and kill() armed it.
            clearTimeout(graceTimer)
            finalize()
            return
          }
          if (hardDeadline === 0 && Date.now() >= deadline) {
            // Deadline reached with the group still non-empty. This is reachable
            // when the host event loop was blocked past both timers: Node runs
            // this poll before the grace SIGKILL timer, so that SIGKILL may never
            // have fired. Send it HERE (idempotent if the timer already ran) and
            // keep polling for the group to actually empty — finalizing on mere
            // signal delivery would declare quiescence while the group is still
            // dying. Bound the extra wait by one more reap margin.
            killGroup('SIGKILL')
            clearTimeout(graceTimer)
            hardDeadline = Date.now() + CLOSE_REAP_MARGIN_MS
          }
          // Hard bound: the self-sent SIGKILL delivered but `groupEmpty()` still
          // reports the group non-empty for a full extra reap margin. This is
          // reachable, not a kernel quirk: a SIGKILL'd same-group survivor
          // lingers as a ZOMBIE until its parent `wait()`s it, and in a
          // container whose PID 1 does not reap orphans the survivor is
          // reparented to init and never waited, so the signal-0 probe keeps
          // succeeding — the same environment dependence the Agent Note's
          // rejected "assert the reap with process.kill(pid, 0)" alternative
          // documents. The ignore stays because that container cannot be built
          // deterministically across CI platforms, not because the branch is
          // unreachable; finalizing here bounds the wait so such a deployment
          // still goes quiescent within `graceMs + 2 * CLOSE_REAP_MARGIN_MS`.
          /* v8 ignore next 4 -- reachable only in a PID-1-doesn't-reap container (zombie survivor); not deterministically buildable. */
          if (hardDeadline !== 0 && Date.now() >= hardDeadline) {
            finalize()
            return
          }
          setTimeout(pollGroup, GROUP_REAP_POLL_MS)
        }
        pollGroup()
      }

      const finish = (result: Omit<CodeRunResult, 'logs'>): void => {
        if (settled) return
        settled = true
        decided = result
        clearTimeout(wallTimer)
        request.signal?.removeEventListener('abort', onAbort)
        // A spawn failure (ENOENT, EACCES) never produced a pid, so there is no
        // process to kill: settle now. Its `close` still fires later and reaches
        // the idempotent settle() again as a no-op.
        ledger.sealOpen()
        if (child.pid === undefined) {
          settle(result)
          return
        }
        // Live child: SIGTERM→grace→SIGKILL, then let `close` (below) settle the
        // run so any `done` frame buffered on fd 3 is handled first and the
        // process is fully reaped before the fiber goes quiescent.
        kill()
        // `close` awaits every stdio stream draining, which a setsid-escaped
        // orphan holding our inherited pipes can prevent forever. Bound that
        // wait: after SIGKILL has had the grace window plus a margin to reap the
        // child itself, force settlement on the decided result. Flush any
        // newline-free stray residual FIRST — a leader that wrote a diagnostic
        // with `os.write(1, ...)` and exited leaves it buffered, and destroying
        // the stream below drops it before an `end`/`close` flush could run, so
        // the diagnostic would be lost from `logs`. Detaching the stream handles
        // then lets `close` land as a no-op if it ever arrives, and stops the
        // orphan's stray output from being accounted against a run that already
        // finished. `unref` so the deadline never keeps the host process alive.
        closeDeadline = setTimeout(() => {
          ledger.flushStdout()
          ledger.flushStderr()
          proto.destroy()
          child.stdout.destroy()
          child.stderr.destroy()
          settle(result)
        }, this.config.graceMs + CLOSE_REAP_MARGIN_MS)
        closeDeadline.unref()
      }

      child.on('error', (error: Error) => {
        finish({ error: { kind: 'worker-exit', message: `python spawn error: ${error.message}` } })
      })
      // `close` (not `exit`) is the settlement trigger: it fires only after the
      // process exits AND every stdio stream — including the fd-3 protocol pipe —
      // has drained, so a `done` frame the child wrote just before exiting is
      // always handled before we settle. macOS can deliver `exit` before that
      // final fd-3 data; keying off `close` makes the ordering irrelevant.
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        // If done/timeout/abort already decided the result, finish() is a no-op
        // and `decided` holds it — a SIGXCPU that arrives after a decision does
        // not override it. Otherwise the child closed before completing: a
        // SIGXCPU close is the kernel's own CPU meter firing — the RLIMIT_CPU
        // soft limit, or the bootstrap's post-settlement getrusage check
        // re-delivering SIGXCPU when a program trapped the soft limit and
        // returned inside the soft-to-hard gap. That kernel-authoritative
        // signal is the ONLY basis for the timeout classification: wall time
        // is not evidence of CPU burn (a sleeping child SIGKILLed by a cgroup
        // OOM killer, an operator, or itself consumed none), so every other
        // signal or code — including an unsolicited SIGKILL, even the
        // hard-limit one — reports as an opaque worker exit.
        //
        // The message names `cpuSeconds` as the CONFIGURED ceiling, not "the
        // budget that fired": the child clamps RLIMIT_CPU to the stricter of
        // `cpuSeconds` and any inherited soft limit, so under a tighter inherited
        // cap SIGXCPU arrives before `cpuSeconds` — the host cannot see the
        // effective value, so it states the ceiling it set rather than a second
        // count it cannot guarantee.
        finish(signal === 'SIGXCPU'
          ? { error: { kind: 'timeout', message: `CPU time exhausted (limit at most the configured ${this.config.cpuSeconds}s; a stricter inherited RLIMIT_CPU can fire sooner)` } }
          : { error: { kind: 'worker-exit', message: `python exited (code=${String(code)}, signal=${String(signal)}) before completing` } })
        settle(decided)
      })

      // Fd-3 and the stdout/stderr pipes emit `error` on early child death
      // (ECONNRESET/EPIPE); swallow them so they do not become uncaught. The
      // authoritative failure signal is `child.on('close')` above.
      const silenceStreamError = (): void => {}
      proto.on('error', silenceStreamError)
      child.stdout.on('error', silenceStreamError)
      child.stderr.on('error', silenceStreamError)

      /* jscpd:ignore-start -- wall-timer/abort/live-run wiring deliberately parallels code-runtime-worker; see the constructor note. */
      const wallTimer = setTimeout(() => {
        finish({ error: { kind: 'timeout', message: `wall-clock ceiling reached (${this.config.maxWallMs}ms)` } })
      }, this.config.maxWallMs)

      const onAbort = (): void => {
        finish({ error: { kind: 'abort', message: errorMessage(request.signal?.reason) } })
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      const live: LiveRun = {
        kill,
        finished,
        settle: (failure: CodeRunFailure) => { finish({ error: failure }) },
      }
      this.live.add(live)
      /* jscpd:ignore-end */

      // Send the boot frame once fd 3 is writable. This runs LAST in run()'s
      // synchronous setup: its failure path calls finish(), which reads
      // wallTimer/onAbort and (through settle) live, so those bindings must
      // already be initialized — issuing the write earlier hit their
      // temporal dead zone and threw a ReferenceError that rejected run()
      // instead of resolving the worker-exit it constructs here.
      const boot: BootMessage = {
        type: 'boot',
        cpuSeconds: this.config.cpuSeconds,
        addressSpaceBytes: this.config.addressSpaceMb * 1024 * 1024,
        maxLogBytes: this.config.maxLogBytes,
        maxValueBytes: this.config.maxValueBytes,
        namespaces: [...bindings].map(([global, namespace]) => ({
          global,
          names: Object.keys(namespace.functions),
          ...namespace.errorClass ? { errorClass: namespace.errorClass } : {},
        })),
      }
      // The run frame is sent only after the child's boot-ack: the seam
      // contract puts `run` after `boot-ack` (the ack confirms the namespaces
      // were accepted), and sending it earlier would let a boot failure race
      // the run frame. The ack handler below writes it.
      let runSent = false
      try {
        proto.write(`${JSON.stringify(boot)}\n`)
      } catch (error: unknown) {
        finish({ error: { kind: 'worker-exit', message: `failed to boot python subprocess: ${errorMessage(error)}` } })
        return
      }
      // Register the ack gate with the frame handler before any data arrives.
      bootAckGate.run = (): void => {
        if (runSent) return
        runSent = true
        try {
          proto.write(`${JSON.stringify({ type: 'run', program: request.program })}\n`)
        } catch (error: unknown) {
          /* v8 ignore next -- the child exited between its ack and this write; the run settles as worker-exit. */
          finish({ error: { kind: 'worker-exit', message: `failed to boot python subprocess: ${errorMessage(error)}` } })
        }
      }
    })
  }
}

export default PythonCodeRuntime
