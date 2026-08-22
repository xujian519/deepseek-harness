// @vitest-environment jsdom
// @vitest-environment-options {"url": "http://127.0.0.1:3080/"}
/**
 * Browser-half smoke: the switch and overlay DOM, view toggling, the
 * session-activation bridge, and effect disposal.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

// jsdom iframes ship a null-origin contentWindow whose postMessage rejects the
// 'null' target; point the iframe at the parent window so the bridge sends are
// observable and never throw in the fake environment.
Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
  configurable: true,
  get() { return window },
})

interface SessionListFace {
  getSnapshot(): {
    ids: string[]
    byId: Record<string, { displayTitle: string; cwd?: string; blank: boolean }>
    current: string | undefined
  }
  subscribe(listener: () => void): () => void
}

interface SessionSubscriber {
  subscribe(listener: () => void): () => void
  getSnapshot(): { running: boolean; partial: { blocks: { kind: 'text'; text: string }[] } | null }
}

interface FakeRuntime {
  sessions: {
    list: SessionListFace
    open: (id: string) => void
    scope(id: string): unknown
    sessionOf(scope: unknown): SessionSubscriber | undefined
    fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  }
  workspaces: {
    list: { getSnapshot(): { items: never[]; archivedSessionIds: never[] }; subscribe(listener: () => void): () => void }
    startSession: (workspaceId?: string) => void
    create(input: { path: string }): Promise<{ workspaceId: string }>
  }
  effects: Array<() => void>
}

function makeRuntime(): FakeRuntime {
  const effects: Array<() => void> = []
  const sessions = {
    list: {
      getSnapshot: () => ({ ids: [], byId: {}, current: undefined }),
      subscribe: () => () => {},
    },
    open: vi.fn(),
    scope: () => undefined,
    sessionOf: () => undefined,
    fork: vi.fn(async () => 'child-1'),
  }
  const workspaces = {
    list: {
      getSnapshot: () => ({ items: [], archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
    startSession: vi.fn(),
    create: vi.fn(async () => ({ workspaceId: 'w-new' })),
  }
  return { sessions, workspaces, effects }
}

function boot(): { runtime: FakeRuntime; dispose: () => void } {
  const runtime = makeRuntime()
  const ctx = {
    sessions: runtime.sessions,
    workspaces: runtime.workspaces,
    effect: (body: () => unknown) => {
      const result = body()
      if (typeof result === 'function') runtime.effects.push(result as () => void)
    },
  }
  apply(ctx as never)
  return { runtime, dispose: () => { for (const effect of runtime.effects) effect() } }
}

describe('synapse browser half', () => {
  it('injects the view switch with a hidden map overlay and an /synapse/ iframe', () => {
    const { dispose } = boot()
    const host = document.querySelector('.dsh-synapse-host')
    expect(host).not.toBeNull()
    const buttons = host?.querySelectorAll('.dsh-synapse-switch button')
    expect(buttons?.length).toBe(2)
    const overlay = host?.querySelector('.dsh-synapse-overlay') as HTMLElement
    expect(overlay.hidden).toBe(true)
    const frame = host?.querySelector('iframe') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/synapse/')
    dispose()
  })

  it('toggles the map on switch clicks and closes with Escape', () => {
    const { dispose } = boot()
    const host = document.querySelector('.dsh-synapse-host') as HTMLElement
    const buttons = host.querySelectorAll('.dsh-synapse-switch button')
    const overlay = host.querySelector('.dsh-synapse-overlay') as HTMLElement
    ;(buttons[1] as HTMLButtonElement).click()
    expect(overlay.hidden).toBe(false)
    expect((buttons[1] as HTMLButtonElement).classList.contains('active')).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(overlay.hidden).toBe(true)
    dispose()
  })

  it('forwards session activation to the client sessions service', async () => {
    const { runtime, dispose } = boot()
    const bridge = (type: string, payload: Record<string, unknown>): void => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { source: 'dsh-synapse', type, ...payload },
      }))
    }
    bridge('synapse:activate-session', { sessionId: 's-1' })
    bridge('synapse:open-session', { sessionId: 's-2' })
    expect(runtime.sessions.open).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('removes every injected node when the plugin fiber is disposed', () => {
    const { dispose } = boot()
    dispose()
    expect(document.querySelector('.dsh-synapse-host')).toBeNull()
    expect(document.querySelector('.dsh-synapse-switch')).toBeNull()
  })

  it('handles create-session through the workspace startSession flow', async () => {
    const { runtime, dispose } = boot()
    // A current change after startSession drives the resolved id.
    let current: string | undefined = undefined
    const listeners: Array<() => void> = []
    const sessions = runtime.sessions as { list: SessionListFace }
    sessions.list.getSnapshot = () => ({
      ids: current === undefined ? [] : [current],
      byId: current === undefined ? {} : { [current]: { displayTitle: '新会话', blank: false } },
      current,
    })
    sessions.list.subscribe = (listener) => { listeners.push(listener); return () => {} }
    (runtime.workspaces.startSession as ReturnType<typeof vi.fn>).mockImplementation(() => {
      current = 's-new'
      for (const listener of listeners) listener()
    })
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { source: 'dsh-synapse', type: 'synapse:create-session', requestId: 'r-1', workspaceId: 'dsh-ungrouped' },
    }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(runtime.workspaces.startSession).toHaveBeenCalled()
    dispose()
  })
})
