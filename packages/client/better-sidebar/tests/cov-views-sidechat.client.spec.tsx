/**
 * Side Chat view coverage round: the thread-id/tab parking helpers, the
 * unbound-tab hero (manual start, retry, immediate-create flash, double-mount
 * guard), the thread-binding effects (title follow, cache reset, transcript
 * walk vs tail poll, live info badge), the transcript row renderers (user,
 * assistant, reasoning, injection, tool success/failure/streaming), the
 * composer (send, Enter/shift/IME, cancel, save-as-new-session), and the
 * thread-switch menu.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { SideChatView, consumeSidechatSeed, parkSidechatReopen, sidechatThreadIdOf } from '../src/client/SideChatView.tsx'
import { api } from '../src/client/api.ts'
import { SIDE_INJECTION_KIND, SIDE_NEW_THREAD_TITLE } from '../src/sidechat-core.ts'
import type { Context, SidebarHistoryEntry, SidebarSessionList } from '../src/context-types.ts'
import type { SidebarTab } from '../src/client/state.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface Store {
  getSnapshot(): SidebarSessionList
  subscribe(fn: () => void): () => void
  set(next: SidebarSessionList): void
}

/** A subscribable sessions-list snapshot (mirror of the runtime list feed). */
function makeStore(initial: SidebarSessionList = { current: undefined, byId: {} }): Store {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    set(next: SidebarSessionList) {
      snapshot = next
      act(() => { for (const fn of [...listeners]) fn() })
    },
  }
}

interface Harness {
  ctx: Context
  store: Store
  updateTab: ReturnType<typeof vi.fn>
  openTab: ReturnType<typeof vi.fn>
  history: MockInstance<(payload: { beforeSeq?: number }, signal?: AbortSignal) => Promise<unknown>>
  fork: ReturnType<typeof vi.fn>
  binding: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  rename: ReturnType<typeof vi.fn>
  /** Remove the client registry (the `ctx.get('betterSidebar')` miss path). */
  withoutService(): void
}

