// Fold behavior of the two Conversation Node Definitions and the view-target
// builder, driven through the real ConversationNodeAssembler: the chat card
// and the Teams-tab snapshot must be projections of one fold.
import { describe, expect, it } from 'vitest'
import {
  ConversationNodeAssembler,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationNodeDefinition, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  applyTeamsEvent, projectTeamsCard, startTeamsState, teamsEventTeamId,
} from '../src/client/teams-model.ts'
import { patentTeamsCardDefinition } from '../src/client/teams-definition.ts'
import {
  PATENT_TEAMS_TARGET, patentTeamsViewDefinition, patentTeamsViewSourceDefinition,
  type PatentTeamsViewSnapshot,
} from '../src/client/teams-view.ts'

interface ChatSnapshot {
  readonly nodes: ReadonlyMap<string, ChatConversationViewNode>
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [patentTeamsCardDefinition, patentTeamsViewSourceDefinition]
  }
  fallbackEntry(): undefined { return undefined }
}

const chatViewDefinition: ConversationViewDefinition<ChatConversationViewNode, ChatSnapshot> = {
  target: 'chat',
  create: () => {
    let nodes = new Map<string, ChatConversationViewNode>()
    const snapshot = (): ChatSnapshot => ({ nodes })
    return {
      empty: snapshot(),
      replace: ({ nodes: values }) => {
        nodes = new Map(values.map(node => [node.key, node]))
        return snapshot()
      },
      apply: ({ upserts }) => {
        nodes = new Map(nodes)
        for (const node of upserts) nodes.set(node.key, node)
        return snapshot()
      },
    }
  },
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition, patentTeamsViewDefinition]
  }
}

function at(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return { type: 'event', event: { seq, time: seq * 100, type, data } as SessionEvent }
}

/** The assembler only builds snapshots for activated targets; activate every test view. */
function createAssembler(): ConversationNodeAssembler {
  const definitions = new TestViewDefinitions()
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), definitions)
  for (const view of definitions.entries()) value.activateTarget(view.target)
  return value
}

function assembler(entries: readonly SessionLiveEventEntry[], hasMore = false): ConversationNodeAssembler {
  const value = createAssembler()
  value.replaceWindow(entries, hasMore)
  value.flush()
  return value
}

function chatNodes(value: ConversationNodeAssembler): readonly ChatConversationViewNode[] {
  return [...(value.snapshot('chat') as ChatSnapshot).nodes.values()]
}

function viewSnapshot(value: ConversationNodeAssembler): PatentTeamsViewSnapshot {
  return value.snapshot(PATENT_TEAMS_TARGET) as PatentTeamsViewSnapshot
}

