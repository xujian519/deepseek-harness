import { describe, expect, it } from 'vitest'
import type { ToolExecutionMode } from '@deepseek-ai/dsh-tools'
import { DispatchPool } from '../src/ptc-dispatch-pool.ts'
import type { PooledDispatch } from '../src/ptc-dispatch-pool.ts'

/**
 * Direct tier for the per-run sub-dispatch lane. `ptc.spec.ts` drives the lane
 * through a whole `run_code` program; this file pins the lane's own contract —
 * submission-ordered starts and commits, the exclusive barrier, the overlap
 * cap, backpressure on tracked side work, abandonment, and quiescence — with
 * entries the test releases stage by stage.
 */

/** One pool-observed stage: what arrived, in order, plus an await for a stage a test must observe. */
interface StageLog {
  /** Every stage recorded so far, in arrival order. */
  readonly stages: string[]
  /** Record one stage and release everyone waiting on it. */
  record(stage: string): void
  /** Resolve once `stage` is recorded, immediately when it already arrived. */
  reached(stage: string): Promise<void>
}

function stageLog(): StageLog {
  const stages: string[] = []
  const waiters = new Map<string, (() => void)[]>()
  return {
    stages,
    record(stage: string): void {
      stages.push(stage)
      for (const release of waiters.get(stage) ?? []) release()
      waiters.delete(stage)
    },
    reached(stage: string): Promise<void> {
      if (stages.includes(stage)) return Promise.resolve()
      return new Promise((resolve) => {
        const pending = waiters.get(stage) ?? []
        pending.push(resolve)
        waiters.set(stage, pending)
      })
    },
  }
}

/** A gated promise plus the resolver a test releases it with. */
function gate(): { readonly promise: Promise<void>; release(): void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release: () => { release() } }
}

