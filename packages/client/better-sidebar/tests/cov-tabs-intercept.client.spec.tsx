/**
 * Remaining interception paths: the intercepted produced-files row (chips,
 * the +N overflow with its show-in-folder action), revealInExplorer's target
 * resolution (relative paths, empty-set → workspace root, no cwd), the
 * external-disable (suspended) decline of the turn-tail takeover, the
 * slash-less openSidebarFile title, and the `'.'` folder-reveal gesture
 * riding the wrapped openPath into the explorer.
 */
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import {
  openSidebarFile,
  registerOpenPathInterception,
  registerTurnTailInterception,
  revealInExplorer,
  SidebarProducedFiles,
} from '../src/client/intercept.tsx'
import { createSidebarStore, allLeaves } from '../src/client/state.ts'
import type { Context } from '../src/context-types.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** A produced-files owner currency: one closing assistant turn + tool rows. */
const producedOwner = (paths: string[]): unknown => ({
  nodes: [
    { kind: 'assistant', seq: 1, turn: 1 },
    ...paths.map(path => ({
      kind: 'tool-result', isError: false, callView: { card: 'diff', locations: [{ path }] },
    })),
    { kind: 'assistant', seq: 2, turn: 1 },
  ],
  seq: 2,
})

/** The minimal client-context fake (sessions feed + the sidebar service seam). */
function clientCtx(): { ctx: Context; openTab: ReturnType<typeof vi.fn> } {
  const openTab = vi.fn()
  const betterSidebar = { openTab }
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ current: 's1', byId: { s1: { id: 's1', cwd: '/w', displayTitle: 's1' } } }) },
    },
    get: (name: string) => name === 'betterSidebar' ? betterSidebar : undefined,
  } as unknown as Context
  return { ctx, openTab }
}

describe('SidebarProducedFiles row', () => {
  it('renders one chip per produced file (basenames), plus the label', () => {
    const html = renderToString(createElement(SidebarProducedFiles, {
      matched: ['/w/src/a.ts', 'b.md'],
      openInSidebar: () => {},
      onShowInFolder: () => {},
    }))
    expect(html).toContain('a.ts')
    expect(html).toContain('b.md')
    expect(html).not.toContain('Show in folder')
  })

  it('caps the chips at six and offers the show-in-folder action for the overflow', () => {
    const show = vi.fn()
    const html = renderToString(createElement(SidebarProducedFiles, {
      matched: ['1.ts', '2.ts', '3.ts', '4.ts', '5.ts', '6.ts', '7.ts', '8.ts'],
      openInSidebar: () => {},
      onShowInFolder: show,
    }))
    // Exactly six chips render; the overflow counter and the reveal affordance follow.
    expect(html.match(/producedChip/gu)?.length).toBe(6)
    expect(html).toContain('Show in folder')
  })
})