function makeHarness(): Harness {
  const store = makeStore()
  const updateTab = vi.fn()
  const openTab = vi.fn()
  const history = vi.fn()
  const rename = vi.fn(async () => ({}))
  const binding = vi.fn(() => ({ session: { rename } }))
  const fork = vi.fn(async () => 'saved-session')
  const open = vi.fn()
  let service: { updateTab: unknown; openTab: unknown } | undefined = { updateTab, openTab }
  const ctx = {
    sessions: { list: store, fork, binding, open },
    connection: { api: { sessions: { history } } },
    get: (name: string) => (name === 'betterSidebar' ? service : undefined),
  } as unknown as Context
  return {
    ctx, store, updateTab, openTab, history, fork, binding, open, rename,
    withoutService: () => { service = undefined },
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

/** One history row (event + no host view). */
function entry(seq: number, type: string, data: Record<string, unknown> = {}): SidebarHistoryEntry {
  return { event: { type, seq, time: seq, data } }
}

/** A successful `session.history` RPC envelope. */
function page(events: SidebarHistoryEntry[]): unknown {
  return { rpcId: 1, result: { ok: true, value: { events, hasMore: false } } }
}

/** A failed `session.history` RPC envelope. */
const FAILED_PAGE = { rpcId: 1, result: { ok: false, error: { code: 'x', message: 'boom' } } }

const SCOPE = { sessionId: 'parent' }

/** A tab bound to `threadId` (undefined = the unbound hero). */
function tabFor(threadId?: string, extra: Record<string, unknown> = {}): SidebarTab {
  return {
    id: 'sidechat:parent',
    type: 'sidechat',
    title: 'Side Chat',
    ...(threadId === undefined ? {} : { meta: { threadId } }),
    ...extra,
  }
}

interface Mounted {
  container: HTMLDivElement
  rerender: (props: { tab: SidebarTab; visible?: boolean }) => void
  unmount: () => void
}

function mount(ctx: Context, tab: SidebarTab, visible = true): Mounted {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const render = (props: { tab: SidebarTab; visible?: boolean }): void => {
    act(() => {
      root.render(createElement(SideChatView, {
        ctx,
        scope: SCOPE,
        tab: props.tab,
        visible: props.visible ?? true,
      }))
    })
  }
  render({ tab, visible })
  return {
    container,
    rerender: (props) => { render({ visible, ...props }) },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Flush the pending microtask chain of one transcript pull. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? ''
}

function menuRows(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
}

/** Set a controlled React input/textarea value the way the browser does. */
function typeInto(field: HTMLTextAreaElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('sidechat tab helpers', () => {
  it('reads the thread id from tab.meta only for a string value', () => {
    expect(sidechatThreadIdOf(tabFor('child-1'))).toBe('child-1')
    expect(sidechatThreadIdOf(tabFor())).toBeUndefined()
    expect(sidechatThreadIdOf({ ...tabFor(), meta: { threadId: 7 } })).toBeUndefined()
  })

  it('parks a reopen target for exactly one consume', () => {
    expect(consumeSidechatSeed()).toBeUndefined()
    parkSidechatReopen('thread-9')
    expect(consumeSidechatSeed()).toBe('thread-9')
    expect(consumeSidechatSeed()).toBeUndefined()
  })
})

describe('SideChatView unbound tab', () => {
  it('offers a manual start that binds the created thread to the tab', async () => {
    const harness = makeHarness()
    vi.spyOn(api, 'sidechatStart').mockResolvedValue({ childId: 'child-7' })
    const mounted = mount(harness.ctx, tabFor())
    try {
      expect(textOf(mounted.container)).toContain('No side conversations')
      const start = [...mounted.container.querySelectorAll('button')]
        .find(button => button.textContent === 'New thread')!
      await act(async () => { start.click() })

      expect(api.sidechatStart).toHaveBeenCalledWith('parent')
      expect(harness.updateTab).toHaveBeenCalledWith('sidechat:parent', { meta: { threadId: 'child-7' } })
    } finally {
      mounted.unmount()
    }
  })

  it('surfaces a start failure and retries from the same hero', async () => {
    const harness = makeHarness()
    const start = vi.spyOn(api, 'sidechatStart').mockRejectedValueOnce(new Error('start failed'))
    const mounted = mount(harness.ctx, tabFor())
    try {
      await act(async () => {
        [...mounted.container.querySelectorAll('button')].find(button => button.textContent === 'New thread')!.click()
      })
      expect(textOf(mounted.container)).toContain('Side Chat error: start failed')

      const retry = [...mounted.container.querySelectorAll('button')]
        .find(button => button.textContent === 'Retry')!
      start.mockRejectedValueOnce('not an error')
      await act(async () => { retry.click() })
      expect(textOf(mounted.container)).toContain('Side Chat error: not an error')
    } finally {
      mounted.unmount()
    }
  })

  it('flashes the creating state while an autoCreate tab starts its thread', async () => {
    const harness = makeHarness()
    const pending = deferred<{ childId: string }>()
    vi.spyOn(api, 'sidechatStart').mockReturnValue(pending.promise)
    const mounted = mount(harness.ctx, tabFor(undefined, { meta: { autoCreate: true } }))
    try {
      expect(textOf(mounted.container)).toContain('Creating side conversation…')
      expect([...mounted.container.querySelectorAll('button')]).toHaveLength(0)

      pending.resolve({ childId: 'child-auto' })
      await flush()
      expect(harness.updateTab).toHaveBeenCalledWith('sidechat:parent', { meta: { threadId: 'child-auto' } })
    } finally {
      mounted.unmount()
    }
  })

  it('starts once while a creation is in flight and stays idle until visible', async () => {
    const harness = makeHarness()
    const pending = deferred<{ childId: string }>()
    const start = vi.spyOn(api, 'sidechatStart').mockReturnValue(pending.promise)
    const mounted = mount(harness.ctx, tabFor(undefined, { meta: { autoCreate: true } }), false)
    try {
      await flush()
      expect(start).not.toHaveBeenCalled()

      mounted.rerender({ tab: tabFor(undefined, { meta: { autoCreate: true } }), visible: true })
      await flush()
      expect(start).toHaveBeenCalledTimes(1)

      // A re-entry while the first creation is still in flight (StrictMode /
      // HMR double mount) must not mint a second thread.
      mounted.rerender({ tab: tabFor(undefined, { meta: { autoCreate: true } }), visible: false })
      mounted.rerender({ tab: tabFor(undefined, { meta: { autoCreate: true } }), visible: true })
      await flush()
      expect(start).toHaveBeenCalledTimes(1)

      pending.resolve({ childId: 'child-auto' })
      await flush()
    } finally {
      mounted.unmount()
    }
  })

  it('tolerates a missing client registry on start', async () => {
    const harness = makeHarness()
    harness.withoutService()
    vi.spyOn(api, 'sidechatStart').mockResolvedValue({ childId: 'child-7' })
    const mounted = mount(harness.ctx, tabFor())
    try {
      await act(async () => {
        [...mounted.container.querySelectorAll('button')].find(button => button.textContent === 'New thread')!.click()
      })
      expect(textOf(mounted.container)).not.toContain('Side Chat error')
    } finally {
      mounted.unmount()
    }
  })
})

describe('SideChatView bound thread', () => {
  const OWN_EVENTS: SidebarHistoryEntry[] = [
    entry(1, 'session/end-seed'),
    entry(2, 'user/message', { content: [{ type: 'text', text: 'question' }] }),
    entry(3, 'assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'answer' }] } }),
    entry(4, 'turn/end'),
  ]

  it('walks the transcript back to the seed on first attach and renders every row kind', async () => {
    const harness = makeHarness()
    harness.history.mockImplementation(async () => page([
      entry(0, 'turn/end'),
      entry(1, 'session/end-seed'),
      entry(2, 'user/message', { content: [{ type: 'text', text: 'first question' }] }),
      entry(3, 'user/message', { content: [{ type: 'text', text: 'injected context' }], source: { kind: SIDE_INJECTION_KIND } }),
      entry(4, 'assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'reasoning', text: 'thinking hard' }] } }),
      entry(5, 'assistant/message', { turn: 0, step: 0, message: { content: [{ type: 'text', text: 'the answer' }] } }),
      entry(6, 'tool/call', { callId: 'c1', name: 'bash', arguments: '{"command":"ls -la"}' }),
      entry(7, 'tool/result', {
        message: {
          source: { kind: 'tool', callId: 'c1' },
          toolCallId: 'c1',
          content: [{ type: 'text', text: 'a.ts' }],
        },
      }),
      entry(8, 'turn/end'),
      // A still-streaming reasoning delta (a settled=false collapsible row).
      entry(9, 'assistant/chunk', { turn: 1, step: 0, chunk: { type: 'reasoning-delta', text: 'still thinking', index: 0 } }),
      // A call with neither arguments nor a result: nothing to expand.
      entry(10, 'tool/call', { callId: 'c2', name: 'grep' }),
      // A failed orphan result with no text: a static failed line.
      entry(11, 'tool/result', { error: { name: 'ToolFailure', code: 'boom' }, message: { source: { kind: 'tool' }, content: [] } }),
      entry(12, 'tool/call', { callId: 'c3', name: 'read', arguments: '{"path":"b.ts"}' }),
      entry(13, 'tool/result', {
        error: { name: 'ToolFailure', code: 'nope' },
        message: {
          source: { kind: 'tool', callId: 'c3' },
          toolCallId: 'c3',
          isError: true,
          content: [{ type: 'text', text: 'failed text' }],
        },
      }),
    ]))
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      expect(harness.history).toHaveBeenCalledWith(
        { sessionId: 'child-1', maxMessages: 200 },
        expect.any(AbortSignal),
      )
      const text = textOf(mounted.container)
      expect(text).toContain('first question')
      expect(text).toContain('the answer')
      expect(text).toContain('Thinking')
      expect(text).toContain('thinking hard')
      expect(text).toContain('Context injected')
      expect(text).toContain('injected context')
      expect(text).toContain('bash')
      expect(text).toContain('ls -la')
      expect(text).toContain('a.ts')
      expect(text).toContain('still thinking')

      // A tool call with nothing to reveal renders as a static line — no
      // expand/collapse wrapper.
      const staticRow = [...mounted.container.querySelectorAll('*')]
        .find(node => node.textContent === 'grep' && node.children.length === 0)!
      expect(staticRow.closest('details')).toBeNull()
      // A failing call that did produce text stays expandable and marks the
      // failure.
      const failedRow = [...mounted.container.querySelectorAll('details')]
        .find(node => node.textContent?.includes('failed text'))!
      expect(failedRow.querySelector('summary')!.className).toContain('sidechatRowFailed')

      // A completed turn makes the save action available (no no-turn hint).
      expect(text).not.toContain('Save is available after the first completed turn')
      expect(text).not.toContain('The last unanswered follow-up')
    } finally {
      mounted.unmount()
    }
  })

  it('keeps the last rows when the first walk fails and when the tail page fails', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValueOnce(FAILED_PAGE).mockResolvedValueOnce(FAILED_PAGE)
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      // A failed walk leaves the cache empty: the empty-thread composer and a
      // transcript with no rows, not an error banner.
      expect(mounted.container.querySelector('textarea')!.placeholder)
        .toBe('Ask the first question — context inherited…')
      expect(textOf(mounted.container)).not.toContain('Side Chat error')

      // Re-entering visibility re-pulls; the walk already resolved a boundary,
      // so the second pull is the tail page and its failure is silent too.
      mounted.rerender({ tab: tabFor('child-1'), visible: false })
      mounted.rerender({ tab: tabFor('child-1'), visible: true })
      await flush()
      expect(mounted.container.querySelector('textarea')!.placeholder)
        .toBe('Ask the first question — context inherited…')
    } finally {
      mounted.unmount()
    }
  })

  it('pages the first walk back until the seed marker surfaces', async () => {
    const harness = makeHarness()
    harness.history.mockImplementation(async payload => (
      payload.beforeSeq === undefined
        ? page([entry(8, 'user/message', { content: [{ type: 'text', text: 'own question' }] })])
        : page([
          entry(1, 'user/message', { content: [{ type: 'text', text: 'seeded answer' }] }),
          entry(2, 'session/end-seed'),
        ])
    ))
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      expect(harness.history).toHaveBeenCalledTimes(2)
      expect(harness.history).toHaveBeenLastCalledWith(
        { sessionId: 'child-1', maxMessages: 200, beforeSeq: 8 },
        expect.any(AbortSignal),
      )
      // Only the thread's own events survive the seed cut.
      expect(textOf(mounted.container)).toContain('own question')
      expect(textOf(mounted.container)).not.toContain('seeded answer')
    } finally {
      mounted.unmount()
    }
  })

  it('keeps the walked rows when a later tail page fails', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValueOnce(page(OWN_ENTRIES())).mockResolvedValue(FAILED_PAGE)
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      expect(textOf(mounted.container)).toContain('question')

      mounted.rerender({ tab: tabFor('child-1'), visible: false })
      mounted.rerender({ tab: tabFor('child-1'), visible: true })
      await flush()
      expect(harness.history).toHaveBeenLastCalledWith({ sessionId: 'child-1', maxMessages: 8 }, expect.any(AbortSignal))
      expect(textOf(mounted.container)).toContain('question')
    } finally {
      mounted.unmount()
    }
  })

  it('polls the tail page and the live info while the thread runs', async () => {
    vi.useFakeTimers()
    const harness = makeHarness()
    harness.history.mockImplementation(async () => page(OWN_EVENTS))
    const info = vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true, status: 'running', preset: 'coder', model: 'ds-3' })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      harness.store.set({
        current: undefined,
        byId: {
          'child-1': { id: 'child-1', displayTitle: 'Side: Fix bug', origin: 'subagent', parentId: 'parent', running: true },
        },
      })
      await flush()
      expect(textOf(mounted.container)).toContain('Deep diving…')
      expect(textOf(mounted.container)).toContain('coder · ds-3')

      harness.history.mockClear()
      await act(async () => { vi.advanceTimersByTime(2000) })
      await flush()
      expect(harness.history).toHaveBeenCalledWith({ sessionId: 'child-1', maxMessages: 8 }, expect.any(AbortSignal))
      expect(info).toHaveBeenCalledTimes(2)

      // The stop button aborts the running turn.
      const stop = [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title') === 'Abort the running turn (queued work is kept)')!
      const cancel = vi.spyOn(api, 'sidechatCancel').mockResolvedValue({ accepted: true })
      await act(async () => { stop.click() })
      expect(cancel).toHaveBeenCalledWith('child-1')
    } finally {
      mounted.unmount()
      vi.useRealTimers()
    }
  })

  it('reports a failed cancel', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true, status: 'running' })
    vi.spyOn(api, 'sidechatCancel').mockRejectedValueOnce(new Error('cancel failed')).mockRejectedValueOnce('wire down')
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: 'Side: Fix bug', parentId: 'parent', running: true } },
      })
      await flush()
      const stop = (): HTMLButtonElement => [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title') === 'Abort the running turn (queued work is kept)')!
      await act(async () => { stop().click() })
      expect(textOf(mounted.container)).toContain('Side Chat error: cancel failed')

      await act(async () => { stop().click() })
      expect(textOf(mounted.container)).toContain('Side Chat error: wire down')
    } finally {
      mounted.unmount()
    }
  })

  it('shows the provider fallback badge and swallows a failed info pull', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page([entry(1, 'session/end-seed')]))
    const info = vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true, preset: 'coder', provider: 'deepseek' })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      expect(textOf(mounted.container)).toContain('coder · deepseek')

      // Re-binding clears the badge; a failed pull leaves it cleared rather
      // than surfacing an error.
      info.mockRejectedValue(new Error('offline'))
      mounted.rerender({ tab: tabFor('child-2') })
      await flush()
      expect(textOf(mounted.container)).not.toContain('coder · deepseek')
      expect(textOf(mounted.container)).not.toContain('Side Chat error')
    } finally {
      mounted.unmount()
    }
  })

  it('follows the thread title onto the tab title', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: 'Side: Fix the bug', parentId: 'parent' } },
      })
      await flush()
      expect(harness.updateTab).toHaveBeenCalledWith('sidechat:parent', { title: 'Fix the bug' })

      // The already-matching title is not re-written, and a thread still on the
      // placeholder label keeps the tab title untouched.
      harness.updateTab.mockClear()
      mounted.rerender({ tab: { ...tabFor('child-1'), title: 'Fix the bug' } })
      harness.store.set({
        current: undefined,
        byId: { 'child-2': { id: 'child-2', displayTitle: SIDE_NEW_THREAD_TITLE, parentId: 'parent' } },
      })
      await flush()
      expect(harness.updateTab).not.toHaveBeenCalled()

      // A thread absent from the list feed is left alone.
      harness.store.set({ current: undefined, byId: {} })
      await flush()
      expect(harness.updateTab).not.toHaveBeenCalled()

      // A label without the side prefix is used verbatim.
      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: 'Plain title', parentId: 'parent' } },
      })
      await flush()
      expect(harness.updateTab).toHaveBeenCalledWith('sidechat:parent', { title: 'Plain title' })
    } finally {
      mounted.unmount()
    }
  })

  it('ignores a stale-title failure and a hidden new-thread label', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    harness.updateTab.mockImplementation(() => { throw new Error('stale tab') })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: SIDE_NEW_THREAD_TITLE, parentId: 'parent' } },
      })
      await flush()
      expect(textOf(mounted.container)).not.toContain('Side Chat error')

      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: 'Side: ', parentId: 'parent' } },
      })
      await flush()
      expect(mounted.container.querySelector('textarea')!.placeholder).toBe('Ask a follow-up…')
    } finally {
      mounted.unmount()
    }
  })

  it('sends the composer text and clears the field', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_ENTRIES()))
    const prompt = vi.spyOn(api, 'sidechatPrompt').mockResolvedValue({ accepted: true })
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      const field = mounted.container.querySelector('textarea')!
      expect(field.placeholder).toBe('Ask the first question — context inherited…')
      typeInto(field, '  follow up  ')
      const send = [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title') === 'Send')!
      await act(async () => { send.click() })

      expect(prompt).toHaveBeenCalledWith('child-1', 'follow up')
      expect(mounted.container.querySelector('textarea')!.value).toBe('')
    } finally {
      mounted.unmount()
    }
  })

  it('sends on Enter only without shift and without an active composition', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_ENTRIES()))
    const prompt = vi.spyOn(api, 'sidechatPrompt').mockResolvedValue({ accepted: true })
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      const field = mounted.container.querySelector('textarea')!
      const press = (init: KeyboardEventInit): void => {
        act(() => { field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
      }
      // An empty composer and a non-Enter key both leave the wire untouched.
      press({ key: 'Enter' })
      expect(prompt).not.toHaveBeenCalled()

      typeInto(field, 'hello')
      press({ key: 'a' })
      press({ key: 'Enter', shiftKey: true })
      press({ key: 'Enter', isComposing: true })
      expect(prompt).not.toHaveBeenCalled()

      await act(async () => { press({ key: 'Enter' }) })
      expect(prompt).toHaveBeenCalledWith('child-1', 'hello')
    } finally {
      mounted.unmount()
    }
  })

  it('reports a failed send and leaves the draft in place', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_ENTRIES()))
    vi.spyOn(api, 'sidechatPrompt').mockRejectedValueOnce(new Error('send failed')).mockRejectedValueOnce('wire down')
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      const field = mounted.container.querySelector('textarea')!
      const sendButton = (): HTMLButtonElement => [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title') === 'Send')!
      typeInto(field, 'hello')
      await act(async () => { sendButton().click() })
      expect(textOf(mounted.container)).toContain('Side Chat error: send failed')
      expect(mounted.container.querySelector('textarea')!.value).toBe('hello')

      // A non-Error rejection still surfaces its text.
      await act(async () => { sendButton().click() })
      expect(textOf(mounted.container)).toContain('Side Chat error: wire down')
    } finally {
      mounted.unmount()
    }
  })

  it('finishes a send whose tab was unbound while the prompt was in flight', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_ENTRIES()))
    const pending = deferred<{ accepted: true }>()
    const prompt = vi.spyOn(api, 'sidechatPrompt').mockReturnValue(pending.promise)
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      typeInto(mounted.container.querySelector('textarea')!, 'hello')
      act(() => {
        [...mounted.container.querySelectorAll('button')].find(button => button.getAttribute('title') === 'Send')!.click()
      })
      expect(prompt).toHaveBeenCalledWith('child-1', 'hello')

      // The tab loses its thread binding before the prompt resolves: the
      // composer field is gone, so the post-await cleanup must tolerate it.
      mounted.rerender({ tab: tabFor() })
      pending.resolve({ accepted: true })
      await flush()
      expect(textOf(mounted.container)).toContain('No side conversations')
      expect(textOf(mounted.container)).not.toContain('Side Chat error')
    } finally {
      mounted.unmount()
    }
  })

  it('saves a completed thread as a new session and renames it', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      harness.store.set({
        current: undefined,
        byId: { 'child-1': { id: 'child-1', displayTitle: 'Side: Fix the bug', parentId: 'parent' } },
      })
      await flush()
      const save = [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title')?.startsWith('Save as new session'))!
      await act(async () => { save.click() })

      expect(harness.fork).toHaveBeenCalledWith({ sessionId: 'child-1', increaseTitle: true })
      expect(harness.rename).toHaveBeenCalledWith('Fix the bug')
      expect(harness.open).toHaveBeenCalledWith('saved-session')
      expect(textOf(mounted.container)).toContain('Saved as a new session')
    } finally {
      mounted.unmount()
    }
  })

  it('saves without a rename when the thread has no resolved title or binding', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    harness.binding.mockReturnValue(undefined)
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      await act(async () => {
        [...mounted.container.querySelectorAll('button')]
          .find(button => button.getAttribute('title')?.startsWith('Save as new session'))!.click()
      })
      expect(harness.rename).not.toHaveBeenCalled()
      expect(textOf(mounted.container)).toContain('Saved as a new session')
    } finally {
      mounted.unmount()
    }
  })

  it('refuses to save when the runtime has no session fork', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    Object.defineProperty(harness.ctx.sessions, 'fork', { value: undefined, configurable: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      await act(async () => {
        [...mounted.container.querySelectorAll('button')]
          .find(button => button.getAttribute('title')?.startsWith('Save as new session'))!.click()
      })
      expect(textOf(mounted.container)).toContain('Side Chat error: session fork is unavailable')
    } finally {
      mounted.unmount()
    }
  })

  it('reports a failed save', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    harness.fork.mockRejectedValue('nope')
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      await act(async () => {
        [...mounted.container.querySelectorAll('button')]
          .find(button => button.getAttribute('title')?.startsWith('Save as new session'))!.click()
      })
      expect(textOf(mounted.container)).toContain('Side Chat error: nope')
    } finally {
      mounted.unmount()
    }
  })

  it('keeps the save action disabled until a turn completes and flags a trailing follow-up', async () => {
    const harness = makeHarness()
    const threads = [
      [entry(1, 'session/end-seed')],
      [entry(1, 'session/end-seed'), entry(2, 'user/message', { content: 'hi' })],
      [
        entry(1, 'session/end-seed'),
        entry(2, 'user/message', { content: 'hi' }),
        entry(3, 'turn/end'),
        entry(4, 'user/message', { content: 'again' }),
      ],
      [entry(1, 'session/end-seed'), entry(2, 'user/message', { content: 'hi' }), entry(3, 'turn/end')],
    ]
    harness.history.mockResolvedValueOnce(page(threads[0]!))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      const saveButton = (): HTMLButtonElement => [...mounted.container.querySelectorAll('button')]
        .find(button => button.getAttribute('title')?.startsWith('Save as new session'))!
      // An empty thread: nothing to save, nothing to warn about.
      expect(saveButton().disabled).toBe(true)
      expect(textOf(mounted.container)).not.toContain('The last unanswered follow-up')
      expect(textOf(mounted.container)).not.toContain('Save is available')

      harness.history.mockResolvedValueOnce(page(threads[1]!))
      mounted.rerender({ tab: tabFor('child-2') })
      await flush()
      expect(saveButton().disabled).toBe(true)
      expect(textOf(mounted.container)).toContain('Save is available after the first completed turn')
      expect(textOf(mounted.container)).not.toContain('The last unanswered follow-up')

      // A completed turn followed by an unanswered follow-up: saveable, with a
      // warning that the trailing question is dropped.
      harness.history.mockResolvedValueOnce(page(threads[2]!))
      mounted.rerender({ tab: tabFor('child-3') })
      await flush()
      expect(saveButton().disabled).toBe(false)
      expect(textOf(mounted.container)).toContain('The last unanswered follow-up will not be included in the saved session')

      harness.history.mockResolvedValueOnce(page(threads[3]!))
      mounted.rerender({ tab: tabFor('child-4') })
      await flush()
      expect(saveButton().disabled).toBe(false)
      expect(textOf(mounted.container)).not.toContain('The last unanswered follow-up')
    } finally {
      mounted.unmount()
    }
  })

  it('aborts the previous transcript pull when the pull is superseded', async () => {
    const harness = makeHarness()
    const signals: Array<AbortSignal | undefined> = []
    const pending = deferred<unknown>()
    harness.history.mockImplementation(async (_payload, signal) => {
      signals.push(signal)
      return await pending.promise
    })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(false)

      mounted.rerender({ tab: tabFor('child-1'), visible: false })
      mounted.rerender({ tab: tabFor('child-1'), visible: true })
      await flush()
      expect(signals).toHaveLength(2)
      expect(signals[0]!.aborted).toBe(true)
    } finally {
      mounted.unmount()
    }
  })

  it('sticks the transcript to the bottom as rows grow', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page(OWN_EVENTS))
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 240 })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      await flush()
      const scroller = mounted.container.querySelector<HTMLElement>('[class*="sidechatScroll"]')!
      expect(scroller.scrollTop).toBe(240)
    } finally {
      if (height === undefined) delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight
      else Object.defineProperty(HTMLElement.prototype, 'scrollHeight', height)
      mounted.unmount()
    }
  })
})

