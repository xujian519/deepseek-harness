/**
 * Document studio plugin, browser half: registers the `document`
 * conversation view (the deliverable studio), the produced-file definition
 * and session-wide view target it reads, and the auto-switch that jumps a
 * session to the studio when its preset is the document agent. All policy
 * lives here — composing this plugin out of cordis.yml removes the tab, the
 * auto-switch, and the preview together.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  resolveWorkspacePath,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  documentDeliverablesDefinition, documentDeliverablesViewDefinition,
} from './document-deliverables.ts'
import { StudioView, type StudioViewInjected } from './StudioView.tsx'
import { en, NS, zh, type DocumentStudioKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Document studio view copy. */
    'documentStudio': DocumentStudioKey
  }
}

/** The agent-preset id the studio auto-switches to. */
export const DOCUMENT_PRESET_ID = 'document'

/** Required services for the view registration, the targets, and the auto-switch. */
export const inject = ['slots', 'locale', 'conversation', 'conversationEvents', 'conversationViews', 'sessions', 'connection', 'workspaces']

/** Auto-switch retry window and cadence (the view setter mounts with the session seat). */
const SWITCH_RETRY_MS = 150
const SWITCH_MAX_RETRIES = 20

/**
 * Client plugin body: register dictionaries, the produced-file targets, the
 * studio view, and the preset auto-switch.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-document-studio: dictionaries')

  ctx.conversationEvents.register(documentDeliverablesDefinition)
  ctx.conversationViews.register(documentDeliverablesViewDefinition)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'document',
    order: 20,
    locale: NS,
    label: () => ctx.locale.bind(NS)('view.document'),
    inject: (sessionId: SessionId): StudioViewInjected => {
      const connection = ctx.get('connection') as ConnectionHandle
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      const resolve = (path: string): string => resolveWorkspacePath(cwd, path)
      return {
        isLoopback: connection.isLoopback,
        hooks: { hostDescription: connection.hostDescription },
        openFile: path => ctx.workspaces.openPath(resolve(path)),
        showInFolder: path => ctx.workspaces.openPath(resolve(path)),
        readFileText: async (path) => {
          const response = await connection.api.host.readFileText({ path: resolve(path) })
          if (!response.result.ok) {
            throw new Error(response.result.error.message)
          }
          return response.result.value
        },
      }
    },
  }, StudioView))

  // Jump to the studio when the current session is a document-agent session.
  // The store-backed setter mounts with the session's conversation seat, so a
  // list change that precedes it retries for a bounded window; re-entering an
  // already-visited session switches again (a deliberate tab pick is
  // overwritten only on session entry, not continuously).
  ctx.effect(() => {
    let previous: SessionId | undefined
    const autoSwitched = new Set<SessionId>()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    let retryFor: SessionId | undefined
    const stopRetry = (): void => {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer)
        retryTimer = undefined
      }
      retryFor = undefined
      retries = 0
    }
    const attempt = (sessionId: SessionId): boolean => {
      const conversation = ctx.get('conversation')
      if (conversation === undefined) return false
      const applied = conversation.setActiveView(sessionId, 'document')
      if (applied) autoSwitched.add(sessionId)
      return applied
    }
    const maybeSwitch = (): void => {
      const state = ctx.sessions.list.getSnapshot()
      const current = state.current
      if (current === undefined || current === previous) return
      previous = current
      stopRetry()
      if (autoSwitched.has(current)) return
      const preset = state.byId[current]?.agentPreset
      if (preset !== DOCUMENT_PRESET_ID) return
      retryFor = current
      retries = 0
      if (attempt(current)) {
        stopRetry()
        return
      }
      retryTimer = setTimeout(tick, SWITCH_RETRY_MS)
    }
    const tick = (): void => {
      if (retryFor === undefined) return
      const state = ctx.sessions.list.getSnapshot()
      if (state.current !== retryFor) {
        stopRetry()
        return
      }
      if (++retries > SWITCH_MAX_RETRIES) {
        stopRetry()
        return
      }
      if (attempt(retryFor)) {
        stopRetry()
        return
      }
      retryTimer = setTimeout(tick, SWITCH_RETRY_MS)
    }
    const stop = ctx.sessions.list.subscribe(maybeSwitch)
    maybeSwitch()
    return () => {
      stop()
      stopRetry()
    }
  }, 'ui-document-studio: preset auto-switch')
}
