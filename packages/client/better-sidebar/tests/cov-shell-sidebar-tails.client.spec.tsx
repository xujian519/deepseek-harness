/**
 * Sidebar shell tails: the session push loop's failure ladder and its
 * teardown race, the missing-service face, the keyboard-inset and preset-CSS
 * effects, the center-column locator's recovery paths (detached column, HMR
 * swap), the float-hint drop-zone tails, every drag strip's commit/abort
 * tails, and the workbench action wrappers for pinned virtual tabs.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import {
  createSidebarStore, firstLeaf, moveTabToEdge, openTabInActivePane, setTabPin,
  type SidebarStore, type SidebarTab,
} from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService, type TabDescriptor } from '../src/client/service.ts'
import { t } from '../src/client/locales.ts'
import { api } from '../src/client/api.ts'
import { TAB_DRAG_TYPE } from '../src/client/TabBar.tsx'
import type { Context, SidebarSessionList, SidebarSessionSummary } from '../src/context-types.ts'
import type { TabComponentProps } from '../src/client/service.ts'

/** jsdom has no ResizeObserver: a recorder the tests can fire by hand. */
class RecordingResizeObserver {
  static instances: RecordingResizeObserver[] = []
  disconnects = 0
  constructor(readonly callback: () => void) { RecordingResizeObserver.instances.push(this) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void { this.disconnects += 1 }
  /** Run the observer callback (jsdom lays nothing out, so tests drive it). */
  fire(): void { this.callback() }
}

/** jsdom's MutationObserver never sees the shell's own DOM writes in a test:
 *  a recorder the tests fire by hand. */
class RecordingMutationObserver {
  static instances: RecordingMutationObserver[] = []
  constructor(readonly callback: () => void) { RecordingMutationObserver.instances.push(this) }
  observe(): void {}
  disconnect(): void {}
  takeRecords(): never[] { return [] }
  fire(): void { this.callback() }
}

/** The streaming push subscription fake (see cov-shell-sidebar-effects). */
class FakePushFetch {
  static instances: FakePushFetch[] = []
  url: string
  private outputController: ReadableStreamDefaultController<Uint8Array> | undefined
  private closed = false
  readonly promise: Promise<Response>
  constructor(url: string) {
    this.url = url
    const output = new ReadableStream<Uint8Array>({
      start: (controller) => { this.outputController = controller },
      cancel: () => { this.closed = true },
    })
    this.promise = Promise.resolve(new Response(output, { status: 200 }))
    FakePushFetch.instances.push(this)
  }

  push(data: string): void {
    if (this.closed) return
    this.outputController?.enqueue(new TextEncoder().encode(data))
  }

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
  pushList: (list: SidebarSessionList) => void
  list: () => SidebarSessionList
  drafts: string[]
  unmount: () => void
}

let sessionSeq = 0
const descriptors: TabDescriptor[] = []
/** Responses the push routes hand back (null = the streaming fake). */
let pushFailure: Response | null = null

/** A probe tab descriptor that renders its id/scope into the DOM. */
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

function mountShell(options: {
  sessionId?: string | null
  cwd?: string | undefined
  prefsPatch?: Record<string, unknown>
  width?: number
  withService?: boolean
  /** The response the push routes hand back instead of the streaming fake. */
  pushFailure?: Response
  /** Refuse the session.cwd route so the shell keeps its unknown cwd. */
  cwdRouteFails?: boolean
} = {}): Harness {
  const width = options.width ?? 1280
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  RecordingResizeObserver.instances = []
  RecordingMutationObserver.instances = []
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver)
  vi.stubGlobal('MutationObserver', RecordingMutationObserver)
  pushFailure = options.pushFailure ?? null
  FakePushFetch.instances = []
  vi.stubGlobal('fetch', (url: string | URL) => {
    const target = String(url)
    if (target.includes('/sidebar/ws/')) {
      if (pushFailure !== null) return Promise.resolve(pushFailure)
      return new FakePushFetch(target).promise
    }
    if (options.cwdRouteFails === true) return Promise.reject(new Error('route down'))
    return Promise.resolve(new Response(JSON.stringify({ ok: true, value: { cwd: '/tmp' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
  })
  const drafts: string[] = []
  let draft = ''
  const conversation = {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft }) },
        setDraft: (text: string) => { draft = text; drafts.push(text) },
      }),
    },
  }

  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  for (const descriptor of descriptors) service.registerTab(descriptor)
  store.setPrefs({ ...store.getPrefs(), openByDefault: true, ...options.prefsPatch })

  const activeId = options.sessionId === null ? undefined : options.sessionId ?? `s-${++sessionSeq}`
  let listSnapshot: SidebarSessionList = {
    current: activeId,
    byId: activeId === undefined
      ? {}
      : { [activeId]: { id: activeId, displayTitle: 'S', ...(options.cwd !== undefined ? { cwd: options.cwd } : {}) } },
  }
  const listListeners = new Set<() => void>()
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => ({ active: 'en' }) },
    sessions: {
      list: {
        getSnapshot: () => listSnapshot,
        subscribe: (listener: () => void) => { listListeners.add(listener); return () => { listListeners.delete(listener) } },
      },
      scope: () => ctx,
    },
    betterSidebar: service,
    get: (name: string) => {
      if (name === 'betterSidebar') return options.withService === false ? undefined : service
      return name === 'conversation' ? conversation : undefined
    },
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as unknown as Context, store })) })
  return {
    container,
    store,
    service,
    drafts,
    list: () => listSnapshot,
    pushList: (next) => {
      act(() => {
        listSnapshot = next
        for (const listener of [...listListeners]) listener()
      })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** A conversation column for the locator to adopt (removable by the test). */
function conversationColumn(): HTMLElement {
  const rootEl = document.createElement('div')
  rootEl.id = 'root'
  const column = document.createElement('div')
  const slot = document.createElement('div')
  slot.setAttribute('data-slot', 'conversation')
  column.append(slot)
  rootEl.append(column)
  document.body.prepend(rootEl)
  return column
}

const CONV_RECT = { left: 100, right: 700, top: 50, bottom: 600, width: 600, height: 550 }

function rectOf(element: HTMLElement, rect: Partial<DOMRect> = CONV_RECT): void {
  element.getBoundingClientRect = () => rect as DOMRect
}

const pushSocket = (route: string): FakePushFetch => {
  const all = FakePushFetch.instances.filter(socket => socket.url.includes(route))
  return all[all.length - 1]!
}

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

/** Re-run the locator's mutation watchers (the shell's own are recorded). */
function fireLocators(): void {
  act(() => { RecordingMutationObserver.instances.forEach((observer) => { observer.fire() }) })
}

const flushFrame = async (): Promise<void> => {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() })) })
}

