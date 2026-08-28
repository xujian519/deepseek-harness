/**
 * Document studio plugin, browser half: registers the `document`
 * conversation view (the deliverable studio), the produced-file definition
 * and session-wide view target it reads, and the auto-switch that jumps a
 * session to the studio when its preset is the document agent. All policy
 * lives here — composing this plugin out of cordis.yml removes the tab, the
 * auto-switch, and the preview together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Conversation registries' Context merges (ctx.uiConversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the sessions-service Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the Client Remote Context merge (ctx.remote, openWorkspacePath included).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the agentPreset Session-projection key (summary.projectionValues).
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import {
  documentDeliverablesDefinition, documentDeliverablesViewDefinition,
} from './document-deliverables.ts'
import { parentDir } from './paths.ts'
import { StudioView } from './StudioView.tsx'
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
export const inject = ['slots', 'locale', 'uiConversation', 'conversation', 'sessions', 'connection', 'remote', 'remote.session']

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

  ctx.uiConversation.events.register(documentDeliverablesDefinition)
  ctx.uiConversation.views.register(documentDeliverablesViewDefinition)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'document',
    order: 20,
    locale: NS,
    label: () => ctx.locale.bind(NS)('view.document'),
    inject: (sessionId: SessionId) => {
      const connection = ctx.get('connection') as ConnectionHandle
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      const resolve = (path: string): string => resolveWorkspacePath(cwd, path)
      const openPath = async (path: string): Promise<void> => {
        const result = await ctx.remote.session.openWorkspacePath({ path: resolve(path) })
        if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
      }
      return {
        isLoopback: connection.isLoopback,
        openFile: openPath,
        // Show-in-folder opens the containing directory: the host has no
        // reveal-in-folder intent, and opening the folder itself is what a
        // file manager handoff means (the ui-deliverables convention).
        showInFolder: (path: string) => openPath(parentDir(path)),
        // FIXME(port): the removed client runtime served file bytes through
        // connection.api.host.readFileText; upstream exposes no file-read
        // Remote, so the preview read fails loud until a replacement lands.
        readFileText: async () => {
          throw new Error('document studio: host file reads are unavailable (no file-read Remote after the client-runtime removal)')
        },
      }
    },
  }, StudioView))

  // Jump to the studio when the current session is a document-agent session.
  // The store-backed setter mounts with the session's conversation seat, so a
  // list change that precedes it retries for a bounded window; re-entering an
  // already-visited session switches again (the previous-current guard fires
  // per session entry, so a deliberate tab pick survives within one visit).
  ctx.effect(() => {
    let previous: SessionId | undefined
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
      return conversation.setActiveView(sessionId, 'document')
    }
    const maybeSwitch = (): void => {
      const state = ctx.sessions.list.getSnapshot()
      const current = state.current
      if (current === undefined || current === previous) return
      previous = current
      stopRetry()
      const preset = state.byId[current]?.projectionValues?.agentPreset
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