/** A full two-team event stream: lifecycle, members, tasks, verdicts, delete. */
function teamEvents(): readonly SessionLiveEventEntry[] {
  return [
    at(1, 'turn/start', { turn: 1 }),
    at(2, 'patent-teams/team-created', {
      teamId: 'search-team', captainSessionId: 'captain', name: '检索团队', description: '查新检索',
    }),
    at(3, 'patent-teams/member-added', { teamId: 'search-team', memberId: 'child-1', name: 'alice', role: 'researcher' }),
    at(4, 'patent-teams/member-added', { teamId: 'search-team', memberId: 'child-2', name: 'bob' }),
    at(5, 'patent-teams/task-created', { teamId: 'search-team', taskId: 't1', subject: '检索 A', dependencies: [] }),
    at(6, 'patent-teams/task-created', { teamId: 'search-team', taskId: 't2', subject: '综述', dependencies: ['t1'], assignee: 'bob' }),
    at(7, 'patent-teams/task-updated', { teamId: 'search-team', taskId: 't1', status: 'in_progress', assignee: 'alice' }),
    at(8, 'patent-teams/message-sent', { teamId: 'search-team', messageId: 'm1', from: 'captain', to: 'alice', content: 'go', ts: 1 }),
    at(9, 'patent-teams/task-updated', { teamId: 'search-team', taskId: 't1', status: 'completed', assignee: 'alice' }),
    at(10, 'patent-teams/task-validated', { teamId: 'search-team', taskId: 't1', worker: 'researcher', valid: false, missingHardFields: ['sources'], degraded: true }),
    at(11, 'patent-teams/task-gated', { teamId: 'search-team', taskId: 't1', score: 0.4, failures: ['evidence'], feedback: 'redo' }),
    at(12, 'patent-teams/member-removed', { teamId: 'search-team', memberId: 'child-2' }),
    at(13, 'patent-teams/team-deleted', { teamId: 'search-team' }),
    at(14, 'patent-teams/team-created', { teamId: 'draft-team', captainSessionId: 'captain', name: '撰写团队' }),
    at(15, 'patent-teams/member-added', { teamId: 'draft-team', memberId: 'child-3', name: 'carol' }),
    at(16, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

describe('teamsEventTeamId', () => {
  it('extracts the team id from every patent-teams kind and nothing else', () => {
    expect(teamsEventTeamId(teamEvents()[1]!.event)).toBe('search-team')
    expect(teamsEventTeamId(teamEvents()[13]!.event)).toBe('draft-team')
    expect(teamsEventTeamId(at(1, 'turn/start', { turn: 1 }).event)).toBeNull()
    expect(teamsEventTeamId(at(2, 'tool/result', {}).event)).toBeNull()
  })
})

describe('fold reducer', () => {
  it('rejects a start on any non-create event', () => {
    expect(() => startTeamsState(at(3, 'patent-teams/member-added', {}).event))
      .toThrow('patent-teams start requires patent-teams/team-created')
  })

  it('leaves unrelated events unchanged', () => {
    const state = startTeamsState(teamEvents()[1]!.event)
    expect(applyTeamsEvent(state, at(99, 'turn/start', { turn: 2 }).event)).toBe(state)
  })

  it('valid verdicts clear earlier degraded fields', () => {
    let state = startTeamsState(at(1, 'patent-teams/team-created', { teamId: 't', captainSessionId: 'c', name: 'n' }).event)
    state = applyTeamsEvent(state, at(2, 'patent-teams/task-created', { teamId: 't', taskId: 't1', subject: 's', dependencies: [] }).event)
    state = applyTeamsEvent(state, at(3, 'patent-teams/task-validated', { teamId: 't', taskId: 't1', worker: 'w', valid: false, missingHardFields: ['a'], degraded: true }).event)
    expect(projectTeamsCard(state).tasks[0]!.missingHardFields).toEqual(['a'])
    state = applyTeamsEvent(state, at(4, 'patent-teams/task-validated', { teamId: 't', taskId: 't1', worker: 'w', valid: true, missingHardFields: [], degraded: false }).event)
    expect(projectTeamsCard(state).tasks[0]!.missingHardFields).toBeUndefined()
  })

  it('records updates, verdicts, and gates for unknown tasks without a subject', () => {
    let state = startTeamsState(at(1, 'patent-teams/team-created', { teamId: 't', captainSessionId: 'c', name: 'n' }).event)
    state = applyTeamsEvent(state, at(2, 'patent-teams/task-updated', { teamId: 't', taskId: 't9', status: 'in_progress' }).event)
    expect(state.tasks).toEqual([])
    state = applyTeamsEvent(state, at(3, 'patent-teams/task-validated', { teamId: 't', taskId: 't9', worker: 'w', valid: true, missingHardFields: [], degraded: false }).event)
    state = applyTeamsEvent(state, at(4, 'patent-teams/task-gated', { teamId: 't', taskId: 't9', score: 0.2, failures: ['x'], feedback: 'f' }).event)
    expect(projectTeamsCard(state).activity).toEqual([
      { kind: 'task-gated', seq: 4, taskId: 't9' },
      { kind: 'task-validated', seq: 3, taskId: 't9', valid: true },
      { kind: 'task-updated', seq: 2, taskId: 't9', status: 'in_progress' },
    ])
  })

  it('keeps a capped newest-first activity feed', () => {
    let state = startTeamsState(at(1, 'patent-teams/team-created', { teamId: 't', captainSessionId: 'c', name: 'n' }).event)
    state = applyTeamsEvent(state, at(2, 'patent-teams/task-created', { teamId: 't', taskId: 't1', subject: 's', dependencies: [] }).event)
    state = applyTeamsEvent(state, at(3, 'patent-teams/message-sent', { teamId: 't', messageId: 'm', from: 'captain', to: 'alice', content: 'go', ts: 1 }).event)
    for (let seq = 4; seq <= 13; seq += 1) {
      state = applyTeamsEvent(state, at(seq, 'patent-teams/task-updated', { teamId: 't', taskId: 't1', status: 'in_progress', attempt: seq }).event)
    }
    const activity = projectTeamsCard(state).activity
    expect(activity).toHaveLength(8)
    expect(activity[0]).toMatchObject({ kind: 'task-updated', seq: 13, taskId: 't1', subject: 's', status: 'in_progress' })
    expect(activity[7]).toMatchObject({ kind: 'task-updated', seq: 6 })
  })
})

describe('chat card Definition', () => {
  it('folds the full lifecycle into one anchored card per team', () => {
    const value = assembler(teamEvents())
    const cards = chatNodes(value)
    expect(cards.map(node => node.id)).toEqual(['search-team', 'draft-team'])
    const first = cards[0]!.data as ReturnType<typeof projectTeamsCard>
    expect(first).toMatchObject({
      teamId: 'search-team',
      name: '检索团队',
      status: 'deleted',
      messageCount: 1,
      completedTasks: 1,
    })
    expect(first.members).toEqual([
      { memberId: 'child-1', name: 'alice', role: 'researcher', removed: false },
      { memberId: 'child-2', name: 'bob', removed: true },
    ])
    expect(first.activity).toEqual([
      { kind: 'task-gated', seq: 11, taskId: 't1', subject: '检索 A' },
      { kind: 'task-validated', seq: 10, taskId: 't1', subject: '检索 A', valid: false, missingHardFields: ['sources'] },
      { kind: 'task-updated', seq: 9, taskId: 't1', subject: '检索 A', status: 'completed' },
      { kind: 'message-sent', seq: 8, from: 'captain', to: 'alice' },
      { kind: 'task-updated', seq: 7, taskId: 't1', subject: '检索 A', status: 'in_progress' },
      { kind: 'task-created', seq: 6, taskId: 't2', subject: '综述' },
      { kind: 'task-created', seq: 5, taskId: 't1', subject: '检索 A' },
    ])
    expect(first.tasks[0]).toMatchObject({
      taskId: 't1', status: 'completed', assignee: 'alice', missingHardFields: ['sources'], gated: true,
    })
    expect(cards[0]!.anchorSeq).toBe(2)
    expect(cards[0]!.kind).toBe('patent-teams')
    expect((cards[1]!.data as ReturnType<typeof projectTeamsCard>).status).toBe('active')
  })

  it('projects all-completed as completed only while the team lives', () => {
    let state = startTeamsState(at(1, 'patent-teams/team-created', { teamId: 't', captainSessionId: 'c', name: 'n' }).event)
    state = applyTeamsEvent(state, at(2, 'patent-teams/task-created', { teamId: 't', taskId: 't1', subject: 's', dependencies: [] }).event)
    expect(projectTeamsCard(state).status).toBe('active')
    state = applyTeamsEvent(state, at(3, 'patent-teams/task-updated', { teamId: 't', taskId: 't1', status: 'completed' }).event)
    expect(projectTeamsCard(state).status).toBe('completed')
    state = applyTeamsEvent(state, at(4, 'patent-teams/team-deleted', { teamId: 't' }).event)
    expect(projectTeamsCard(state).status).toBe('deleted')
  })

  it('holds an update-only tail pending until the start arrives', () => {
    const events = teamEvents()
    const value = createAssembler()
    // The window covers only search-team updates: no team-created inside it.
    value.replaceWindow(events.slice(2, 13), true)
    value.flush()
    expect(chatNodes(value)).toEqual([])
    value.prepend(events.slice(0, 2), false)
    value.flush()
    expect(chatNodes(value).map(node => node.id)).toEqual(['search-team'])
  })

  it('produces the same fold through live append as complete replay', () => {
    const events = teamEvents()
    const replay = assembler(events)
    const live = createAssembler()
    live.replaceWindow(events.slice(0, 2), false)
    for (const event of events.slice(2)) live.append(event)
    live.flush()
    // Node projections carry mode-local branded seqs after the session
    // seq/log-offset split; the stable contract is identity plus card data.
    const identity = (nodes: readonly ChatConversationViewNode[]) =>
      nodes.map(node => ({ id: node.id, anchorSeq: node.anchorSeq, data: node.data }))
    expect(identity(chatNodes(live))).toEqual(identity(chatNodes(replay)))
    expect(viewSnapshot(live)).toEqual(viewSnapshot(replay))
  })
})

describe('Teams view target', () => {
  it('keeps team-creation order across incremental upserts', () => {
    const events = teamEvents()
    const value = createAssembler()
    value.replaceWindow(events.slice(0, 2), false)
    value.flush()
    expect(viewSnapshot(value).teams.map(team => team.teamId)).toEqual(['search-team'])
    for (const event of events.slice(2)) value.append(event)
    value.flush()
    expect(viewSnapshot(value).teams.map(team => team.teamId)).toEqual(['search-team', 'draft-team'])
    expect(viewSnapshot(value).teams[0]).toMatchObject({ status: 'deleted' })
  })

  it('starts each session builder from the empty snapshot', () => {
    expect(patentTeamsViewDefinition.create().empty).toEqual({ teams: [] })
  })

  it('upserts an existing team in place instead of appending a twin', () => {
    const builder = patentTeamsViewDefinition.create()
    const teamNode = (data: ReturnType<typeof projectTeamsCard>): ConversationViewNode => ({
      key: '12:patent-teams' + data.teamId,
      kind: 'patent-teams-view',
      id: data.teamId,
      target: PATENT_TEAMS_TARGET,
      data,
    })
    const created = projectTeamsCard(startTeamsState(teamEvents()[1]!.event))
    const timeline = { turnOrder: [] as number[], turns: new Map() }
    builder.replace({ nodes: [teamNode(created), teamNode({ ...created, teamId: 'other', name: '其他' })], timeline })
    builder.apply({ upserts: [teamNode(viewSnapshot(assembler(teamEvents().slice(0, 10))).teams[0]!)] , timeline })
    const snapshot = builder.apply({ upserts: [], timeline })
    expect(snapshot.teams).toHaveLength(2)
    expect(snapshot.teams.map(team => team.teamId)).toEqual(['search-team', 'other'])
    expect(snapshot.teams[0]!.messageCount).toBe(1)
  })
})
