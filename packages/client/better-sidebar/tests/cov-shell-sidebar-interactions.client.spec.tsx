/**
 * Sidebar shell interaction round: the bound workbench actions (close with
 * pty release, activate, move/merge, split resize, float, pin), the pinned
 * VIRTUAL tab surface (activate, close, unpin, agent releases), tab badges
 * and icons, the + menu built from the registry, the three panel drag
 * strips with their commit/abort tails, the composer @-reference, the
 * topology jump-back, and the float-hint drop-zone tails.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { createSidebarStore, floatTab, openTabInActivePane, setTabPin, type SidebarStore, type SidebarTab } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService, type TabComponentProps, type TabDescriptor } from '../src/client/service.ts'
import { t } from '../src/client/locales.ts'
import type { Context, SidebarSessionList, SidebarSessionSummary } from '../src/context-types.ts'

class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

}

const CONV_RECT = { left: 100, right: 700, top: 50, bottom: 600, width: 600, height: 550 }

let sessionSeq = 0
let fetchCalls: Array<{ url: string; body: unknown }> = []

function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: { body?: string }) => {
    fetchCalls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(init.body) })
    return new Response(JSON.stringify({ ok: true, value: { cwd: '/tmp', root: '/', parent: null } }), { headers: { 'content-type': 'application/json' } })
  }))
}

interface Harness {
  container: HTMLElement
  store: SidebarStore
  service: BetterSidebarService
  drafts: string[]
  pushList: (current?: string, extraById?: Record<string, SidebarSessionSummary>) => void
  unmount: () => void
}

function terminalProbe(id: string, extra: Partial<TabDescriptor> = {}): TabDescriptor {
  return {
    id,
    title: id,
    component: ({ tab, scope }: TabComponentProps) => createElement(
      'div', { 'data-probe': id }, `${tab.id}@${scope.sessionId}:${scope.cwd ?? '-'}`,
    ),
    ...extra,
  }
}

function mountShell(opts: { cwd?: string | undefined; withConversation?: boolean } = {}): Harness {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
  }
  vi.stubGlobal('WebSocket', FakeWebSocket)
  stubFetch()
  fetchCalls = []

  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab(terminalProbe('terminal'))
  service.registerTab(terminalProbe('notes', { single: true }))
  service.registerTab(terminalProbe('subagent', { single: true }))
  service.registerTab(terminalProbe('diff', { hidden: true }))
  store.setPrefs({ ...store.getPrefs(), openByDefault: true, titleBarScheme: 'web', defaultWidthPercent: 25 })

  const sessionId = `v-${++sessionSeq}`
  let listSnapshot: SidebarSessionList = {
    current: sessionId,
    byId: { [sessionId]: { id: sessionId, displayTitle: 'V', ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }) } },
  }
  const listeners = new Set<() => void>()
  const drafts: string[] = []
  let currentDraft = ''
  const conversation = {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft: currentDraft }) },
        setDraft: (text: string) => { currentDraft = text; drafts.push(text) },
      }),
    },
  }
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => ({ active: 'en' }) },
    sessions: {
      scope: () => ctx,
      list: {
        getSnapshot: () => listSnapshot,
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      },
    },
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : name === 'conversation' && opts.withConversation !== false ? conversation : undefined,
  } as unknown as Context
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx, store })) })
  return {
    container,
    store,
    service,
    drafts,
    pushList: (current, extraById = {}) => {
      act(() => {
        listSnapshot = {
          current: current ?? sessionId,
          byId: {
            [sessionId]: { id: sessionId, displayTitle: 'V', ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }) },
            ...extraById,
          },
        }
        for (const fn of [...listeners]) fn()
      })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

const flushFrame = async (): Promise<void> => {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() =>{  resolve() })) })
}

function tabEls(h: Harness): HTMLElement[] {
  return [...h.container.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
}
function tabByTitle(h: Harness, title: string): HTMLElement {
  return tabEls(h).find(el => el.title === title)!
}
function contextMenuOn(el: HTMLElement): void {
  act(() => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 })) })
}
function menuRow(text: string): HTMLElement {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .find(row => (row.textContent ?? '').includes(text))!
}
function dragAt(type: string, x: number, y: number, raw = ''): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'dataTransfer', { value: { getData: (t: string) => t === 'application/x-dsh-tab' ? raw : '', types: [] } })
  return event
}
function pointerAt(type: string, x: number, y: number, button = 0): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

beforeEach(() => {
  // jsdom lacks pointer capture; the panel strips call it directly.
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = () => {}
  proto.releasePointerCapture = () => {}
  proto.hasPointerCapture = () => true
  // Debounced persists must never fire mid-test: a late global-width write
  // would leak one mount's committed width into the next mount's seed.
  vi.stubGlobal('setTimeout', (() => 0))
  vi.stubGlobal('clearTimeout', () => {})
})

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  document.body.removeAttribute('data-dsh-sidebar-collapsed')
  document.body.removeAttribute('data-dsh-sidebar-dragging')
  document.body.removeAttribute('data-dsh-tab-dragging')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('workbench actions', () => {
  it('closing a terminal tab releases its pty through the HTTP fallback', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.service.registerTab({
          id: 'sh', title: 'Sh',
          createTab: state => ({ tab: { id: `term-${state.nextTerminal}`, type: 'terminal', title: 'T' }, patch: { nextTerminal: state.nextTerminal + 1 } }),
          component: () => null,
        })
        h.service.openTab({ type: 'sh', title: 'T' })
      })
      const closeBtn = tabByTitle(h, 'T').querySelector<HTMLElement>('[class*="tabClose"]')!
      act(() => { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(fetchCalls.some(call => call.url.includes('/sidebar/api/pty.close') && (call.body as { tab?: string }).tab === 'term-1')).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('closing an AGENT terminal releases it through the agent route', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'agent:u-9', type: 'terminal', title: 'Agent sh' })) })
      const closeBtn = tabByTitle(h, 'Agent sh').querySelector<HTMLElement>('[class*="tabClose"]')!
      act(() => { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(fetchCalls.some(call => call.url.includes('/sidebar/api/agent-pty.close') && (call.body as { uuid?: string }).uuid === 'u-9')).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('clicking a tab activates it through the service', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      const seeded = (h.store.getSnapshot().state!.splits as { tabs: SidebarTab[] }).tabs[0]!
      act(() => { tabByTitle(h, seeded.title).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const state = h.store.getSnapshot().state!
      const leaf = state.splits as { active: string | null }
      expect(leaf.active).toBe(seeded.id)
    } finally {
      h.unmount()
    }
  })

  it('dropping a tab on the strip background merges it into that pane', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.store.reduce(s => openTabInActivePane(s, { id: 'x1', type: 'notes', title: 'X1' }))
        h.store.reduce(s => openTabInActivePane(s, { id: 'x2', type: 'notes', title: 'X2' }))
      })
      const raw = JSON.stringify({ tabId: 'x1', paneId: 'pane:1' })
      const strip = h.container.querySelector<HTMLElement>('[class*="tabBar"]')!
      act(() => { strip.dispatchEvent(dragAt('drop', 5, 5, raw)) })
      // x1 moved to the END of its pane (center merge reorder).
      const tabs = (h.store.getSnapshot().state!.splits as { tabs: Array<{ id: string }> }).tabs.map(tab => tab.id)
      expect(tabs.at(-1)).toBe('x1')
    } finally {
      h.unmount()
    }
  })

  it('the tab context menu floats at the viewport center when no column is measured', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      contextMenuOn(tabByTitle(h, 'N'))
      act(() => { menuRow(t('moveToFreeWindow')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const state = h.store.getSnapshot().state!
      expect(state.floats).toHaveLength(1)
      expect(state.floats[0]).toMatchObject({ x: 640 - 195, w: 390 })
    } finally {
      h.unmount()
    }
  })

  it('pinning a terminal snapshots the session cwd; unpin clears it', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'term-x', type: 'terminal', title: 'Long run' })) })
      contextMenuOn(tabByTitle(h, 'Long run'))
      act(() => { menuRow(t('pinTerminal')).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
      act(() => { menuRow(t('pinToWorkspace')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const state = h.store.getSnapshot().state!
      const pinned = (state.splits as { tabs: SidebarTab[] }).tabs.find(tab => tab.id === 'term-x')!
      expect(pinned.pin).toEqual({ scope: 'workspace', homeCwd: '/tmp' })
      contextMenuOn(tabByTitle(h, 'Long run'))
      act(() => { menuRow(t('unpinTerminal')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const cleared = (h.store.getSnapshot().state!.splits as { tabs: SidebarTab[] }).tabs.find(tab => tab.id === 'term-x')!
      expect(cleared.pin).toBeUndefined()
    } finally {
      h.unmount()
    }
  })
})

describe('pinned virtual tabs', () => {
  function seedHome(h: Harness, homeId: string, opts: { float?: boolean; agent?: boolean; cwd?: string | undefined } = {}): void {
    act(() => {
      const tabId = opts.agent === true ? 'agent:u-1' : 'term-home'
      const tab: SidebarTab = { id: tabId, type: 'terminal', title: 'Home term' }
      h.store.reduceFor(homeId, (s) => {
        let next = openTabInActivePane(s, tab)
        next = setTabPin(next, tabId, { scope: 'global', ...(opts.cwd !== undefined ? { homeCwd: opts.cwd } : {}) })
        if (opts.float === true) next = floatTab(next, tabId, 500, 300)
        return next
      })
    })
    // reduceFor does not notify; a store change recomputes the pinned rail.
    act(() => { h.store.reduce(cur => ({ ...cur, revealed: cur.revealed.slice() })) })
  }

  it('a pinned terminal from another session renders as a virtual tab and activates in place', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-1', { cwd: '/tmp' })
      const virtual = tabByTitle(h, 'Home term')
      expect(virtual).toBeDefined()
      act(() => { virtual.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      // The descriptor component sees the ORIGINAL tab id and the HOME scope,
      // and the virtual tab's cell is the VISIBLE one in its pane.
      const virtualCell = [...h.container.querySelectorAll('[data-probe="terminal"]')]
        .find(el => el.textContent.includes('term-home@home-1:/tmp'))!
        .closest('[class*="paneTab"]') as HTMLElement
      expect(virtualCell.className).not.toContain('paneTabHidden')
      // A regular click clears the pinned activation again.
      const seeded = (h.store.getSnapshot().state!.splits as { tabs: SidebarTab[] }).tabs[0]!
      act(() => { tabByTitle(h, seeded.title).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const deactivatedCell = [...h.container.querySelectorAll('[data-probe="terminal"]')]
        .find(el => el.textContent.includes('term-home@home-1:/tmp'))!
        .closest('[class*="paneTab"]') as HTMLElement
      expect(deactivatedCell.className).toContain('paneTabHidden')
    } finally {
      h.unmount()
    }
  })

  it('closing the virtual tab closes it in the HOME session through its scope', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-1', { cwd: '/tmp' })
      const virtual = tabByTitle(h, 'Home term')
      // Activate, then close: the active pointer resets with the close.
      act(() => { virtual.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const closeBtn = virtual.querySelector<HTMLElement>('[class*="tabClose"]')!
      act(() => { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(fetchCalls.some(call => call.url.includes('pty.close') && (call.body as { sessionId?: string }).sessionId === 'home-1' && (call.body as { tab?: string }).tab === 'term-home')).toBe(true)
      // The home session lost the tab; the virtual tab left the strip.
      const homeState = h.store.getSessionStates().get('home-1')!
      expect(JSON.stringify(homeState)).not.toContain('term-home')
      expect(tabByTitle(h, 'Home term')).toBeUndefined()
    } finally {
      h.unmount()
    }
  })

  it('a floated pinned tab closes with its window; agent tabs release by uuid', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-f', { float: true, cwd: '/tmp' })
      expect(tabByTitle(h, 'Home term')).toBeDefined()
      act(() => { tabByTitle(h, 'Home term').querySelector<HTMLElement>('[class*="tabClose"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const homeState = h.store.getSessionStates().get('home-f')!
      expect(homeState.floats).toHaveLength(0)

      seedHome(h, 'home-a', { agent: true })
      const agentVirtual = tabByTitle(h, 'Home term')
      act(() => { agentVirtual.querySelector<HTMLElement>('[class*="tabClose"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(fetchCalls.some(call => call.url.includes('agent-pty.close') && (call.body as { uuid?: string }).uuid === 'u-1')).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('unpinning the virtual tab clears the pin marker in the home session', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-2', { cwd: '/tmp' })
      contextMenuOn(tabByTitle(h, 'Home term'))
      expect(menuRow(t('pinTerminal'))).toBeUndefined()
      act(() => { menuRow(t('unpinTerminal')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const homeState = h.store.getSessionStates().get('home-2')!
      const homeTab = JSON.parse(JSON.stringify(homeState)) as { splits: { tabs: Array<{ id: string; pin?: unknown }> } }
      expect(homeTab.splits.tabs.find(tab => tab.id === 'term-home')!.pin).toBeUndefined()
      // The tab STAYS open at home (unpin is not a close).
      expect(homeTab.splits.tabs.some(tab => tab.id === 'term-home')).toBe(true)
    } finally {
      h.unmount()
    }
  })
})

describe('badges, icons and the + menu', () => {
  function badgeHarness(badge: NonNullable<TabDescriptor['badge']>): Harness {
    const h = mountShell({ cwd: '/tmp' })
    act(() => {
      h.service.registerTab({
        id: 'badged', title: 'Badged', icon: size => createElement('i', { 'data-size': size }, 'ico'), badge,
        component: () => null,
      })
      h.store.reduce(s => openTabInActivePane(s, { id: 'badged-1', type: 'badged', title: 'Badged' }))
    })
    return h
  }

  it('counts render as pills with the 99+ cap; text renders as-is; none renders nothing', () => {
    const h = badgeHarness(() => 150)
    try {
      expect(tabByTitle(h, 'Badged').querySelector('[class*="tabBadge"]')!.textContent).toBe('99+')
      h.unmount()
      const h2 = badgeHarness(() => 5)
      expect(tabByTitle(h2, 'Badged').querySelector('[class*="tabBadge"]')!.textContent).toBe('5')
      h2.unmount()
      const h3 = badgeHarness(() => 'hot')
      expect(tabByTitle(h3, 'Badged').querySelector('[class*="tabBadge"]')!.textContent).toBe('hot')
      h3.unmount()
      const h4 = badgeHarness(() => null)
      expect(tabByTitle(h4, 'Badged').querySelector('[class*="tabBadge"]')).toBeNull()
      h4.unmount()
      const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
      const h5 = badgeHarness(() => { throw new Error('badge boom') })
      try {
        expect(tabByTitle(h5, 'Badged').querySelector('[class*="tabBadge"]')).toBeNull()
        expect(warn.mock.calls.some(call => String(call[0]).includes('tab badge error'))).toBe(true)
      } finally {
        warn.mockRestore()
      }
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })

  it('the function icon resolver sizes the glyph into the strip', () => {
    const h = badgeHarness(() => null)
    try {
      expect(tabByTitle(h, 'Badged').querySelector('i[data-size="14"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('the + menu lists registry tabs sorted by order with disabled states', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.service.registerTab({ id: 'z-late', title: () => 'Late', order: 200, component: () => null })
        h.service.registerTab({ id: 'a-early', title: 'Early', order: 1, component: () => null })
        h.service.registerTab({ id: 'locked', title: 'Locked', available: () => false, component: () => null })
      })
      const plus = h.container.querySelector<HTMLElement>('[class*="tabBarPlus"]')!
      act(() => { plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const labels = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(row => row.textContent)
      expect(labels.indexOf('Early')).toBeLessThan(labels.indexOf('Late'))
      const locked = menuRow('Locked') as HTMLButtonElement
      expect(locked.disabled).toBe(true)
      // Selecting an option opens the tab in the current session.
      act(() => { menuRow('Early').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect((h.store.getSnapshot().state!.splits as { tabs: Array<{ id: string }> }).tabs.map(tab => tab.id)).toContain('a-early')
    } finally {
      h.unmount()
    }
  })
})

describe('tab callbacks', () => {
  it('onToggleDir expands, onOpenDiff splits, onReferenceFile appends the @-mention', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const hooks: TabComponentProps['onToggleDir'][] = []
      const diffHook: TabComponentProps['onOpenDiff'][] = []
      const refHook: TabComponentProps['onReferenceFile'][] = []
      act(() => {
        h.service.registerTab({
          id: 'hooks', title: 'Hooks',
          component: (props) => {
            hooks.push(props.onToggleDir)
            diffHook.push(props.onOpenDiff)
            refHook.push(props.onReferenceFile)
            return null
          },
        })
      })
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'hooks-1', type: 'hooks', title: 'Hooks' })) })
      act(() => { hooks.at(-1)!('/tmp/src') })
      expect(h.store.getSnapshot().state!.expanded).toEqual(['/tmp/src'])
      act(() => { diffHook.at(-1)!({ id: 'diff:w:a.ts', type: 'diff', title: 'a.ts', diff: { kind: 'worktree', path: 'a.ts', staged: false } }) })
      expect(h.store.getSnapshot().state!.splits.kind).toBe('split')
      act(() => { refHook.at(-1)!('/tmp/readme.md') })
      expect(h.drafts).toEqual(['@readme.md'])
      // An existing draft gets a space-separated append.
      h.drafts.length = 0
      act(() => {
        h.service.registerTab({
          id: 'hooks2', title: 'Hooks2',
          component: (props) => { refHook.push(props.onReferenceFile); return null },
        })
      })
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'hooks-2', type: 'hooks2', title: 'Hooks2' })) })
      act(() => { refHook.at(-1)!('/tmp/other.md') })
      expect(h.drafts).toEqual(['@readme.md @other.md'])
    } finally {
      h.unmount()
    }
  })

  it('a topology jump re-opens the Subagent page over the child layout', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      let jump: TabComponentProps['onSubagentJump'] | undefined
      act(() => {
        h.service.registerTab({
          id: 'jumper', title: 'Jumper',
          component: (props) => { jump = props.onSubagentJump; return null },
        })
      })
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'jumper-1', type: 'jumper', title: 'J' })) })
      act(() => { jump!('child-9') })
      // Nothing yet: the jump fires when the shell arrives at the child.
      expect(h.container.querySelector('[data-probe="subagent"]')).toBeNull()
      h.pushList('child-9', { 'child-9': { id: 'child-9', displayTitle: 'Child' } })
      // The child's layout now hosts the open Subagent page.
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      expect(h.container.querySelector('[data-probe="subagent"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('panel drag strips', () => {
  it('a width drag writes DOM-first and commits the up position to the store', async () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 1000, 200))
        strip.dispatchEvent(pointerAt('pointermove', 900, 200))
      })
      expect(document.body.hasAttribute('data-dsh-sidebar-dragging')).toBe(true)
      await flushFrame()
      expect(h.container.querySelector<HTMLElement>('[data-dsh-panel]')!.style.width).toBe('420px')
      expect(h.store.getSnapshot().state!.width).toBe(320)
      act(() => { strip.dispatchEvent(pointerAt('pointerup', 880, 200)) })
      expect(h.store.getSnapshot().state!.width).toBe(440)
      expect(document.body.hasAttribute('data-dsh-sidebar-dragging')).toBe(false)
    } finally {
      h.unmount()
    }
  })

  it('a capture loss mid-move ignores moves until re-capture', async () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      ;(strip as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 1000, 200))
        strip.dispatchEvent(pointerAt('pointermove', 900, 200))
      })
      await flushFrame()
      expect(h.container.querySelector<HTMLElement>('[data-dsh-panel]')!.style.width).toBe('320px')
    } finally {
      h.unmount()
    }
  })

  it('pointercancel commits the pending drag; a coordinate-less cancel adopts the DOM size', async () => {
    // A pending rAF drag frame: the cancel commits the PENDING value.
    const h = mountShell({ cwd: '/tmp' })
    try {
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 1000, 200))
        strip.dispatchEvent(pointerAt('pointermove', 900, 200))
        strip.dispatchEvent(pointerAt('pointercancel', 940, 200))
      })
      expect(h.store.getSnapshot().state!.width).toBe(420)
    } finally {
      h.unmount()
    }
    // The commit above seeded the cross-session width; isolate the next mount.
    localStorage.clear()
    // No move ever landed: the cancel's own coordinates drive the commit.
    // Separate acts — the abort branch reads the draggingWidth STATE.
    const hCoord = mountShell({ cwd: '/tmp' })
    try {
      const coordStrip = hCoord.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => { coordStrip.dispatchEvent(pointerAt('pointerdown', 1000, 200)) })
      act(() => { coordStrip.dispatchEvent(pointerAt('pointercancel', 950, 200)) })
      expect(hCoord.store.getSnapshot().state!.width).toBe(370)
    } finally {
      hCoord.unmount()
    }
    localStorage.clear()
    // Neither pending nor usable coordinates (lostpointercapture): the last
    // applied size — here the pre-drag one — is adopted, never rolled back.
    const hLost = mountShell({ cwd: '/tmp' })
    try {
      const lostStrip = hLost.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => { lostStrip.dispatchEvent(pointerAt('pointerdown', 1000, 200)) })
      act(() => { lostStrip.dispatchEvent(pointerAt('lostpointercapture', 1000, 200)) })
      expect(hLost.store.getSnapshot().state!.width).toBe(320)
    } finally {
      hLost.unmount()
    }
  })

  it('the bottom strip and the shared corner commit both geometries', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click()
      })
      const bottomStrip = h.container.querySelector<HTMLElement>('[class*="bottomResize"]')!
      act(() => {
        bottomStrip.dispatchEvent(pointerAt('pointerdown', 500, 300))
        bottomStrip.dispatchEvent(pointerAt('pointermove', 500, 260))
        bottomStrip.dispatchEvent(pointerAt('pointerup', 500, 250))
      })
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(270)
      // The corner renders while BOTH panels are open and drags both at once.
      const corner = h.container.querySelector<HTMLElement>('[class*="cornerHandle"]')!
      act(() => {
        corner.dispatchEvent(pointerAt('pointerdown', 1000, 400))
        corner.dispatchEvent(pointerAt('pointermove', 950, 430))
        corner.dispatchEvent(pointerAt('pointerup', 940, 440))
      })
      const state = h.store.getSnapshot().state!
      expect(state.width).toBe(380)
      expect(state.bottomHeight).toBe(230)
      // The bottom panel's own close button collapses it.
      act(() => { h.container.querySelector<HTMLElement>('[class*="bottomClose"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(h.store.getSnapshot().state!.bottomOpen).toBe(false)
    } finally {
      h.unmount()
    }
  })
})

describe('float hint tails', () => {
  function conversationColumn(): void {
    const rootEl = document.createElement('div')
    rootEl.id = 'root'
    const col = document.createElement('div')
    const conv = document.createElement('div')
    conv.setAttribute('data-slot', 'conversation')
    col.append(conv)
    rootEl.append(col)
    document.body.prepend(rootEl)
    col.getBoundingClientRect = () => CONV_RECT as DOMRect
  }

  it('drags outside our tab drags and inside the host never arm the hint', () => {
    const h = mountShell({ cwd: '/tmp' })
    conversationColumn()
    try {
      // Not a tab drag: ignored outright.
      act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).toBeNull()
      // A tab drag over the host's own surfaces: left to the panes.
      document.body.setAttribute('data-dsh-tab-dragging', '')
      act(() => { h.container.querySelector<HTMLElement>('button')!.dispatchEvent(dragAt('dragover', 400, 300)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).toBeNull()
      document.body.removeAttribute('data-dsh-tab-dragging')
    } finally {
      h.unmount()
    }
  })

  it('leaving the column clears the hint; drops without a payload land nothing', () => {
    // The column must exist BEFORE the mount so the locate chain adopts it.
    conversationColumn()
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      document.body.setAttribute('data-dsh-tab-dragging', '')
      // Over the column: the hint arms.
      act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).not.toBeNull()
      // The same rect again keeps the identity (no re-render churn).
      act(() => { document.dispatchEvent(dragAt('dragover', 450, 320)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).not.toBeNull()
      // Off the column: the hint clears.
      act(() => { document.dispatchEvent(dragAt('dragover', 40, 20)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).toBeNull()
      // Re-arm, then drop with an unparsable payload: no float, hint gone.
      act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
      act(() => { document.dispatchEvent(dragAt('drop', 400, 300, 'broken')) })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(0)
      // Re-arm, then drop OUTSIDE the column: left to other handlers.
      act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
      act(() => {
        document.dispatchEvent(dragAt('drop', 40, 20, JSON.stringify({ tabId: 'notes', paneId: 'pane:1' })))
      })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(0)
      // Re-arm, then a window blur clears the armed hint.
      act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
      act(() => { window.dispatchEvent(new Event('blur')) })
      act(() => {
        document.dispatchEvent(dragAt('drop', 400, 300, JSON.stringify({ tabId: 'notes', paneId: 'pane:1' })))
      })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(0)
      document.body.removeAttribute('data-dsh-tab-dragging')
    } finally {
      h.unmount()
    }
  })
})
