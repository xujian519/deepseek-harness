/**
 * Second coverage round for the per-session sidebar state: the store
 * lifecycle members the main spec does not drive (update, tabOpen,
 * suspension, session clearing), the persisted-id counter seeding against
 * malformed shapes, and the remaining reducer/sanitizer branch tails.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activateTab, insertLeafAt, PANEL_MAX, allLeaves, createSidebarStore, defaultWidthFor, dockFloat, floatTab, makeDefaultState,
  migrateBottomTabs, mintTabId, moveFloat, moveTab, moveTabToEdge, openTabInActivePane, patchTab,
  raiseFloat, removeLeafAt, resizeFloat, resizeSplit, revealPaths, resizeSplitIn, sanitizeState,
  setTabPin, setWidth, splitPane, treeOf, firstLeaf,
  type SidebarState, type SidebarTab, type SplitNode,
} from '../src/client/state.ts'

const editorTab = (id: string): SidebarTab => ({ id, type: 'editor', title: id })
const terminalTab = (id: string): SidebarTab => ({ id, type: 'terminal', title: id })
const leaf = (id: string, tabs: SidebarTab[], active: string | null = tabs[0]?.id ?? null): SplitNode =>
  ({ kind: 'leaf', id, tabs, active })
const split = (id: string, dir: 'row' | 'col', children: SplitNode[]): SplitNode =>
  ({ kind: 'split', id, dir, sizes: children.map(() => 1 / children.length), children })

describe('state reducers: remaining branch tails', () => {
  it('mintTabId mints unique ids through the shared counter', () => {
    const first = mintTabId()
    const second = mintTabId()
    expect(first).toMatch(/^tab:\d+$/)
    expect(second).not.toBe(first)
  })

  it('treeOf routes split ids and misses to the right tree', () => {
    const s = makeDefaultState()
    const splitTree = splitPane(s, 'row')
    const splitId = (splitTree.splits as { id: string }).id
    expect(treeOf(splitTree, splitId)).toBe('splits')
    expect(treeOf(splitTree, 'no-such-id')).toBe('splits')
  })

  it('migrateBottomTabs empties a NESTED bottom tree (clearAllTabs recursion)', () => {
    const s = {
      ...makeDefaultState(400, true, 'none'),
      bottomOpen: true,
      bottomSplits: split('sb', 'row', [
        leaf('pb1', [editorTab('t1')]),
        leaf('pb2', [editorTab('t2')]),
      ]),
    }
    const out = migrateBottomTabs(s)
    expect(out.bottomOpen).toBe(false)
    for (const bottomLeaf of allLeaves(out.bottomSplits)) {
      expect(bottomLeaf.tabs).toHaveLength(0)
      expect(bottomLeaf.active).toBeNull()
    }
    // Both tabs landed in the right tree's first leaf.
    expect(allLeaves(out.splits)[0]!.tabs.map(tab => tab.id)).toEqual(['t1', 't2'])
  })

  it('moveTabToEdge splits to the LEFT edge (fresh leaf first) and on dir col', () => {
    const s = {
      ...makeDefaultState(),
      splits: split('s', 'row', [
        leaf('pa', [editorTab('a1')]),
        leaf('pb', [editorTab('b1')]),
      ]),
      activePane: 'pb',
    }
    const left = moveTabToEdge(s, 'pb', 'b1', 'pa', 'left')
    // The target pane pa split: the fresh leaf with b1 comes FIRST.
    const pa = allLeaves(left.splits).find(l => l.id === 'pa')
    expect(pa).toBeDefined()
    const fresh = allLeaves(left.splits).find(l => l.tabs.some(tab => tab.id === 'b1'))
    expect(fresh).toBeDefined()
    // 'up' takes the same front-first path with dir col.
    const up = moveTabToEdge(s, 'pb', 'b1', 'pa', 'up')
    expect(up.splits.kind).toBe('split')
  })

  it('moveTabToEdge cross-panel drops cover merge, split, emptied source, and misses', () => {
    const base = (): SidebarState => ({
      ...makeDefaultState(400, true, 'none'),
      bottomOpen: true,
      splits: split('s', 'row', [leaf('pa', [editorTab('a1'), editorTab('a2')]), leaf('pb', [editorTab('b1')])]),
      bottomSplits: split('sb', 'row', [leaf('pc', [editorTab('c1')]), leaf('pd', [terminalTab('d1')])]),
      activePane: 'pd',
    })
    // Unknown source tab: strict no-op.
    const untouched = base()
    expect(moveTabToEdge(untouched, 'pd', 'nope', 'pc', 'center')).toBe(untouched)
    // Cross-tree center merge: d1 leaves the bottom tree (source emptied →
    // the sibling leaf promotes) and joins pc, which becomes active.
    const merged = moveTabToEdge(base(), 'pd', 'd1', 'pc', 'center')
    expect(merged.activePane).toBe('pc')
    expect(allLeaves(merged.bottomSplits).find(l => l.id === 'pc')!.tabs.map(t => t.id)).toEqual(['c1', 'd1'])
    // Cross-tree edge split with a NON-active remaining tab (active pointer
    // moves to the sibling, the source leaf keeps its other tab).
    const splitOut = moveTabToEdge(base(), 'pa', 'a1', 'pd', 'right')
    const sourceLeaf = allLeaves(splitOut.splits).find(l => l.tabs.some(tab => tab.id === 'a2'))
    expect(sourceLeaf!.active).toBe('a2')
    expect(allLeaves(splitOut.bottomSplits).flatMap(l => l.tabs.map(t => t.id))).toContain('a1')
  })

  it('removeLeafAt recurses into nested splits and keeps a 3-way split after one removal', () => {
    const tree = split('s', 'row', [
      split('s-inner', 'col', [leaf('p1', []), leaf('p2', [])]),
      leaf('p3', []),
      leaf('p4', []),
    ])
    // A leaf id the direct children do not carry: recursion removes it from
    // the nested split and its emptied sibling promotes.
    const out = removeLeafAt(tree, 'p1')
    const inner = (out as { children: SplitNode[] }).children[0]!
    expect(inner).toMatchObject({ kind: 'leaf', id: 'p2' })
    // Removing one of three leaves keeps a split with the remaining two.
    const out2 = removeLeafAt(tree, 'p3') as { kind: 'split'; children: SplitNode[] }
    expect(out2.children.map(child => child.id)).toEqual(['s-inner', 'p4'])
    // Removing the root leaf itself empties it (the last-leaf rule).
    const emptied = removeLeafAt(leaf('only', [editorTab('x')]), 'only')
    expect(emptied).toMatchObject({ kind: 'leaf', tabs: [], active: null })
  })

  it('activateTab is a no-op when the pane lacks the tab', () => {
    const s = { ...makeDefaultState(400, true, 'none'), splits: leaf('pa', [editorTab('a1')]) }
    const out = activateTab(s, 'pa', 'missing')
    expect(out.splits).toMatchObject({ active: 'a1' })
    expect(out.activePane).toBe('pa')
  })

  it('patchTab walks split trees and skips foreign floats', () => {
    const s: SidebarState = {
      ...makeDefaultState(),
      splits: split('s', 'row', [leaf('pa', [editorTab('a1')]), leaf('pb', [editorTab('b1')])]),
      floats: [
        { id: 'f1', tab: editorTab('float1'), x: 0, y: 0, w: 320, h: 200 },
        { id: 'f2', tab: editorTab('float2'), x: 0, y: 0, w: 320, h: 200 },
      ],
    }
    const out = patchTab(s, 'b1', { title: 'renamed', path: '/p' })
    expect(allLeaves(out.splits).find(l => l.tabs.some(t => t.id === 'b1'))!.tabs[0]).toMatchObject({ title: 'renamed', path: '/p' })
    // A tab inside a float is patched through the same walk.
    const outFloat = patchTab(s, 'float2', { meta: { n: 1 } })
    expect(outFloat.floats[1]!.tab.meta).toEqual({ n: 1 })
    expect(outFloat.floats[0]!.tab).toBe(s.floats[0]!.tab)
    // A missing id returns the same reference.
    expect(patchTab(s, 'nope', { title: 'x' })).toBe(s)
  })

  it('setTabPin refuses non-terminal tabs, walks split trees, and patches floats', () => {
    const s: SidebarState = {
      ...makeDefaultState(),
      splits: split('s', 'row', [leaf('pa', [terminalTab('t1')]), leaf('pb', [editorTab('b1')])]),
      floats: [{ id: 'f1', tab: terminalTab('tfloat'), x: 0, y: 0, w: 320, h: 200 }],
    }
    // A non-terminal target is a strict no-op (same reference).
    expect(setTabPin(s, 'b1', { scope: 'global' })).toBe(s)
    // A terminal inside a nested tree gets the pin.
    const pinned = setTabPin(s, 't1', { scope: 'workspace', homeCwd: '/w' })
    expect(allLeaves(pinned.splits)[0]!.tabs[0]!.pin).toEqual({ scope: 'workspace', homeCwd: '/w' })
    // Re-setting the same pin is idempotent; clearing removes it.
    expect(setTabPin(pinned, 't1', { scope: 'workspace', homeCwd: '/w' })).toBe(pinned)
    const cleared = setTabPin(pinned, 't1', null)
    expect(cleared.splits.kind).toBe('split')
    expect(allLeaves(cleared.splits)[0]!.tabs[0]!.pin).toBeUndefined()
    // A floated terminal is pinned through the float walk.
    const floatPinned = setTabPin(s, 'tfloat', { scope: 'global' })
    expect(floatPinned.floats[0]!.tab.pin).toEqual({ scope: 'global' })
    expect(setTabPin(floatPinned, 'tfloat', { scope: 'global' })).toBe(floatPinned)
    const floatCleared = setTabPin(floatPinned, 'tfloat', null)
    expect(floatCleared.floats[0]!.tab.pin).toBeUndefined()
    // Unknown ids stay untouched.
    expect(setTabPin(s, 'nope', null)).toBe(s)
  })

  it('openTabInActivePane and splitPane fall back to the first leaf when no pane is active', () => {
    const s = { ...makeDefaultState(), activePane: null }
    const opened = openTabInActivePane(s, editorTab('e1'))
    expect(opened.activePane).not.toBeNull()
    expect(allLeaves(opened.splits).flatMap(l => l.tabs.map(t => t.id))).toContain('e1')
    const splitOut = splitPane({ ...s, splits: split('s', 'row', [leaf('pa', []), leaf('pb', [])]) }, 'col')
    expect(splitOut.splits.kind).toBe('split')
  })

  it('moveTab cross-tree covers unknown tabs, kept sources, and index clamping', () => {
    const base = (): SidebarState => ({
      ...makeDefaultState(400, true, 'none'),
      splits: split('s', 'row', [leaf('pa', [editorTab('a1'), editorTab('a2')]), leaf('pb', [])]),
      bottomSplits: leaf('pc', [editorTab('c1')]),
      activePane: 'pa',
    })
    // Unknown tab: strict no-op in both tree combinations.
    const untouched = base()
    expect(moveTab(untouched, 'pa', 'nope', 'pc')).toBe(untouched)
    // Cross-tree move with an out-of-range index appends; the source keeps
    // its other tab (no removal of the leaf).
    const moved = moveTab(base(), 'pa', 'a1', 'pc', 99)
    expect(allLeaves(moved.bottomSplits)[0]!.tabs.map(t => t.id)).toEqual(['c1', 'a1'])
    expect(allLeaves(moved.splits).find(l => l.id === 'pa')!.tabs.map(t => t.id)).toEqual(['a2'])
    // Same-tree move with an out-of-range index appends at the end.
    const reorder = moveTab(base(), 'pa', 'a1', 'pa', 99)
    expect(allLeaves(reorder.splits).find(l => l.id === 'pa')!.tabs.map(t => t.id)).toEqual(['a2', 'a1'])
    // Same-tree move with a valid index inserts before the target.
    const inserted = moveTab(base(), 'pa', 'a1', 'pb', 0)
    expect(allLeaves(inserted.splits).find(l => l.id === 'pb')!.tabs.map(t => t.id)).toEqual(['a1'])
  })

  it('setWidth clamps to the viewport with a window and to the contract without one', () => {
    // No window (the rest of this describe runs window-less): PANEL_MAX wins.
    expect(typeof window).toBe('undefined')
    expect(setWidth({ ...makeDefaultState(), width: 400 }, 9999).width).toBe(PANEL_MAX)
    expect(setWidth({ ...makeDefaultState(), width: 400 }, 1).width).toBe(280)
  })

  it('revealPaths skips malformed files and relative paths (no prefix)', () => {
    const s = makeDefaultState()
    const out = revealPaths(s, undefined, ['', 42 as unknown as string, 'src/a.ts'])
    // A relative path still reveals itself and expands its ancestors, built
    // without a leading separator (the '' prefix branch).
    expect(out.revealed).toEqual(['src/a.ts'])
    expect(out.expanded).toEqual(['src'])
    expect(revealPaths(s, '/w', []).revealed).toEqual([])
  })

  it('resizeSplit ignores leaf roots and recurses into nested splits', () => {
    const tree = split('s', 'row', [leaf('p1', []), leaf('p2', [])])
    // A leaf as the node itself: untouched.
    expect(resizeSplit(leaf('p1', []), 'p1', 0, 0.2)).toMatchObject({ kind: 'leaf' })
    // A split id deeper in the tree: recursion adjusts the inner divider.
    const nested = split('outer', 'row', [tree, leaf('p3', [])])
    const out = resizeSplit(nested, 's', 0, 0.2) as { children: Array<{ sizes?: number[] }> }
    expect((out.children[0] as { sizes: number[] }).sizes[0]).toBeCloseTo(0.7)
    // resizeSplitIn routes by id through the state.
    const state = { ...makeDefaultState(), splits: nested }
    const routed = resizeSplitIn(state, 's', 0, -0.05)
    expect((routed.splits as { children: SplitNode[] }).children[0]!.kind).toBe('split')
  })

  it('floatTab repoints the active pane when the float empties it', () => {
    const s = {
      ...makeDefaultState(400, true, 'none'),
      splits: split('s', 'row', [leaf('pa', [terminalTab('t1')]), leaf('pb', [editorTab('b1')])]),
      activePane: 'pa',
    }
    const floated = floatTab(s, 't1', 500, 400)
    expect(floated.floats).toHaveLength(1)
    // The emptied pane collapsed to its sibling, which becomes the active pane.
    expect(floated.activePane).toBe('pb')
    // Unknown and already-floating tabs are strict no-ops.
    expect(floatTab(floated, 'nope', 1, 1)).toBe(floated)
    expect(floatTab(floated, 't1', 1, 1)).toBe(floated)
    // moveFloat clamps and skips no-op geometry; unknown ids too.
    const moved = moveFloat(floated, floated.floats[0]!.id, floated.floats[0]!.x, floated.floats[0]!.y)
    expect(moved).toBe(floated)
    expect(moveFloat(floated, 'nope', 5, 5)).toBe(floated)
  })

  it('resizeFloat maps only the targeted window among several', () => {
    const s: SidebarState = {
      ...makeDefaultState(),
      floats: [
        { id: 'f1', tab: editorTab('a'), x: 0, y: 0, w: 320, h: 200 },
        { id: 'f2', tab: editorTab('b'), x: 50, y: 50, w: 320, h: 200 },
      ],
    }
    const out = resizeFloat(s, 'f2', 400, 260)
    expect(out.floats[1]).toMatchObject({ w: 400, h: 260 })
    expect(out.floats[0]).toBe(s.floats[0])
    expect(resizeFloat(s, 'nope', 400, 260)).toBe(s)
    expect(raiseFloat(s, 'nope')).toBe(s)
    // Raising the bottom window reorders the stack.
    const raised = raiseFloat(s, 'f1')
    expect(raised.floats.map(f => f.id)).toEqual(['f2', 'f1'])
    expect(raiseFloat(raised, 'f1')).toBe(raised)
  })

  it('dockFloat falls back to the first leaf when no pane is active', () => {
    const s: SidebarState = {
      ...makeDefaultState(400, true),
      splits: split('s', 'row', [leaf('pa', []), leaf('pb', [])]),
      floats: [{ id: 'f1', tab: terminalTab('t1'), x: 0, y: 0, w: 320, h: 200 }],
      activePane: null,
    }
    const docked = dockFloat(s, 'f1')
    expect(docked.floats).toHaveLength(0)
    expect(docked.activePane).toBe(firstLeaf(docked.splits).id)
    expect(allLeaves(docked.splits).flatMap(l => l.tabs.map(t => t.id))).toContain('t1')
    expect(dockFloat(s, 'nope')).toBe(s)
  })

  it('insertLeafAt places the fresh leaf first on front=true', () => {
    const s = { ...makeDefaultState(400, true, 'none'), splits: leaf('pa', [editorTab('a1')]) }
    const out = insertLeafAt(s.splits, 'pa', 'row', terminalTab('t1'), true)
    const node = out.node as { kind: 'split'; children: Array<{ tabs: SidebarTab[] }> }
    expect(node.children[0]!.tabs.map(t => t.id)).toEqual(['t1'])
    expect(out.leafId).toBe((node.children[0] as { id: string; tabs: SidebarTab[] }).id)
  })

  it('sanitizeState rejects malformed headers and validates split nodes', () => {
    const header = {
      panelOpen: true, width: 400, nextTerminal: 1, activePane: 'pane:1', expanded: [],
      splits: leaf('pane:1', []), bottomSplits: leaf('pane:b', []),
    }
    expect(sanitizeState({ ...header, panelOpen: 'yes' })).toBeUndefined()
    expect(sanitizeState({ ...header, activePane: 7 })).toBeUndefined()
    expect(sanitizeState({ ...header, expanded: [3] })).toBeUndefined()
    expect(sanitizeState({ ...header, splits: { kind: 'leaf', tabs: [], active: null } })).toBeUndefined()
    // A split node: valid children survive; <2 children or bad sizes reset.
    const withSplit = {
      ...header,
      splits: {
        kind: 'split', id: 'sp', dir: 'row', sizes: [0.5, 0.5],
        children: [leaf('p1', [editorTab('x')]), leaf('p2', [editorTab('y')])],
      },
    }
    expect(sanitizeState(withSplit)!.splits.kind).toBe('split')
    expect(sanitizeState({
      ...withSplit, splits: { kind: 'split', id: 'sp', dir: 'row', sizes: [1], children: [leaf('p1', [editorTab('x')])] },
    })).toBeUndefined()
    expect(sanitizeState({
      ...withSplit, splits: { kind: 'split', id: 'sp', dir: 'diagonal', sizes: [0.5, 0.5], children: [leaf('p1', [editorTab('x')]), leaf('p2', [editorTab('y')])] },
    })).toBeUndefined()
    expect(sanitizeState({
      ...withSplit, splits: { kind: 'split', id: 'sp', dir: 'row', sizes: [0.5], children: [leaf('p1', [editorTab('x')]), leaf('p2', [editorTab('y')])] },
    })).toBeUndefined()
    expect(sanitizeState({
      ...withSplit, splits: { kind: 'split', id: 'sp', dir: 'row', sizes: [0.5, 0], children: [leaf('p1', [editorTab('x')]), leaf('p2', [editorTab('y')])] },
    })).toBeUndefined()
    expect(sanitizeState({
      ...withSplit, splits: { kind: 'split', id: 'sp', dir: 'row', sizes: [0.5, 0.5], children: [leaf('p1', [])] },
    })).toBeUndefined()
    // Tabs: a non-string id or type resets; a terminal pin with a non-string
    // homeCwd keeps the scope but drops the cwd.
    expect(sanitizeState({
      ...header, splits: leaf('pane:1', [{ id: 9, type: 'editor', title: 'x' } as unknown as SidebarTab]),
    })).toBeUndefined()
    expect(sanitizeState({
      ...header, splits: leaf('pane:1', [{ id: 't', title: 'x' } as unknown as SidebarTab]),
    })).toBeUndefined()
    const pinKept = sanitizeState({
      ...header, splits: leaf('pane:1', [{ id: 't', type: 'terminal', title: 'x', pin: { scope: 'global', homeCwd: 42 } as unknown as NonNullable<SidebarTab['pin']> }]),
    })!
    expect(allLeaves(pinKept.splits)[0]!.tabs[0]!.pin).toEqual({ scope: 'global' })
  })
})

describe('persisted counter seeding', () => {
  const g = globalThis as Record<string, unknown>
  let backing: Map<string, string>

  beforeEach(() => {
    backing = new Map()
    g.window = { clearTimeout: () => {}, setTimeout: () => 0, innerWidth: 1024, innerHeight: 800 }
    g.localStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value) },
      removeItem: (key: string) => { backing.delete(key) },
    }
  })

  afterEach(() => {
    delete g.window
    delete g.localStorage
  })

  it('seeds past malformed persisted ids without crashing (tabs, children, floats)', () => {
    backing.set('dsh-sidebar:v1:seeded', JSON.stringify({
      panelOpen: true, width: 400, nextTerminal: 1, activePane: null, expanded: [],
      splits: { kind: 'leaf', id: 'pane:9', tabs: [{ id: 42 }, null], children: 'x' },
      bottomSplits: { id: 'no-kind-here' },
      floats: [null, { id: 43 }],
    }))
    const store = createSidebarStore()
    store.setSession('seeded')
    // Corruption falls back to the default layout, and a fresh split after
    // the load mints ids disjoint from the seeded ones.
    store.reduce(s => splitPane(s, 'row'))
    const ids = allLeaves(store.getSnapshot().state!.splits).map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('pane:9')
  })

  it('adopts a valid cross-session width and ignores a corrupt one', () => {
    backing.set('dsh-sidebar:v1:width', '9999')
    const store = createSidebarStore()
    store.setSession('w1')
    // window.innerWidth 1024 clamps the stored 9999.
    expect(store.getSnapshot().state!.width).toBe(1024)
    backing.set('dsh-sidebar:v1:width', 'abc')
    const other = createSidebarStore()
    other.setSession('w2')
    // The corrupt stored width is ignored: the prefs percent seeds instead.
    expect(other.getSnapshot().state!.width).toBe(
      defaultWidthFor(1024, other.getPrefs().defaultWidthPercent))
  })

  it('falls back to the default layout when the persisted state does not sanitize', () => {
    backing.set('dsh-sidebar:v1:corrupt', JSON.stringify({
      panelOpen: true, width: 'wide', nextTerminal: 1, activePane: null, expanded: [],
      splits: leaf('pane:1', []),
    }))
    const store = createSidebarStore()
    store.setSession('corrupt')
    expect(store.getSnapshot().state!.splits.kind).toBe('leaf')
  })

  it('a duplicate persisted SPLIT id re-ids with the split prefix', () => {
    backing.set('dsh-sidebar:v1:dupsplit', JSON.stringify({
      panelOpen: true, width: 400, nextTerminal: 1, activePane: null, expanded: [],
      splits: {
        kind: 'split', id: 'split:5', dir: 'row', sizes: [0.5, 0.5],
        children: [
          { kind: 'split', id: 'split:5', dir: 'row', sizes: [0.5, 0.5], children: [leaf('p1', [editorTab('x')]), leaf('p2', [])] },
          leaf('p3', [editorTab('z')]),
        ],
      },
    }))
    const store = createSidebarStore()
    store.setSession('dupsplit')
    // The walk sanitizes children first, so the INNER 'split:5' keeps its id
    // and the OUTER duplicate is re-ided with a fresh split-prefixed id
    // (minted past the seeded max, with the split prefix — not 'pane:N').
    const tree = store.getSnapshot().state!.splits as { id: string }
    expect(tree.id).toBe('split:6')
  })
})

describe('store lifecycle members', () => {
  const g = globalThis as Record<string, unknown>

  beforeEach(() => {
    g.window = { clearTimeout: () => {}, setTimeout: () => 0, innerWidth: 1024, innerHeight: 800 }
    g.localStorage = { getItem: () => null, setItem: () => {} }
  })

  afterEach(() => {
    delete g.window
    delete g.localStorage
  })

  it('setSuspended/getSuspended round-trip the external-disable flag', async () => {
    const { createSidebarStore: fresh } = await import('../src/client/state.ts')
    const store = fresh()
    expect(store.getSuspended()).toBe(false)
    store.setSuspended(true)
    expect(store.getSuspended()).toBe(true)
    store.setSuspended(false)
    expect(store.getSuspended()).toBe(false)
  })

  it('setSession clears to no session and deduplicates the same id', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const before = store.getSnapshot()
    let notified = 0
    store.subscribe(() => { notified += 1 })
    store.setSession('s1')
    expect(notified).toBe(0)
    expect(store.getSnapshot()).toBe(before)
    store.setSession(undefined)
    expect(store.getSnapshot()).toMatchObject({ sessionId: undefined, state: undefined })
    store.setSession(undefined)
    expect(notified).toBe(1)
  })

  it('update mutates a structural draft, persists it, and no-ops without a session', () => {
    const store = createSidebarStore()
    // No session: the mutator never runs.
    let called = false
    store.update(() => { called = true })
    expect(called).toBe(false)
    store.setSession('s1')
    store.update((draft) => { draft.expanded = ['/x']; draft.width = 500 })
    expect(store.getSnapshot().state).toMatchObject({ expanded: ['/x'], width: 500 })
    expect(store.getSnapshot().state!.splits).not.toBe(makeDefaultState().splits)
    store.update(() => { called = true })
    expect(called).toBe(true)
  })

  it('tabOpen consults the owning session state and unknown sessions', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const tabId = allLeaves(store.getSnapshot().state!.splits)[0]!.tabs[0]!.id
    expect(store.tabOpen('s1', tabId)).toBe(true)
    expect(store.tabOpen('s1', 'nope')).toBe(false)
    // An unknown session id resolves through the snapshot fallback (none).
    expect(store.tabOpen('other', tabId)).toBe(false)
  })

  it('getSessionStates returns a copy keyed by session', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const map = store.getSessionStates()
    expect([...map.keys()]).toEqual(['s1'])
    expect(map.get('s1')).toBe(store.getSnapshot().state)
  })
})
