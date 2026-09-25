/** Re-arming readiness polls for the send that owns the terminal slot. */

/**
 * Owns the timing state of readiness polling: the pending timer, whether a judgement is
 * running, and which send is waiting for one.
 *
 * The judgement itself stays with the session, which collects the readiness evidence. This
 * owner keeps the arming decisions together so a poll cannot be armed twice, lost when a
 * judgement settles, or left armed for a send that no longer owns the slot.
 *
 * @typeParam Operation - send object the timing state belongs to.
 */
export class ReadinessPoller<Operation> {
  private timer: NodeJS.Timeout | undefined
  private polling = false
  private waiter: Operation | undefined

  /**
   * @param intervalMs - delay before the next poll when no delay is requested.
   * @param poll - runs one readiness judgement for the waiting send.
   * @param ownsSlot - whether the send still holds the slot and may be polled again.
   * @param isActive - whether the send is still the active one, so a due poll should run.
   */
  constructor(
    private readonly intervalMs: number,
    private readonly poll: (operation: Operation) => Promise<void>,
    private readonly ownsSlot: (operation: Operation) => boolean,
    private readonly isActive: (operation: Operation) => boolean,
  ) {}

  /**
   * Publish `operation` as waiting for readiness and arm its next poll.
   * @param operation - send to poll.
   * @param delayMs - delay before the first poll; defaults to the poll interval.
   */
  begin(operation: Operation, delayMs = this.intervalMs): void {
    this.waiter = operation
    this.arm(operation, delayMs)
  }

  /** Stop the pending poll and forget the send waiting for one. */
  cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.waiter = undefined
  }

  private arm(operation: Operation, delayMs: number): void {
    if (this.polling || !this.ownsSlot(operation)) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.run(operation)
    }, delayMs)
  }

  private async run(operation: Operation): Promise<void> {
    // `arm` never schedules while a judgement is running, so only the timer reaches here.
    if (!this.isActive(operation)) return
    this.polling = true
    try {
      await this.poll(operation)
    } finally {
      this.polling = false
      const waiter = this.waiter
      if (waiter !== undefined && this.ownsSlot(waiter)) this.arm(waiter, this.intervalMs)
    }
  }
}
