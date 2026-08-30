/**
 * Shared timeout arithmetic, signal fusion, and classification. The library
 * only notifies through abort signals; each capability still owns the mechanism
 * that stops its work and translates timeout reasons into public outcomes.
 * @module @deepseek-ai/dsh-timeout
 */

/**
 * Internal abort reason carrying a capability-owned code and elapsed deadline.
 * Providers translate it through {@link timeoutOf} before returning to callers.
 */
export class TimeoutReason extends Error {
  override name = 'TimeoutReason'

  /**
   * @param code Capability-owned timeout code (e.g. `BASH_TIMEOUT`).
   * @param timeoutMs The deadline that elapsed, in milliseconds.
   */
  constructor(readonly code: string, readonly timeoutMs: number) {
    super(`${code} after ${timeoutMs}ms`)
  }
}

/** Largest delay Node schedules without clamping it to one millisecond. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647

function assertTimerDelay(timeoutMs: number, name: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/**
 * Validate a caller's optional timeout hint, use the backend default, then cap
 * it. Supplied values must be positive and finite; zero is not a public
 * disable-timeout sentinel.
 *
 * @param requested The caller's optional hint; validated when present.
 * @param def The backend default applied when `requested` is absent.
 * @param max The backend upper bound the result is capped to.
 * @param name Field name used in the thrown message (so the caller sees which input was
 *   bad).
 * @returns The effective timeout in milliseconds: `min(requested ?? def, max)`.
 */
export function clampTimeout(
  requested: number | undefined,
  def: number,
  max: number,
  name = 'timeoutMs',
): number {
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error(`${name} must be a positive finite number`)
  }
  return Math.min(requested ?? def, max)
}

/** A deadline signal plus the cleanup that clears its timer (dispose-once). */
export interface Deadline {
  /** Aborts on upstream cancellation OR on timeout (the timeout carries a {@link TimeoutReason}). */
  readonly signal: AbortSignal
  /** Clear the timer. Safe to call once; `using` calls it at scope exit. */
  [Symbol.dispose](): void
}

/** Rearmable timeout around one outstanding async-iterator demand. */
export interface IdleWatchdog {
  /** Stable signal aborted by upstream cancellation or this watchdog's timeout. */
  readonly signal: AbortSignal
  /**
   * Await one iterator demand while the idle timer is armed.
   * @param iterator - iterator whose next value represents provider progress.
   * @returns the iterator's next result.
   */
  next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>>
  /** Rearm an outstanding demand after transport activity that yields no iterator value; otherwise a no-op. */
  pulse(): void
  /** Clear an armed timer; safe to call once at the owning stream's exit. */
  [Symbol.dispose](): void
}

/**
 * Fuse upstream cancellation with an identifiable timeout. `timeoutMs <= 0` is
 * the internal no-timer sentinel; the returned disposer clears an armed timer.
 * The signal only notifies, so callers must stop their own work.
 *
 * @param upstream The caller's cancellation signal, if any, fused into the result.
 * @param timeoutMs Deadline in milliseconds; `<= 0` means "no timeout" (arm no timer).
 * @param code Capability-owned code stamped onto the timeout's {@link TimeoutReason}.
 * @returns The fused {@link Deadline} (signal + timer cleanup).
 */
export function deadline(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): Deadline {
  if (timeoutMs <= 0) {
    // No timeout (background work): forward only the upstream signal, or a never-aborting one
    // when there is no upstream.
    return { signal: upstream ?? new AbortController().signal, [Symbol.dispose]() {} }
  }

  assertTimerDelay(timeoutMs, 'deadline timeoutMs')

  const timer = new AbortController()
  const id = setTimeout(() => { timer.abort(new TimeoutReason(code, timeoutMs)) }, timeoutMs)
  return {
    // AbortSignal.any adopts the reason of whichever source aborts FIRST, so a
    // race resolves to a single cause: timeoutOf() reads TimeoutReason only
    // when the timeout won, and upstream-wins leaves an ordinary abort reason.
    signal: upstream !== undefined ? AbortSignal.any([upstream, timer.signal]) : timer.signal,
    [Symbol.dispose]() { clearTimeout(id) },
  }
}

/**
 * Create a rearmable idle watchdog for an async iterator. The timer exists only
 * while {@link IdleWatchdog.next} is outstanding, so consumer think time does
 * not count as provider idle time. The returned signal is stable for the whole
 * call and only notifies; the iterator must observe it to terminate its work.
 *
 * @param upstream - caller cancellation fused into the stable signal.
 * @param timeoutMs - positive finite idle interval in milliseconds.
 * @param code - capability-owned code carried by the timeout reason.
 * @returns a stable signal, guarded next operation, and timer disposer.
 */
export function idleWatchdog(
  upstream: AbortSignal | undefined,
  timeoutMs: number,
  code: string,
): IdleWatchdog {
  assertTimerDelay(timeoutMs, 'idleWatchdog timeoutMs')
  const timeout = new AbortController()
  const signal = upstream === undefined
    ? timeout.signal
    : AbortSignal.any([upstream, timeout.signal])
  let timer: ReturnType<typeof setTimeout> | undefined
  let outstanding = false
  let disposed = false

  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timeout.abort(new TimeoutReason(code, timeoutMs))
    }, timeoutMs)
  }

  return {
    signal,
    async next<T>(iterator: AsyncIterator<T>): Promise<IteratorResult<T>> {
      if (disposed) throw new Error('idleWatchdog is disposed')
      if (outstanding) throw new Error('idleWatchdog next is already outstanding')
      outstanding = true
      arm()
      try {
        return await iterator.next()
      } finally {
        clearTimeout(timer)
        timer = undefined
        outstanding = false
      }
    },
    pulse(): void {
      if (disposed || !outstanding) return
      arm()
    },
    [Symbol.dispose](): void {
      if (disposed) return
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * Await `promise` while rejecting as soon as `signal` aborts. Losing the race
 * drops the loser's settlement, not the work: the wrapped operation must
 * observe `signal` itself to stop, and its late settlement is absorbed. The
 * abort path rejects with the signal's own reason — the same value
 * `throwIfAborted` throws — so callers classify it with the usual abort checks.
 *
 * @param promise The work to await.
 * @param signal Cancellation signal; `undefined` returns `promise` unchanged.
 * @returns `promise`'s settlement, or a rejection carrying `signal.reason`.
 */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the contract passes the signal's own reason through verbatim.
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the loser's rejection is forwarded verbatim.
        reject(error)
      },
    )
  })
}

/**
 * Recover a timeout reason from a reason-bearing object. Supplying `code`
 * distinguishes this deadline from a nested upstream deadline; a foreign code
 * follows the ordinary cancellation path.
 *
 * @param x An {@link AbortSignal} or any `{ reason }` carrier (e.g. a caught abort error).
 * @param code When provided, only a {@link TimeoutReason} with this exact `code` matches.
 * @returns The matching {@link TimeoutReason}, else `undefined`.
 */
export function timeoutOf(x: AbortSignal | { reason?: unknown }, code?: string): TimeoutReason | undefined {
  // AbortSignal.reason is typed `any`; pin it to `unknown` so no `any` leaks and
  // the instanceof narrows cleanly for both a signal and a bare reason carrier.
  const reason: unknown = x.reason
  if (!(reason instanceof TimeoutReason)) return undefined
  return code === undefined || reason.code === code ? reason : undefined
}
