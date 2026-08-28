/**
 * The fixed Teams conversation view: every team folded from this session's
 * `patent-teams/*` events, read from the `patentTeams` view snapshot. Pure
 * presentation — team facts arrive through the conversation snapshot, live member
 * activity through the sessions list share, and the open-member action
 * through the injected callback. Sessions without team records get the empty
 * state.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { runningMemberIds } from './TeamsCard.tsx'
import {
  STATUS_KEYS, TeamsMemberList, TeamsTaskList, teamDotState, type TeamsOpenSession,
} from './TeamsSections.tsx'
import type { PatentTeamsCardData } from './teams-model.ts'
import type { PatentTeamsViewSnapshot } from './teams-view.ts'
import { PATENT_TEAMS_TARGET } from './teams-view.ts'
import css from './TeamsView.module.css'

/** Teams view props: runtime session share + injected callback + locale. */
export type TeamsViewProps = ConvViewProps & PropsLocale<'patentTeams'> & TeamsOpenSession

/** Stable empty list so the selector never allocates per store tick. */
const EMPTY_TEAMS: readonly PatentTeamsCardData[] = []

function snapshotTeams(value: PatentTeamsViewSnapshot | undefined): readonly PatentTeamsCardData[] {
  return value?.teams ?? EMPTY_TEAMS
}

function runningIdsFor(
  sessions: SessionListState,
  teams: readonly PatentTeamsCardData[],
  sessionId: ConvViewProps['sessionId'],
): ReadonlySet<string> {
  const result = new Set<string>()
  for (const team of teams) {
    for (const id of runningMemberIds(sessions, team, sessionId)) result.add(id)
  }
  return result
}

function TeamBlock({ team, running, openSession, t }: {
  readonly team: PatentTeamsCardData
  readonly running: ReadonlySet<string>
  readonly openSession: TeamsOpenSession['openSession']
  readonly t: TeamsViewProps['t']
}): ReactNode {
  const tasks = team.tasks.length === 0
    ? t('card.noTasks')
    : t('card.tasks', { done: team.completedTasks, total: team.tasks.length })
  return (
    <section className={css.team} data-patent-teams-team={team.teamId} data-team-status={team.status}>
      <header className={css.teamHeader}>
        <span className={css.teamName}>{team.name}</span>
        <span className={css.teamMeta}>
          {t('card.members', { count: team.members.length })} · {tasks}
        </span>
        <span className={css.statusTail} data-status={team.status}>
          <StateDot state={teamDotState(team.status)} />
          <span>{t(STATUS_KEYS[team.status])}</span>
        </span>
      </header>
      {team.description === undefined ? null : <p className={css.teamDescription}>{team.description}</p>}
      <h4 className={css.sectionLabel}>{t('section.members')}</h4>
      {team.members.length === 0
        ? <span className={css.empty}>{t('card.members', { count: 0 })}</span>
        : <TeamsMemberList team={team} runningMemberIds={running} openSession={openSession} t={t} />}
      <h4 className={css.sectionLabel}>{t('section.tasks')}</h4>
      {team.tasks.length === 0
        ? <span className={css.empty}>{t('card.noTasks')}</span>
        : <TeamsTaskList team={team} t={t} />}
      {team.messageCount === 0 ? null : (
        <span className={css.empty}>{t('card.messages', { count: team.messageCount })}</span>
      )}
    </section>
  )
}

/**
 * Render the session's folded teams.
 * @param props - session runtime share, injected open-member action, locale share.
 * @returns the Teams tab body.
 */
export function TeamsView({ sessionId, useConversation, useSessions, openSession, t }: TeamsViewProps): ReactNode {
  const snapshot = useConversation(state => state.views.get(PATENT_TEAMS_TARGET))
  const list = useMemo(() => snapshotTeams(snapshot), [snapshot])
  const running = useSessions(
    sessions => runningIdsFor(sessions, list, sessionId),
    shallowEqual,
  )

  if (list.length === 0) {
    return <p className={css.emptyState} data-patent-teams-empty>{t('view.empty')}</p>
  }
  return (
    <div className={css.root}>
      {list.map(team => (
        <TeamBlock key={team.teamId} team={team} running={running} openSession={openSession} t={t} />
      ))}
    </div>
  )
}
