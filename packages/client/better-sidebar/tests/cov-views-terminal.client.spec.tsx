// @vitest-environment jsdom
/**
 * TerminalView spec: the full mount lifecycle over a fake fetch stream and
 * fake xterm — URL construction for UI-tab and agent terminals, open/close/
 * park/ping frames, the transcript stream and input echo, the link provider
 * (buffer scan + Ctrl/Cmd activation + scheme guard), live font re-apply on
 * prefs changes, the reconnect ladder with its failure limit, the
 * deps-missing banner flow, and the retry affordances.
 *
 * The terminal carries client→host input over the fetch request body and
 * host→client output over the response body, so the harness drives a fake
 * `fetch` whose response body the test pushes to and whose request body the
 * view writes into (captured as the fake's `sent` frames).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { api, type SessionScope } from '../src/client/api.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { TerminalView, TerminalDepsBanner } from '../src/client/TerminalView.tsx'
import { PTY_DEPS_MISSING } from '../src/pty-deps.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// Hoisted module mocks: the real xterm needs a rendering-capable window.
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

/** A fake `fetch` for one terminal duplex request: captures the view's input
 *  frames (the request body), exposes host→client output via `push`/`end`,
 *  and can be built as a non-200 refusal. */
class FakeFetch {
  static instances: FakeFetch[] = []
  readonly url: string
  /** The request options the view passed (carries the streaming-body `duplex`). */
  readonly init: RequestInit
  /** Client→host input frames the view wrote, in order. */
  sent: string[] = []
  ended = false
  disposed = false
  private response: Response
  private outputController: ReadableStreamDefaultController<Uint8Array> | undefined
  readonly promise: Promise<Response>
  constructor(url: string, init: RequestInit, failed: { status: number; body: string } | undefined) {
    this.url = url
    this.init = init
    if (failed !== undefined) {
      this.response = new Response(failed.body, { status: failed.status })
      this.promise = Promise.resolve(this.response)
    } else {
      const output = new ReadableStream<Uint8Array>({
        start: (c) => { this.outputController = c },
        cancel: () => { this.disposed = true },
      })
      this.response = new Response(output, { status: 200 })
      this.promise = Promise.resolve(this.response)
    }
    // Drain the request body (client→host input) into `sent`.
    const body = init.body as ReadableStream<Uint8Array>
    const decoder = new TextDecoder()
    void (async () => {
      try {
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          this.sent.push(decoder.decode(value))
        }
      } catch {
        // A client abort ends the upload normally here.
      } finally {
        this.ended = true
      }
    })()
    FakeFetch.instances.push(this)
  }
  /** Push one host→client output chunk. */
  push(data: string): void {
    this.outputController?.enqueue(new TextEncoder().encode(data))
  }
  /** End the host→client output (a host-side stream close). */
  end(): void {
    this.outputController?.close()
  }
}

/** Install the fake fetch; `failNext` makes the NEXT terminal request a
 *  refusal and `rejectNext` makes it reject (a network failure). */
function installFakeFetch(): {
  instances: () => FakeFetch[]
  failNext: (status: number, body: string) => void
  rejectNext: () => void
} {
  let failNext: { status: number; body: string } | null = null
  let rejectNext = false
  const instances: FakeFetch[] = []
  const impl = (url: string | URL, init: RequestInit): Promise<Response> => {
    if (rejectNext) {
      rejectNext = false
      return Promise.reject(new Error('network down'))
    }
    const failed = failNext
    failNext = null
    const fake = new FakeFetch(String(url), init, failed ?? undefined)
    instances.push(fake)
    return fake.promise
  }
  vi.stubGlobal('fetch', impl)
  return {
    instances: () => instances,
    failNext: (status, body) => { failNext = { status, body } },
    rejectNext: () => { rejectNext = true },
  }
}

