import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReadinessPoller } from '@deepseek-ai/dsh-terminal-bash/src/readiness-poller.ts'

const INTERVAL_MS = 10

/** A poller over plain tokens, with the slot and active predicates driven by the test. */
function makePoller(poll?: (operation: string) => Promise<void>) {
  const polls: string[] = []
  const owning = new Set<string>()
  const active = new Set<string>()
  const poller = new ReadinessPoller<string>(
    INTERVAL_MS,
    poll ?? ((operation) => { polls.push(operation); return Promise.resolve() }),
    operation => owning.has(operation),
    operation => active.has(operation),
  )
  return { poller, polls, owning, active }
}

afterEach(() => { vi.useRealTimers() })

describe('ReadinessPoller', () => {
  it('polls the waiting send after the interval and keeps re-arming while it owns the slot', async () => {
    vi.useFakeTimers()
    const { poller, polls, owning, active } = makePoller()
    owning.add('a')
    active.add('a')

    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(polls).toEqual(['a'])

    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(polls).toEqual(['a', 'a'])
  })

  it('does not arm for a send that does not own the slot', async () => {
    vi.useFakeTimers()
    const { poller, polls, active } = makePoller()
    active.add('a')

    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(polls).toEqual([])
  })

  it('replaces a pending poll instead of arming a second one', async () => {
    vi.useFakeTimers()
    const { poller, polls, owning, active } = makePoller()
    owning.add('a')
    active.add('a')

    poller.begin('a')
    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(polls).toEqual(['a'])
  })

  it('skips a due poll once the send is no longer the active one', async () => {
    vi.useFakeTimers()
    const { poller, polls, owning, active } = makePoller()
    owning.add('a')
    active.add('a')

    poller.begin('a')
    active.delete('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(polls).toEqual([])
  })

  it('does not arm a second poll while a judgement is running', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    const { poller, polls, owning, active } = makePoller(async (operation) => {
      polls.push(operation)
      await gate.promise
    })
    owning.add('a')
    active.add('a')

    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    expect(polls).toEqual(['a'])

    poller.begin('a')
    gate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)

    expect(polls).toEqual(['a', 'a'])
  })

  it('stops re-arming when the send loses the slot while a judgement runs', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    const { poller, polls, owning, active } = makePoller(async (operation) => {
      polls.push(operation)
      await gate.promise
    })
    owning.add('a')
    active.add('a')

    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    owning.delete('a')
    gate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(polls).toEqual(['a'])
  })

  it('does not re-arm a send that was cancelled while its judgement ran', async () => {
    vi.useFakeTimers()
    const gate = Promise.withResolvers<undefined>()
    const { poller, polls, owning, active } = makePoller(async (operation) => {
      polls.push(operation)
      await gate.promise
    })
    owning.add('a')
    active.add('a')

    poller.begin('a')
    await vi.advanceTimersByTimeAsync(INTERVAL_MS)
    poller.cancel()
    gate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(polls).toEqual(['a'])
  })

  it('stops a pending poll on cancel, including when no poll is pending', async () => {
    vi.useFakeTimers()
    const { poller, polls, owning, active } = makePoller()
    owning.add('a')
    active.add('a')

    poller.cancel()
    poller.begin('a')
    poller.cancel()
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3)

    expect(polls).toEqual([])
  })
})
