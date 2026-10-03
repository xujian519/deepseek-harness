/**
 * Bounded retry for the patent lookups' transient upstream failures: the nuo
 * engine answers timeouts and dropped connections under load, so a short
 * backoff turns them into a slower answer instead of a failed lookup.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/bounded-retry
 */

/** Wait for the given delay; the retry never outlives the caller's patience. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Run `attempt` until its result is not retryable, the bounded backoff is
 * exhausted, or the caller aborts.
 * @param attempt - one attempt at the upstream call.
 * @param retryable - whether a settled result is worth another attempt.
 * @param retryDelaysMs - backoff before each repeat attempt; its length caps the retries.
 * @param signal - aborts the retry loop; omitted means the loop never aborts.
 * @returns the last result and the total attempts made.
 */
export async function retryBounded<T>(
  attempt: () => Promise<T>,
  retryable: (result: T) => boolean,
  retryDelaysMs: readonly number[],
  signal?: AbortSignal,
): Promise<{ result: T; attempts: number }> {
  let result = await attempt()
  let attempts = 1
  for (const delayMs of retryDelaysMs) {
    if (!retryable(result) || signal?.aborted === true) break
    await delay(delayMs)
    result = await attempt()
    attempts += 1
  }
  return { result, attempts }
}
