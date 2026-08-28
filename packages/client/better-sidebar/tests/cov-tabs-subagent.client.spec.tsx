/**
 * Subagent topology page coverage round: the root card (jump back, highlight,
 * fallback label), lazy catalog rows (live status lines, one-shot/continuable
 * modes, nested levels, diagnostics, error + retry, side-thread filtering,
 * summary-backed loading, ready-empty state), the arrow-key navigation, the
 * catalog-open observation effects, and the job section's remaining paths
 * (kill failure, multi-owner labels, output pane states).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { SubagentView } from '../src/client/SubagentView.tsx'
import { SIDE_LABEL_PREFIX } from '../src/sidechat-core.ts'
import type { Context, SidebarSessionList, SidebarSubagentCatalog, SidebarSubagentChildEntry, SidebarSubagentDiagnosticEntry } from '../src/context-types.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A subscribable sessions-list snapshot (mirror of the runtime list feed). */
function makeStore(initial: SidebarSessionList) {
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
      for (const fn of [...listeners]) fn()
    },
  }
}

type Store = ReturnType<typeof makeStore>

function makeCtx(store: Store, overrides: Partial<Record<string, unknown>> = {}): {
  ctx: Context
  calls: { openSubagent: unknown[]; open: unknown[]; refresh: string[]; catalogOpen: Array<[string, boolean]> }
} {
  const calls = {
    openSubagent: [] as unknown[],
    open: [] as unknown[],
    refresh: [] as string[],
    catalogOpen: [] as Array<[string, boolean]>,
  }
  const ctx = {
    sessions: {
      list: store,
      setSubagentCatalogOpen: (id: string, open: boolean) => { calls.catalogOpen.push([id, open]) },
      openSubagent: (address: unknown) => { calls.openSubagent.push(address) },
      open: (id: string) => { calls.open.push(id) },
      refreshSubagents: async (id: string) => { calls.refresh.push(id) },
    },
  } as unknown as Context
  Object.assign(ctx.sessions as object, overrides)
  return { ctx, calls }
}

/** Render `node` into a detached body container under React's act(). */
function mount(node: ReactNode): {
  container: HTMLDivElement
  rerender: (next: ReactNode) => void
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const rerender = (next: ReactNode): void => { act(() => { root.render(next) }) }
  act(() => { root.render(node) })
  const unmount = (): void => {
    act(() => { root.unmount() })
    container.remove()
  }
  return { container, rerender, unmount }
}

function jsonResponse(value: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ ok: true, value }) } as unknown as Response
}

const catalog = (entries: unknown[]): SidebarSubagentCatalog => ({ entries: entries as Array<SidebarSubagentChildEntry | SidebarSubagentDiagnosticEntry>, parentAvailable: true, state: 'ready', error: null })

/** The main agent with one running one-shot child and one idle branch. */
function topology(): SidebarSessionList {
  return {
    current: 'root',
    byId: {
      root: { id: 'root', displayTitle: 'Main session', running: true },
      a: { id: 'a', displayTitle: 'Child A', origin: 'subagent', parentId: 'root', running: true },
      b: { id: 'b', displayTitle: 'Child B', origin: 'subagent', parentId: 'root', running: false },
    },
    subagentsByParent: {
      root: catalog([
        { kind: 'child', id: 'a', activity: 'running', hasChildren: false, mode: 'one-shot', label: 'A' },
        { kind: 'child', id: 'b', activity: 'idle', hasChildren: true, mode: 'continuable', label: 'B' },
        { kind: 'diagnostic', id: 'bad-1', reason: 'corrupt' },
      ]),
    },
    jobsBySession: {},
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'language', { value: 'en-US', configurable: true })
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = String(url).split('/').pop()
    if (method === 'subagents.live') return jsonResponse({ live: {} })
    if (method === 'jobs.output') {
      return jsonResponse({ text: `out-${(JSON.parse(String(init?.body)) as { id: string }).id}`, truncated: false, read: true })
    }
    if (method === 'jobs.kill') {
      return jsonResponse({ ok: true, outcome: 'requested' })
    }
    throw new Error(`unexpected fetch ${String(url)}`)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const el of document.querySelectorAll('body > div')) el.remove()
})