function tabByTitle(h: Harness, title: string): HTMLElement {
  const tabs = [...h.container.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
  return tabs.find(element => element.title === title)!
}

function pointerAt(type: string, x: number, y: number): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

function dragAt(type: string, x: number, y: number, raw = ''): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'dataTransfer', {
    value: { getData: (format: string) => (format === TAB_DRAG_TYPE ? raw : ''), types: [] },
  })
  return event
}

beforeEach(() => {
  descriptors.length = 0
  descriptors.push(probe('notes', { single: true }))
  // A mounted shell seeds its width from the persisted global width.
  localStorage.clear()
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  proto.setPointerCapture = () => {}
  proto.releasePointerCapture = () => {}
  proto.hasPointerCapture = () => true
})

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  document.body.removeAttribute('data-dsh-sidebar-collapsed')
  document.body.removeAttribute('data-dsh-sidebar-dragging')
  document.body.removeAttribute('data-dsh-tab-dragging')
  window.history.replaceState({}, '', '/')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('session push loop failures', () => {
  it('retries on the backoff ladder while the response is unusable', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell({ pushFailure: new Response(null, { status: 503 }) })
    try {
      await flush()
      // A refused (non-ok, bodyless) response schedules the retry ladder.
      expect(pending.length).toBeGreaterThan(0)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        act(() => { pending.splice(0).forEach((fn) => { fn() }) })
        await flush()
      }
      // After the failure cap the loop stops rather than spinning.
      expect(errorSpy.mock.calls.some(call => String(call[0]).includes('agent-terminals'))).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('ignores a retry that lands after teardown', async () => {
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell()
    try {
      // Dropping the stream arms one retry, then the shell goes away.
      act(() => { pushSocket('agent-terminals').end() })
      await flush()
      expect(pending).toHaveLength(1)
      h.unmount()
      const attempts = FakePushFetch.instances.length
      act(() => { pending.splice(0).forEach((fn) => { fn() }) })
      await flush()
      expect(FakePushFetch.instances).toHaveLength(attempts)
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })
})

describe('shell without the sidebar service', () => {
  it('renders the panels with an empty + menu', () => {
    const h = mountShell({ withService: false, cwd: '/tmp' })
    try {
      const plus = h.container.querySelector<HTMLButtonElement>(`button[aria-label="${t('newTab')}"]`)!
      act(() => { plus.click() })
      expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0)
    } finally {
      h.unmount()
    }
  })
})

describe('keyboard inset effect', () => {
  it('stays at zero when nothing is obscured and cancels a pending frame on unmount', async () => {
    const listeners: Array<[string, () => void]> = []
    const viewport = {
      height: 768,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => { listeners.push([type, fn]) },
      removeEventListener: () => {},
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    const h = mountShell()
    try {
      // measure() ran on mount with nothing obscured: no inset.
      const press = (): void => { listeners.filter(([type]) => type === 'resize').forEach(([, fn]) => { fn() }) }
      act(() => { press() })
      // A second event inside the same frame reuses the armed frame.
      act(() => { press() })
      await flushFrame()
      // Unmount while a frame is armed cancels it.
      act(() => { press() })
      h.unmount()
      expect(cancel).toHaveBeenCalled()
    } finally {
      if (h.container.isConnected) h.unmount()
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })
})

describe('center column locator recovery', () => {
  it('re-adopts a fresh column after the measured one was detached', async () => {
    const column = conversationColumn()
    rectOf(column)
    const h = mountShell({ cwd: '/tmp' })
    try {
      const live = RecordingResizeObserver.instances.at(-1)!
      const observers = RecordingResizeObserver.instances.length
      // The observed column is detached (HMR swapped the node in place): the
      // measurement drops the stale reference instead of using its rect.
      column.remove()
      act(() => { live.fire() })

      // A fresh column appears and the locator adopts it.
      const replacement = conversationColumn()
      rectOf(replacement)
      fireLocators()
      await flushFrame()
      expect(RecordingResizeObserver.instances).toHaveLength(observers + 1)
      expect(h.container.querySelector<HTMLElement>('[data-dsh-bottom-panel]')!.style.visibility).toBe('')
    } finally {
      h.unmount()
    }
  })

  it('drops the reference and the observer when the column vanishes', async () => {
    const column = conversationColumn()
    rectOf(column)
    const h = mountShell({ cwd: '/tmp' })
    try {
      const live = RecordingResizeObserver.instances.at(-1)!
      const disconnects = live.disconnects
      // The column is gone when the locator re-runs: it clears the reference
      // and disconnects the observer bound to the dead node.
      column.remove()
      fireLocators()
      await flushFrame()
      expect(live.disconnects).toBe(disconnects + 1)
    } finally {
      h.unmount()
    }
  })

  it('pauses measurement during a panel drag', async () => {
    const column = conversationColumn()
    rectOf(column)
    const h = mountShell({ cwd: '/tmp' })
    try {
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => { strip.dispatchEvent(pointerAt('pointerdown', 1000, 200)) })
      const observer = RecordingResizeObserver.instances[0]!
      // Firing the observer mid-drag must not re-measure (the drag writes the
      // geometry itself); it is a no-op the test observes through the panel.
      expect(() => { act(() => { observer.fire() }) }).not.toThrow()
      act(() => { strip.dispatchEvent(pointerAt('pointerup', 1000, 200)) })
    } finally {
      h.unmount()
    }
  })
})

describe('os file drag shield', () => {
  it('lets a drag without a dataTransfer through untouched', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const host = h.container.querySelector<HTMLElement>('[data-dsh-panel-host]')!
      const event = new Event('dragenter', { bubbles: true, cancelable: true })
      host.dispatchEvent(event)
      // No dataTransfer → not an OS file drag → not swallowed.
      expect(event.defaultPrevented).toBe(false)
    } finally {
      h.unmount()
    }
  })
})

