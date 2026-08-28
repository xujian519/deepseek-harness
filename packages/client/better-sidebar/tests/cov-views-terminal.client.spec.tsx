// @vitest-environment jsdom
/**
 * TerminalView spec: the full mount lifecycle over a fake WebSocket and
 * fake xterm — URL construction for UI-tab and agent terminals, open/close/
 * park/ping frames, the transcript stream and input echo, the link provider
 * (buffer scan + Ctrl/Cmd activation + scheme guard), live font re-apply on
 * prefs changes, the reconnect ladder with its failure limit, the
 * deps-missing banner flow, and the retry affordances.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { api, type SessionScope } from '../src/client/api.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { TerminalView, TerminalDepsBanner } from '../src/client/TerminalView.tsx'


;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// Hoisted module mocks: the real xterm needs a rendering-capable window.
// The factories dereference the classes lazily (vi.mock is hoisted above
// the declarations, but the factory only runs at import time).
vi.mock('@xterm/xterm', () => ({ get Terminal() { return FakeTerminal } }))
vi.mock('@xterm/addon-fit', () => ({ get FitAddon() { return FakeFitAddon } }))

/** The xterm Terminal stand-in: records options, handlers and writes. */
class FakeTerminal {
  static instances: FakeTerminal[] = []
  options: Record<string, unknown>
  cols = 80
  rows = 24
  written: string[] = []
  disposed = 0
  private dataHandler: ((data: string) => void) | undefined
  linkProvider: { provideLinks: (line: number, cb: (links: unknown) => void) => void; dispose: () => void } | undefined
  buffer = {
    active: {
      getLine: (n: number) => n === 0
        ? { translateToString: () => 'see https://example.com now' }
        : undefined,
    },
  }
  constructor(options: Record<string, unknown>) {
    this.options = { ...options }
    FakeTerminal.instances.push(this)
  }
  loadAddon(): void {}
  registerLinkProvider(provider: {
    provideLinks: (line: number, cb: (links: unknown) => void) => void
    dispose: () => void
  }): { dispose: () => void } {
    this.linkProvider = provider
    return { dispose: () => { this.linkProvider = undefined } }
  }
  onData(handler: (data: string) => void): { dispose: () => void } {
    this.dataHandler = handler
    return { dispose: () => { this.dataHandler = undefined } }
  }
  emitData(data: string): void { this.dataHandler?.(data) }
  open(): void {}
  refresh(): void {}
  write(data: string): void { this.written.push(data) }
  dispose(): void { this.disposed += 1 }
}

class FakeFitAddon {
  fit = vi.fn()
}

class FakeWebSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeWebSocket[] = []
  url: string
  readyState = 0
  sent: string[] = []
  closed = 0
  onopen: (() => void) | undefined
  onclose: ((event: { code: number; reason: string }) => void) | undefined
  onmessage: ((event: { data: unknown }) => void) | undefined
  onerror: (() => void) | undefined
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  send(data: string): void { this.sent.push(data) }
  close(): void { this.closed += 1; this.readyState = 3 }
  /** Test helper: complete the handshake. */
  connect(): void {
    this.readyState = 1
    this.onopen?.()
  }
}

beforeEach(() => {
  FakeTerminal.instances = []
  FakeWebSocket.instances = []
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

/** Mount the view with fakes installed; returns the harness handles. */
function mountTerminal(tabId: string, cwd: string | undefined = '/ws'): {
  container: HTMLDivElement
  unmount: () => void
  lastSocket: () => FakeWebSocket
  lastTerm: () => FakeTerminal
  store: ReturnType<typeof createSidebarStore>
} {
  const store = createSidebarStore()
  store.setSession('s1')
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'terminal', title: 'Terminal', single: true, component: () => null })
  if (!tabId.startsWith('agent:')) {
    service.openTab({ type: 'terminal', title: 'T', id: tabId }, { sessionId: 's1' })
  }
  const scope: SessionScope = { sessionId: 's1', cwd }
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  // A real host size + immediate rAF: the deferred open fires on mount.
  // jsdom reports every box as 0x0, so the size probe is overridden too —
  // otherwise openWhenSized would poll (or, with a synchronous rAF, recurse).
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  })
  vi.stubGlobal('WebSocket', FakeWebSocket)
  act(() => { root.render(createElement(TerminalView, { scope, tabId, store })) })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
    lastSocket: () => FakeWebSocket.instances.at(-1)!,
    lastTerm: () => FakeTerminal.instances.at(-1)!,
    store,
  }
}

