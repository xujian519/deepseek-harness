// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { TeamsCard, type TeamsCardProps } from '../src/client/TeamsCard.tsx'
import { TeamsView, type TeamsViewProps } from '../src/client/TeamsView.tsx'
import type { PatentTeamsCardData } from '../src/client/teams-model.ts'
import { PATENT_TEAMS_TARGET, type PatentTeamsViewSnapshot } from '../src/client/teams-view.ts'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'
import { apply as applyInvariant } from '../src/invariant.ts'

afterEach(cleanup)

const PARENT_ID = 'captain' as SessionId
const CHILD_ID = 'child-1' as SessionId

const TEAM: PatentTeamsCardData = {
  teamId: 'search-team',
  name: '检索团队',
  description: '查新检索',
  status: 'active',
  members: [
    { memberId: 'child-1', name: 'alice', role: 'researcher', removed: false },
    { memberId: 'child-2', name: 'bob', removed: true },
  ],
  tasks: [
    { taskId: 't1', subject: '检索 A', dependencies: [], assignee: 'alice', status: 'completed', gated: false },
    { taskId: 't2', subject: '综述', dependencies: ['t1'], gated: false },
  ],
  completedTasks: 1,
  messageCount: 2,
}

function listState(overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: [PARENT_ID, CHILD_ID],
    byId: {
      [PARENT_ID]: { id: PARENT_ID, displayTitle: 'captain', running: true, blank: false, updatedAt: 0 },
      [CHILD_ID]: {
        id: CHILD_ID, displayTitle: 'alice', parentId: PARENT_ID, origin: 'subagent',
        running: true, blank: false, updatedAt: 0,
      },
    },
    current: PARENT_ID,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function cardNode(team: PatentTeamsCardData): TeamsCardProps['node'] {
  return {
    key: '12:patent-teamssearch-team',
    kind: 'patent-teams',
    id: team.teamId,
    target: 'chat',
    anchorSeq: 2,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: team,
  }
}

const runtimeShare = {
  sessionId: PARENT_ID,
  useSession: (() => undefined) as TeamsCardProps['useSession'],
  useProjection: () => undefined,
  useInput: () => { throw new Error('unused') },
  inputActions: { setDraft: () => {}, submit: () => {} } as unknown as TeamsCardProps['inputActions'],
  useWorkspaces: (() => undefined) as TeamsCardProps['useWorkspaces'],
  useTurnData: () => undefined,
  selectedCallId: undefined,
  cwd: undefined,
  openFile: () => {},
  inspectCall: () => {},
  forkAt: () => {},
  renderMessageImages: () => null,
  fileMentions: () => undefined,
}

function cardProps(
  team: PatentTeamsCardData = TEAM,
  sessions: SessionListState = listState(),
  openSession = vi.fn(),
): TeamsCardProps {
  return {
    node: cardNode(team),
    useSessions: (selector: (state: SessionListState) => unknown) => selector(sessions),
    openSession,
    t: makeTranslate(zh),
    ...runtimeShare,
  } as TeamsCardProps
}

function viewProps(
  snapshot: PatentTeamsViewSnapshot | undefined,
  sessions: SessionListState = listState(),
  openSession = vi.fn(),
): TeamsViewProps {
  return {
    ...runtimeShare,
    sessionId: PARENT_ID,
    useSession: (selector: (state: { views: Map<string, unknown> }) => unknown) =>
      selector({ views: new Map(snapshot === undefined ? [] : [[PATENT_TEAMS_TARGET, snapshot]]) }),
    useSessions: (selector: (state: SessionListState) => unknown) => selector(sessions),
    openSession,
    t: makeTranslate(zh),
  } as unknown as TeamsViewProps
}

describe('TeamsCard', () => {
  it('renders the collapsed summary for an active team and expands on demand', () => {
    render(<TeamsCard {...cardProps()} />)
    const header = screen.getByRole('button', { name: /检索团队/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/2 名成员/)).toBeTruthy()
    expect(screen.getByText(/1\/2 项任务/)).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('alice')).toBeNull()
  })

  it('starts collapsed for completed and disbanded teams', () => {
    render(<TeamsCard {...cardProps({ ...TEAM, status: 'deleted' })} />)
    expect(screen.getByRole('button', { name: /检索团队/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('已解散')).toBeTruthy()
  })

  it('opens a proven running member session and leaves others inert', () => {
    const openSession = vi.fn()
    render(<TeamsCard {...cardProps(TEAM, listState(), openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 alice' }))
    expect(openSession).toHaveBeenCalledWith('child-1')
    expect(screen.queryByRole('button', { name: '打开 bob' })).toBeNull()
    expect(screen.getByText('已离队')).toBeTruthy()
  })

  it('renders task rows with status, assignee, dependencies, and gate flags', () => {
    render(<TeamsCard {...cardProps()} />)
    const header = screen.getByRole('button', { name: /检索团队/ })
    fireEvent.click(header)
    fireEvent.click(header)
    expect(screen.getByText('检索 A')).toBeTruthy()
    expect(screen.getByText('综述')).toBeTruthy()
    expect(screen.getByText('未开始')).toBeTruthy()
    expect(screen.getByText('依赖 t1')).toBeTruthy()
    expect(screen.getByText('2 条消息')).toBeTruthy()
  })

  it('demotes the open button when the member row stops running', () => {
    const view = render(<TeamsCard {...cardProps(TEAM)} />)
    expect(screen.getByRole('button', { name: '打开 alice' })).toBeTruthy()
    view.rerender(<TeamsCard {...cardProps(TEAM, listState({
      byId: {
        ...listState().byId,
        [CHILD_ID]: { ...listState().byId[CHILD_ID]!, running: false },
      },
    }))} />)
    expect(screen.queryByRole('button', { name: '打开 alice' })).toBeNull()
  })
})

describe('TeamsView', () => {
  it('renders the empty state without team records', () => {
    render(<TeamsView {...viewProps(undefined)} />)
    expect(screen.getByText(zh['view.empty'])).toBeTruthy()
  })

  it('renders every folded team block from the view snapshot', () => {
    render(<TeamsView {...viewProps({ teams: [TEAM] })} />)
    expect(screen.getByText('检索团队')).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开 alice' })).toBeTruthy()
    expect(screen.getByText('检索 A')).toBeTruthy()
  })

  it('opens a running member session from a team block', () => {
    const openSession = vi.fn()
    render(<TeamsView {...viewProps({ teams: [TEAM] }, listState(), openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '打开 alice' }))
    expect(openSession).toHaveBeenCalledWith('child-1')
  })
})

class TestSessions extends Service {
  readonly opened: SessionId[] = []
  constructor(ctx: Context) { super(ctx, 'sessions') }
  open(id: SessionId): void { this.opened.push(id) }
}

describe('plugin lifecycle', () => {
  it('registers and removes the Definitions, the view, and both slot entries with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    ctx.provide('conversationEvents', { register: () => () => {} } as never)
    ctx.provide('conversationViews', { register: () => () => {} } as never)
    await ctx.plugin(TestSessions).await()
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
        'conversation.view': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.chat.node')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.view')).toHaveLength(1)
    const cardEntry = ctx.slots.entries('conversation.chat.node')[0]!
    const cardFace = cardEntry.inject?.() as unknown as { openSession: (id: SessionId) => void }
    cardFace.openSession(CHILD_ID)
    expect((ctx.sessions as unknown as TestSessions).opened).toEqual([CHILD_ID])
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.chat.node')).toEqual([])
    expect(ctx.slots.entries('conversation.view')).toEqual([])
  })

  it('keeps the node half inert and registers invariant ownership', async () => {
    applyNode()
    const registered: string[] = []
    const ctx = new Context()
    ctx.provide('invariants')
    ctx.set('invariants', {
      register: (pkg: string) => { registered.push(pkg); return () => {} },
    } as never)
    await applyInvariant(ctx)
    expect(registered).toEqual(['@deepseek-ai/dsh-client-ui-patent-teams'])
  })
})
