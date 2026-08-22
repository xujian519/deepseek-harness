/**
 * Plugin apply contract: route registration, the /synapse/api handlers over a
 * real WorkspaceStore, the Host check, and live-session projection wiring.
 */
import { describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { apply } from '../src/index.ts'
import { WorkspaceStore } from '../src/store.ts'

function tempFile(): string {
  return join(tmpdir(), `dsh-synapse-apply-${Math.random().toString(36).slice(2)}`)
}

function makeRequest(method: string, url: string, body?: unknown, host = '127.0.0.1'): IncomingMessage {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return {
    method,
    url,
    headers: { host },
    [Symbol.asyncIterator]: async function* () {
      if (payload !== undefined) yield payload
    },
  } as unknown as IncomingMessage
}

function makeResponse(): { res: ServerResponse; status: () => number; json: () => unknown; raw: () => string } {
  let status = 0
  let raw = ''
  return {
    res: {
      writeHead: (code: number) => { status = code },
      end: (body?: string) => { raw = body ?? '' },
    } as unknown as ServerResponse,
    status: () => status,
    json: () => JSON.parse(raw) as unknown,
    raw: () => raw,
  }
}

function sessionStub(id: string, events: unknown[], header: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, header: { version: 0, id, createdAt: 0, ...header }, firstLiveSeq: 0, events, seq: events.length }
}

function boot(
  config: Record<string, unknown>,
  sessions: Record<string, unknown>[],
  persistence: { listSnapshots: () => Promise<unknown[]>; inspect: (id: string) => Promise<unknown> } = { listSnapshots: async () => [], inspect: async () => ({ meta: { id: '' }, events: [] }) },
): { ctx: Context; routes: WebRoute[] } {
  const ctx = new Context()
  const routes: WebRoute[] = []
  ctx.provide('webServer', {
    register: (route: WebRoute) => { routes.push(route); return () => {} },
    host: '127.0.0.1',
    port: 3080,
  } as never)
  ctx.provide('sessions', { list: () => sessions } as never)
  ctx.provide('sessionPersistence', persistence as never)
  apply(ctx, { dataFile: tempFile(), autoProjection: true, projectionWorkspaceTitle: 'DSH 任务', trustedHosts: [], ...config })
  return { ctx, routes }
}

const route = (routes: WebRoute[], kind: string, path: string): WebRoute => {
  const found = routes.find(item => item.kind === kind && item.path === path)
  if (found === undefined) throw new Error(`route ${kind} ${path} not registered`)
  return found
}

