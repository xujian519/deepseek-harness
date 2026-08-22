/**
 * Synapse session-map host half, mounted as a `dsh web` row. Registers the
 * `/synapse` canvas page, its static assets, and the `/synapse/api` JSON API
 * on the existing Web Server, and projects committed DSH session events into
 * the canvas graph. Reads only committed session logs; never touches a model
 * request.
 * @module @deepseek-ai/dsh-host-synapse
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Type-only import: activates the webServer Context merge (ctx.webServer) below.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import {
  UNSPECIFIED_CWD,
  sessionIsBlank,
  sessionLiveStart,
  sessionTitle,
} from './projection.ts'
import { WorkspaceStore, InputError, NotFoundError, MAX_TITLE_LENGTH, type SessionRow } from './store.ts'

const MAX_BODY_BYTES = 32 * 1024

/** Plugin configuration, overrideable from the profile patch by row id `synapse`. */
export interface SynapseConfig {
  /** Canvas metadata persistence path. */
  dataFile: string
  /** Project committed DSH session events into canvas cards. */
  autoProjection: boolean
  /** Title of the projection workspace shown for sessions without a cwd. */
  projectionWorkspaceTitle: string
  /** Extra authorities the `/synapse` Host check accepts; loopback is always allowed. */
  trustedHosts: string[]
}

export const Config: z<SynapseConfig> = z.object({
  dataFile: z.string().default(dshHomePath('synapse/workspaces.json')),
  autoProjection: z.boolean().default(true),
  projectionWorkspaceTitle: z.string().default('DSH 任务'),
  trustedHosts: z.array(String).default([]),
})

/** Stable Cordis plugin name (the row id the profile patch targets). */
export const name = 'synapse'

/** Required services: the existing Web Server, the live SessionStore, and
 * the durable session persistence the canvas baseline replays from (the web
 * host keeps restored sessions cold). */
export const inject = ['webServer', 'sessions', 'sessionPersistence']

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function sendFile(res: ServerResponse, contentType: string, body: string): void {
  res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(body)
}

function page(): string {
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synapse for DSH</title><link rel="stylesheet" href="/synapse/styles.css"></head><body><div id="app"></div><script src="/synapse/app.js"></script></body></html>'
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    length += buffer.length
    if (length > MAX_BODY_BYTES) throw new InputError('请求内容过大')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new InputError('请求不是有效 JSON')
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positionOrUndefined(value: unknown): { x: number; y: number } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { x?: unknown; y?: unknown }
  const x = Number(record.x)
  const y = Number(record.y)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}

