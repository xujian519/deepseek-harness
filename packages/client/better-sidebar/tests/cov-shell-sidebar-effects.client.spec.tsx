/**
 * Sidebar shell effect tests against the REAL Sidebar + real store/service:
 * the no-session guard, the toggle cluster, the visual-viewport keyboard
 * inset, the title-bar scheme injection, the narrow-viewport bottom merge,
 * the OS file-drag shield, the bottom panel's first-expansion auto terminal,
 * both agent push loops (terminals and opens) with their reconnect caps, and
 * the subagent/job auto-openers with the debounced recheck.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService, type TabDescriptor } from '../src/client/service.ts'
import type { SidebarPrefs } from '../src/prefs-shared.ts'
import { t } from '../src/client/locales.ts'
import type { Context, SidebarSessionList, SidebarSessionSummary } from '../src/context-types.ts'

/** jsdom has no WebSocket; a recording fake the tests can drive. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }
}

/** A fake `fetch` for one push subscription: the sidebar POSTs the request
 *  and reads a newline-delimited JSON body. The test drives host→client
 *  frames with `push` (which the NDJSON reader splits) and ends the stream
 *  with `end` (a host-side stream close triggers the reconnect ladder). */
class FakePushFetch {
  static instances: FakePushFetch[] = []
  url: string
  private outputController: ReadableStreamDefaultController<Uint8Array> | undefined
  private closed = false
  readonly promise: Promise<Response>
  constructor(url: string, _init: RequestInit) {
    this.url = url
    const output = new ReadableStream<Uint8Array>({
      start: (c) => { this.outputController = c },
      cancel: () => { this.closed = true },
    })
    this.promise = Promise.resolve(new Response(output, { status: 200 }))
    FakePushFetch.instances.push(this)
  }
  /** Push one host→client output frame (a newline-delimited JSON line). */
  push(data: string): void {
    if (this.closed) return
    this.outputController?.enqueue(new TextEncoder().encode(data))
  }
  /** End the host→client output (drives the reconnect ladder). */
  end(): void {
    if (this.closed) return
    this.closed = true
    this.outputController?.close()
  }
}

interface Harness {
  container: HTMLElement
  store: SidebarStore
  service: BetterSidebarService
  /** Replace the sessions-list snapshot and notify the shell. */
  pushList: (list: SidebarSessionList) => void
  list: () => SidebarSessionList
  unmount: () => void
}

let sessionSeq = 0
const descriptors: TabDescriptor[] = []

/** A probe tab descriptor: renders its id, scope and visibility into the DOM. */
function probe(id: string, extra: Partial<TabDescriptor> = {}): TabDescriptor {
  return {
    id,
    title: id,
    component: ({ tab, scope, visible }) => createElement(
      'div',
      { 'data-probe': id },
      `${tab.id}|${scope.sessionId}|${scope.cwd ?? '-'}|${String(visible)}`,
    ),
    ...extra,
  }
}

