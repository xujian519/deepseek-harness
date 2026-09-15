/**
 * The lane behind PTC mode's `run_code` programs: one driver pass schedules
 * sub-dispatches under the concurrency rules the native loop applies to
 * model-direct calls. Every ordered stage (the dispatch-start append, prepare
 * = pre-execute and guards, finalize/finish = post-execute, context deferral,
 * the settle append) runs inside that one pass, so ordered policy stages never
 * overlap each other and only the around-dispatch/body stage runs
 * concurrently. Starts are strictly submission-ordered; results commit in
 * submission order through the head-of-line cursor. Consecutive
 * parallel-classified entries overlap up to `maxParallel`; an exclusive entry
 * waits for the pool to drain, runs alone, and holds its barrier until its
 * COMMIT (post-execute included) completes, exactly like a native exclusive
 * group. An entry is reclassified immediately before it starts (a registry
 * mutation while it was queued can flip it exclusive), matching the native
 * scheduler's lazy reclassification.
 *
 * @module @deepseek-ai/dsh-tools/ptc-dispatch-pool
 */

import type { ToolExecutionMode } from './index.ts'

/** One queued sub-dispatch, driven by the pool's single ordered lane. */
export interface PooledDispatch {
  /** Ordered stage: append the start event, await prepare (pre-execute/guards), launch the body into {@link flight}. */
  start(): Promise<void>
  /** The classification re-read immediately before this entry starts. */
  classify(): ToolExecutionMode['kind']
  /** Reject the program-side call waiting on a queued-unstarted entry that run settlement abandoned. */
  abandon(): void
  /** Ordered stage: post-execute + context deferral + settle event, in submission order. */
  commit(): Promise<void>
  /** The launched around-dispatch/body stage; resolved until {@link start} replaces it. */
  flight: Promise<void>
  /** True once the dispatch stage parked its outcome; the commit cursor waits on it. */
  settled: boolean
  /** The classification this entry started under; an exclusive holds its barrier through {@link commit}. */
  mode?: ToolExecutionMode['kind']
}

/** Construction inputs for a {@link DispatchPool}. */
export interface DispatchPoolOptions {
  /** Overlap cap for parallel-classified entries, and the bound on {@link DispatchPool.track}ed side work. */
  maxParallel: number
  /** True once the run is over: queued-unstarted entries are abandoned instead of started. */
  isRunOver: () => boolean
}

/**
 * The lane behind one `run_code` program: submission-ordered starts and
 * commits, an exclusive barrier, and bounded side work.
 */
export class DispatchPool {
  private readonly pendingQueue: PooledDispatch[] = []
  private readonly commitQueue: PooledDispatch[] = []
  private readonly inFlight = new Set<Promise<void>>()
  /** Tracked settle-event side work (log-content listener + append), drained at run settlement. */
  private readonly sideWork = new Set<Promise<void>>()
  private exclusiveActive = false
  private driving = false
  private driverRun: Promise<void> = Promise.resolve()
  private wake: (() => void) | undefined

  /**
   * @param options - the run's overlap cap and its settlement probe.
   */
  constructor(private readonly options: DispatchPoolOptions) {}

  /**
   * Queue one dispatch and make sure the lane is running.
   * @param entry - the dispatch, whose stages the lane drives.
   */
  submit(entry: PooledDispatch): void {
    this.pendingQueue.push(entry)
    this.wakeup()
    void this.drive()
  }

  /**
   * Track one settle-event side work item. Each item retains a full result
   * while a slow backend stores it, so the pool cap bounds their count:
   * beyond it the ordered lane waits, so later sub-calls cannot start and
   * pending I/O and memory cannot grow without bound.
   * @param work - the side work; the pool drops it from the ledger on settlement.
   */
  track(work: Promise<void>): void {
    const task = work.finally(() => { this.sideWork.delete(task) })
    this.sideWork.add(task)
  }

  /**
   * Every dispatch settled AND committed, and every tracked side work item
   * drained. Called once the run is aborted, so the abort has already fired:
   * the lane abandons queued-unstarted entries, awaits the live pool, and
   * drains the ordered commit lane — including a commit already in progress
   * when the program returned.
   * @returns a promise resolving at quiescence.
   */
  async drain(): Promise<void> {
    await this.drive()
    // Every settle event is appended inside the open run_code turn (tasks self-remove on settlement).
    while (this.sideWork.size > 0) await Promise.allSettled([...this.sideWork])
  }

  /**
   * The single ordered lane. Each pass commits the head-of-line settled
   * dispatch (ordered post-execute), then starts the next queued entry if
   * its slot is free (ordered pre-execute), and otherwise sleeps until a
   * body settles or a new submission arrives. One run reaching the
   * empty-queues/empty-pool state is quiescence.
   * @returns the current driver pass; a later submission wakes it.
   */
  private drive(): Promise<void> {
    if (this.driving) return this.driverRun
    this.driving = true
    this.driverRun = (async () => {
      try {
        for (;;) {
          // Create the wakeup promise before inspecting state so a settle or submission arriving
          // between the checks and the await below cannot be lost.
          const signal = new Promise<void>((resolve) => { this.wake = resolve })
          const commitHead = this.commitQueue[0]
          if (commitHead !== undefined && commitHead.settled) {
            this.commitQueue.shift()
            await commitHead.commit()
            await this.applyBackpressure()
            // The barrier covers post-execute: later starts wait for the
            // exclusive call's full pipeline, as under the native loop.
            if (commitHead.mode === 'exclusive') this.exclusiveActive = false
            continue
          }
          const head = this.pendingQueue[0]
          if (head !== undefined) {
            if (this.options.isRunOver()) {
              this.pendingQueue.shift()
              head.abandon()
              continue
            }
            // Reclassify at start time (fail-closed on registry changes).
            const mode = head.classify()
            const capacity = !this.exclusiveActive
              && (mode === 'exclusive' ? this.inFlight.size === 0 : this.inFlight.size < this.options.maxParallel)
            if (capacity) {
              if (mode === 'exclusive') this.exclusiveActive = true
              head.mode = mode
              this.pendingQueue.shift()
              // Joined before start() so the commit cursor sees submission
              // order; nothing commits it until `settled` flips.
              this.commitQueue.push(head)
              await head.start()
              const flight: Promise<void> = head.flight.finally(() => {
                this.inFlight.delete(flight)
                this.wakeup()
              })
              this.inFlight.add(flight)
              continue
            }
          }
          if (this.pendingQueue.length === 0 && this.commitQueue.length === 0 && this.inFlight.size === 0) return
          await signal
        }
      } finally {
        this.driving = false
        this.wake = undefined
      }
    })()
    return this.driverRun
  }

  /** Wait for tracked side work to fall back under the cap before the lane starts anything else. */
  private async applyBackpressure(): Promise<void> {
    while (this.sideWork.size > this.options.maxParallel) await Promise.race(this.sideWork)
  }

  /** Release the lane's parked pass, if it has one. */
  private wakeup(): void {
    const release = this.wake
    this.wake = undefined
    release?.()
  }
}