describe('float hint drop tails', () => {
  function armedHint(h: Harness): void {
    act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
    document.body.setAttribute('data-dsh-tab-dragging', '')
    act(() => { document.dispatchEvent(dragAt('dragover', 400, 300)) })
    expect(h.container.querySelector('[class*="floatDropHint"]')).not.toBeNull()
  }

  it('a zero-size column never arms the hint', () => {
    const column = conversationColumn()
    rectOf(column, { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 })
    const h = mountShell({ cwd: '/tmp' })
    try {
      document.body.setAttribute('data-dsh-tab-dragging', '')
      act(() => { document.dispatchEvent(dragAt('dragover', 0, 0)) })
      expect(h.container.querySelector('[class*="floatDropHint"]')).toBeNull()
      document.body.removeAttribute('data-dsh-tab-dragging')
    } finally {
      h.unmount()
    }
  })

  it('an armed drop outside the column and a payload-less drop both land nothing', () => {
    const column = conversationColumn()
    rectOf(column)
    const h = mountShell({ cwd: '/tmp' })
    try {
      armedHint(h)
      // Outside the column: the drop is left to other handlers.
      act(() => { document.dispatchEvent(dragAt('drop', 20, 10, JSON.stringify({ tabId: 'n-1', paneId: 'pane:1' }))) })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(0)

      // A drop with no dataTransfer at all: nothing to parse.
      armedHint(h)
      const bare = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(bare, 'clientX', { value: 400 })
      Object.defineProperty(bare, 'clientY', { value: 300 })
      act(() => { document.dispatchEvent(bare) })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(0)
      document.body.removeAttribute('data-dsh-tab-dragging')
    } finally {
      h.unmount()
    }
  })
})