describe('openSidebarFile + revealInExplorer', () => {
  it('uses the whole resolved path as the title when it has no separator', () => {
    const { ctx, openTab } = clientCtx()
    openSidebarFile(ctx, 's1', 'plain.ts')
    // A bare name resolves against the session cwd; the title is the segment.
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: 'plain.ts', path: '/w/plain.ts', id: 'editor:/w/plain.ts' })
  })

  it('reveal expands ancestors, highlights the rows, and opens the files window', () => {
    const { ctx, openTab } = clientCtx()
    const store = createSidebarStore()
    store.setSession('reveal-session')
    revealInExplorer(ctx, store, 's1', ['src/a.ts'])
    const state = store.getSnapshot().state!
    expect(state.revealed).toEqual(['/w/src/a.ts'])
    expect(state.expanded).toContain('/w/src')
    // The reveal opens the collapsed panel and pins the landing pane.
    expect(state.panelOpen).toBe(true)
    expect(state.activePane).toBe(firstLeafId(store))
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: 'Files' })
  })

  it('an empty file list reveals the workspace root; no cwd reveals nothing', () => {
    const { ctx, openTab } = clientCtx()
    const store = createSidebarStore()
    store.setSession('reveal-root')
    revealInExplorer(ctx, store, 's1', [])
    expect(store.getSnapshot().state!.revealed).toEqual(['/w'])

    const noCwdCtx = {
      sessions: { list: { getSnapshot: () => ({ current: 's1', byId: {} }) } },
      get: ctx.get,
    } as unknown as Context
    const bare = createSidebarStore()
    bare.setSession('reveal-nocwd')
    revealInExplorer(noCwdCtx, bare, 's1', [])
    expect(bare.getSnapshot().state!.revealed).toEqual([])
    expect(openTab).toHaveBeenCalled()
  })

  it('a second reveal keeps the already-open panel (no extra toggle)', () => {
    const { ctx, openTab } = clientCtx()
    const store = createSidebarStore()
    store.setSession('reveal-twice')
    revealInExplorer(ctx, store, 's1', ['a.ts'])
    const once = store.getSnapshot().state!
    expect(once.panelOpen).toBe(true)
    revealInExplorer(ctx, store, 's1', ['b.ts'])
    const twice = store.getSnapshot().state!
    expect(twice.panelOpen).toBe(true)
    expect(twice.revealed).toEqual(['/w/b.ts'])
    expect(openTab).toHaveBeenCalledTimes(2)
  })

  it('opens a cwd-less session without resolving a title segment', () => {
    const { ctx, openTab } = clientCtx()
    const noCwdCtx = {
      sessions: { list: { getSnapshot: () => ({ current: 's1', byId: {} }) } },
      get: ctx.get,
    } as unknown as Context
    // No cwd: the path passes through unresolved (no separator → whole path).
    openSidebarFile(noCwdCtx, 's1', 'bare.ts')
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: 'bare.ts', path: 'bare.ts', id: 'editor:bare.ts' })
  })
})

/** The first leaf pane's id (the reveal pins the active pane there). */
function firstLeafId(store: ReturnType<typeof createSidebarStore>): string {
  const state = store.getSnapshot().state!
  // firstLeaf descends the split tree; a fresh session is a single leaf.
  const splits = state.splits
  return splits.kind === 'leaf' ? splits.id : allLeaves(splits)[0]!.id
}

/** A structural fake of the client slots service (mirror of the turn-tail spec). */
function fakeSlots(): { slots: unknown; registered: Array<{ options: Record<string, unknown>; component: unknown }> } {
  const registered: Array<{ options: Record<string, unknown>; component: unknown }> = []
  return {
    registered,
    slots: {
      register: (options: Record<string, unknown>, component: unknown) => {
        registered.push({ options, component })
        return () => {}
      },
      inject: (_key: string, callback: () => () => void) => callback(),
    },
  }
}

