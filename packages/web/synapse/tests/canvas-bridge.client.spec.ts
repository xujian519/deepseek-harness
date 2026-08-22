// @vitest-environment jsdom
/**
 * Canvas-half bridge regression: the host iframe's post/dshRpc/settleRpc RPC
 * primitives and the window message listener that routes host -> canvas events.
 * The map ships as a committed static asset (assets/app.js), so this jsdom
 * integration is its contract test; snapshot gates keep excluding the canvas UI.
 *
 * The whole script is evaluated into the jsdom window so the real DOM carries
 * the listeners; re-stubbing the DOM into a node vm context would be brittle.
 * window.parent is pointed at a stub before eval so post()/dshRpc() take the
 * bridge path instead of the same-window no-op guard.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

interface BridgeState {
  dshWorkspaces: Array<{ id: string }>
  currentDsh: { id: string } | null
  selectedDshWorkspaceId: string | null
  liveReplies: Map<string, { running: boolean; text: string }>
  workspace: { id: string; title: string; threads: unknown[] } | null
  mode: string
  draft: unknown
  dragging: boolean
  canvasGesture: boolean
  canvasRefreshAfter: number
  error: string
  summaries: unknown[]
  pendingRpc: Map<string, unknown>
  activeId: string | null
  historyBySession: Map<string, Array<{ at: string; id: string; kind: string; sourceSeq: number; text: string }>>
  historyHasMore: Map<string, boolean>
}

interface BridgeExports {
  post(type: string, payload?: Record<string, unknown>): void
  dshRpc(type: string, payload?: Record<string, unknown>): Promise<unknown>
  settleRpc(requestId: string, value?: unknown, error?: unknown): void
  renderThread(): string
  // The asset is an untyped static script whose runtime state is foreign, so
  // only the fields this test reads or writes are declared here.
  state: BridgeState
}

let bridge: BridgeExports
let posted: Array<{ message: Record<string, unknown>; origin: string }> = []

const parentStub = {
  postMessage(message: Record<string, unknown>, origin: string): void {
    posted.push({ message, origin })
  },
}

const fakeFetch = async (): Promise<{ ok: true; status: number; json: () => Promise<{ workspaces: [] }> }> => ({
  ok: true,
  status: 200,
  json: async () => ({ workspaces: [] }),
})

function lastPost(): { message: Record<string, unknown>; origin: string } {
  const entry = posted[posted.length - 1]
  if (entry === undefined) throw new Error('expected a captured postMessage')
  return entry
}

function resetBridgeState(): void {
  posted = []
  bridge.state.dshWorkspaces = []
  bridge.state.currentDsh = null
  bridge.state.selectedDshWorkspaceId = null
  bridge.state.liveReplies = new Map()
  bridge.state.workspace = null
  bridge.state.mode = 'canvas'
  bridge.state.draft = null
  bridge.state.dragging = false
  bridge.state.canvasGesture = false
  bridge.state.canvasRefreshAfter = 0
  bridge.state.error = ''
  bridge.state.summaries = []
}

function dispatch(type: string, payload: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', {
    origin: window.location.origin,
    data: { source: 'dsh-synapse', type, ...payload },
  }))
}

beforeAll(async () => {
  // In the jsdom environment import.meta.url resolves against the jsdom
  // document origin, so the asset is reached through a cwd-relative path like
  // the other jsdom bundle specs (vitest runs from the workspace root).
  const source = await readFile(path.resolve('packages/web/synapse/assets/app.js'), 'utf8')

  // jsdom ships a top window whose parent === window (post() would no-op) and
  // no requestAnimationFrame/fetch; make the bridge observable and kill the
  // background projection poll so it never renders during a test.
  Object.defineProperty(window, 'parent', { configurable: true, value: parentStub })
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: () => 0 })
  Object.defineProperty(window, 'setInterval', { configurable: true, value: () => 0 })
  Object.defineProperty(window, 'clearInterval', { configurable: true, value: () => {} })
  globalThis.fetch = fakeFetch as unknown as typeof fetch
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: (() => { let i = 0; return () => `r-${++i}` })(),
    })
  }

  const app = document.createElement('div')
  app.id = 'app'
  document.body.appendChild(app)

  window.eval(`${source}\n;globalThis.__synapse = { post, dshRpc, settleRpc, state, renderThread }`)
  bridge = (globalThis as unknown as { __synapse: BridgeExports }).__synapse
})

afterEach(() => {
  // Release any dshRpc timers a failed assertion left behind.
  for (const requestId of [...bridge.state.pendingRpc.keys()]) bridge.settleRpc(requestId, undefined)
  bridge.state.pendingRpc.clear()
})

describe('assets/app.js canvas bridge', () => {
  it('posts the bridge envelope with source, type, and a generated requestId', async () => {
    resetBridgeState()
    const pending = bridge.dshRpc('synapse:send-message', { sessionId: 's-1', text: '你好' })
    expect(posted).toHaveLength(1)
    const { message, origin } = lastPost()
    expect(origin).toBe(window.location.origin)
    expect(message.source).toBe('dsh-synapse')
    expect(message.type).toBe('synapse:send-message')
    expect(typeof message.requestId).toBe('string')
    expect(message.requestId).not.toBe('')
    expect(message.sessionId).toBe('s-1')
    expect(message.text).toBe('你好')
    dispatch('synapse:message-sent', { requestId: message.requestId, session: { sessionId: 's-1' } })
    await pending
  })

  it('settles an RPC promise from a forked-session message', async () => {
    resetBridgeState()
    const pending = bridge.dshRpc('synapse:create-branch', { sessionId: 's-1', atSeq: 3 })
    const { message } = lastPost()
    dispatch('synapse:forked-session', {
      requestId: message.requestId,
      session: { sessionId: 'child-1', parentId: 's-1' },
    })
    await expect(pending).resolves.toEqual({ sessionId: 'child-1', parentId: 's-1' })
  })

  it('rejects an RPC promise from a bridge-error message', async () => {
    resetBridgeState()
    const pending = bridge.dshRpc('synapse:create-session', { workspaceId: 'dsh-ungrouped' })
    const { message } = lastPost()
    dispatch('synapse:bridge-error', { requestId: message.requestId, message: 'DSH 已关闭' })
    await expect(pending).rejects.toThrow('DSH 已关闭')
  })

  it('routes workspaces and current-session into state', async () => {
    resetBridgeState()
    dispatch('synapse:workspaces', { workspaces: [
      { id: 'w1', title: '工作区一', sessionIds: ['s-1'] },
      { id: 'w2', title: '工作区二', sessionIds: ['s-2'] },
    ] })
    expect(bridge.state.dshWorkspaces.map((workspace: { id: string }) => workspace.id)).toEqual(['w1', 'w2'])
    dispatch('synapse:current-session', { session: { id: 's-1' } })
    expect(bridge.state.currentDsh).toEqual({ id: 's-1' })
  })

  it('routes a live-reply into state.liveReplies keyed by session', () => {
    resetBridgeState()
    bridge.state.workspace = {
      id: 'dsh:w1',
      title: '工作区一',
      threads: [{ id: 't1', dshSessionId: 's-1', title: 'T', messages: [] }],
    }
    dispatch('synapse:live-reply', { sessionId: 's-1', running: true, text: '正在回复' })
    expect(bridge.state.liveReplies.get('s-1')).toEqual({ running: true, text: '正在回复' })
  })

  it('renders a load-earlier button in the detail view only when more history exists', () => {
    resetBridgeState()
    bridge.state.workspace = {
      id: 'dsh:w1',
      title: '工作区一',
      threads: [{ id: 't1', dshSessionId: 's-1', title: 'T', messages: [{ kind: 'user', text: '提问', sourceSeq: 1 }] }],
    }
    bridge.state.activeId = 't1'
    bridge.state.mode = 'thread'
    bridge.state.historyBySession.set('s-1', [{ kind: 'user', text: '提问', sourceSeq: 1, at: new Date().toISOString(), id: 'h1' }])
    bridge.state.historyHasMore.set('s-1', true)
    expect(bridge.renderThread()).toContain('load-earlier')
    bridge.state.historyHasMore.set('s-1', false)
    expect(bridge.renderThread()).not.toContain('load-earlier')
  })
})