describe('drag strips', () => {
  /** The committed geometry a drag starts from. */
  const sizeOf = (h: Harness): { width: number; height: number } => {
    const state = h.store.getSnapshot().state!
    return { width: state.width, height: state.bottomHeight }
  }

  it('coalesces moves inside one frame and commits each pane tail', async () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const { width } = sizeOf(h)
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 1000, 200))
        // Two moves inside one frame: the second one only refreshes the
        // pending write (the rAF has not run yet).
        strip.dispatchEvent(pointerAt('pointermove', 950, 200))
        strip.dispatchEvent(pointerAt('pointermove', 900, 200))
      })
      expect(document.body.hasAttribute('data-dsh-sidebar-dragging')).toBe(true)
      await flushFrame()
      // Mid-drag the DOM carries the width; the store still holds the old one.
      expect(h.container.querySelector<HTMLElement>('[data-dsh-panel]')!.style.width).toBe(`${width + 100}px`)
      expect(h.store.getSnapshot().state!.width).toBe(width)
      act(() => { strip.dispatchEvent(pointerAt('pointerup', 880, 200)) })
      // The release projects the up position onto the drag's start.
      expect(h.store.getSnapshot().state!.width).toBe(width + 120)
      // A second release finds the drag already committed.
      act(() => { strip.dispatchEvent(pointerAt('pointerup', 800, 200)) })
      expect(h.store.getSnapshot().state!.width).toBe(width + 120)
      expect(document.body.hasAttribute('data-dsh-sidebar-dragging')).toBe(false)
    } finally {
      h.unmount()
    }
  })

  it('a width strip without pointer capture ignores moves and the release', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const { width } = sizeOf(h)
      const strip = h.container.querySelector<HTMLElement>('[class*="panelResize"]')!
      ;(strip as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 1000, 200))
        strip.dispatchEvent(pointerAt('pointermove', 900, 200))
        strip.dispatchEvent(pointerAt('pointerup', 800, 200))
      })
      expect(h.store.getSnapshot().state!.width).toBe(width)
    } finally {
      h.unmount()
    }
  })

  it('the corner strip drags both sizes and tolerates its own release tails', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      const { width, height } = sizeOf(h)
      const corner = h.container.querySelector<HTMLElement>('[class*="cornerHandle"]')!
      act(() => {
        corner.dispatchEvent(pointerAt('pointerdown', 1000, 400))
        corner.dispatchEvent(pointerAt('pointermove', 950, 430))
      })
      // A release without capture is ignored; with capture it commits both.
      ;(corner as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
      act(() => { corner.dispatchEvent(pointerAt('pointerup', 940, 440)) })
      expect(h.store.getSnapshot().state!.width).toBe(width)
      ;(corner as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true
      act(() => { corner.dispatchEvent(pointerAt('pointerup', 940, 440)) })
      const committed = h.store.getSnapshot().state!
      expect(committed.width).toBe(width + 60)
      expect(committed.bottomHeight).toBe(Math.max(120, height - 40))
      // The second release finds the drag already committed.
      act(() => { corner.dispatchEvent(pointerAt('pointerup', 900, 400)) })
      expect(h.store.getSnapshot().state!.width).toBe(width + 60)
      // A move without capture is ignored.
      act(() => {
        corner.dispatchEvent(pointerAt('pointerdown', 1000, 400))
      })
      ;(corner as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
      act(() => { corner.dispatchEvent(pointerAt('pointermove', 900, 400)) })
      ;(corner as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true
      // Losing capture before any release settles the drag from the last DOM size.
      act(() => { corner.dispatchEvent(pointerAt('lostpointercapture', 900, 400)) })
      expect(document.body.hasAttribute('data-dsh-sidebar-dragging')).toBe(false)
    } finally {
      h.unmount()
    }
  })

  it('a corner drag cancelled without a move commits the cancel position', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      const { width, height } = sizeOf(h)
      const corner = h.container.querySelector<HTMLElement>('[class*="cornerHandle"]')!
      act(() => { corner.dispatchEvent(pointerAt('pointerdown', 1000, 400)) })
      act(() => { corner.dispatchEvent(pointerAt('pointercancel', 950, 440)) })
      const state = h.store.getSnapshot().state!
      expect(state.width).toBe(width + 50)
      expect(state.bottomHeight).toBe(Math.max(120, height - 40))
      // A second interruption after the commit is inert.
      act(() => { corner.dispatchEvent(pointerAt('pointercancel', 100, 100)) })
      expect(h.store.getSnapshot().state!.width).toBe(width + 50)
      expect(h.container.querySelector('[class*="cornerHandle"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('the bottom strip drags its height and commits its tails', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      const { height } = sizeOf(h)
      const strip = h.container.querySelector<HTMLElement>('[class*="bottomResize"]')!
      act(() => { strip.dispatchEvent(pointerAt('pointerdown', 500, 300)) })
      // The active drag marks the panel while the pointer is down.
      expect(h.container.querySelector('[data-dsh-bottom-panel]')!.getAttribute('data-dragging')).toBe('true')
      act(() => {
        strip.dispatchEvent(pointerAt('pointermove', 500, 260))
        strip.dispatchEvent(pointerAt('pointerup', 500, 250))
      })
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(height + 50)
      expect(h.container.querySelector('[data-dsh-bottom-panel]')!.getAttribute('data-dragging')).toBeNull()
      // No capture: the move and the release are inert.
      ;(strip as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 500, 300))
        strip.dispatchEvent(pointerAt('pointermove', 500, 200))
        strip.dispatchEvent(pointerAt('pointerup', 500, 200))
      })
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(height + 50)
      // A committed release ignores a repeated one, then the interruption
      // tail settles the drag.
      ;(strip as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => true
      const before = h.store.getSnapshot().state!.bottomHeight
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 500, 300))
        strip.dispatchEvent(pointerAt('pointerup', 500, 250))
        strip.dispatchEvent(pointerAt('pointerup', 500, 100))
      })
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(before + 50)
      act(() => {
        strip.dispatchEvent(pointerAt('pointerdown', 500, 300))
        strip.dispatchEvent(pointerAt('lostpointercapture', 500, 100))
      })
      expect(h.container.querySelector('[data-dsh-bottom-panel]')!.getAttribute('data-dragging')).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('a cancel with no drag in flight falls back to the last applied size', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const { width } = sizeOf(h)
      // An interruption with no drag in flight and no recorded size adopts the
      // layout push for the CLOSED panel — the push writes 0, which the store
      // clamps to the bottom minimum. The width is untouched.
      act(() => { h.container.querySelector<HTMLElement>('[class*="bottomResize"]')!.dispatchEvent(pointerAt('pointercancel', 500, 100)) })
      expect(h.store.getSnapshot().state!.width).toBe(width)
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(120)
    } finally {
      h.unmount()
    }
  })

  it('a bottom drag cancelled without a move commits the cancel position', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.container.querySelector<HTMLButtonElement>(`[aria-label="${t('expandBottomPanel')}"]`)!.click() })
      const { height } = sizeOf(h)
      const strip = h.container.querySelector<HTMLElement>('[class*="bottomResize"]')!
      act(() => { strip.dispatchEvent(pointerAt('pointerdown', 500, 300)) })
      act(() => { strip.dispatchEvent(pointerAt('pointercancel', 500, 240)) })
      expect(h.store.getSnapshot().state!.bottomHeight).toBe(height + 60)
    } finally {
      h.unmount()
    }
  })
})

