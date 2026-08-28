/**
 * Second coverage round for the BetterSidebar service: the openTab guard
 * tails (no active session, refusing createTab, patch-less minting), the
 * landing-panel decisions (bottom open, no active pane), and the string
 * helpers behind openFile/matchFileViewer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBetterSidebarService, type TabDescriptor } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, defaultWidthFor, firstLeaf } from '../src/client/state.ts'

const g = globalThis as Record<string, unknown>

beforeEach(() => {
  g.window = { clearTimeout: () => {}, setTimeout: () => 0, innerWidth: 1024, innerHeight: 800 }
  g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
})

afterEach(() => {
  delete g.window
  delete g.localStorage
  vi.restoreAllMocks()
})

/** Store with a clean empty pane (the editor seed type is disabled). */
const bareStore = (): ReturnType<typeof createSidebarStore> => {
  const store = createSidebarStore()
  store.setPrefs({ ...store.getPrefs(), tabsEnabled: { editor: false } })
  return store
}

const tabDescriptor = (overrides: Partial<TabDescriptor>): TabDescriptor => ({
  id: 'probe',
  title: 'Probe',
  component: () => null,
  ...overrides,
})

describe('openTab guards', () => {
  it('refuses an open while no session is active', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({}))
    service.openTab({ type: 'probe', title: 'X' })
    expect(store.getSnapshot().state).toBeUndefined()
  })

  it('a refusing createTab (null) lands nothing and fires no lifecycle', () => {
    const store = bareStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    const onOpen = vi.fn()
    service.registerTab(tabDescriptor({ createTab: () => null, onOpen }))
    service.openTab({ type: 'probe' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(allLeaves(store.getSnapshot().state!.splits)[0]!.tabs).toHaveLength(0)
  })

  it('a createTab without a patch lands the minted tab as-is', () => {
    const store = bareStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({
      createTab: () => ({ tab: { id: 'minted', type: 'probe', title: 'Minted' } }),
    }))
    service.openTab({ type: 'probe', title: 'Ignored' })
    const landed = allLeaves(store.getSnapshot().state!.splits)[0]!.tabs
    expect(landed).toHaveLength(1)
    expect(landed[0]).toMatchObject({ id: 'minted', title: 'Minted' })
  })

  it('the descriptor title string is the default when no seed title is given', () => {
    const store = bareStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({ title: 'Plain String' }))
    service.openTab({ type: 'probe' })
    const landed = allLeaves(store.getSnapshot().state!.splits)[0]!.tabs[0]!
    expect(landed.title).toBe('Plain String')
  })

  it('a wide-viewport content open into an ALREADY-open bottom panel keeps it untouched', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({}))
    // Active pane lives in the bottom tree, bottom already open.
    store.reduce(s => ({
      ...s,
      bottomOpen: true,
      activePane: firstLeaf(s.bottomSplits).id,
      panelOpen: false,
    }))
    service.openTab({ type: 'probe', title: 'X', path: '/tmp/f.txt' })
    const state = store.getSnapshot().state!
    expect(state.bottomOpen).toBe(true)
    expect(state.panelOpen).toBe(false)
  })

  it('a content open with a stale (null) active pane routes through the right tree', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({}))
    store.reduce(s => ({ ...s, panelOpen: false, activePane: null }))
    service.openTab({ type: 'probe', title: 'X', path: '/tmp/f.txt' })
    const state = store.getSnapshot().state!
    // The open landed in the right tree's first pane and expanded it.
    expect(state.panelOpen).toBe(true)
    expect(allLeaves(state.splits).flatMap(l => l.tabs.map(t => t.id))).toContain('probe')
  })

  it('a plain open (no scope) notifies and lands in the active session', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({}))
    let notified = 0
    store.subscribe(() => { notified += 1 })
    service.openTab({ type: 'probe' })
    expect(notified).toBe(1)
    expect(allLeaves(store.getSnapshot().state!.splits).flatMap(l => l.tabs.map(t => t.id))).toContain('probe')
  })
})

describe('narrow-viewport openTab decision tails', () => {
  beforeEach(() => {
    g.window = { clearTimeout: () => {}, setTimeout: () => 0, innerWidth: 390, innerHeight: 800 }
    g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  })

  it('keeps an open drawer open for a content open (no toggle churn)', () => {
    const store = bareStore()
    store.setSession('n1')
    const service = createBetterSidebarService(store)
    service.registerTab(tabDescriptor({}))
    // A narrow viewport seeds collapsed; open the drawer explicitly.
    store.reduce(s => ({ ...s, panelOpen: true }))
    service.openTab({ type: 'probe', title: 'X', path: '/tmp/f.txt' })
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
  })

  it('new-session default width follows the prefs percent of the narrow viewport', () => {
    const store = createSidebarStore()
    store.setSession('n2')
    expect(store.getSnapshot().state!.width).toBe(
      defaultWidthFor(390, store.getPrefs().defaultWidthPercent))
  })
})

describe('string helpers behind the service', () => {
  it('openFile titles from the basename with both separators', () => {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    // openFile dispatches through the editor descriptor.
    service.registerTab(tabDescriptor({ id: 'editor', title: 'Editor' }))
    service.openFile({ sessionId: 's1' }, '/work/notes/todo.md')
    service.openFile({ sessionId: 's1' }, 'C:\\work\\other.md')
    // Scan both trees: which workbench hosts the default leaf follows the
    // viewport width the (globally stubbed) window reports at seed time.
    const state = store.getSnapshot().state!
    const titles = allLeaves(state.splits).concat(allLeaves(state.bottomSplits))
      .flatMap(leaf => leaf.tabs)
      .map(t => t.title).filter(title => title !== 'Files')
    expect(titles).toEqual(['todo.md', 'other.md'])
  })

  it('matchFileViewer yields undefined for extension-less paths without a catch-all', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    service.registerFileViewer({
      id: 'text', exts: ['txt'], fetchStrategy: 'fsRead', component: () => null,
    })
    expect(service.matchFileViewer('no-extension')).toBeUndefined()
    expect(service.matchFileViewer('a.b/c')).toBeUndefined()
  })
})
