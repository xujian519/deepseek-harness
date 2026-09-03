/**
 * Browser plugin for the durable PatentTeams Conversation Node card and the
 * fixed Teams conversation view. Both surfaces fold the same nine
 * `patent-teams/*` session-event kinds through `teams-model.ts`, so the
 * in-stream card and the Teams tab are projections of one deterministic
 * replay.
 * @module @deepseek-ai/dsh-client-ui-patent-teams/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the slots Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Chat SlotMap entry and ChatNodeDataMap (keyed renderer seat).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the Conversation registries' Context merge (ctx.uiConversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the sessions-service Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { TeamsCard } from './TeamsCard.tsx'
import { TeamsView } from './TeamsView.tsx'
import { en, NS, zh, type PatentTeamsKey } from './locales.ts'
import { patentTeamsCardDefinition } from './teams-definition.ts'
import { patentTeamsViewDefinition, patentTeamsViewSourceDefinition } from './teams-view.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Patent-teams card and Teams-view copy. */
    patentTeams: PatentTeamsKey
  }
}

/** Required services for the Definitions, the keyed renderer, the view, and copy. */
export const inject = ['uiConversation', 'slots', 'sessions', 'locale']

/** Register the fold Definitions, dictionary, the keyed Chat renderer, and the Teams view. */
export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(patentTeamsCardDefinition)
  ctx.uiConversation.events.register(patentTeamsViewSourceDefinition)
  ctx.uiConversation.views.register(patentTeamsViewDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-patent-teams: dictionaries')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'patent-teams',
    locale: NS,
    inject: (): { openSession: (id: SessionId) => void } => ({
      openSession: (id: SessionId) => { ctx.sessions.open(id) },
    }),
  }, TeamsCard))
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'teams',
    order: 30,
    locale: NS,
    label: () => ctx.locale.bind(NS)('view.teams'),
    inject: (sessionId: SessionId) => {
      // The dashboard's backwards drain pages through the Session face, the
      // same verb the trajectory view uses for its scroll history.
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) {
        throw new Error(`ui-patent-teams: session "${sessionId}" is unavailable`)
      }
      return {
        openSession: (id: SessionId) => { ctx.sessions.open(id) },
        loadOlder: () => session.loadOlder(),
      }
    },
  }, TeamsView))
}
