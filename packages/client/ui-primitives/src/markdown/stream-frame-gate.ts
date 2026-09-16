/**
 * Frame gate for the streaming Markdown renderer.
 *
 * Re-parsing the open tail block costs time proportional to the reply so far,
 * so a reply that streams as one growing top-level block — a paragraph, a
 * list, a table — spends more main-thread time on every frame: this grammar
 * parses a 128 KB block in 29 ms as a paragraph and 114 ms as a list, against
 * 4 KB blocks that stay under 4 ms. The gate measures each completed frame
 * and, once a frame exceeds {@link STREAM_FRAME_BUDGET_MS}, holds the following
 * frames back for a multiple of that measured cost, so a stream can occupy at
 * most `1 / (1 + STREAM_FRAME_DELAY_FACTOR)` of the main thread however long
 * its open block grows. Held-back frames show the text of the frame before
 * them; the owner retries after {@link StreamFrameGate.delayMs}. Frames inside
 * the budget are never held back, and neither is a reply under
 * {@link STREAM_FRAME_MIN_SOURCE_CHARS}, so anything but a large single block
 * renders every frame exactly as it did without the gate.
 */

/** Cost of one frame's tail re-parse and element rebuild, in milliseconds, above which frames are held back. */
export const STREAM_FRAME_BUDGET_MS = 4

/** Hold-back window after an over-budget frame, as a multiple of that frame's measured cost. */
export const STREAM_FRAME_DELAY_FACTOR = 3

/**
 * Source size below which a frame is admitted whatever it costs. The slowest
 * grammar this renderer parses measures 0.7 ms/KB, so a reply under four
 * kilobytes cannot re-parse its way past {@link STREAM_FRAME_BUDGET_MS}: only
 * replies that can are worth holding back, and admitting the rest keeps a
 * one-off scheduler pause from delaying a short reply.
 */
export const STREAM_FRAME_MIN_SOURCE_CHARS = 4_096

/**
 * Admission gate for one growing message's streaming frames. Claim every
 * frame, run the claimed work through {@link measure}, and retry a frame the
 * gate rejected once {@link delayMs} has elapsed.
 */
export class StreamFrameGate {
  private readyAt = 0
  private deferred = false

  /** @param now - Monotonic millisecond clock; tests substitute a scripted one. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  /**
   * Claim the frame that is about to run.
   * @param sourceChars - Length of the markdown source accumulated so far.
   * @returns `true` when this frame must do the tail re-parse and element
   * rebuild, `false` when it must return the previous frame's result and be
   * retried after {@link delayMs}.
   */
  claim(sourceChars: number): boolean {
    if (sourceChars < STREAM_FRAME_MIN_SOURCE_CHARS) return true
    if (this.now() >= this.readyAt) return true
    this.deferred = true
    return false
  }

  /**
   * Run one claimed frame's work and hold back the following frames when the
   * work outran {@link STREAM_FRAME_BUDGET_MS}.
   * @param work - The frame body: the tail re-parse and the element rebuild.
   * @returns Whatever `work` returned.
   */
  measure<T>(work: () => T): T {
    const startedAt = this.now()
    const result = work()
    const endedAt = this.now()
    const costMs = endedAt - startedAt
    this.deferred = false
    this.readyAt = costMs > STREAM_FRAME_BUDGET_MS ? endedAt + costMs * STREAM_FRAME_DELAY_FACTOR : 0
    return result
  }

  /**
   * Remaining wait before a held-back frame may run.
   * @returns Milliseconds to wait, or `null` when no frame is waiting.
   */
  delayMs(): number | null {
    return this.deferred ? Math.max(0, this.readyAt - this.now()) : null
  }

  /** Drop the waiting frame: the text it was held back for is already rendered. */
  release(): void {
    this.deferred = false
  }
}