/** The minimal own-event log (a completed turn) used by composer tests. */
function OWN_ENTRIES(): SidebarHistoryEntry[] {
  return [
    entry(1, 'session/end-seed'),
    entry(2, 'user/message', { content: [{ type: 'text', text: 'question' }] }),
    entry(3, 'turn/end'),
  ]
}

describe('SideChatView thread menu', () => {
  it('opens a new thread tab and switches to an existing one exactly once', async () => {
    const harness = makeHarness()
    harness.history.mockResolvedValue(page([entry(1, 'session/end-seed')]))
    vi.spyOn(api, 'sidechatInfo').mockResolvedValue({ live: true })
    harness.store.set({
      current: undefined,
      byId: {
        'child-1': { id: 'child-1', displayTitle: 'Side: Current', origin: 'subagent', parentId: 'parent' },
        'child-2': { id: 'child-2', displayTitle: 'Side: Other', origin: 'subagent', parentId: 'parent', running: true },
      },
    })
    const mounted = mount(harness.ctx, tabFor('child-1'))
    try {
      const open = (): void => {
        act(() => {
          mounted.container.querySelector<HTMLButtonElement>('[class*="sidechatIconBtn"]')!.click()
        })
      }
      open()
      expect(menuRows().map(row => row.textContent)).toEqual(['New thread', 'Current', 'Other'])

      act(() => { menuRows()[0]!.click() })
      expect(harness.openTab).toHaveBeenCalledWith({ type: 'sidechat' }, SCOPE)
      expect(menuRows()).toHaveLength(0)

      open()
      act(() => { menuRows()[1]!.click() })
      // Switching to the already-bound thread is a no-op.
      expect(harness.openTab).toHaveBeenCalledTimes(1)

      open()
      act(() => { menuRows()[2]!.click() })
      expect(harness.openTab).toHaveBeenCalledTimes(2)
      expect(consumeSidechatSeed()).toBe('child-2')

      open()
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(menuRows()).toHaveLength(0)
    } finally {
      mounted.unmount()
    }
  })
})