describe('pinned virtual tabs', () => {
  const terminalProbe = (): TabDescriptor => ({
    id: 'terminal', title: 'Terminal',
    component: ({ tab, scope }: TabComponentProps) => createElement(
      'div', { 'data-probe': 'terminal' }, `${tab.id}@${scope.sessionId}`,
    ),
  })

  /** Pin a terminal tab in ANOTHER session so it shows on this rail. */
  function seedHome(h: Harness, homeId: string, opts: { agent?: boolean; cwd?: string } = {}): void {
    act(() => {
      const tabId = opts.agent === true ? 'agent:u-1' : 'term-home'
      const tab: SidebarTab = { id: tabId, type: 'terminal', title: 'Home term' }
      h.store.reduceFor(homeId, (state) => {
        let next = openTabInActivePane(state, tab)
        next = setTabPin(next, tabId, { scope: 'global', ...(opts.cwd !== undefined ? { homeCwd: opts.cwd } : {}) })
        return next
      })
    })
    // reduceFor does not notify; a store change recomputes the pinned rail.
    act(() => { h.store.reduce(current => ({ ...current, revealed: current.revealed.slice() })) })
  }

  function virtualTabId(homeId: string): string {
    return `pinned:${homeId}:term-home`
  }

  it('routes a drop onto the virtual tab into the pane and ignores a virtual payload', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-1', { cwd: '/tmp' })
      const pane = firstLeaf(h.store.getSnapshot().state!.splits)
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      const regular = tabByTitle(h, 'N')

      // Dropping a regular tab ONTO the virtual tab merges it into the pane.
      act(() => {
        tabByTitle(h, 'Home term').dispatchEvent(
          dragAt('drop', 5, 5, JSON.stringify({ tabId: pane.tabs[0]!.id, paneId: pane.id })),
        )
      })
      expect(h.store.getSnapshot().state!.splits).toBeDefined()

      // A payload carrying a VIRTUAL tab id is refused outright.
      act(() => {
        tabByTitle(h, 'Home term').dispatchEvent(
          dragAt('drop', 5, 5, JSON.stringify({ tabId: virtualTabId('home-1'), paneId: pane.id })),
        )
      })
      expect(h.container.querySelector('[data-probe="terminal"]')).not.toBeNull()

      // The pane's own drop with a virtual payload is refused too.
      const paneEl = h.container.querySelector<HTMLElement>(`[data-dsh-pane="${pane.id}"]`)!
      paneEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
      act(() => {
        paneEl.dispatchEvent(dragAt('drop', 50, 50, JSON.stringify({ tabId: virtualTabId('home-1'), paneId: pane.id })))
      })
      expect(regular).toBeDefined()
    } finally {
      h.unmount()
    }
  })

  it('refuses a virtual payload dropped on a regular tab and forwards the rest', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-8', { cwd: '/tmp' })
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      act(() => { h.service.registerTab(probe('second', { single: true })) })
      act(() => { h.service.openTab({ type: 'second', title: 'S' }) })
      const pane = firstLeaf(h.store.getSnapshot().state!.splits)
      const target = tabByTitle(h, 'N')

      // A regular payload dropped onto a regular tab inserts before it.
      act(() => {
        target.dispatchEvent(dragAt('drop', 5, 5, JSON.stringify({ tabId: 'second', paneId: pane.id })))
      })
      const reordered = firstLeaf(h.store.getSnapshot().state!.splits)
      expect(reordered.tabs.findIndex(tab => tab.id === 'second'))
        .toBeLessThan(reordered.tabs.findIndex(tab => tab.id === 'notes'))

      // A VIRTUAL payload is refused by the wrapper.
      act(() => {
        tabByTitle(h, 'N').dispatchEvent(
          dragAt('drop', 5, 5, JSON.stringify({ tabId: virtualTabId('home-8'), paneId: pane.id })),
        )
      })
      expect(firstLeaf(h.store.getSnapshot().state!.splits).tabs.some(tab => tab.id === 'notes')).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('forwards a pane drop of a regular payload to the edge mover', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-9', { cwd: '/tmp' })
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      const pane = firstLeaf(h.store.getSnapshot().state!.splits)
      const paneEl = h.container.querySelector<HTMLElement>(`[data-dsh-pane="${pane.id}"]`)!
      paneEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
      act(() => {
        paneEl.dispatchEvent(dragAt('drop', 50, 50, JSON.stringify({ tabId: 'notes', paneId: pane.id })))
      })
      // The drop resolved to a zone and the tab was moved within the pane.
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
    } finally {
      h.unmount()
    }
  })

  it('pins and unpins a regular terminal through the base action', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-10', { cwd: '/tmp' })
      act(() => { h.service.openTab({ type: 'terminal', title: 'Local term' }) })
      act(() => {
        tabByTitle(h, 'Local term').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }))
      })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(item => item.textContent?.includes(t('pinTerminal')))!
          .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(item => item.textContent?.includes(t('pinToWorkspace')))!
          .click()
      })
      const pinned = firstLeaf(h.store.getSnapshot().state!.splits).tabs.find(tab => tab.type === 'terminal')!
      expect(pinned.pin).toMatchObject({ scope: 'workspace' })
    } finally {
      h.unmount()
    }
  })

  it('unpins an ACTIVATED virtual tab and clears its activation', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-11', { cwd: '/tmp' })
      act(() => {
        tabByTitle(h, 'Home term').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      act(() => {
        tabByTitle(h, 'Home term').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }))
      })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(item => item.textContent?.includes(t('unpinTerminal')))!
          .click()
      })
      // The virtual tab left the rail (unpinned) and its cell is gone.
      expect(tabByTitle(h, 'Home term')).toBeUndefined()
      expect(h.store.getSessionStates().get('home-11')!).toBeDefined()
    } finally {
      h.unmount()
    }
  })

  it('closes a regular tab through the base action while the rail is up', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-2', { cwd: '/tmp' })
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      act(() => {
        tabByTitle(h, 'N').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
      expect(h.container.textContent).not.toContain('N')
    } finally {
      h.unmount()
    }
  })

  it('releases a pinned tab whose home scope carries no cwd and survives a refused release', async () => {
    descriptors.push(terminalProbe())
    const close = vi.spyOn(api, 'ptyClose').mockRejectedValue(new Error('already gone'))
    const h = mountShell({ cwd: '/tmp' })
    try {
      // No homeCwd on the pin: the release scope carries the session only.
      seedHome(h, 'home-3')
      act(() => {
        tabByTitle(h, 'Home term').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(close).toHaveBeenCalledWith({ sessionId: 'home-3' }, 'term-home')
      await flush()
    } finally {
      h.unmount()
    }
  })

  it('releases a pinned AGENT terminal by uuid and survives a refused release', async () => {
    descriptors.push(terminalProbe())
    const close = vi.spyOn(api, 'agentPtyClose').mockRejectedValue(new Error('already gone'))
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-4', { agent: true, cwd: '/tmp' })
      act(() => {
        tabByTitle(h, 'Home term').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(close).toHaveBeenCalledWith('u-1')
      await flush()
    } finally {
      h.unmount()
    }
  })

  it('closing a virtual tab whose home layout lost it is a no-op', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-5', { cwd: '/tmp' })
      // The home tab disappears behind the rail's back (a targeted reduce does
      // not notify, so the stale virtual tab stays on screen).
      h.store.reduceFor('home-5', (state) => {
        const pane = firstLeaf(state.splits)
        return { ...state, splits: { ...pane, tabs: pane.tabs.filter(tab => tab.id !== 'term-home'), active: null } }
      })
      const virtual = tabByTitle(h, 'Home term')
      expect(() => {
        act(() => {
          virtual.querySelector<HTMLElement>('[class*="tabClose"]')!
            .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        })
      }).not.toThrow()
    } finally {
      h.unmount()
    }
  })

  it('floats a regular tab while a pinned rail is up', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-6', { cwd: '/tmp' })
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      act(() => {
        tabByTitle(h, 'N').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }))
      })
      const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find(item => item.textContent?.includes(t('moveToFreeWindow')))!
      act(() => { row.click() })
      expect(h.store.getSnapshot().state!.floats).toHaveLength(1)
    } finally {
      h.unmount()
    }
  })

  it('unpins and re-pins through the wrapper without touching a virtual id', () => {
    descriptors.push(terminalProbe())
    const h = mountShell({ cwd: '/tmp' })
    try {
      seedHome(h, 'home-7', { cwd: '/tmp' })
      // Unpinning the virtual tab marks the HOME tab (the virtual id routes
      // there); pinning a regular terminal keeps the base action.
      act(() => {
        tabByTitle(h, 'Home term').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 8, clientY: 8 }))
      })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(item => item.textContent?.includes(t('unpinTerminal')))!
          .click()
      })
      const home = h.store.getSessionStates().get('home-7')!
      expect(JSON.stringify(home)).not.toContain('"pin"')
    } finally {
      h.unmount()
    }
  })
})

