/**
 * The Teams-tab view surface: a second Conversation Node Definition targeting
 * the `patentTeams` view target (the chat card owns `chat`), plus the
 * per-session `ConversationViewDefinition` that folds those nodes into the
 * snapshot the tab reads. The builder keeps first-seen (team-creation) order
 * across incremental upserts.
 * @module dsh-client-ui-patent-teams/teams-view
 */
import type {
  ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
  ConversationNodeDefinition, ConversationTimelineSnapshot,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { projectTeamsCard, teamsNodeDefinition, type PatentTeamsCardData, type TeamsTeamState } from './teams-model.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationViewSnapshotMap {
    /** Session-wide PatentTeams teams in team-creation order. */
    patentTeams: PatentTeamsViewSnapshot
  }
}

/** Snapshot published under {@link PATENT_TEAMS_TARGET}: every folded team. */
export interface PatentTeamsViewSnapshot {
  readonly teams: readonly PatentTeamsCardData[]
}

/** Stable view target the Teams tab reads from the session snapshot. */
export const PATENT_TEAMS_TARGET = 'patentTeams'

/** View-target twin of the chat Definition: same fold, session-wide surface. */
export const patentTeamsViewSourceDefinition: ConversationNodeDefinition<TeamsTeamState> = teamsNodeDefinition(
  'patent-teams-view',
  PATENT_TEAMS_TARGET,
  context => ({
    key: context.key,
    kind: 'patent-teams-view',
    id: context.id,
    target: PATENT_TEAMS_TARGET,
    data: projectTeamsCard(context.state),
  }),
)

const EMPTY: PatentTeamsViewSnapshot = { teams: [] }

class PatentTeamsViewBuilder implements ConversationViewBuilder<ConversationViewNode, PatentTeamsViewSnapshot> {
  readonly empty = EMPTY
  private teams: readonly PatentTeamsCardData[] = []

  replace(input: {
    readonly nodes: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): PatentTeamsViewSnapshot {
    this.teams = input.nodes.map(node => node.data as PatentTeamsCardData)
    return { teams: this.teams }
  }

  apply(input: {
    readonly upserts: readonly ConversationViewNode[]
    readonly timeline: ConversationTimelineSnapshot
  }): PatentTeamsViewSnapshot {
    for (const node of input.upserts) {
      const next = node.data as PatentTeamsCardData
      const index = this.teams.findIndex(team => team.teamId === next.teamId)
      this.teams = index === -1
        ? [...this.teams, next]
        : this.teams.map((team, at) => at === index ? next : team)
    }
    return { teams: this.teams }
  }
}

/** Isolated per-session builder registered under {@link PATENT_TEAMS_TARGET}. */
export const patentTeamsViewDefinition: ConversationViewDefinition<ConversationViewNode, PatentTeamsViewSnapshot> = {
  target: PATENT_TEAMS_TARGET,
  create: () => new PatentTeamsViewBuilder(),
}
