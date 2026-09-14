import { describe, expect, it, vi } from 'vitest'
import { EntryLifecycle } from '@deepseek-ai/dsh-entry-lifecycle'

const subject = 'session "s1"'

/** The rejection text for one call, so a contract sentence stays pinned verbatim. */
function messageOf(run: () => void): string {
  try {
    run()
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected the call to reject')
}

describe('announce', () => {
  it('claims the creation edge and reports it as announced', () => {
    const lifecycle = new EntryLifecycle()
    expect(lifecycle.isAnnounced).toBe(false)
    lifecycle.announce(subject)
    expect(lifecycle.isAnnounced).toBe(true)
  })

  it('rejects a second announcement, including one reentering its own dispatch', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    // Still inside the announcement dispatch: a creation listener that
    // announces the same entry again must not produce a second edge.
    expect(messageOf(() => { lifecycle.announce(subject) })).toBe('session "s1" was already announced')
    lifecycle.endAnnouncement()
    expect(lifecycle.isAnnounced).toBe(true)
    expect(messageOf(() => { lifecycle.announce(subject) })).toBe('session "s1" was already announced')
  })
})

describe('dispatches', () => {
  it('reports an open dispatch until it closes', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    expect(lifecycle.hasOpenDispatch).toBe(false)
    lifecycle.beginDispatch()
    expect(lifecycle.hasOpenDispatch).toBe(true)
    expect(lifecycle.endDispatch()).toBe(false)
    expect(lifecycle.hasOpenDispatch).toBe(false)
  })
})

describe('removal', () => {
  it('runs removal at once when nothing holds the entry live', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.endAnnouncement()
    const remove = vi.fn()
    const detach = lifecycle.detachCapability(remove)
    detach()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('defers removal requested during the announcement to the end of that dispatch', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    const remove = vi.fn()
    const detach = lifecycle.detachCapability(remove)
    detach()
    expect(remove).not.toHaveBeenCalled()
    expect(lifecycle.endAnnouncement()).toBe(true)
  })

  it('defers removal requested during a later dispatch to the end of that dispatch', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.endAnnouncement()
    lifecycle.beginDispatch()
    const remove = vi.fn()
    lifecycle.detachCapability(remove)()
    expect(remove).not.toHaveBeenCalled()
    expect(lifecycle.endDispatch()).toBe(true)
  })

  it('waits for the last open dispatch before reporting removal', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.endAnnouncement()
    lifecycle.beginDispatch()
    lifecycle.beginDispatch()
    const remove = vi.fn()
    lifecycle.detachCapability(remove)()
    expect(lifecycle.endDispatch()).toBe(false)
    expect(lifecycle.endDispatch()).toBe(true)
    expect(remove).not.toHaveBeenCalled()
  })

  it('waits for the announcement when a removal was requested inside a nested dispatch', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.beginDispatch()
    lifecycle.detachCapability(vi.fn())()
    expect(lifecycle.endDispatch()).toBe(false)
    expect(lifecycle.endAnnouncement()).toBe(true)
  })

  it('reports no removal when none was requested', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    expect(lifecycle.endAnnouncement()).toBe(false)
  })

  it('removes once for one request, however often the capability is called', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.endAnnouncement()
    const remove = vi.fn()
    const detach = lifecycle.detachCapability(remove)
    detach()
    detach()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('consumes a deferred request so a second removal is not reported', () => {
    const lifecycle = new EntryLifecycle()
    lifecycle.announce(subject)
    lifecycle.detachCapability(vi.fn())()
    expect(lifecycle.endAnnouncement()).toBe(true)
    expect(lifecycle.endAnnouncement()).toBe(false)
  })
})