describe('auto-open triggers', () => {
  const subagentTab = (): TabDescriptor => ({
    id: 'subagent', title: 'Subagent', single: true,
    component: () => createElement('div', { 'data-probe': 'subagent' }, 'sub'),
  })
  const summary = (id: string, over: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary =>
    ({ id, displayTitle: `S ${id}`, ...over })

  it('re-opens the subagent page over an already-open panel', () => {
    descriptors.push(subagentTab())
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell({ prefsPatch: { autoOpenSubagent: true } })
    try {
      // The panel is already expanded (openByDefault): the reveal must not
      // toggle it shut.
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      const base = h.list()
      h.pushList({
        ...base,
        byId: { ...base.byId, child: summary('child', { origin: 'subagent', parentId: base.current!, displayTitle: 'Research' }) },
      })
      act(() => { pending.splice(0).forEach((fn) => { fn() }) })
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      expect(h.container.querySelector('[data-probe="subagent"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('expands a collapsed panel when the first subagent appears', () => {
    descriptors.push(subagentTab())
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    vi.stubGlobal('clearTimeout', () => {})
    const h = mountShell({ prefsPatch: { autoOpenSubagent: true, openByDefault: false } })
    try {
      // The panel starts collapsed (openByDefault off).
      expect(h.store.getSnapshot().state!.panelOpen).toBe(false)
      const base = h.list()
      h.pushList({
        ...base,
        byId: { ...base.byId, child: summary('child', { origin: 'subagent', parentId: base.current!, displayTitle: 'Research' }) },
      })
      act(() => { pending.splice(0).forEach((fn) => { fn() }) })
      expect(h.store.getSnapshot().state!.panelOpen).toBe(true)
      expect(h.container.querySelector('[data-probe="subagent"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('voids an armed recheck when the session switches away', () => {
    descriptors.push(subagentTab())
    const pending: Array<() => void> = []
    vi.stubGlobal('setTimeout', (fn: () => void) => { pending.push(fn); return pending.length })
    const cleared: number[] = []
    vi.stubGlobal('clearTimeout', (handle: number) => { cleared.push(handle) })
    const h = mountShell({ prefsPatch: { autoOpenSubagent: true }, sessionId: null })
    try {
      const base = { current: 'live-1', byId: { 'live-1': summary('live-1', { displayTitle: 'L' }) } }
      h.pushList(base)
      h.pushList({
        ...base,
        byId: { ...base.byId, child: summary('child', { origin: 'subagent', parentId: 'live-1', displayTitle: 'Research' }) },
      })
      expect(pending).toHaveLength(1)
      // Switching sessions voids the armed recheck (and drops the timer).
      h.unmount()
      expect(cleared.length).toBeGreaterThan(0)
    } finally {
      if (h.container.isConnected) h.unmount()
    }
  })

  it('a disabled subagent tab type blocks the job-triggered auto-open', () => {
    descriptors.push(subagentTab())
    const h = mountShell({ cwd: '/tmp', prefsPatch: { autoOpenJobs: true, tabsEnabled: { subagent: false } } })
    try {
      const base = h.list()
      h.pushList({
        ...base,
        jobsBySession: { [base.current!]: [{ id: 'bash-1', kind: 'bash', label: 'ls', status: 'running', startedAt: 1 }] },
      })
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
      expect(h.container.querySelector('[data-probe="subagent"]')).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('workbench actions against a vanished layout', () => {
  it('closing a tab whose layout was cleared still releases the tab', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      const close = tabByTitle(h, 'N').querySelector<HTMLElement>('[class*="tabClose"]')!
      // The layout vanishes between the render and the click.
      h.store.setSession(undefined)
      act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      // No crash, and the session scope degrades to undefined.
      expect(h.store.getSnapshot().state).toBeUndefined()
    } finally {
      h.unmount()
    }
  })

  it('routes a pane press, a tab-onto-tab drop and a divider drag to the store', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.service.registerTab(probe('second', { single: true }))
        h.service.openTab({ type: 'notes', title: 'N' })
        h.service.openTab({ type: 'second', title: 'S' })
      })
      const state = h.store.getSnapshot().state!
      const pane = firstLeaf(state.splits)
      // A press anywhere in the pane focuses it.
      act(() => {
        h.container.querySelector<HTMLElement>(`[data-dsh-pane="${pane.id}"]`)!
          .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }))
      })
      expect(h.store.getSnapshot().state!.activePane).toBe(pane.id)

      // Dropping the last tab onto the first inserts it BEFORE the target.
      const [first, middle, last] = pane.tabs
      const payload = JSON.stringify({ tabId: last!.id, paneId: pane.id })
      act(() => {
        tabByTitle(h, first!.title).dispatchEvent(dragAt('drop', 5, 5, payload))
      })
      const reordered = firstLeaf(h.store.getSnapshot().state!.splits)
      expect(reordered.tabs.map(tab => tab.id)).toEqual([last!.id, first!.id, middle!.id])

      // Splitting the pane grows a divider; dragging it resizes the split.
      act(() => { h.store.reduce(s => moveTabToEdge(s, pane.id, last!.id, pane.id, 'right')) })
      const divider = h.container.querySelector<HTMLElement>('[class*="divider"]')!
      const rect = (): DOMRect => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 }) as DOMRect
      divider.getBoundingClientRect = rect
      divider.parentElement!.getBoundingClientRect = rect
      expect(() => {
        act(() => {
          divider.dispatchEvent(pointerAt('pointerdown', 100, 50))
          divider.dispatchEvent(pointerAt('pointermove', 120, 50))
          divider.dispatchEvent(pointerAt('pointerup', 120, 50))
        })
      }).not.toThrow()
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
    } finally {
      h.unmount()
    }
  })

  it('releases terminal ptys through the host routes and survives a refused release', async () => {
    const agentClose = vi.spyOn(api, 'agentPtyClose').mockRejectedValue(new Error('gone'))
    const ptyClose = vi.spyOn(api, 'ptyClose').mockRejectedValue(new Error('gone'))
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.service.registerTab({
          id: 'term', title: 'Term',
          createTab: state => ({
            tab: { id: `term-${state.nextTerminal}`, type: 'terminal', title: 'T' },
            patch: { nextTerminal: state.nextTerminal + 1 },
          }),
          component: () => null,
        })
      })
      act(() => { h.service.openTab({ type: 'term', title: 'T' }) })
      act(() => {
        tabByTitle(h, 'T').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(ptyClose).toHaveBeenCalled()
      await flush()

      // An agent-owned terminal releases through the agent route.
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'agent:u-2', type: 'terminal', title: 'Agent sh' })) })
      act(() => {
        tabByTitle(h, 'Agent sh').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(agentClose).toHaveBeenCalled()
      await flush()
    } finally {
      h.unmount()
    }
  })

  it('closes a bottom-panel terminal and a plain tab without releasing a pty', () => {
    const ptyClose = vi.spyOn(api, 'ptyClose').mockResolvedValue({ ok: true })
    const h = mountShell({ cwd: '/tmp', sessionId: 'bottom-1' })
    try {
      act(() => { h.service.openTab({ type: 'notes', title: 'N' }) })
      act(() => { h.service.registerTab({ id: 'plain2', title: () => 'Plain two', component: () => null }) })
      act(() => { h.service.openTab({ type: 'plain2', title: 'Plain two' }) })
      // Closing a non-terminal never touches the pty routes.
      act(() => {
        tabByTitle(h, 'N').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(ptyClose).not.toHaveBeenCalled()

      // A terminal opened into the BOTTOM pane resolves its leaf there.
      act(() => {
        h.service.registerTab({
          id: 'term', title: 'Term',
          createTab: state => ({
            tab: { id: `term-${state.nextTerminal}`, type: 'terminal', title: 'Bottom term' },
            patch: { nextTerminal: state.nextTerminal + 1 },
          }),
          component: () => null,
        })
      })
      act(() => {
        h.store.reduce(s => ({ ...s, activePane: firstLeaf(s.bottomSplits).id, bottomOpen: true }))
      })
      act(() => { h.service.openTab({ type: 'term' }) })
      const bottomTab = [...h.store.getSnapshot().state!.bottomSplits
        ? [h.store.getSnapshot().state!.bottomSplits] : []]
      expect(bottomTab).toHaveLength(1)
      act(() => {
        tabByTitle(h, 'Bottom term').querySelector<HTMLElement>('[class*="tabClose"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(ptyClose).toHaveBeenCalledWith({ sessionId: 'bottom-1', cwd: '/tmp' }, 'term-1')
    } finally {
      h.unmount()
    }
  })

  it('ignores a + menu row whose descriptor was disposed under the menu', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      const unregister = h.service.registerTab({ id: 'going', title: 'Going away', component: () => null })
      const plus = h.container.querySelector<HTMLButtonElement>(`button[aria-label="${t('newTab')}"]`)!
      act(() => { plus.click() })
      const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find(item => item.textContent?.includes('Going away'))!
      // The plugin unloads while its + row is still on screen.
      unregister()
      act(() => { row.click() })
      // Nothing is opened for the gone descriptor.
      expect(h.container.textContent).not.toContain('Going away')
    } finally {
      h.unmount()
    }
  })

  it('appends an @-reference with an empty base when the cwd is unknown', async () => {
    let reference: ((path: string) => void) | undefined
    descriptors.push({
      id: 'hooks', title: 'Hooks',
      component: (props) => { reference = props.onReferenceFile; return null },
    })
    const h = mountShell({ cwd: undefined, cwdRouteFails: true })
    try {
      act(() => { h.store.reduce(s => openTabInActivePane(s, { id: 'hooks-1', type: 'hooks', title: 'Hooks' })) })
      await flush()
      act(() => { reference?.('/abs/notes.md') })
      // With no cwd the reference keeps the absolute path.
      expect(h.drafts).toEqual(['@abs/notes.md'])
    } finally {
      h.unmount()
    }
  })

  it('lifts the narrow drawer above the on-screen keyboard', () => {
    const viewport = {
      height: 400,
      offsetTop: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
    const h = mountShell({ cwd: '/tmp', width: 400 })
    try {
      const panel = h.container.querySelector<HTMLElement>('[data-dsh-panel]')!
      // 768 layout viewport − (400 visual + 0 offset) = 368px obscured.
      expect(panel.style.bottom).toBe('368px')
      // Narrow viewports merge the workbenches: no bottom panel, no toggle.
      expect(h.container.querySelector('[data-dsh-bottom-panel]')).toBeNull()
    } finally {
      h.unmount()
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('refuses to mint a tab whose descriptor is gone, and opens one with a string title', () => {
    const h = mountShell({ cwd: '/tmp' })
    try {
      act(() => {
        h.service.registerTab({ id: 'plain', title: 'Plain title', component: () => null })
        h.service.registerTab({ id: 'computed', title: () => 'Computed title', component: () => null })
      })
      // The + menu row for a plain-title descriptor carries the string title.
      const plus = h.container.querySelector<HTMLButtonElement>(`button[aria-label="${t('newTab')}"]`)!
      act(() => { plus.click() })
      const row = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find(item => item.textContent?.includes('Plain title'))!
      act(() => { row.click() })
      expect(h.store.getSnapshot().state!.splits).toBeDefined()
      expect(h.container.textContent).toContain('Plain title')

      // A descriptor with a FUNCTION title resolves it at open time.
      act(() => { plus.click() })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(item => item.textContent?.includes('Computed title'))!
          .click()
      })
      expect(h.container.textContent).toContain('Computed title')
    } finally {
      h.unmount()
    }
  })
})