describe('SubagentView topology', () => {
  it('renders the main agent card with highlight, counts, and the live tree', () => {
    const store = makeStore(topology())
    const { ctx, calls } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Tasks · Main session')
    expect(text).toContain('2 subagents · 1 running')
    const rootItem = container.querySelector('[role="treeitem"][aria-level="0"]')
    expect(rootItem?.getAttribute('aria-current')).toBe('true')
    expect(rootItem?.getAttribute('aria-label')).toContain('Main session')
    // The running child card carries the one-shot mode; the idle one the
    // continuable mode.
    expect(text).toContain('One-shot')
    expect(text).toContain('Continuable')
    expect(text).toContain('Running')
    expect(text).toContain('Inactive')
    // The catalog-open observation consumed the root on mount.
    expect(calls.catalogOpen).toContainEqual(['root', true])
    unmount()
  })

  it('clicking the root jumps back to the main session; children open transcripts', () => {
    const store = makeStore(topology())
    const { ctx, calls } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'a', active: true, ctx, onOpenChild: () => {} }),
    )
    // Open session is the child: the root card is not current.
    expect(container.querySelector('[role="treeitem"][aria-level="0"]')?.getAttribute('aria-current')).toBeNull()
    const rootItem = container.querySelector('[role="treeitem"][aria-level="0"]') as HTMLElement
    act(() => { rootItem.click() })
    expect(calls.open).toEqual(['root'])
    // The child row click opens its transcript through the sessions seam.
    const child = container.querySelector('[role="treeitem"][aria-level="1"]') as HTMLElement
    act(() => { child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    expect(calls.openSubagent).toHaveLength(1)
    expect(calls.openSubagent[0]).toMatchObject({ parentSessionId: 'root', childSessionId: 'a', mode: 'one-shot' })
    // Space also activates; other keys do nothing.
    act(() => {
      child.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(calls.openSubagent).toHaveLength(2)
    act(() => {
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))
    })
    expect(calls.openSubagent).toHaveLength(2)
    unmount()
  })

  it('a diagnostic entry renders its reason and no live lines', () => {
    const store = makeStore(topology())
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const text = container.textContent ?? ''
    expect(text).toContain('bad-1')
    expect(text).toContain('Corrupt')
    unmount()
  })

  it('all diagnostic reasons resolve to their labels', () => {
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M' } },
      subagentsByParent: {
        root: catalog([
          { kind: 'diagnostic', id: 'd1', reason: 'corrupt' },
          { kind: 'diagnostic', id: 'd2', reason: 'unsupported' },
          { kind: 'diagnostic', id: 'd3', reason: 'unavailable' },
        ]),
      },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Corrupt')
    expect(text).toContain('Unsupported')
    expect(text).toContain('Unavailable')
    unmount()
  })

  it('an error catalog renders the failure with a working retry', async () => {
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M' } },
      subagentsByParent: {
        root: { entries: [], parentAvailable: false, state: 'error', error: { message: 'host gone' } },
      },
      jobsBySession: {},
    })
    const { ctx, calls } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    expect(container.textContent).toContain('host gone')
    const retry = container.querySelector('button[class*="subagentErrorRetry"]') as HTMLButtonElement
    await act(async () => { retry.click() })
    expect(calls.refresh).toEqual(['root'])
    unmount()
  })

  it('side-chat threads are filtered out of the topology', () => {
    const store = makeStore({
      current: 'root',
      byId: {
        root: { id: 'root', displayTitle: 'M' },
        side: { id: 'side', displayTitle: `${SIDE_LABEL_PREFIX} side thread`, origin: 'subagent', parentId: 'root' },
      },
      subagentsByParent: {
        root: catalog([
          { kind: 'child', id: 'side', activity: 'idle', hasChildren: false, mode: 'continuable', label: `${SIDE_LABEL_PREFIX} side` },
        ]),
      },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    expect(container.textContent).not.toContain('side thread')
    unmount()
  })

  it('a summary-backed load shows the loading rows; a ready-empty tree shows the empty state', () => {
    // Catalog absent but summaries announce a child: loading rows render.
    const loading = makeStore({
      current: 'root',
      byId: {
        root: { id: 'root', displayTitle: 'M' },
        a: { id: 'a', displayTitle: 'A', origin: 'subagent', parentId: 'root', running: false },
      },
      subagentsByParent: {},
      jobsBySession: {},
    })
    const { ctx } = makeCtx(loading)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    expect(container.querySelector('[role="tree"][aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="treeitem"][aria-disabled="true"]')).toHaveLength(1)
    unmount()

    // Catalog ready and empty with no summaries: the empty state.
    const empty = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M' } },
      subagentsByParent: { root: catalog([]) },
      jobsBySession: {},
    })
    const { ctx: ctx2 } = makeCtx(empty)
    const { container: c2, unmount: unmount2 } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx: ctx2 }),
    )
    expect(c2.textContent).toContain('No subagents')
    expect(c2.textContent).toContain('will appear here')
    unmount2()
  })

  it('a branch with children renders the nested group with its own loading rows', () => {
    const store = makeStore(topology())
    // Child B has hasChildren: true and NO catalog yet → nested loading.
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const groups = container.querySelectorAll('[role="group"]')
    expect(groups.length).toBeGreaterThanOrEqual(1)
    // The nested group is busy (child catalog missing).
    expect(container.querySelector('[role="group"][aria-busy="true"]')).not.toBeNull()
    unmount()
  })

  it('a childless catalog-loading parent with no summaries renders the plain loading line', () => {
    // Root catalog pending (state loading, zero entries) and no summaries:
    // CatalogLoadingRows renders the single "Loading…" line.
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M' } },
      subagentsByParent: {
        root: { entries: [], parentAvailable: true, state: 'loading', error: null },
      },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    expect(container.textContent).toContain('Loading…')
    unmount()
  })

  it('a session with no topology degrades to itself; the refresh button works', async () => {
    const noRoot = makeStore({ current: undefined, byId: {}, subagentsByParent: {}, jobsBySession: {} })
    const { ctx, calls } = makeCtx(noRoot)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'solo', active: true, ctx }),
    )
    // The root resolves to the session itself; no root summary row renders,
    // and the empty tree shows the ready-empty hint.
    expect(container.querySelector('[role="treeitem"][aria-level="0"]')).toBeNull()
    const refresh = container.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement
    expect(refresh.disabled).toBe(false)
    await act(async () => { refresh.click() })
    expect(calls.refresh).toEqual(['solo'])
    unmount()

    const store = makeStore(topology())
    const { ctx: ctx2, calls: calls2 } = makeCtx(store)
    const { container: c2, unmount: unmount2 } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx: ctx2 }),
    )
    await act(async () => {
      ;(c2.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement).click()
    })
    expect(calls2.refresh).toEqual(['root'])
    unmount2()
  })

  it('unlabeled children fall back to summary titles and raw ids; count labels go plain', () => {
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M', running: false }, known: { id: 'known', displayTitle: 'Known child', origin: 'subagent', parentId: 'root' } },
      subagentsByParent: {
        root: catalog([
          // No label + a summary: the display title becomes the label.
          { kind: 'child', id: 'known', activity: 'idle', hasChildren: false, mode: 'one-shot' },
          // No label + no summary: the raw id is the label.
          { kind: 'child', id: 'ghost', activity: 'idle', hasChildren: false, mode: 'continuable' },
        ]),
      },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Known child')
    expect(text).toContain('ghost')
    // No running children: the plain count label (no running suffix). Only
    // summary-backed children count (the ghost has no durable row yet).
    expect(text).toContain('1 subagents')
    unmount()
  })

  it('an empty root display title falls back to the Main agent label on the card and header', () => {
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: '' } },
      subagentsByParent: { root: catalog([]) },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const rootItem = container.querySelector('[role="treeitem"][aria-level="0"]')
    expect(rootItem?.getAttribute('aria-label')).toContain('Main agent')
    expect(container.querySelector('[class*="subagentTitle"]')?.textContent).toBe('Tasks')
    unmount()
  })

  it('the root card activates with Enter and click and survives a throwing open', () => {
    const store = makeStore(topology())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { ctx, calls } = makeCtx(store)
    ;(ctx.sessions as unknown as { open: () => void }).open = () => { throw new Error('gone') }
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const rootItem = container.querySelector('[role="treeitem"][aria-level="0"]') as HTMLElement
    act(() => {
      rootItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(warn).toHaveBeenCalledTimes(1)
    act(() => { rootItem.click() })
    expect(warn).toHaveBeenCalledTimes(2)
    // Space does not re-throw either (openMain catches everything).
    act(() => {
      rootItem.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(calls.open).toHaveLength(0)
    warn.mockRestore()
    unmount()
  })

  it('a throwing openSubagent is logged and the jump notify still ran', () => {
    const store = makeStore(topology())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const jumps: string[] = []
    const { ctx, calls } = makeCtx(store)
    ;(ctx.sessions as unknown as { openSubagent: () => void }).openSubagent = () => { throw new Error('nope') }
    const { container, unmount } = mount(
      createElement(SubagentView, {
        sessionId: 'root', active: true, ctx,
        onOpenChild: (address) => { jumps.push((address as { childSessionId: string }).childSessionId) },
      }),
    )
    const child = container.querySelector('[role="treeitem"][aria-level="1"]') as HTMLElement
    act(() => { child.click() })
    expect(jumps).toEqual(['a'])
    expect(warn).toHaveBeenCalled()
    expect(calls.openSubagent).toHaveLength(0)
    warn.mockRestore()
    unmount()
  })

  it('an older snapshot WITHOUT the subagent seam degrades to the empty page', () => {
    const store = makeStore({ current: 'root', byId: { root: { id: 'root', displayTitle: 'M' } }, jobsBySession: {} } as SidebarSessionList)
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    // The summary feed still renders the root card; no child rows exist.
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1)
    unmount()
  })

  it('re-observing a known branch is a no-op; hiding the page releases the set', () => {
    const store = makeStore(topology())
    const { ctx, calls } = makeCtx(store)
    const { rerender, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const observedAfterMount = calls.catalogOpen.filter(([, open]) => open).map(([id]) => id)
    // A fresh snapshot re-runs the branch effect: known branches are skipped.
    store.set(topology())
    expect(calls.catalogOpen.filter(([, open]) => open).map(([id]) => id))
      .toEqual(observedAfterMount)
    // Hiding the page releases every observed catalog.
    rerender(createElement(SubagentView, { sessionId: 'root', active: false, ctx }))
    const released = calls.catalogOpen.filter(([, open]) => !open).map(([id]) => id)
    for (const id of observedAfterMount) expect(released).toContain(id)
    unmount()
  })

  it('arrow keys on a tree without focusable rows and without focus are safe', () => {
    const store = makeStore({
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'M' } },
      subagentsByParent: { root: catalog([]) },
      jobsBySession: {},
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const body = container.querySelector('[class*="subagentBody"]') as HTMLElement
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      act(() => {
        body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
    }
    // The root card is the only row; the walk is a no-op over it.
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(1)
    unmount()
  })

  it('arrow keys walk the enabled rows (Down/Up/Home/End)', () => {
    const store = makeStore(topology())
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const body = container.querySelector('[class*="subagentBody"]') as HTMLElement
    const items = () => container.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])')
    const key = (k: string): void => {
      act(() => {
        body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
      })
    }
    key('Home')
    expect(document.activeElement).toBe(items()[0])
    key('End')
    expect(document.activeElement).toBe(items()[items().length - 1])
    key('ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    key('ArrowUp')
    expect(document.activeElement).toBe(items()[items().length - 1])
    unmount()
  })

  it('live previews: thinking, tool with args, tool without args, and text', async () => {
    vi.useFakeTimers()
    const store = makeStore(topology())
    let livePayload: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('subagents.live')) return jsonResponse({ live: livePayload })
      throw new Error('unexpected')
    }))
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    await act(async () => { await Promise.resolve() })
    // No live data yet: the running child reads "thinking".
    expect(container.textContent).toContain('Thinking')
    // Tool + args, and plain text on the other child (idle → no live lines).
    const longArgs = `x${'y'.repeat(80)}`
    livePayload = {
      a: { tool: { name: 'grep', args: longArgs }, text: `  multi
      line  text ` },
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    const text = container.textContent ?? ''
    expect(text).toContain('grep')
    expect(text).toContain(`x${'y'.repeat(59)}…`) // preview cap at 60 chars
    expect(text.replace(/\s+/g, ' ')).toContain('multi line text')
    // A tool call with empty args renders the name only.
    livePayload = { a: { tool: { name: 'ls', args: '' } } }
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(container.textContent).toContain('ls')
    unmount()
    vi.useRealTimers()
  })
})