/** Mount the Synapse routes and live projection on the existing DSH Web Server. */
export function apply(ctx: Context, config: SynapseConfig): void {
  const store = new WorkspaceStore(config.dataFile)
  const autoProjection = config.autoProjection !== false
  const projectionWorkspaceTitle = typeof config.projectionWorkspaceTitle === 'string' && config.projectionWorkspaceTitle.trim() !== ''
    ? config.projectionWorkspaceTitle.trim().slice(0, MAX_TITLE_LENGTH)
    : 'DSH 任务'
  const reportProjectionFailure = (error: unknown): void => {
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
  }
  const replaySession = (session: Session): void => {
    // Forks inherit their parent's log. The canvas already represents that
    // history through the parent node, so only project the child's live tail.
    const replayFrom = session.header.parentSession === undefined ? 0 : session.firstLiveSeq
    void store.projectSession(session, replayFrom, projectionWorkspaceTitle).catch(reportProjectionFailure)
  }
  // The web host keeps restored sessions cold (the live store holds only
  // attached sessions; session.list is a persistence read), so the canvas
  // baseline comes from SessionPersistence, keyed by revision: a session is
  // re-projected exactly once per durable log change, and the store's
  // sourceSeq guard makes repeats cheap.
  const projectedRevisions = new Map<string, string>()
  const replayPersistedBaseline = async (): Promise<void> => {
    try {
      const snapshots = await ctx.sessionPersistence.listSnapshots()
      for (const snapshot of snapshots) {
        const key = String(snapshot.header.id)
        const revision = String(snapshot.revision)
        if (projectedRevisions.get(key) === revision) continue
        const { events } = await ctx.sessionPersistence.inspect(snapshot.header.id)
        // Blank sessions stay out of the canvas (the browser list skips them
        // too). For a forked child the persisted log carries the parent seed;
        // only that prefix is skipped — a root session's end-seed is the
        // persistence's own snapshot boundary, never a lineage cut.
        if (sessionIsBlank(events)) continue
        const title = sessionTitle(events)
        const replayAt = snapshot.header.parentSession === undefined ? 0 : sessionLiveStart(events)
        await store.projectPersisted({
          id: key,
          ...(title === null ? {} : { title }),
          ...(snapshot.header.parentSession === undefined ? {} : { parentId: snapshot.header.parentSession }),
          header: {
            ...(snapshot.header.seedLength === undefined ? {} : { seedLength: snapshot.header.seedLength }),
            ...(snapshot.header.parentSession === undefined ? {} : { parentSession: snapshot.header.parentSession }),
          },
        }, snapshot.header.cwd ?? UNSPECIFIED_CWD, events, replayAt, projectionWorkspaceTitle)
        projectedRevisions.set(key, revision)
      }
    } catch (error) {
      reportProjectionFailure(error)
    }
  }
  // Buffer live events per session and flush them in one write per microtask,
  // so a burst of turn events coalesces into a single save instead of N.
  const projectionQueue: { session: Session; event: SessionEvent }[] = []
  let projectionScheduled = false
  const enqueueProjection = (session: Session, event: SessionEvent): void => {
    projectionQueue.push({ session, event })
    if (projectionScheduled) return
    projectionScheduled = true
    queueMicrotask(() => {
      projectionScheduled = false
      const batch = projectionQueue.splice(0)
      const bySession = new Map<string, { session: Session; events: SessionEvent[] }>()
      for (const item of batch) {
        const entry = bySession.get(item.session.id)
        if (entry === undefined) bySession.set(item.session.id, { session: item.session, events: [item.event] })
        else entry.events.push(item.event)
      }
      for (const { session, events } of bySession.values()) {
        void store.projectEvents(session, events, projectionWorkspaceTitle).catch(reportProjectionFailure)
      }
    })
  }
  if (autoProjection) {
    ctx.on('session/created', replaySession)
    ctx.on('session/event', enqueueProjection)
    // Live sessions that predate this activation (their creation
    // announcement already fired) replay from the live log; persisted-cold
    // sessions come from the revision-keyed persistence baseline below.
    for (const session of ctx.sessions.list()) replaySession(session)
    void replayPersistedBaseline()
    // Persistence backends settle shortly after composition in this build;
    // one re-scan after the settle window covers a backend whose directory
    // scan was still in flight. Revision keys make this a no-op when nothing
    // changed.
    const baselineTimer = setTimeout(() => { void replayPersistedBaseline() }, 2_000)
    ctx.effect(() => () => clearTimeout(baselineTimer), 'synapse: baseline replay timer')
  }
  // The DSH /api browser-trust fence does not cover /synapse routes, so this
  // handler checks the Host header itself: loopback is allowed by default and
  // additional authorities opt in through config.trustedHosts (mirrors the
  // fence's DNS-rebinding defense).
  const trustedHosts = new Set(['localhost', '127.0.0.1',
    ...[...(config.trustedHosts ?? [])].map(host => String(host).trim().toLowerCase()).filter(Boolean)])
  const api = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const hostname = (typeof req.headers.host === 'string' ? req.headers.host : '').replace(/:\d+$/, '').toLowerCase()
      if (!trustedHosts.has(hostname)) return sendJson(res, 403, { error: '不被信任的 Host' })
      const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
      if (path === '/synapse/api/reset' && req.method === 'POST') {
        return sendJson(res, 200, await store.clearLegacy(ctx.sessions.list()))
      }
      if (path === '/synapse/api/workspaces') {
        if (req.method === 'GET') return sendJson(res, 200, { workspaces: await store.list() })
        if (req.method === 'POST') {
          const body = (await readJson(req)) as { title?: unknown }
          if (typeof body?.title !== 'string') throw new InputError('title 必须是文本')
          return sendJson(res, 201, { workspace: await store.create(body.title) })
        }
      }
      const workspace = /^\/synapse\/api\/workspaces\/([0-9a-f-]+)$/i.exec(path)
      if (workspace !== null) {
        if (req.method === 'GET') return sendJson(res, 200, { workspace: await store.get(workspace[1] ?? '') })
        if (req.method === 'POST') {
          const body = await readJson(req) as {
            title?: unknown
            parentId?: unknown
            dshSessionId?: unknown
            dshSessionTitle?: unknown
            position?: unknown
            color?: unknown
            note?: unknown
          }
          if (typeof body?.title !== 'string') throw new InputError('title 必须是文本')
          return sendJson(res, 201, { thread: await store.createThread(workspace[1] ?? '', {
            title: body.title,
            parentId: stringOrUndefined(body.parentId),
            dshSessionId: stringOrUndefined(body.dshSessionId),
            dshSessionTitle: stringOrUndefined(body.dshSessionTitle),
            position: positionOrUndefined(body.position),
            color: stringOrUndefined(body.color),
          }) })
        }
      }
      const branch = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/branch$/i.exec(path)
      if (branch !== null && req.method === 'POST') {
        const body = await readJson(req) as {
          title?: unknown
          dshSessionId?: unknown
          dshSessionTitle?: unknown
          position?: unknown
          color?: unknown
        }
        if (typeof body?.title !== 'string') throw new InputError('title 必须是文本')
        return sendJson(res, 201, { thread: await store.branch(branch[1] ?? '', {
          title: body.title,
          dshSessionId: stringOrUndefined(body.dshSessionId),
          dshSessionTitle: stringOrUndefined(body.dshSessionTitle),
          position: positionOrUndefined(body.position),
          color: stringOrUndefined(body.color),
        }) })
      }
      if (path === '/synapse/api/sessions/sync' && req.method === 'POST') {
        const body = await readJson(req) as { sessions?: unknown; removedSessionIds?: unknown }
        const sessions = Array.isArray(body?.sessions) ? body.sessions as SessionRow[] : []
        const removedSessionIds = Array.isArray(body?.removedSessionIds) ? body.removedSessionIds.filter((item): item is string => typeof item === 'string') : []
        const summaries = await store.syncSessions(sessions, removedSessionIds)
        // The browser sync is the reliable trigger when a cold session gains
        // events: refresh the persisted baseline (revision-keyed, cheap).
        void replayPersistedBaseline()
        return sendJson(res, 200, { workspaces: summaries })
      }
      const messages = /^\/synapse\/api\/threads\/([0-9a-f-]+)\/messages$/i.exec(path)
      if (messages !== null && req.method === 'POST') {
        const body = await readJson(req) as { text?: unknown }
        if (typeof body?.text !== 'string') throw new InputError('text 必须是文本')
        return sendJson(res, 201, { thread: await store.addMessage(messages[1] ?? '', body.text) })
      }
      const thread = /^\/synapse\/api\/threads\/([0-9a-f-]+)$/i.exec(path)
      if (thread !== null && req.method === 'PATCH') {
        const body = await readJson(req) as { title?: unknown; position?: unknown }
        return sendJson(res, 200, { thread: await store.updateThread(thread[1] ?? '', { title: typeof body?.title === 'string' ? body.title : undefined, position: positionOrUndefined(body?.position) }) })
      }
      if (thread !== null && req.method === 'DELETE') return sendJson(res, 200, await store.removeThread(thread[1] ?? ''))
      return sendJson(res, 404, { error: '接口不存在' })
    } catch (error) {
      if (error instanceof InputError) return sendJson(res, 400, { error: error.message })
      if (error instanceof NotFoundError) return sendJson(res, 404, { error: error.message })
      ctx.logger.error(error instanceof Error ? error : new Error(String(error)))
      return sendJson(res, 500, { error: 'Synapse 数据暂时不可用' })
    }
  }
  const asset = (name: string): Promise<string> => readFile(new URL(`../assets/${name}`, import.meta.url), 'utf8')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse', handler: (_req, res) => { res.writeHead(302, { location: '/synapse/' }); res.end() } }), 'synapse: redirect')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/', handler: async (_req, res) => { sendFile(res, 'text/html; charset=utf-8', page()) } }), 'synapse: page')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/app.js', handler: async (_req, res) => { sendFile(res, 'text/javascript; charset=utf-8', await asset('app.js')) } }), 'synapse: app')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/styles.css', handler: async (_req, res) => { sendFile(res, 'text/css; charset=utf-8', await asset('styles.css')) } }), 'synapse: styles')
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/synapse/deepseek-mark.svg', handler: async (_req, res) => { sendFile(res, 'image/svg+xml', await asset('deepseek-mark.svg')) } }), 'synapse: DeepSeek mark')
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/synapse/api', handler: api }), 'synapse: api')
}