describe('TerminalView connection lifecycle', () => {
  it('builds the UI-tab URL, opens the terminal, and streams both directions', () => {
    const { container, unmount, lastSocket, lastTerm } = mountTerminal('terminal:1')
    const socket = lastSocket()
    expect(socket.url).toBe('ws://localhost:3000/sidebar/ws/terminal?sessionId=s1&tab=terminal%3A1&cwd=%2Fws')
    socket.connect()
    expect(container.textContent).not.toContain('disconnected')
    // The deferred open ran (host reports a size): resize announced once.
    expect(socket.sent).toContain(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))
    // Server output writes into the terminal; user input echoes back.
    act(() => { socket.onmessage?.({ data: 'hello\n' }) })
    expect(lastTerm().written).toEqual(['hello\n'])
    act(() => { lastTerm().emitData('ls\n') })
    expect(socket.sent).toContain('ls\n')
    // Non-string frames are ignored.
    act(() => { socket.onmessage?.({ data: new ArrayBuffer(2) }) })
    expect(lastTerm().written).toHaveLength(1)
    unmount()
    // Same-session unmount: bare drop, no control frame.
    expect(socket.sent.filter(frame => frame.includes('close') || frame.includes('park'))).toEqual([])
    expect(lastTerm().disposed).toBe(1)
  })

  it('an agent terminal attaches by uuid and drops bare (no park, no close)', () => {
    const { unmount, lastSocket } = mountTerminal('agent:abc-uuid-42', undefined)
    expect(lastSocket().url).toBe('ws://localhost:3000/sidebar/ws/terminal?uuid=abc-uuid-42')
    const socket = lastSocket()
    socket.connect()
    unmount()
    expect(socket.sent).toEqual([])
  })

  it('a tab closed before unmount sends the close frame', () => {
    const { unmount, lastSocket } = mountTerminal('terminal:1')
    const socket = lastSocket()
    socket.connect()
    unmount()
    // The seeded home tab never carries terminal:1, so this tab reads as
    // closed → close frame. (Registered through the service in the mount
    // helper; see the park case for the still-open variant.)
    expect(socket.sent.some(frame => frame.includes('"close"'))).toBe(true)
  })

  it('a session switch with the tab still open sends the park frame', () => {
    const { unmount, lastSocket, store } = mountTerminal('terminal:1')
    const socket = lastSocket()
    socket.connect()
    act(() => { store.setSession('s2') })
    unmount()
    expect(socket.sent.some(frame => frame.includes('"park"'))).toBe(true)
    expect(socket.sent.some(frame => frame.includes('"close"'))).toBe(false)
  })
})

describe('TerminalView link provider', () => {
  it('scans the requested buffer line and activates only modified http(s) clicks', () => {
    const { unmount, lastTerm } = mountTerminal('terminal:1')
    const term = lastTerm()
    expect(term.linkProvider).toBeDefined()
    const callback = vi.fn()
    // Line 1 → buffer index 0 → the URL line.
    term.linkProvider!.provideLinks(1, callback)
    const links = callback.mock.calls[0]![0] as Array<{
      text: string
      range: { start: { x: number; y: number }; end: { x: number; y: number } }
      activate: (event: { ctrlKey: boolean }) => void
    }>
    expect(links).toHaveLength(1)
    expect(links[0]!.text).toBe('https://example.com')
    expect(links[0]!.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 23, y: 1 } })
    // A plain click is inert; Ctrl/Cmd opens; non-http(s) never reaches open.
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    links[0]!.activate({ ctrlKey: false })
    expect(openSpy).not.toHaveBeenCalled()
    links[0]!.activate({ ctrlKey: true })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer')
    // A line without URLs yields no links.
    term.buffer.active.getLine = () => ({ translateToString: () => 'plain text' })
    term.linkProvider!.provideLinks(1, callback)
    expect(callback.mock.calls[1]![0]).toBeUndefined()
    // A line number past the buffer ends the scan.
    term.linkProvider!.provideLinks(9, callback)
    expect(callback.mock.calls[2]![0]).toBeUndefined()
    unmount()
  })
})