/** Flush pending microtasks so the fake's async input drain and the view's
 *  response reader both advance before an assertion. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

const fakeFetch = { current: installFakeFetch() }

beforeEach(() => {
  FakeTerminal.instances = []
  FakeFetch.instances = []
  fakeFetch.current = installFakeFetch()
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
  lastFetch: () => FakeFetch
  lastTerm: () => FakeTerminal
  store: ReturnType<typeof createSidebarStore>
  service: ReturnType<typeof createBetterSidebarService>
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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  })
  act(() => { root.render(createElement(TerminalView, { scope, tabId, store })) })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
    lastFetch: () => FakeFetch.instances.at(-1)!,
    lastTerm: () => FakeTerminal.instances.at(-1)!,
    store,
    service,
  }
}

describe('TerminalView connection lifecycle', () => {
  it('builds the UI-tab URL, opens the terminal, and streams both directions', async () => {
    const { container, unmount, lastFetch, lastTerm } = mountTerminal('terminal:1')
    const fake = lastFetch()
    expect(fake.url).toBe('http://localhost:3000/sidebar/ws/terminal?sessionId=s1&tab=terminal%3A1&cwd=%2Fws')
    // A streaming request body requires `duplex`; Chromium refuses the request
    // outright without it, so the terminal must declare it on every transport.
    expect((fake.init as { duplex?: string }).duplex).toBe('half')
    await flush()
    expect(container.textContent).not.toContain('disconnected')
    // Resize announced once after a real host size.
    expect(fake.sent).toContain(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }))
    // Server output writes into the terminal; user input echoes back.
    fake.push('hello\n')
    await flush()
    expect(lastTerm().written).toEqual(['hello\n'])
    lastTerm().emitData('ls\n')
    await flush()
    expect(fake.sent).toContain('ls\n')
    unmount()
    // Same-session unmount: bare drop, no control frame.
    expect(fake.sent.filter(frame => frame.includes('close') || frame.includes('park'))).toEqual([])
    expect(lastTerm().disposed).toBe(1)
  })

  it('an agent terminal attaches by uuid and drops bare (no park, no close)', async () => {
    const { unmount, lastFetch } = mountTerminal('agent:abc-uuid-42', undefined)
    expect(lastFetch().url).toBe('http://localhost:3000/sidebar/ws/terminal?uuid=abc-uuid-42')
    const fake = lastFetch()
    await flush()
    unmount()
    // Agent terminals never send park or close (their lifetime is agent-owned).
    expect(fake.sent.some(frame => frame.includes('"close"') || frame.includes('"park"'))).toBe(false)
  })

  it('a tab closed before unmount sends the close frame', async () => {
    const { unmount, lastFetch, service } = mountTerminal('terminal:1')
    const fake = lastFetch()
    await flush()
    // Close the tab so the unmount reads it as a closed terminal.
    act(() => { service.closeTab('terminal:1', { sessionId: 's1', cwd: '/ws' }) })
    unmount()
    await flush()
    expect(fake.sent.some(frame => frame.includes('"close"'))).toBe(true)
  })

  it('a session switch with the tab still open sends the park frame', async () => {
    const { unmount, lastFetch, store } = mountTerminal('terminal:1')
    const fake = lastFetch()
    await flush()
    act(() => { store.setSession('s2') })
    unmount()
    await flush()
    expect(fake.sent.some(frame => frame.includes('"park"'))).toBe(true)
    expect(fake.sent.some(frame => frame.includes('"close"'))).toBe(false)
  })
})

describe('TerminalView link provider', () => {
  it('scans the requested buffer line and activates only modified http(s) clicks', () => {
    const { unmount, lastTerm } = mountTerminal('terminal:1')
    const term = lastTerm()
    expect(term.linkProvider).toBeDefined()
    const callback = vi.fn()
    term.linkProvider!.provideLinks(1, callback)
    const links = callback.mock.calls[0]![0] as Array<{
      text: string
      range: { start: { x: number; y: number }; end: { x: number; y: number } }
      activate: (event: { ctrlKey: boolean }) => void
    }>
    expect(links).toHaveLength(1)
    expect(links[0]!.text).toBe('https://example.com')
    expect(links[0]!.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 23, y: 1 } })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    links[0]!.activate({ ctrlKey: false })
    expect(openSpy).not.toHaveBeenCalled()
    links[0]!.activate({ ctrlKey: true })
    expect(openSpy).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer')
    term.buffer.active.getLine = () => ({ translateToString: () => 'plain text' })
    term.linkProvider!.provideLinks(1, callback)
    expect(callback.mock.calls[1]![0]).toBeUndefined()
    term.linkProvider!.provideLinks(9, callback)
    expect(callback.mock.calls[2]![0]).toBeUndefined()
    unmount()
  })
})

describe('TerminalView close handling', () => {
  it('an unreasoned drop retries, then surfaces the failure after three attempts', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Every connect's fetch rejects (host down), so failures accumulate
    // across the reconnect ladder instead of being reset by a 200 hand-up.
    fakeFetch.current.rejectNext()
    const { container, unmount } = mountTerminal('terminal:1')
    await flush()
    expect(container.textContent).toContain('disconnected')
    act(() => { fakeFetch.current.rejectNext() })
    act(() => { vi.advanceTimersByTime(2000) })
    await flush()
    act(() => { fakeFetch.current.rejectNext() })
    act(() => { vi.advanceTimersByTime(2000) })
    await flush()
    expect(container.textContent).toContain('(3)')
    expect(errorSpy).toHaveBeenCalled()
    unmount()
  })

  it('a server refusal (4xx + body) stops the ladder and offers retry', async () => {
    fakeFetch.current.failNext(404, 'spawn refused')
    const { container, unmount } = mountTerminal('terminal:1')
    await flush()
    expect(container.textContent).toContain('spawn refused')
    // The retry button reconnects through the stored connector.
    const retry = [...container.querySelectorAll('button')].at(-1)!
    act(() => { retry.click() })
    await flush()
    expect(FakeFetch.instances.length).toBe(2)
    unmount()
  })

  it('the deps-missing refusal fetches the repair details and renders the banner', async () => {
    const deps = vi.spyOn(api, 'terminalDeps').mockResolvedValue({
      ok: false, cause: 'binding gone', command: 'npm rebuild', profile: 'web', note: 'or brew',
    })
    fakeFetch.current.failNext(503, JSON.stringify({ error: { code: PTY_DEPS_MISSING } }))
    const { container, unmount } = mountTerminal('terminal:1')
    await flush()
    expect(container.textContent).toContain('npm rebuild')
    expect(container.textContent).toContain('or brew')
    expect(deps).toHaveBeenCalled()
    unmount()
  })

  it('a recovered host between refusal and fetch falls back to the plain banner; a failed fetch too', async () => {
    vi.spyOn(api, 'terminalDeps').mockResolvedValue({ ok: true })
    fakeFetch.current.failNext(503, JSON.stringify({ error: { code: PTY_DEPS_MISSING } }))
    const { container, unmount } = mountTerminal('terminal:1')
    await flush()
    expect(container.textContent).toContain('node-pty failed to load')
    unmount()

    vi.spyOn(api, 'terminalDeps').mockRejectedValue(new Error('route down'))
    fakeFetch.current.failNext(503, JSON.stringify({ error: { code: PTY_DEPS_MISSING } }))
    const second = mountTerminal('terminal:1')
    await flush()
    expect(second.container.textContent).toContain('node-pty failed to load')
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
  it('a prefs change re-resolves the font and announces the resize', async () => {
    const { unmount, lastFetch, lastTerm, store } = mountTerminal('terminal:1')
    const fake = lastFetch()
    await flush()
    const before = lastTerm().options.fontSize
    act(() => {
      store.setPrefs({ ...store.getPrefs(), terminalFontSize: 40 })
    })
    expect(lastTerm().options.fontSize).not.toBe(before)
    expect(lastTerm().options.fontSize).toBe(32)
    // The resize is re-announced after the refit.
    await flush()
    expect(fake.sent.filter(frame => frame.includes('resize')).length).toBeGreaterThanOrEqual(2)
    unmount()
  })
})
