/**
 * Load-time admission for one runtime instance: the `Config` fields the plugin
 * declares, the gates that decide whether a configured set of values is
 * admissible, and the bounds those gates are written against.
 *
 * `resolveRuntimeConfig` and `resolveInterpreter` run once per plugin load and
 * throw on the first violation. The gates run in a fixed order, and that order
 * decides which message an operator sees when several values are wrong: cheap
 * shape checks first, then the checks that turn a self-contained
 * misconfiguration into a load failure instead of a late per-run one, then the
 * executable probe.
 * @module @deepseek-ai/dsh-experimental-ptc-runtime-python/src/config
 */

import { execFileSync } from 'node:child_process'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { getHeapStatistics } from 'node:v8'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { errorMessage } from '@deepseek-ai/dsh-value'

/** Plugin config: every cap, changeable from `cordis.yml` (no hardcoded tunables). */
export interface Config {
  /**
   * RLIMIT_CPU in whole seconds (a positive integer — `setrlimit` in the child
   * rejects a float). The child sets the soft limit to `cpuSeconds` and the
   * hard limit to `cpuSeconds + 1`: the kernel delivers SIGXCPU at the soft
   * limit, which the host classifies as a `timeout`; the +1s hard limit is a
   * SIGKILL backstop for a program that traps SIGXCPU. Granularity is whole seconds.
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
export type ResolvedConfig = Required<Config>

/** Lowest CPython version supported by the bootstrap and its traceback behavior. */
const MIN_CPYTHON = { major: 3, minor: 10 } as const

/** Fixed load-time probe bound; a configured executable must not hang plugin activation. */
const PYTHON_PROBE_TIMEOUT_MS = 5_000

/** The only host environment fact exposed to the child; the load-time probe and every run build it the same way. */
export function pythonEnvironment(): NodeJS.ProcessEnv {
  return { TMPDIR: tmpdir() }
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
      // lookup misses; resolveInterpreter reports the final load error.
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
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin ${JSON.stringify(bin)} failed the CPython version probe: ${errorMessage(error)}`)
  }
  const match = /^(\S+) (\d+) (\d+) (\d+)$/.exec(output)
  if (match === null) {
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin ${JSON.stringify(bin)} did not report a CPython version`)
  }
  const [, implementation, majorText, minorText, patchText] = match
  const major = Number(majorText)
  const minor = Number(minorText)
  if (implementation !== 'cpython') {
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin ${JSON.stringify(bin)} must be CPython, got ${implementation}`)
  }
  if (major < MIN_CPYTHON.major || (major === MIN_CPYTHON.major && minor < MIN_CPYTHON.minor)) {
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin ${JSON.stringify(bin)} must be CPython ${MIN_CPYTHON.major}.${MIN_CPYTHON.minor} or newer, got ${implementation} ${majorText}.${minorText}.${patchText}`)
  }
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
 * `[dsh-ptc-runtime-python] log capture truncated at <N> bytes` — 50 fixed
 * characters (the bracketed prefix `[dsh-ptc-runtime-python] log capture
 * truncated at ` counts both square brackets) plus the digits of N plus 6 —
 * and its serialized form adds 4 (two quotes, two array brackets), so the
 * smallest N that admits its own marker is 62 (50 + 2 + 6 + 4 = 62); 64 is the
 * floor with two bytes of room. The marker itself remains envelope, not
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
 * stdio; see the `closeDeadline` arm in {@link PythonPtcRuntime.execute}). It
 * covers the OS reaping the killed child itself after SIGKILL — not a deployment
 * choice but a fixed safety margin, so it is a constant rather than a config knob.
 */
export const CLOSE_REAP_MARGIN_MS = 2_000

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
 * Validate one plugin configuration against every load-time gate and return it
 * as the resolved set the runtime reads.
 *
 * A violation throws, so the plugin never registers with values that would fail
 * later and unhelpfully: an unsatisfiable output budget, an rlimit the child
 * cannot represent, a timer delay Node would clamp, or an address space too
 * small for the budgets to fit under RLIMIT_AS.
 * @param config - the configured values, with schemastery's defaults applied.
 * @param frameParseCapBytes - this instance's effective frame parse cap, which
 * bounds the budgets against what an honest child frame can cross.
 * @returns the same values, typed as complete.
 */