/** Give the lane a full macrotask turn: every microtask it could reach runs before this resolves. */
function turn(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/** The highest number of bodies the recorded stages show running at once. */
function peakOverlap(stages: readonly string[]): number {
  let live = 0
  let peak = 0
  for (const stage of stages) {
    if (stage.startsWith('start:')) peak = Math.max(peak, ++live)
    if (stage.startsWith('end:')) live--
  }
  return peak
}

/** Telemetry for one fake dispatch: whether it was abandoned, and how often it started. */
interface DispatchState {
  abandoned: boolean
  starts: number
}

interface FakeDispatch extends PooledDispatch {
  readonly state: DispatchState
  /** Release the gated body, settling this dispatch. */
  releaseBody(): void
  /** Release the gated commit. */
  releaseCommit(): void
}

/**
 * A pool entry whose body waits for the test, recording every stage in `log`.
 * @param label - the stage-name suffix identifying this dispatch.
 * @param kind - the classification the pool re-reads before starting it.
 * @param log - the shared stage record.
 * @param options - `gatedCommit` parks the lane's commit cursor; `onCommit` runs as side work hook-up.
 * @returns the entry plus its release hooks and telemetry.
 */
function fakeDispatch(
  label: string,
  kind: ToolExecutionMode['kind'],
  log: StageLog,
  options: { gatedCommit?: boolean; onCommit?: () => void } = {},
): FakeDispatch {
  const state: DispatchState = { abandoned: false, starts: 0 }
  const body = gate()
  const commitGate = options.gatedCommit === true ? gate() : undefined
  return {
    state,
    flight: Promise.resolve(),
    settled: false,
    releaseBody: () => { body.release() },
    releaseCommit: () => { commitGate?.release() },
    classify: () => kind,
    abandon(): void { state.abandoned = true },
    async start(): Promise<void> {
      state.starts++
      log.record(`start:${label}`)
      this.flight = body.promise.then(() => {
        this.settled = true
        log.record(`end:${label}`)
      })
    },
    async commit(): Promise<void> {
      log.record(`commit:${label}`)
      options.onCommit?.()
      if (commitGate !== undefined) await commitGate.promise
      log.record(`committed:${label}`)
    },
  }
}

describe('the PTC sub-dispatch lane', () => {
  it('drains an idle pool without starting anything', async () => {
    const pool = new DispatchPool({ maxParallel: 2, isRunOver: () => false })

    await pool.drain()
  })

  it('starts in submission order and commits in submission order when bodies settle out of order', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 2, isRunOver: () => false })
    const first = fakeDispatch('a', 'parallel', log)
    const second = fakeDispatch('b', 'parallel', log)

    pool.submit(first)
    pool.submit(second)
    await log.reached('start:b')
    // b finishes first, but the commit cursor cannot pass the still-live a.
    second.releaseBody()
    await turn()
    expect(log.stages).toEqual(['start:a', 'start:b', 'end:b'])
    first.releaseBody()
    await pool.drain()

    expect(log.stages).toEqual([
      'start:a', 'start:b', 'end:b', 'end:a',
      'commit:a', 'committed:a', 'commit:b', 'committed:b',
    ])
  })

  it('holds an exclusive dispatch until the pool drains and its own commit completes', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 4, isRunOver: () => false })
    const read = fakeDispatch('r1', 'parallel', log)
    const write = fakeDispatch('w', 'exclusive', log, { gatedCommit: true })
    const tail = fakeDispatch('r2', 'parallel', log)

    pool.submit(read)
    pool.submit(write)
    pool.submit(tail)
    await log.reached('start:r1')
    // The exclusive dispatch waits for the live body to end.
    read.releaseBody()
    await log.reached('start:w')
    write.releaseBody()
    await log.reached('commit:w')
    // The barrier covers post-execute: the next start waits for the commit.
    write.releaseCommit()
    await log.reached('start:r2')
    tail.releaseBody()
    await pool.drain()

    expect(log.stages.indexOf('start:w')).toBeGreaterThan(log.stages.indexOf('end:r1'))
    expect(log.stages.indexOf('start:r2')).toBeGreaterThan(log.stages.indexOf('committed:w'))
  })

  it('caps overlap at maxParallel', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 2, isRunOver: () => false })
    const entries = ['a', 'b', 'c'].map(label => fakeDispatch(label, 'parallel', log))
    for (const entry of entries) pool.submit(entry)
    await log.reached('start:b')
    // Only a finished body frees a slot.
    entries[0]!.releaseBody()
    await log.reached('start:c')
    for (const entry of entries.slice(1)) entry.releaseBody()
    await pool.drain()

    expect(peakOverlap(log.stages)).toBe(2)
    expect(log.stages.indexOf('start:c')).toBeGreaterThan(log.stages.indexOf('end:a'))
  })

  it('abandons queued-unstarted dispatches once the run is over', async () => {
    const log = stageLog()
    let runOver = false
    const pool = new DispatchPool({ maxParallel: 1, isRunOver: () => runOver })
    const live = fakeDispatch('a', 'parallel', log)
    const queued = fakeDispatch('b', 'parallel', log)

    pool.submit(live)
    pool.submit(queued)
    await log.reached('start:a')
    runOver = true
    live.releaseBody()
    await pool.drain()

    expect(queued.state).toMatchObject({ abandoned: true, starts: 0 })
    expect(log.stages).not.toContain('start:b')
  })

  it('waits for tracked side work above the cap before starting anything else', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 1, isRunOver: () => false })
    const overCap = gate()
    const alsoOverCap = gate()
    pool.track(overCap.promise)
    pool.track(alsoOverCap.promise)
    const first = fakeDispatch('a', 'parallel', log)
    const second = fakeDispatch('b', 'parallel', log)

    pool.submit(first)
    pool.submit(second)
    await log.reached('start:a')
    first.releaseBody()
    await log.reached('commit:a')
    // Two tracked items against a cap of one: the lane parks behind the commit.
    await turn()
    expect(log.stages).not.toContain('start:b')
    // One release puts the ledger back under the cap and the lane resumes.
    overCap.release()
    await log.reached('start:b')
    expect(log.stages.indexOf('start:b')).toBeGreaterThan(log.stages.indexOf('committed:a'))
    second.releaseBody()
    alsoOverCap.release()
    await pool.drain()
  })

  it('does not drain until side work tracked during a commit settles', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 4, isRunOver: () => false })
    const spill = gate()
    const entry = fakeDispatch('a', 'parallel', log, { onCommit: () => { pool.track(spill.promise) } })

    pool.submit(entry)
    await log.reached('start:a')
    entry.releaseBody()
    const drained = pool.drain()
    await log.reached('committed:a')

    expect(await Promise.race([drained.then(() => 'drained'), turn().then(() => 'turn')])).toBe('turn')

    spill.release()
    await drained
  })

  it('starts a fresh pass for a dispatch submitted after quiescence', async () => {
    const log = stageLog()
    const pool = new DispatchPool({ maxParallel: 2, isRunOver: () => false })
    const first = fakeDispatch('a', 'parallel', log)

    pool.submit(first)
    await log.reached('start:a')
    first.releaseBody()
    await pool.drain()
    const second = fakeDispatch('b', 'parallel', log)
    pool.submit(second)
    await log.reached('start:b')
    second.releaseBody()
    await pool.drain()

    expect(log.stages).toContain('committed:b')
  })
})