describe('turn-tail takeover declines', () => {
  it('declines when the editor tab is disabled, and keeps lastProduced only on a match', () => {
    const fake = fakeSlots()
    const { ctx } = clientCtx()
    ctx.slots = fake.slots as typeof ctx.slots
    const store = createSidebarStore()
    const restore = registerTurnTailInterception(ctx, store)
    const select = fake.registered[0]!.options.select as (owner: unknown) => unknown
    // The editor switch off: even a produced turn declines (the default
    // deliverables row renders instead of chips that cannot open).
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: { editor: false } })
    expect(select(producedOwner(['a.ts']))).toBeNull()
    store.setPrefs({ ...store.getPrefs(), tabsEnabled: {} })
    // A produced turn claims the chain; an empty one declines WITHOUT
    // touching the last match (the reveal keeps its targets).
    expect(select(producedOwner(['a.ts', 'b.ts']))).toEqual(['a.ts', 'b.ts'])
    expect(select({ nodes: [{ kind: 'assistant', seq: 1, turn: 1 }], seq: 1 })).toBeNull()
    restore()
  })

  it('returns null while the sidebar is externally disabled (suspended)', () => {
    const fake = fakeSlots()
    const { ctx } = clientCtx()
    ctx.slots = fake.slots as typeof ctx.slots
    const store = createSidebarStore()
    const restore = registerTurnTailInterception(ctx, store)
    const select = fake.registered[0]!.options.select as (owner: unknown) => unknown
    store.setSuspended(true)
    expect(select(producedOwner(['a.ts']))).toBeNull()
    // Re-enabled: the produced turn is claimed again.
    store.setSuspended(false)
    expect(select(producedOwner(['a.ts']))).toEqual(['a.ts'])
    restore()
  })

  it('wires the session-scoped seats (openInSidebar / onShowInFolder)', () => {
    const fake = fakeSlots()
    const { ctx, openTab } = clientCtx()
    ctx.slots = fake.slots as typeof ctx.slots
    const store = createSidebarStore()
    const restore = registerTurnTailInterception(ctx, store)
    const inject = fake.registered[0]!.options.inject as (sessionId: string) => {
      openInSidebar: (path: string) => void
      onShowInFolder: (files: readonly string[]) => void
    }
    const seat = inject('s1')
    seat.openInSidebar('/w/src/a.ts')
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: 'a.ts', path: '/w/src/a.ts', id: 'editor:/w/src/a.ts' })
    seat.onShowInFolder(['src/a.ts'])
    expect(openTab).toHaveBeenLastCalledWith({ type: 'editor', title: 'Files' })
    restore()
  })

  it("the '.' folder-reveal gesture rides the wrapped openPath into the explorer; plain opens go to the editor", async () => {
    const { ctx, openTab } = clientCtx()
    const funnel = {
      openPath: async (_path: string): Promise<void> => {},
    }
    ;(ctx as { workspaces?: unknown }).workspaces = funnel
    const store = createSidebarStore()
    const restoreOpen = registerOpenPathInterception(ctx, store)
    // The reveal gesture (the deliverables row passes '.') opens the files
    // window instead of an editor tab (no editor seed, panel reveal only).
    await ctx.workspaces!.openPath('.')
    expect(openTab).toHaveBeenCalledWith({ type: 'editor', title: 'Files' })
    // A plain path lands in the sidebar editor with the session-resolved id.
    await ctx.workspaces!.openPath('/w/src/late.ts')
    expect(openTab).toHaveBeenLastCalledWith({ type: 'editor', title: 'late.ts', path: '/w/src/late.ts', id: 'editor:/w/src/late.ts' })
    restoreOpen()
    // The raw funnel is restored: a later open reaches the original.
    const calls: string[] = []
    funnel.openPath = async (path) => { calls.push(path) }
    await ctx.workspaces!.openPath('/w/late2.ts')
    expect(calls).toEqual(['/w/late2.ts'])
    expect(openTab).toHaveBeenCalledTimes(2)
  })
})

/** Mount the row with createRoot and click its chips (event paths). */
describe('SidebarProducedFiles clicks', () => {
  it('the chip click opens that file; the show-in-folder click reveals the set', () => {
    const opened: string[] = []
    const shown: Array<readonly string[]> = []
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(SidebarProducedFiles, {
        matched: ['/w/a.ts', '/w/b.ts', '/w/c.ts', '/w/d.ts', '/w/e.ts', '/w/f.ts', '/w/g.ts'],
        openInSidebar: (path) => { opened.push(path) },
        onShowInFolder: (files) => { shown.push(files) },
      }))
    })
    const chips = [...container.querySelectorAll('button[class*="producedChip"]')] as HTMLButtonElement[]
    expect(chips).toHaveLength(6)
    act(() => { chips[2]!.click() })
    expect(opened).toEqual(['/w/c.ts'])
    const more = container.querySelector('button[class*="producedMore"]') as HTMLButtonElement
    expect(more).not.toBeNull()
    act(() => { more.click() })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toHaveLength(7)
    act(() => { root.unmount() })
    container.remove()
  })
})