describe('TerminalView close handling', () => {
  it('an unreasoned drop retries, then surfaces the close code after three failures', () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container, unmount } = mountTerminal('terminal:1')
    const drop = (code: number, reason = ''): void => {
      const socket = FakeWebSocket.instances.at(-1)!
      socket.onclose?.({ code, reason })
    }
    drop(1006)
    expect(container.textContent).toContain('disconnected')
    vi.advanceTimersByTime(2000)
    drop(1006)
    vi.advanceTimersByTime(2000)
    drop(1006, 'ECONNREFUSED')
    expect(container.textContent).toContain('(1006: ECONNREFUSED)')
    expect(errorSpy).toHaveBeenCalled()
    unmount()
  })

  it('a server refusal (1011 + reason) stops the ladder and offers retry', () => {
    const { container, unmount, lastSocket } = mountTerminal('terminal:1')
    const socket = lastSocket()
    socket.onclose?.({ code: 1011, reason: 'spawn refused' })
    expect(container.textContent).toContain('spawn refused')
    // The retry button reconnects through the stored connector.
    const retry = [...container.querySelectorAll('button')].at(-1)!
    act(() => { retry.click() })
    expect(FakeWebSocket.instances.length).toBe(2)
    unmount()
  })

  it('the deps-missing close fetches the repair details and renders the banner', () => {
    const deps = vi.spyOn(api, 'terminalDeps').mockResolvedValue({
      ok: false, cause: 'binding gone', command: 'npm rebuild', profile: 'web', note: 'or brew',
    })
    const { container, unmount, lastSocket } = mountTerminal('terminal:1')
    const socket = lastSocket()
    act(() => { socket.onclose?.({ code: 1011, reason: 'pty-deps-missing' }) })
    // The banner renders through TerminalDepsBanner (profile + note + copy).
    expect(container.textContent).toContain('npm rebuild')
    expect(container.textContent).toContain('or brew')
    expect(deps).toHaveBeenCalled()
    unmount()
  })

  it('a recovered host between close and fetch falls back to the plain banner; a failed fetch too', async () => {
    vi.spyOn(api, 'terminalDeps').mockResolvedValue({ ok: true })
    const { container, unmount, lastSocket } = mountTerminal('terminal:1')
    act(() => { lastSocket().onclose?.({ code: 1011, reason: 'pty-deps-missing' }) })
    await act(async () => {})
    expect(container.textContent).toContain('terminalDepsFailed')
    unmount()

    vi.spyOn(api, 'terminalDeps').mockRejectedValue(new Error('route down'))
    const second = mountTerminal('terminal:1')
    act(() => { second.lastSocket().onclose?.({ code: 1011, reason: 'pty-deps-missing' }) })
    await act(async () => {})
    expect(second.container.textContent).toContain('terminalDepsFailed')
    second.unmount()
  })
})

describe('TerminalDepsBanner (direct)', () => {
  it('copies the repair command and retries', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const onRetry = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(TerminalDepsBanner, {
        deps: { ok: false, cause: 'x', command: 'npm rebuild', profile: null },
        onRetry,
      }))
    })
    expect(container.textContent).not.toContain('web profile')
    const copy = [...container.querySelectorAll('button')][0]!
    await act(async () => { copy.click() })
    expect(clipboard).toHaveBeenCalledWith('npm rebuild')
    const retry = [...container.querySelectorAll('button')].at(-1)!
    act(() => { retry.click() })
    expect(onRetry).toHaveBeenCalledTimes(1)
    act(() => { root.unmount() })
    container.remove()
  })
})

describe('TerminalView live font re-apply', () => {
  it('a prefs change re-resolves the font and announces the resize', () => {
    const { unmount, lastSocket, lastTerm, store } = mountTerminal('terminal:1')
    const socket = lastSocket()
    socket.connect()
    const before = lastTerm().options.fontSize
    act(() => {
      store.setPrefs({ ...store.getPrefs(), terminalFontSize: 40 })
    })
    expect(lastTerm().options.fontSize).not.toBe(before)
    expect(lastTerm().options.fontSize).toBe(32)
    // The resize is re-announced after the refit.
    expect(socket.sent.filter(frame => frame.includes('resize')).length).toBeGreaterThanOrEqual(2)
    unmount()
  })
})