describe('SubagentView jobs extras', () => {
  function jobsSnapshot(jobs: unknown[]): SidebarSessionList {
    return {
      current: 'root',
      byId: { root: { id: 'root', displayTitle: 'Main' } },
      subagentsByParent: { root: catalog([]) },
      jobsBySession: { root: jobs as NonNullable<SidebarSessionList['jobsBySession']>[string] },
    }
  }

  it('a failed kill surfaces the inline error; multi-owner rows carry owner titles', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const method = String(url).split('/').pop()
      if (method === 'jobs.kill') {
        // A wire failure (not an ok envelope): call() throws, kill() records it.
        return { ok: false, status: 500, json: async () => ({ ok: false, error: { code: 'busy', message: 'refused' } }) } as unknown as Response
      }
      if (method === 'jobs.output') return jsonResponse({ text: 'x', truncated: false, read: true })
      throw new Error(`unexpected ${String(url)}`)
    }))
    const store = makeStore(jobsSnapshot([
      { id: 'j1', kind: 'bash', label: 'run', status: 'running', startedAt: 1_000, detail: 'cwd /w' },
    ]))
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const kill = container.querySelector('button[aria-label="Kill"]') as HTMLButtonElement
    await act(async () => { kill.click() })
    const confirm = container.querySelector('button[aria-label="Click again to confirm kill"]') as HTMLButtonElement
    await act(async () => { confirm.click() })
    expect(container.textContent).toContain('Kill failed')
    // The detail rides the secondary line.
    expect(container.textContent).toContain('cwd /w')
    unmount()
  })

  it('a settled job without finishedAt formats its elapsed from the start', async () => {
    const store = makeStore(jobsSnapshot([
      { id: 'j9', kind: 'bash', label: 'crashed', status: 'failed', startedAt: 5_000 },
    ]))
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    expect(container.textContent).toContain('crashed')
    unmount()
  })

  it('the output pane header carries the job detail; short tool args stay whole', async () => {
    vi.useFakeTimers()
    let livePayload: Record<string, unknown> = {}
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('subagents.live')) return jsonResponse({ live: livePayload })
      if (String(url).endsWith('jobs.output')) return jsonResponse({ text: 'out', truncated: false, read: true })
      throw new Error(`unexpected ${String(url)}`)
    }))
    const store = makeStore({
      current: 'root',
      byId: {
        root: { id: 'root', displayTitle: 'M' },
        a: { id: 'a', displayTitle: 'A', origin: 'subagent', parentId: 'root', running: true },
      },
      subagentsByParent: {
        root: catalog([
          { kind: 'child', id: 'a', activity: 'running', hasChildren: false, mode: 'one-shot', label: 'A' },
        ]),
      },
      jobsBySession: { root: [{ id: 'j1', kind: 'bash', label: 'watch', status: 'running', startedAt: 1_000, detail: 'exit 3' }] },
    })
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    // Short args render whole (no ellipsis).
    livePayload = { a: { tool: { name: 'ls', args: '-la' } } }
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(container.textContent).toContain('-la')
    // Selecting the job: the dock header shows the detail after the status.
    const row = container.querySelector('button[aria-label*="watch"]') as HTMLButtonElement
    await act(async () => { row.click() })
    expect(container.textContent).toContain('exit 3')
    unmount()
    vi.useRealTimers()
  })

  it('the output pane explains errors, unread jobs, truncation, and pins the tail', async () => {
    vi.useFakeTimers()
    let output: Response | Error = jsonResponse({ text: '', truncated: false, read: false })
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('jobs.output')) {
        if (output instanceof Error) throw output
        return output
      }
      throw new Error(`unexpected ${String(url)}`)
    }))
    const store = makeStore(jobsSnapshot([
      { id: 'j1', kind: 'bash', label: 'watch', status: 'running', startedAt: 1_000 },
    ]))
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const row = container.querySelector('button[aria-label*="watch"]') as HTMLButtonElement
    await act(async () => { row.click() })
    // read:false + empty text → the not-read-yet explainer.
    expect(container.textContent).toContain('Waiting for the model to read')
    // The model read it but produced nothing → the no-output line.
    output = jsonResponse({ text: '', truncated: false, read: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(container.textContent).toContain('No output')
    // Text arrives truncated → the truncation notice; the pre is pinned.
    output = jsonResponse({ text: 'chunk', truncated: true, read: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(container.textContent).toContain('truncated')
    expect(container.querySelector('pre')?.textContent).toBe('chunk')
    // A wire failure keeps the last known output (never blank while loaded).
    output = new Error('offline')
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(container.querySelector('pre')?.textContent).toBe('chunk')
    unmount()
    vi.useRealTimers()
  })

  it('a dock whose first load fails outright renders the error line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('jobs.output')) throw new Error('offline')
      throw new Error(`unexpected ${String(url)}`)
    }))
    const store = makeStore(jobsSnapshot([
      { id: 'j1', kind: 'bash', label: 'one-shot', status: 'completed', startedAt: 1_000, finishedAt: 2_000 },
    ]))
    const { ctx } = makeCtx(store)
    const { container, unmount } = mount(
      createElement(SubagentView, { sessionId: 'root', active: true, ctx }),
    )
    const row = container.querySelector('button[aria-label*="one-shot"]') as HTMLButtonElement
    await act(async () => { row.click() })
    expect(container.textContent).toContain('Failed to read output')
    unmount()
  })
})
