/**
 * Synapse session-map browser half, loaded as a `dsh.client` row in the Web
 * profile. Adds the 对话/会话地图 switch and hosts the map at `/synapse/` in a
 * full-surface iframe, bridging it to the DSH session and workspace services:
 * create/fork/send, current-session sync, live replies, and theme follows.
 * The host half (dsh-host-synapse) owns the map page and projection.
 * @module @deepseek-ai/dsh-client-synapse
 */

import type { ClientContext, SessionFace, SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/** Required client services: the session and workspace runtimes. */
export const inject = ['sessions', 'workspaces']

/** One canvas session row sent to `/synapse/api/sessions/sync`. */
interface SessionRow {
  id: SessionId
  title: string
  cwd: string | null
  parentId?: SessionId
  blank: boolean
}

/** One canvas workspace row sent to the map's sidebar. */
interface WorkspaceRow {
  id: string
  title: string
  path: string | null
  sessionIds: SessionId[]
}

interface PendingRpc {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: number
}

/**
 * Register the map switch and its overlay. Pure DOM: the map lives in an
 * iframe, so nothing here renders through the slot system — the canvas app
 * owns its own document.
 * @param ctx - client root context carrying sessions/workspaces.
 */
export function apply(ctx: ClientContext): void {
  const currentSession = (): { id: SessionId; title: string; cwd: string | null } | null => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const id = snapshot.current
    if (id === undefined) return null
    const session = snapshot.byId[id]
    return session === undefined ? null : { id, title: session.displayTitle, cwd: session.cwd ?? null }
  }
  const sessionRows = (): SessionRow[] =>
    ctx.sessions.list.getSnapshot().ids.flatMap((id) => {
      const session = ctx.sessions.list.getSnapshot().byId[id]
      return session === undefined ? [] : [{
        id,
        title: session.displayTitle,
        cwd: session.cwd ?? null,
        ...(session.parentId === undefined ? {} : { parentId: session.parentId }),
        blank: session.blank,
      }]
    })
  const workspaceRows = (): WorkspaceRow[] => {
    const sessions = ctx.sessions.list.getSnapshot()
    const workspaces = ctx.workspaces.list.getSnapshot()
    const accounted = new Set(workspaces.items.flatMap(workspace => workspace.sessionIds))
    return [
      ...workspaces.items.map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title,
        path: workspace.path,
        sessionIds: [...workspace.sessionIds],
      })),
      { id: 'dsh-ungrouped', title: '未分组', path: null, sessionIds: sessions.ids.filter(id => !accounted.has(id)) },
    ]
  }
  const promptSession = async (sessionId: SessionId, text: string): Promise<void> => {
    const scope = ctx.sessions.scope(sessionId)
    const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
    if (session === undefined) throw new Error('关联的 DSH 会话已不可用')
    const result = await session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(result.error.message)
  }
  const bridgeText = (session: SessionFace | undefined): string => {
    if (session === undefined) return ''
    const snapshot = session.getSnapshot()
    return snapshot.partial?.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n') ?? ''
  }
  const style = document.createElement('style')
  style.textContent = '.dsh-synapse-switch{position:fixed;z-index:80;top:12px;left:50%;display:flex;gap:2px;transform:translateX(-50%);border:1px solid #d1d5db;border-radius:999px;background:rgba(255,255,255,.96);padding:3px;backdrop-filter:blur(10px)}.dsh-synapse-switch button{height:28px;border:0;border-radius:999px;background:transparent;padding:0 11px;color:#6b7280;font:600 12px Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}.dsh-synapse-switch button:hover{background:#f3f4f6;color:#111827}.dsh-synapse-switch button.active{background:#111827;color:#fff}.dsh-synapse-switch button:focus-visible{outline:2px solid #111827;outline-offset:2px}.dsh-synapse-overlay{position:fixed;z-index:100;inset:0;background:#f5f7fa}.dsh-synapse-overlay.is-opening{visibility:hidden}.dsh-synapse-overlay[hidden]{display:none}.dsh-synapse-overlay iframe{display:block;width:100%;height:100%;border:0}'
  document.head.append(style)
  const host = document.createElement('div')
  host.className = 'dsh-synapse-host'
  host.innerHTML = '<div class="dsh-synapse-switch" role="group" aria-label="视图切换"><button type="button" data-view="dialog" class="active" aria-pressed="true">对话</button><button type="button" data-view="map" aria-pressed="false">会话地图</button></div><section class="dsh-synapse-overlay" hidden><iframe title="会话地图" src="/synapse/"></iframe></section>'
  document.body.append(host)
  const dialogButton = host.querySelector('[data-view="dialog"]')
  const mapButton = host.querySelector('[data-view="map"]')
  const overlay = host.querySelector('.dsh-synapse-overlay')
  const frame = host.querySelector('iframe')
  const frameReady = frame instanceof HTMLIFrameElement
  const buttonsReady = dialogButton instanceof HTMLElement && mapButton instanceof HTMLElement
  const overlayReady = overlay instanceof HTMLElement
  if (!frameReady || !buttonsReady || !overlayReady) {
    style.remove()
    host.remove()
    throw new Error('synapse: failed to build the map switch DOM')
  }
  const send = (type: string, payload: Record<string, unknown> = {}): void => {
    frame.contentWindow?.postMessage({ source: 'dsh-synapse', type, ...payload }, window.location.origin)
  }
  const pendingRpc = new Map<string, PendingRpc>()
  const settle = (requestId: string, value: unknown, error?: string): void => {
    const pending = pendingRpc.get(requestId)
    if (pending === undefined) return
    pendingRpc.delete(requestId)
    window.clearTimeout(pending.timer)
    if (error === undefined) pending.resolve(value)
    else pending.reject(new Error(error))
  }
  const setView = (view: 'dialog' | 'map'): void => {
    const showingMap = view === 'map'
    dialogButton.classList.toggle('active', !showingMap)
    dialogButton.setAttribute('aria-pressed', String(!showingMap))
    mapButton.classList.toggle('active', showingMap)
    mapButton.setAttribute('aria-pressed', String(showingMap))
  }
  let mapOpenFallback = 0
  let mapOpening = false
  const close = (): void => {
    window.clearTimeout(mapOpenFallback)
    mapOpening = false
    overlay.classList.remove('is-opening')
    overlay.hidden = true
    setView('dialog')
  }
  let syncQueued = false
  let knownSessionIds = new Set<SessionId>()
  const liveUnsubscribers = new Map<SessionId, () => void>()
  const syncLiveSessions = (): void => {
    const snapshot = ctx.sessions.list.getSnapshot()
    for (const id of snapshot.ids) {
      if (liveUnsubscribers.has(id)) continue
      const scope = ctx.sessions.scope(id)
      const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
      if (session === undefined) continue
      const publish = (): void => {
        if (overlay.hidden) return
        send('synapse:live-reply', { sessionId: id, running: session.getSnapshot().running, text: bridgeText(session) })
      }
      liveUnsubscribers.set(id, session.subscribe(publish))
      publish()
    }
    for (const [id, unsubscribe] of liveUnsubscribers) {
      if (!snapshot.ids.includes(id)) {
        unsubscribe()
        liveUnsubscribers.delete(id)
      }
    }
  }
  const syncSessions = (): void => {
    if (syncQueued) return
    syncQueued = true
    queueMicrotask(() => {
      syncQueued = false
      const sessions = sessionRows()
      const sessionIds = new Set(sessions.map(session => session.id))
      const removedSessionIds = [...knownSessionIds].filter(id => !sessionIds.has(id))
      knownSessionIds = sessionIds
      void fetch('/synapse/api/sessions/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessions, removedSessionIds }),
      }).catch(() => {})
    })
  }
  const syncTheme = (): void => {
    send('synapse:theme', { dark: document.body.hasAttribute('data-ds-dark-theme') })
  }
  const syncCurrentSession = (): void => {
    syncSessions()
    syncLiveSessions()
    syncTheme()
    if (!overlay.hidden) {
      send('synapse:workspaces', { workspaces: workspaceRows() })
      send('synapse:current-session', { session: currentSession() })
    }
  }
  const showMapOverlay = (): void => {
    window.clearTimeout(mapOpenFallback)
    mapOpening = false
    overlay.hidden = false
    overlay.classList.remove('is-opening')
    syncCurrentSession()
  }
  const open = (): void => {
    window.clearTimeout(mapOpenFallback)
    mapOpening = true
    setView('map')
    // Keep the iframe laid out while hidden so its canvas can receive a
    // real scroll offset. display:none would clamp scrollTop back to zero.
    overlay.hidden = false
    overlay.classList.add('is-opening')
    window.requestAnimationFrame(() => {
      send('synapse:map-opened')
      syncCurrentSession()
    })
    mapOpenFallback = window.setTimeout(showMapOverlay, 300)
  }
  const onFrameLoad = (): void => {
    syncCurrentSession()
    if (mapOpening) send('synapse:map-opened')
  }
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as {
      source?: unknown
      type: string
      requestId?: string
      sessionId?: string
      session?: unknown
      text?: unknown
      atSeq?: unknown
      workspaceId?: unknown
      cwd?: unknown
      message?: unknown
    }
    if (event.origin !== window.location.origin || data.source !== 'dsh-synapse') return
    if (data.type === 'synapse:close') { close(); return }
    if (data.type === 'synapse:map-ready') { showMapOverlay(); return }
    if (data.type === 'synapse:request-current') {
      send('synapse:workspaces', { workspaces: workspaceRows() })
      send('synapse:current-session', { session: currentSession() })
      return
    }
    if (data.type === 'synapse:open-session') {
      if (typeof data.sessionId !== 'string') return
      try { ctx.sessions.open(data.sessionId as SessionId); close() } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
      return
    }
    if (data.type === 'synapse:activate-session') {
      // Bidirectional current-session sync: switch DSH's current session
      // without closing the map; the sessions-list subscription re-sends
      // synapse:current-session so the map follows the new highlight.
      if (typeof data.sessionId !== 'string') return
      try { ctx.sessions.open(data.sessionId as SessionId) } catch { send('synapse:bridge-error', { message: '关联的 DSH 会话已不可用' }) }
      return
    }
    if (data.type === 'synapse:fork-session') {
      if (typeof data.sessionId !== 'string') return
      const sessionId = data.sessionId as SessionId
      const atSeq = Number.isInteger(data.atSeq) ? (data.atSeq as number) : undefined
      ctx.sessions.fork({ sessionId, ...(atSeq === undefined ? {} : { atSeq }), increaseTitle: true }).then((childId) => {
        send('synapse:forked-session', {
          requestId: data.requestId,
          session: { id: childId, title: ctx.sessions.list.getSnapshot().byId[childId]?.displayTitle ?? 'DSH 分支' },
        })
      }).catch(() => {
        send('synapse:bridge-error', { requestId: data.requestId, message: 'DSH 分支创建失败，请确认源会话已经完成当前轮次' })
      })
      return
    }
    if (data.type === 'synapse:send-message') {
      if (typeof data.sessionId !== 'string') return
      const text = typeof data.text === 'string' ? data.text.trim() : ''
      if (text === '') { send('synapse:bridge-error', { requestId: data.requestId, message: '消息不能为空' }); return }
      void promptSession(data.sessionId as SessionId, text).then(() => {
        send('synapse:message-sent', { requestId: data.requestId, sessionId: data.sessionId })
      }).catch((error: unknown) => {
        send('synapse:bridge-error', { requestId: data.requestId, message: error instanceof Error ? error.message : 'DSH 消息发送失败' })
      })
      return
    }
    if (data.type === 'synapse:create-session') {
      const workspaceId = typeof data.workspaceId === 'string' && data.workspaceId !== '' && data.workspaceId !== 'dsh-ungrouped' ? data.workspaceId : undefined
      const cwd = typeof data.cwd === 'string' && data.cwd !== '' ? data.cwd : undefined
      // New-session creation is workspace-owned (blank-session reuse): the
      // browser half asks for the current selection, then prompts it.
      const before = ctx.sessions.list.getSnapshot().current
      const next = (): Promise<SessionId> => new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          unsub()
          reject(new Error('DSH 会话创建超时'))
        }, 5_000)
        const unsub = ctx.sessions.list.subscribe(() => {
          const current = ctx.sessions.list.getSnapshot().current
          if (current !== undefined && current !== before) {
            window.clearTimeout(timer)
            unsub()
            resolve(current)
          }
        })
      })
      void (async () => {
        if (workspaceId !== undefined) {
          ctx.workspaces.startSession(workspaceId as WorkspaceId)
        } else if (cwd !== undefined) {
          const workspace = await ctx.workspaces.create({ path: cwd })
          ctx.workspaces.startSession(workspace.workspaceId)
        } else {
          ctx.workspaces.startSession()
        }
        const id = await next()
        send('synapse:created-session', {
          requestId: data.requestId,
          session: { id, title: ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? '新会话', cwd: ctx.sessions.list.getSnapshot().byId[id]?.cwd ?? cwd ?? null },
        })
      })().catch(() => {
        send('synapse:bridge-error', { requestId: data.requestId, message: 'DSH 会话创建失败，请先在 DSH 选择工作目录' })
      })
      return
    }
    if (data.type === 'synapse:forked-session' || data.type === 'synapse:created-session' || data.type === 'synapse:message-sent') {
      if (data.requestId !== undefined) settle(data.requestId, data.session ?? data)
    }
    if (data.type === 'synapse:bridge-error') {
      if (data.requestId !== undefined) settle(data.requestId, undefined, data.message as string | undefined)
    }
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !overlay.hidden) close()
  }
  // Follow DSH's live theme switch: body[data-ds-dark-theme] is the web
  // client's dark-mode signal, mirrored into the map iframe via synapse:theme.
  const themeObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => { syncTheme() })
  if (themeObserver !== null) {
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  }
  const unsubscribeSessions = ctx.sessions.list.subscribe(syncCurrentSession)
  const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(syncCurrentSession)
  dialogButton.addEventListener('click', close)
  mapButton.addEventListener('click', open)
  frame.addEventListener('load', onFrameLoad)
  window.addEventListener('message', onMessage)
  window.addEventListener('keydown', onKeyDown)
  ctx.effect(() => () => {
    dialogButton.removeEventListener('click', close)
    mapButton.removeEventListener('click', open)
    frame.removeEventListener('load', onFrameLoad)
    window.removeEventListener('message', onMessage)
    window.removeEventListener('keydown', onKeyDown)
    themeObserver?.disconnect()
    unsubscribeSessions()
    unsubscribeWorkspaces()
    for (const unsubscribe of liveUnsubscribers.values()) unsubscribe()
    host.remove()
    style.remove()
  }, 'synapse: web workspace switch')
}