describe('host apply', () => {
  it('registers the canvas routes and API prefix', () => {
    const { routes } = boot({}, [])
    expect(routes.map(r => `${r.kind}:${r.path}`).sort()).toEqual([
      'exact:/synapse',
      'exact:/synapse/',
      'exact:/synapse/app.js',
      'exact:/synapse/deepseek-mark.svg',
      'exact:/synapse/styles.css',
      'prefix:/synapse/api',
    ])
  })

  it('serves the map page and rejects untrusted Host headers', async () => {
    const { routes } = boot({}, [])
    const page = route(routes, 'exact', '/synapse/')
    const pageOut = makeResponse()
    await page.handler(makeRequest('GET', '/synapse/'), pageOut.res)
    expect(pageOut.status()).toBe(200)
    expect(pageOut.raw()).toContain('Synapse for DSH')

    const api = route(routes, 'prefix', '/synapse/api')
    const forbidden = makeResponse()
    await api.handler(makeRequest('GET', '/synapse/api/workspaces', undefined, 'evil.example'), forbidden.res)
    expect(forbidden.status()).toBe(403)
  })

  it('creates and lists workspaces and projects synced session rows', async () => {
    const { routes } = boot({}, [])
    const api = route(routes, 'prefix', '/synapse/api')
    const created = makeResponse()
    await api.handler(makeRequest('POST', '/synapse/api/workspaces', { title: '专利调研' }), created.res)
    expect(created.status()).toBe(201)
    const workspaceId = (created.json() as { workspace: { id: string } }).workspace.id

    const excluded = makeResponse()
    await api.handler(makeRequest('GET', '/synapse/api/workspaces/not-a-uuid'), excluded.res)
    expect(excluded.status()).toBe(404)

    const synced = makeResponse()
    await api.handler(makeRequest('POST', '/synapse/api/sessions/sync', {
      sessions: [
        { id: 's1', cwd: '/tmp/alpha', title: '会话一' },
        { id: 's1-branch', cwd: '/tmp/alpha', title: '分支一', parentId: 's1' },
      ],
      removedSessionIds: [],
    }), synced.res)
    expect(synced.status()).toBe(200)
    const projections = (synced.json() as { workspaces: { kind: string; threadCount: number }[] }).workspaces
    expect(projections.find(w => w.kind === 'dsh')?.threadCount).toBe(2)

    const manual = makeResponse()
    await api.handler(makeRequest('GET', `/synapse/api/workspaces/${workspaceId}`), manual.res)
    expect(manual.status()).toBe(200)
    const graph = manual.json() as { workspace: { threads: unknown[] } }
    expect(graph.workspace.threads).toHaveLength(0)
  })

  it('projects committed live sessions and replays existing ones on apply', async () => {
    const live = sessionStub('s-live', [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '看看目录' }] } },
    ])
    const { ctx, routes } = boot({}, [live])
    const api = route(routes, 'prefix', '/synapse/api')
    await new Promise(resolve => setTimeout(resolve, 20))
    const list = makeResponse()
    await api.handler(makeRequest('GET', '/synapse/api/workspaces'), list.res)
    const workspaces = (list.json() as { workspaces: { kind: string; threadCount: number }[] }).workspaces
    expect(workspaces.find(w => w.kind === 'dsh')?.threadCount).toBe(1)

    const later = sessionStub('s-live', [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '看看目录' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回话' }] } } },
    ])
    ctx.emit('session/event', later as never, { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回话' }] } } } as never)
    await new Promise(resolve => setTimeout(resolve, 20))
    const detail = makeResponse()
    const ws = workspaces.find(w => w.kind === 'dsh') as { kind: string; threadCount: number; id: string } | undefined
    await api.handler(makeRequest('GET', `/synapse/api/workspaces/${ws?.id ?? ''}`), detail.res)
    const messages = (detail.json() as { workspace: { threads: { messages: unknown[] }[] } }).workspace.threads[0]?.messages ?? []
    expect(messages.some(m => (m as { kind: string }).kind === 'assistant')).toBe(true)
    expect(WorkspaceStore).toBeDefined()
  })

  it('replays cold persisted sessions from the persistence baseline on apply', async () => {
    const events = [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '持久化的问题' }], source: { kind: 'user' } } },
      { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '<system-reminder> workspace instructions' }], source: { kind: 'agent-instructions' } } },
    ]
    const persistence = {
      listSnapshots: async () => [{ header: { id: 's-cold', cwd: '/tmp/cold', parentSession: undefined, seedLength: undefined }, revision: 'r1' }],
      inspect: async () => ({ meta: { id: 's-cold', cwd: '/tmp/cold' }, events }),
    }
    const { routes } = boot({}, [], persistence)
    const api = route(routes, 'prefix', '/synapse/api')
    await new Promise(resolve => setTimeout(resolve, 20))
    const list = makeResponse()
    await api.handler(makeRequest('GET', '/synapse/api/workspaces'), list.res)
    const summaries = (list.json() as { workspaces: { kind: string; threadCount: number }[] }).workspaces
    const ws = summaries.find(w => w.kind === 'dsh') as { id: string } | undefined
    expect(ws).toBeDefined()
    const detail = makeResponse()
    await api.handler(makeRequest('GET', '/synapse/api/workspaces/' + (ws?.id ?? '')), detail.res)
    const messages = (detail.json() as { workspace: { threads: { messages: { kind: string }[] }[] } }).workspace.threads[0]?.messages ?? []
    // Human question only: the injected workspace instructions dropped.
    expect(messages.map(m => m.kind)).toEqual(['user'])
  })
})
