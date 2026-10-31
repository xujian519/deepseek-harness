/**
 * Video studio plugin, browser half: registers the `videoProjects`
 * conversation view (the production board), the definition that discovers
 * project paths from settled tool results, and the Host reads the board uses.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/* jscpd:ignore-start -- sibling client studios share the Context imports */
import { fileAddressFor, fileMediaUrl, resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Conversation registries' Context merges (ctx.uiConversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
/* jscpd:ignore-end */
import { VIDEO_PROJECTS_TARGET, videoProjectsDefinition, videoProjectsViewDefinition } from './video-projects.ts'
import { readStudioProject } from './project-reads.ts'
import { StudioView, type VideoStudioInjected } from './StudioView.tsx'
import { en, ja, es, fr, de, ru, pt, zh, NS, type VideoStudioKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Video studio board copy. */
    videoStudio: VideoStudioKey
  }
}

/** Required services for the view registration and its Host reads. */
export const inject = ['slots', 'locale', 'uiConversation', 'sessions', 'connection', 'remote', 'remote.session', 'remote.workspaceFiles']

/**
 * Open one workspace path on the Host desktop.
 * @param ctx - client root context carrying the session Remote.
 * @param resolve - maps a project path to the path the Host receives.
 * @param path - declared path from the project document.
 * @param action - `reveal` selects the file in the OS file manager instead of opening it.
 * @returns completion; a Host refusal rejects so the board can report it.
 */
/* jscpd:ignore-start -- the Host file action and dictionary registration are the shared studio skeleton */
async function openPath(
  ctx: ClientContext,
  resolve: (path: string) => string,
  path: string,
  action?: 'reveal',
): Promise<void> {
  const result = await ctx.remote.session.openWorkspacePath({
    path: resolve(path),
    ...action === undefined ? {} : { action },
  })
  if (!result.ok) throw new Error(result.error.message)
}

/**
 * Client plugin body: register dictionaries, the discovery fold, the board, and its Host reads.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-video-studio: dictionaries')
  /* jscpd:ignore-end */

  ctx.uiConversation.events.register(videoProjectsDefinition)
  ctx.uiConversation.views.register(videoProjectsViewDefinition)

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    // The shell activates a selected view by slot id, so it must equal the
    // ConversationViewDefinition target the board reads its snapshot from.
    id: VIDEO_PROJECTS_TARGET,
    order: 30,
    locale: NS,
    label: () => ctx.locale.bind(NS)('view.video'),
    inject: (sessionId: SessionId): VideoStudioInjected => {
      const connection = ctx.get('connection') as ConnectionHandle
      // The list row may not carry `cwd` when the tab mounts, so every call
      // reads the live row rather than capturing one snapshot.
      const cwdOf = (): string | undefined => ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      const resolve = (path: string): string => resolveWorkspacePath(cwdOf(), path)
      const sidebar = ctx.get('sidebarRight')
      return {
        loadProject: (path, signal) => readStudioProject(ctx.remote.workspaceFiles, sessionId, resolve(path), resolve, signal),
        mediaUrl: (absolutePath, version) => {
          const url = fileMediaUrl(document.baseURI, absolutePath)
          // The file route always carries `?path=`, so the version joins that query.
          return url === undefined ? undefined : `${url}&v=${encodeURIComponent(version)}`
        },
        canOpenInSidebar: sidebar !== undefined,
        openInSidebar: (path) => {
          if (sidebar === undefined) return false
          sidebar.openResource(fileAddressFor(sessionId, cwdOf(), path))
          return true
        },
        openFile: path => openPath(ctx, resolve, path),
        showInFolder: path => openPath(ctx, resolve, path, 'reveal'),
        isLoopback: connection.isLoopback,
      }
    },
  }, StudioView))
}
