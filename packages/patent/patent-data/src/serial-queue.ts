/**
 * FIFO serializer for work that shares one external resource. The owner is the
 * service or instance that constructs the queue; nothing here outlives it.
 * @module @deepseek-ai/dsh-patent-data/serial-queue
 */

/** Runs admitted tasks one at a time in admission order. */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve()

  /**
   * Run one task after every previously admitted task has settled.
   * @param task - the work to run while this queue's slot is held.
   * @returns the task's result; a rejection releases the slot and propagates.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }
}