export function resolveRuntimeConfig(config: Config, frameParseCapBytes: number): ResolvedConfig {
  const resolved = config as ResolvedConfig
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'number' && !(Number.isFinite(value) && value > 0)) {
      throw new Error(`dsh-ptc-runtime-python: config.${key} must be a positive number, got ${String(value)}`)
    }
  }
  // cpuSeconds crosses to the child's setrlimit(RLIMIT_CPU) raw; a float
  // raises TypeError inside every child (a late per-run failure). Reject it
  // at load. maxLogBytes/maxValueBytes get their own integer gate below (the
  // child int()-truncates them, so a float would diverge from the host);
  // maxWallMs/graceMs/addressSpaceMb are consumed as numbers where a fraction
  // is harmless.
  if (!Number.isInteger(resolved.cpuSeconds)) {
    throw new Error(`dsh-ptc-runtime-python: config.cpuSeconds must be a positive integer, got ${String(resolved.cpuSeconds)}`)
  }
  // Finite is not the same as representable as an rlimit. `cpuSeconds` and its
  // `+ 1` hard limit both cross to `setrlimit` as integers, and `1e100` clears
  // `Number.isInteger` while being far past the safe range, so it cannot round
  // -trip: the child sees a different number than was configured. The `+ 1` is
  // what gets checked because that is the larger of the two values sent.
  if (!Number.isSafeInteger(resolved.cpuSeconds + 1)) {
    throw new Error(`dsh-ptc-runtime-python: config.cpuSeconds must be at most ${Number.MAX_SAFE_INTEGER - 1} (it and its +1 hard limit cross to setrlimit as exact integers), got ${String(resolved.cpuSeconds)}`)
  }
  // `addressSpaceMb` is multiplied by 1 MiB before it is framed, and a large
  // finite value overflows to `Infinity` there — which `encodeJsonPlain`
  // renders as `null`, so the child receives no limit at all and every run
  // ends in a bootstrap exception rather than a load-time configuration error.
  // Checking the DERIVED byte count is what catches it; the input itself looks
  // ordinary. Safe-integer, not merely finite, since the value must survive
  // the JSON round trip exactly.
  if (!Number.isSafeInteger(resolved.addressSpaceMb * 1024 * 1024)) {
    throw new Error(`dsh-ptc-runtime-python: config.addressSpaceMb must be at most ${Math.floor(Number.MAX_SAFE_INTEGER / (1024 * 1024))} (its byte count crosses the wire as an exact integer), got ${String(resolved.addressSpaceMb)}`)
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
  if (resolved.pythonBin === '' || resolved.pythonBin.includes('\0')) {
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin must be a non-empty path without NUL bytes, got ${JSON.stringify(resolved.pythonBin)}`)
  }
  // `maxWallMs` and `graceMs` are armed with setTimeout, which clamps any
  // delay past MAX_TIMER_DELAY_MS to 1 ms without a word — turning a
  // generous ceiling into an instant timeout and a generous grace period into
  // an instant SIGKILL. `graceMs` is checked against the margin the
  // close-deadline adds on top, since that sum is what gets armed.
  if (resolved.maxWallMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-ptc-runtime-python: config.maxWallMs must not exceed ${MAX_TIMER_DELAY_MS} (setTimeout clamps a larger delay to 1ms), got ${String(resolved.maxWallMs)}`)
  }
  if (resolved.graceMs + CLOSE_REAP_MARGIN_MS > MAX_TIMER_DELAY_MS) {
    throw new Error(`dsh-ptc-runtime-python: config.graceMs must not exceed ${MAX_TIMER_DELAY_MS - CLOSE_REAP_MARGIN_MS} (its close deadline adds ${CLOSE_REAP_MARGIN_MS}ms, and setTimeout clamps a larger delay to 1ms), got ${String(resolved.graceMs)}`)
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
  // into `PtcRunResult.error.message` and never re-crosses a frame-bounded
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
    // Node backend does for its byte budgets.
    if (!Number.isInteger(resolved[key])) {
      throw new Error(`dsh-ptc-runtime-python: config.${key} must be a positive integer (the child reads it as an int, so a float diverges from the host), got ${String(resolved[key])}`)
    }
    const limit = frameParseCapBytes - FRAME_ENVELOPE_BYTES
    if (resolved[key] > limit) {
      // Only a host whose heap is below the protocol cap reaches the
      // heap-constrained note; the constrained-heap rejection is exercised
      // by the subprocess load test, but subprocess runs are not
      // coverage-instrumented, so the note's arm is not schedulable from the
      // instrumented suite (whose heap never binds).
      /* v8 ignore next -- the heap-constrained message arm needs a host heap below the protocol cap. */
      const heapNote = frameParseCapBytes < FRAME_PARSE_CAP_BYTES ? ` — this host's heap limits the parse to ${frameParseCapBytes} bytes, so the protocol cap of ${FRAME_PARSE_CAP_BYTES} would be unsafe` : ''
      throw new Error(`dsh-ptc-runtime-python: config.${key} must not exceed ${limit} (a payload that large cannot cross the fd-3 frame PARSER, which rejects raw frames past ${frameParseCapBytes} bytes before decoding to bound host memory${heapNote} — a larger budget would admit a config whose honest child frames the host then rejects as a worker-exit), got ${String(resolved[key])}`)
    }
    // Reject a log budget too small to honor: the truncation marker alone
    // must serialize within the budget, or a marker-only truncated run
    // returns more than the configured cap. (With admitted entries the
    // marker is envelope, so the serialized logs run to
    // `maxLogBytes + marker + envelope`.)
    if (key === 'maxLogBytes' && resolved[key] < MIN_LOG_BYTES) {
      throw new Error(`dsh-ptc-runtime-python: config.maxLogBytes must be at least ${MIN_LOG_BYTES} (a smaller budget cannot serialize the truncation marker itself, so a marker-only truncated run would return more than the configured cap), got ${String(resolved[key])}`)
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
  const addressSpaceBytes = resolved.addressSpaceMb * 1024 * 1024
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
    throw new Error(`dsh-ptc-runtime-python: config.addressSpaceMb must exceed the ${INTERPRETER_BASELINE_BYTES}-byte interpreter baseline with room for the output budgets, so the child has address space left to build and encode them; got ${String(resolved.addressSpaceMb)} MiB (${addressSpaceBytes} bytes)`)
  }
  const admissibleBudget = Math.ceil(budgetableBytes / OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE) - 1
  for (const key of ['maxLogBytes', 'maxValueBytes'] as const) {
    if (resolved[key] * OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE >= budgetableBytes) {
      throw new Error(`dsh-ptc-runtime-python: config.${key} times the ${OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE}x worst-case Unicode expansion must fit within the ${budgetableBytes} bytes left after the ${INTERPRETER_BASELINE_BYTES}-byte interpreter baseline within the ${addressSpaceBytes}-byte addressSpaceMb, so a near-budget output truncates rather than breaching RLIMIT_AS as worker-exit; got ${String(resolved[key])} against a limit of ${admissibleBudget}`)
    }
  }
  return resolved
}

/**
 * Resolve and probe the executable `pythonBin` names, once at plugin load.
 * Re-resolving a basename in each run would let a later `PATH` change silently
 * switch interpreters, while an unchecked explicit path would turn a
 * self-contained misconfiguration into a late worker-exit. A missing or
 * unsupported interpreter is a load failure; a later filesystem mutation is
 * outside config validation, and a missing executable settles as worker-exit.
 * @param bin - the configured interpreter: an absolute path, a relative path, or
 * a bare command resolved on `PATH`.
 * @returns the validated absolute path of a CPython 3.10+ interpreter.
 */
export function resolveInterpreter(bin: string): string {
  const pythonBin = resolvePythonBin(bin)
  if (pythonBin === undefined) {
    const explicit = isAbsolute(bin) || bin.includes('/')
    throw new Error(`dsh-ptc-runtime-python: config.pythonBin ${JSON.stringify(bin)} ${explicit ? 'is not an executable regular file' : 'does not resolve on PATH'}`)
  }
  validatePythonBin(pythonBin)
  return pythonBin
}
