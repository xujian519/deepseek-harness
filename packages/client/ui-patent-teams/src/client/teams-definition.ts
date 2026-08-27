/**
 * The durable PatentTeams Conversation Node Definition for the chat target:
 * one keyed Chat node per team, anchored at the `patent-teams/team-created`
 * event and updated by every later `patent-teams/*` event of the same team.
 * The same mechanism as `ui-workflow-run`'s workflow-run node; the fold core
 * lives in `teams-model.ts` and is shared with the Teams-tab view source.
 * @module dsh-client-ui-patent-teams/teams-definition
 */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { projectTeamsCard, teamsNodeDefinition, type PatentTeamsCardData, type TeamsTeamState } from './teams-model.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** One durable PatentTeams team: members, tasks, and progress. */
    'patent-teams': PatentTeamsCardData
  }
}

/** Durable PatentTeams event family folded into one keyed Chat node per team. */
export const patentTeamsCardDefinition: ConversationNodeDefinition<TeamsTeamState> = teamsNodeDefinition(
  'patent-teams',
  'chat',
  context => ({
    key: context.key,
    kind: 'patent-teams',
    id: context.id,
    target: 'chat',
    anchorSeq: context.anchorSeq,
    location: context.location,
    visibility: 'visible',
    data: projectTeamsCard(context.state),
  }),
)