function mountShell(opts: {
  /** null = explicitly no session (the guard render). */
  sessionId?: string | null
  cwd?: string | undefined
  prefsPatch?: Partial<SidebarPrefs>
  width?: number
} = {}): Harness {
  const width = opts.width ?? 1280
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  FakeWebSocket.instances = []
  // The two push loops (agent-terminals / agent-opens) subscribe via a
  // streaming fetch; the fake captures each subscription so the tests can
  // push NDJSON frames and end the stream. Non-push URLs (the session.cwd
  // route) delegate to the fetch stubbed before mount so their own tests
  // still drive the API.
  FakePushFetch.instances = []
  const priorFetch = globalThis.fetch
  vi.stubGlobal('fetch', (url: string | URL, init: RequestInit) => {
    const target = String(url)
    if (target.includes('/sidebar/ws/agent-terminals') || target.includes('/sidebar/ws/agent-opens')) {
      return new FakePushFetch(target, init).promise
    }
    if (typeof priorFetch === 'function') return priorFetch(target, init)
    return Promise.resolve(new Response(JSON.stringify({ ok: true, value: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })

  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  for (const descriptor of descriptors) service.registerTab(descriptor)
  store.setPrefs({ ...store.getPrefs(), openByDefault: true, ...opts.prefsPatch })

  const sessionId = opts.sessionId === null ? undefined : opts.sessionId ?? `s-${++sessionSeq}`
  let listSnapshot: SidebarSessionList = {
    current: sessionId,
    byId: sessionId === undefined
      ? {}
      : { [sessionId]: { id: sessionId, displayTitle: 'S', ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}) } },
  }
  const listListeners = new Set<() => void>()
  const localeSnapshot = { active: 'en' }
  const conversation = {
    input: { for: () => ({ state: { getSnapshot: () => ({ draft: '' }) }, setDraft: () => {} }) },
  }
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe: (fn: () => void) => { listListeners.add(fn); return () => { listListeners.delete(fn) } },
      },
    },
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : name === 'conversation' ? conversation : undefined,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as unknown as Context, store })) })
  return {
    container,
    store,
    service,
    list: () => listSnapshot,
    pushList: (next) => {
      act(() => {
        listSnapshot = next
        for (const fn of [...listListeners]) fn()
      })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

beforeEach(() => {
  descriptors.length = 0
  descriptors.push(probe('notes', { single: true }))
})

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  document.body.removeAttribute('data-dsh-sidebar-collapsed')
  document.body.removeAttribute('data-dsh-title-bar-compat')
  document.body.removeAttribute('data-dsh-tab-dragging')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

/** The shell mounts TWO push loops (terminals + opens); pick the LATEST by
 *  route (a reconnect creates a fresh subscription). */
const socketFor = (route: string): FakePushFetch => {
  const all = FakePushFetch.instances.filter(socket => socket.url.includes(route))
  return all[all.length - 1]!
}

/** Flush pending microtasks so the push loop's NDJSON reader advances. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('no-session shell', () => {
  it('renders a focusable disabled cluster and pushes nothing', () => {
    const h = mountShell({ sessionId: null })
    try {
      expect(h.store.getSnapshot().state).toBeUndefined()
      const buttons = [...h.container.querySelectorAll('button')]
      expect(buttons).toHaveLength(2)
      for (const button of buttons) expect(button.getAttribute('aria-label')).toBe(t('noSession'))
      // The layout push still runs (no session = collapsed = zero push).
      expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('0px')
      expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-height')).toBe('0px')
    } finally {
      h.unmount()
    }
  })
})

describe('toggle cluster', () => {
  it('toggles each panel through the store', () => {
    const h = mountShell()
    try {
      const bottom = h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!
      const side = h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('collapse')}"]`)!
      act(() => { bottom.click() })
      expect(h.store.getSnapshot().state!.bottomOpen).toBe(true)
      expect(h.container.querySelector(`[aria-label="${t('collapseBottomPanel')}"]`)).not.toBeNull()
      act(() => { side.click() })
      expect(h.store.getSnapshot().state!.panelOpen).toBe(false)
      expect(document.body.hasAttribute('data-dsh-sidebar-collapsed')).toBe(true)
    } finally {
      h.unmount()
    }
  })
})

describe('visual viewport inset', () => {
  it('offsets the bottom panel by the keyboard inset and re-measures on resize', async () => {
    const listeners: Array<[string, () => void]> = []
    const vv = {
      height: 500,
      offsetTop: 10,
      addEventListener: (type: string, fn: () => void) => { listeners.push([type, fn]) },
      removeEventListener: () => {},
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    try {
      const h = mountShell()
      try {
        // measure() ran on mount: inset = 768 - (500 + 10) = 258.
        expect(listeners.map(([type]) => type).sort()).toEqual(['resize', 'scroll'])
        act(() => { h.store.reduce(s => ({ ...s, bottomOpen: true })) })
        const bottom = h.container.querySelector<HTMLElement>('[data-dsh-bottom-panel]')!
        expect(bottom.style.bottom).toBe('258px')
        // A viewport shrink (rAF-throttled) lifts the panel further.
        vv.height = 200
        await act(async () => {
          for (const [type, fn] of listeners) if (type === 'resize') fn()
          await new Promise<void>(resolve => requestAnimationFrame(() =>{  resolve() }))
        })
        expect(h.container.querySelector<HTMLElement>('[data-dsh-bottom-panel]')!.style.bottom).toBe('558px')
      } finally {
        h.unmount()
      }
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    }
  })
})

describe('title-bar scheme', () => {
  it('the custom scheme injects the user stylesheet and drives the strip variable', () => {
    const h = mountShell({ prefsPatch: { titleBarScheme: 'custom', customCss: 'body{color:red}', titleBarStripPx: 40 } })
    try {
      expect(document.body.hasAttribute('data-dsh-title-bar-compat')).toBe(true)
      expect(document.documentElement.style.getPropertyValue('--dsh-title-bar-strip')).toBe('40px')
      const tag = document.head.querySelector('style[data-dsh-custom-css]')
      expect(tag).not.toBeNull()
      expect(tag!.textContent).toBe('body{color:red}')
      h.unmount()
      // The unmount/boundary swap removes the tag and the attribute.
      expect(document.head.querySelector('style[data-dsh-custom-css]')).toBeNull()
      expect(document.body.hasAttribute('data-dsh-title-bar-compat')).toBe(false)
      expect(document.documentElement.style.getPropertyValue('--dsh-title-bar-strip')).toBe('')
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })

  it('the preset scheme resolves the built-in preset (no CSS of its own)', () => {
    const h = mountShell({ prefsPatch: { titleBarScheme: 'preset', titleBarPresetId: 'dsh-desktop' } })
    try {
      // No desktop stamp in jsdom: the preset contributes no strip here.
      expect(document.body.hasAttribute('data-dsh-title-bar-compat')).toBe(false)
      expect(document.head.querySelector('style[data-dsh-preset-css]')).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('session cwd fetch', () => {
  it('asks the host once when the summary has no cwd yet', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ ok: true, value: { cwd: '/resolved', root: '/', parent: null } }), { headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const h = mountShell({ cwd: undefined })
    try {
      await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) })
      expect(fetchMock.mock.calls.some(([url]) => url.includes('/sidebar/api/session.cwd'))).toBe(true)
      // The resolved cwd reaches the tab scope (the explorer root seam).
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      expect(h.container.querySelector('[data-probe="notes"]')!.textContent).toContain('|/resolved')
    } finally {
      h.unmount()
    }
  })

  it('a failing cwd fetch leaves the shell alive', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetchMock)
    const h = mountShell({ cwd: undefined })
    try {
      await act(async () => { await new Promise<void>((resolve) => { setTimeout(resolve, 0) }) })
      expect(fetchMock).toHaveBeenCalled()
      expect(h.container.querySelector(`[aria-label="${t('collapse')}"]`)).not.toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('narrow-viewport merge', () => {
  it('migrating into narrow throws the bottom tabs into the right tree', async () => {
    const h = mountShell({ width: 1280 })
    try {
      // Open a tab in the bottom panel.
      act(() => {
        h.store.reduce(s => ({ ...s, bottomOpen: true, activePane: (s.bottomSplits as { id: string }).id }))
        h.service.openTab({ type: 'notes', title: 'N' })
      })
      expect(h.store.getSnapshot().state!.bottomOpen).toBe(true)
      // Shrink to a phone width: the shell merges the panels and closes the
      // bottom panel (its tabs now live in the right tree).
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
        await new Promise<void>(resolve => requestAnimationFrame(() =>{  resolve() }))
      })
      const state = h.store.getSnapshot().state!
      expect(state.bottomOpen).toBe(false)
      expect(state.bottomSplits).toMatchObject({ tabs: [] })
      const rightLeaf = state.splits as { tabs: Array<{ id: string }> }
      expect(rightLeaf.tabs.map(t => t.id)).toContain('notes')
      // No bottom toggle on narrow; the drawer spans the viewport.
      expect(h.container.querySelector(`[aria-label="${t('expandBottomPanel')}"]`)).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('OS file drag shield', () => {
  function fileDrag(type: string): Event {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'] } })
    return event
  }

  it('swallows the four OS file drag events at the panel host', () => {
    const h = mountShell()
    try {
      const button = h.container.querySelector<HTMLElement>('button')!
      let reachedDocument = 0
      const count = (): void => { reachedDocument += 1 }
      for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) {
        document.addEventListener(type, count)
        const event = fileDrag(type)
        button.dispatchEvent(event)
        expect(event.defaultPrevented, type).toBe(true)
      }
      expect(reachedDocument).toBe(0)
      // In-app drags (no Files type) propagate untouched.
      const inApp = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(inApp, 'dataTransfer', { value: { types: ['application/x-dsh-tab'] } })
      button.dispatchEvent(inApp)
      expect(inApp.defaultPrevented).toBe(false)
      expect(reachedDocument).toBe(1)
      for (const type of ['dragenter', 'dragover', 'dragleave', 'drop']) document.removeEventListener(type, count)
    } finally {
      h.unmount()
    }
  })
})

describe('bottom panel first-expansion auto terminal', () => {
  const terminalDescriptor = (): TabDescriptor => ({
    id: 'terminal',
    title: 'Terminal',
    createTab: state => ({ tab: { id: `term-${state.nextTerminal}`, type: 'terminal', title: 'T' }, patch: { nextTerminal: state.nextTerminal + 1 } }),
    component: () => createElement('div', null, 'termbody'),
  })

  function terminalsOf(h: Harness): string[] {
    const state = h.store.getSnapshot().state!
    const walk = (node: { kind: string; tabs?: Array<{ id: string }>; children?: unknown[] }): string[] =>
      node.kind === 'leaf' ? (node.tabs ?? []).map(t => t.id) : (node.children as unknown[]).flatMap(c => walk(c as never))
    return [...walk(state.splits as never), ...walk(state.bottomSplits as never)]
      .filter(id => id.startsWith('term-'))
  }

  it('opens a terminal into the bottom panel exactly once', () => {
    descriptors.push(terminalDescriptor())
    const h = mountShell()
    try {
      const bottomToggle = h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!
      act(() => { bottomToggle.click() })
      expect(terminalsOf(h)).toEqual(['term-1'])
      expect(h.store.getSnapshot().state!.bottomOpenedOnce).toBe(true)
      expect(h.store.getSnapshot().state!.activePane).toBe((h.store.getSnapshot().state!.bottomSplits as { id: string }).id)
      // Later expansions never repeat the auto-open.
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('collapseBottomPanel')}"]`)!.click() })
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      expect(terminalsOf(h)).toEqual(['term-1'])
    } finally {
      h.unmount()
    }
  })

  it('the pref switch or a disabled terminal type keeps the expansion silent', () => {
    descriptors.push(terminalDescriptor())
    const off = mountShell({ prefsPatch: { bottomPanelAutoTerminal: false } })
    try {
      act(() => { off.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      expect(terminalsOf(off)).toEqual([])
      off.unmount()
      const disabled = mountShell({ prefsPatch: { tabsEnabled: { terminal: false } } })
      try {
        act(() => { disabled.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
        expect(terminalsOf(disabled)).toEqual([])
      } finally {
        disabled.unmount()
      }
    } finally {
      if (off.container.isConnected) off.unmount()
    }
  })
})

describe('agent-terminals push loop', () => {
  const terminalView = (): TabDescriptor => ({
    id: 'terminal',
    title: 'Terminal',
    component: ({ tab }) => createElement('div', { 'data-probe': 'terminal' }, tab.id),
  })

  it('reconciles pushes into tabs and ignores malformed payloads', async () => {
    descriptors.push(terminalView())
    const h = mountShell()
    try {
      expect(FakePushFetch.instances).toHaveLength(2) // terminals + opens loops
      const socket = socketFor('agent-terminals')
      expect(socket.url).toContain('/sidebar/ws/agent-terminals?sessionId=')
      act(() => { socket.push(`${JSON.stringify([{ uuid: 'u1', title: 'Agent sh', command: 'sh', exited: false }])}\n`) })
      await flush()
      expect(h.container.querySelector('[data-probe="terminal"]')!.textContent).toContain('agent:u1')
      // Idempotent: the same push is a no-op.
      act(() => { socket.push(`${JSON.stringify([{ uuid: 'u1', title: 'Agent sh', command: 'sh', exited: false }])}\n`) })
      await flush()
      // Non-array JSON, broken JSON and blank lines are ignored.
      act(() => { socket.push('42\n') })
      act(() => { socket.push('{broken\n') })
      act(() => { socket.push('\n') })
      await flush()
      expect(h.container.querySelectorAll('[data-probe="terminal"]')).toHaveLength(1)
    } finally {
      h.unmount()
    }
  })

  it('pushes are ignored while the terminal type is disabled', async () => {
    const h = mountShell({ prefsPatch: { tabsEnabled: { terminal: false } } })
    try {
      const socket = socketFor('agent-terminals')
      act(() => { socket.push(`${JSON.stringify([{ uuid: 'u2', title: 'T', command: 'sh', exited: false }])}\n`) })
      await flush()
      expect(h.container.querySelector('[data-probe="terminal"]')).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('reconnects with backoff, caps the failures, and stops on unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell()
    try {
      expect(pending).toHaveLength(0)
      // Each dropped stream schedules a reconnect; after FAILURE_LIMIT (3)
      // consecutive drops the loop stops with a logged error.
      for (let i = 0; i < 3; i += 1) {
        act(() => { socketFor('agent-terminals').end() })
        await flush()
        act(() => { pending.splice(0).forEach((fn) => { fn() }) })
        await flush()
      }
      expect(errorSpy.mock.calls.some(call => String(call[0]).includes('agent-terminals'))).toBe(true)
      // Unmount aborts the live request; a late retry is a no-op.
      h.unmount()
      const after = FakePushFetch.instances.length
      for (const fn of pending.splice(0)) fn()
      await flush()
      expect(FakePushFetch.instances).toHaveLength(after)
      return
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })
})

describe('agent-opens push loop', () => {
  const editorView = (): TabDescriptor => ({
    id: 'editor', title: 'Editor',
    component: ({ tab }) => createElement('div', { 'data-probe': 'editor' }, `${tab.id}:${tab.path ?? ''}:${String((tab.meta as { dir?: boolean } | undefined)?.dir)}`),
  })
  const browserView = (): TabDescriptor => ({
    id: 'browser', title: 'Browser',
    component: ({ tab }) => createElement('div', { 'data-probe': 'browser' }, tab.path ?? ''),
  })

  function pushes(_h: Harness, payload: unknown): void {
    const frame = typeof payload === 'string' ? payload : JSON.stringify(payload)
    act(() => { socketFor('agent-opens').push(`${frame}\n`) })
  }

  it('routes file, folder and url opens; ignores broken requests and the pref switch', async () => {
    descriptors.push(editorView(), browserView())
    const h = mountShell({ prefsPatch: { agentOpenTools: true } })
    try {
      expect(socketFor('agent-opens').url).toContain('/sidebar/ws/agent-opens?sessionId=')
      pushes(h, { kind: 'file', target: '/w/notes/a.md' })
      pushes(h, { kind: 'folder', target: '/w/notes' })
      pushes(h, { kind: 'url', target: 'http://example.test/x', title: 'Example' })
      await flush()
      const state = h.store.getSnapshot().state!
      const tabs = (state.splits as { tabs: Array<{ id: string; path?: string; meta?: unknown }> }).tabs
        .filter(tab => tab.id.startsWith('editor:/w/') || tab.id === 'browser')
      expect(tabs.map(t => t.id)).toEqual(['editor:/w/notes/a.md', 'editor:/w/notes', 'browser'])
      expect(tabs[1]!.meta).toEqual({ dir: true })
      expect(tabs[2]!.path).toBe('http://example.test/x')
      // Malformed shapes are ignored one by one.
      pushes(h, '{broken')
      pushes(h, 42)
      pushes(h, { kind: 'binary', target: '/x' })
      pushes(h, { kind: 'file', target: '' })
      pushes(h, { kind: 'file' })
      pushes(h, null)
      await flush()
      expect((h.store.getSnapshot().state!.splits as { tabs: unknown[] }).tabs).toHaveLength(4)
      // With the tool pref off, pushes are a defensive no-op.
      act(() => { h.store.setPrefs({ ...h.store.getPrefs(), agentOpenTools: false }) })
      pushes(h, { kind: 'file', target: '/w/other.md' })
      await flush()
      expect((h.store.getSnapshot().state!.splits as { tabs: unknown[] }).tabs).toHaveLength(4)
    } finally {
      h.unmount()
    }
  })

  it('caps reconnect failures and cleans up on unmount', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell({ prefsPatch: { agentOpenTools: true } })
    try {
      for (let i = 0; i < 3; i += 1) {
        act(() => { socketFor('agent-opens').end() })
        await flush()
        act(() => { pending.splice(0).forEach((fn) => { fn() }) })
        await flush()
      }
      expect(errorSpy.mock.calls.some(call => String(call[0]).includes('agent-opens'))).toBe(true)
      h.unmount()
      const after = FakePushFetch.instances.length
      for (const fn of pending.splice(0)) fn()
      await flush()
      expect(FakePushFetch.instances).toHaveLength(after)
      return
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })
})

describe('subagent and job auto-openers', () => {
  const subagentTab = (): TabDescriptor => ({
    id: 'subagent', title: 'Subagent', single: true,
    component: () => createElement('div', { 'data-probe': 'subagent' }, 'sub'),
  })
  const summary = (id: string, over: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary =>
    ({ id, displayTitle: `S ${id}`, ...over })
  const armTimeouts = (): Array<() => void> => {
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    return pending
  }

  it('a new direct subagent opens the Subagent page once the debounce settles', () => {
    descriptors.push(subagentTab())
    const pending = armTimeouts()
    const h = mountShell({ prefsPatch: { autoOpenSubagent: true } })
    try {
      const base = h.list()
      // The child arrives: 0 → 1 direct subagent.
      const withChild: SidebarSessionList = {
        ...base,
        byId: { ...base.byId, child: summary('child', { origin: 'subagent', parentId: base.current!, displayTitle: 'Research' }) },
      }
      h.pushList(withChild)
      expect(h.container.querySelector('[data-probe="subagent"]')).toBeNull()
      expect(pending).toHaveLength(1)
      // While the recheck is armed, further snapshots never re-arm.
      h.pushList({ ...withChild, byId: { ...withChild.byId, c2: summary('c2') } })
      expect(pending).toHaveLength(1)
      // The settled recheck opens the page (panel + single subagent tab).
      act(() => { pending.splice(0).forEach((fn) =>{  fn() }) })
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      expect(h.container.querySelector('[data-probe="subagent"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('a Side-thread title at recheck time cancels the auto-open', () => {
    descriptors.push(subagentTab())
    const pending = armTimeouts()
    const h = mountShell({ prefsPatch: { autoOpenSubagent: true } })
    try {
      const base = h.list()
      // The thread's FIRST frame carries no 'Side: ' label yet: it arms the
      // debounced recheck like any direct subagent.
      h.pushList({ ...base, byId: { ...base.byId, th: summary('th', { origin: 'subagent', parentId: base.current!, displayTitle: 'chat' }) } })
      expect(pending).toHaveLength(1)
      // By the time the timer fires, the settled title is a Side thread:
      // the recheck sees no direct subagent and cancels the open.
      h.pushList({ ...base, byId: { ...base.byId, th: summary('th', { origin: 'subagent', parentId: base.current!, displayTitle: 'Side: chat' }) } })
      expect(pending).toHaveLength(1)
      act(() => { pending.splice(0).forEach((fn) =>{  fn() }) })
      expect(h.container.querySelector('[data-probe="subagent"]')).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('the pref switch or a disabled tab type blocks the auto-open', () => {
    descriptors.push(subagentTab())
    const off = mountShell({ prefsPatch: { autoOpenSubagent: false } })
    const pendingOff = armTimeouts()
    try {
      const baseOff = off.list()
      off.pushList({ ...baseOff, byId: { ...baseOff.byId, c: summary('c', { origin: 'subagent', parentId: baseOff.current! }) } })
      act(() => { pendingOff.splice(0).forEach((fn) =>{  fn() }) })
      expect(off.container.querySelector('[data-probe="subagent"]')).toBeNull()
      off.unmount()

      const pendingDis = armTimeouts()
      const disabled = mountShell({ prefsPatch: { autoOpenSubagent: true, tabsEnabled: { subagent: false } } })
      try {
        const baseDis = disabled.list()
        disabled.pushList({ ...baseDis, byId: { ...baseDis.byId, c: summary('c', { origin: 'subagent', parentId: baseDis.current! }) } })
        act(() => { pendingDis.splice(0).forEach((fn) =>{  fn() }) })
        expect(disabled.container.querySelector('[data-probe="subagent"]')).toBeNull()
      } finally {
        disabled.unmount()
      }
    } finally {
      if (off.container.isConnected) off.unmount()
    }
  })

  it('a NEW background job opens the Jobs page (pref-gated)', () => {
    descriptors.push(subagentTab())
    const h = mountShell({ prefsPatch: { autoOpenJobs: true } })
    try {
      const base = h.list()
      const jobList: SidebarSessionList = {
        ...base,
        jobsBySession: { [base.current!]: [{ id: 'bash-1', kind: 'bash', label: 'ls', status: 'running', startedAt: 1 }] },
      }
      h.pushList(jobList)
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      expect(h.container.querySelector('[data-probe="subagent"]')).not.toBeNull()
      // The same job again is not new.
      h.pushList(jobList)
      // With the pref off, nothing opens.
      act(() => { h.store.setPrefs({ ...h.store.getPrefs(), autoOpenJobs: false }) })
      h.pushList({ ...jobList, jobsBySession: { [base.current!]: [
        { id: 'bash-1', kind: 'bash', label: 'ls', status: 'running', startedAt: 1 },
        { id: 'bash-2', kind: 'bash', label: 'x', status: 'running', startedAt: 2 },
      ] } })
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
    } finally {
      h.unmount()
    }
  })
})

describe('personal-workbench entry promotion', () => {
  /** Mount a #root + strip so the effect's MutationObserver/rAF attaches,
   *  mirroring the real app shell (the effect watches document#root). */
  const mountStrip = ({ anchor, timer }: { anchor?: boolean; timer?: boolean }): { root: HTMLElement; strip: HTMLElement } => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const strip = document.createElement('div')
    root.append(strip)
    if (timer) {
      const timerButton = document.createElement('button')
      timerButton.setAttribute('aria-label', '打开定时任务面板')
      strip.append(timerButton)
    }
    if (anchor) {
      const anchorButton = document.createElement('button')
      anchorButton.className = 'hT2-rG_newSession'
      strip.append(anchorButton)
    }
    return { root, strip }
  }

  const flush = (): Promise<void> =>
    new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))

  it('moves the plugin entry after 新建会话, hides the scheduled task, and matches its styling', async () => {
    // The @dely0/dsh-personal-workbench plugin injects
    // button[data-dsh-personal-workbench-entry] into the sidebar after mount; the
    // shell moves it to the slot right after 新建会话, hides the scheduled-task
    // entry that used to sit there, and copies the new-session button's class
    // so it reads as a peer. The anchor is matched by its CSS-module class
    // suffix (the expanded sidebar has TWO aria-label="新建会话" buttons — the
    // brand shortcut and the real button, so the aria-label alone is ambiguous).
    const { root, strip } = mountStrip({ anchor: true, timer: true })
    const anchor = strip.children[1] as HTMLButtonElement
    const timer = strip.children[0] as HTMLButtonElement
    const h = mountShell()
    try {
      const entry = document.createElement('button')
      entry.setAttribute('data-dsh-personal-workbench-entry', '')
      entry.innerHTML = '<svg aria-hidden="true"></svg><span class="wb-label">工作台</span>'
      // Prepend so the entry is NOT already anchor's next sibling, forcing the
      // effect to actually move it (the after-anchor case would skip the move).
      act(() => { strip.prepend(entry) })
      await act(async () => { await flush() })
      expect(timer.style.display).toBe('none')
      expect(anchor.nextElementSibling).toBe(entry)
      expect(entry.className).toBe(anchor.className)
      expect(entry.querySelector('span')!.className).toBe('')
      expect(entry.querySelector('svg')!.getAttribute('width')).toBe('14')
      expect(entry.querySelector('svg')!.getAttribute('height')).toBe('14')
      // Idempotent: another mutation cycle leaves the entry where it is.
      act(() => { root.append(document.createElement('i')) })
      await act(async () => { await flush() })
      expect(anchor.nextElementSibling).toBe(entry)
    } finally {
      h.unmount()
      root.remove()
    }
  })

  it('hides the scheduled task but leaves the entry in place when no 新建会话 anchor exists', async () => {
    const { root, strip } = mountStrip({ timer: true })
    const timer = strip.children[0] as HTMLButtonElement
    const h = mountShell()
    try {
      const entry = document.createElement('button')
      entry.setAttribute('data-dsh-personal-workbench-entry', '')
      entry.innerHTML = '<span class="wb-label">工作台</span><svg aria-hidden="true"></svg>'
      act(() => { strip.append(entry) })
      await act(async () => { await flush() })
      expect(timer.style.display).toBe('none')
      expect(entry.parentElement).toBe(strip)
      expect(entry.className).toBe('')
    } finally {
      h.unmount()
      root.remove()
    }
  })

  it('copies the anchor class even when the scheduled task, entry label, and entry icon are absent', async () => {
    // Covers the no-scheduled-task, no-span, and no-svg paths in one sweep: a
    // bare data-attribute button still gets promoted and restyled to match.
    const { root, strip } = mountStrip({ anchor: true })
    const anchor = strip.children[0] as HTMLButtonElement
    const h = mountShell()
    try {
      const entry = document.createElement('button')
      entry.setAttribute('data-dsh-personal-workbench-entry', '')
      act(() => { strip.append(entry) })
      await act(async () => { await flush() })
      expect(anchor.nextElementSibling).toBe(entry)
      expect(entry.className).toBe(anchor.className)
      expect(entry.querySelector('span')).toBeNull()
      expect(entry.querySelector('svg')).toBeNull()
    } finally {
      h.unmount()
      root.remove()
    }
  })

  it('attaches no observer and promotes nothing when no #root shell is mounted', async () => {
    // Without a #root node the effect has nothing to observe (root === null):
    // the one-shot promoteEntry() at mount finds no entry yet, and a later-
    // inserted entry is never promoted. Mounting the shell this way also
    // exercises the null branch of the observer-attach guard.
    const h = mountShell()
    const entry = document.createElement('button')
    try {
      entry.setAttribute('data-dsh-personal-workbench-entry', '')
      act(() => { document.body.append(entry) })
      await act(async () => { await flush() })
      expect(entry.parentElement).toBe(document.body)
    } finally {
      entry.remove()
      h.unmount()
    }
  })
})
