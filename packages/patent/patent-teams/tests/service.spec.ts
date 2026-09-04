// PatentTeamsService end-to-end: real Context + real team state on disk, with
// stubbed ctx.agents / ctx.llm / ctx.subagents. Covers every service method,
// authorization branch, and scheduler-triggered side effect.
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { PatentTeamsService, callingAgent } from '../src/service.ts'
import {
  appendMailbox,
  createMessage,
  readArchivedTeam,
  readTeam,
  readUnreadMailbox,
  writeTeam,
} from '../src/state.ts'

const tmpRoots: string[] = []

async function tmpWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'patent-teams-service-'))
  tmpRoots.push(dir)
  return dir
}

function fakeAgent(id: string, cwd: string, overrides: Partial<Agent> = {}): Agent {
  const session = Session.create(SessionId(id), [], {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    cwd,
    isSeeded: false,
  })
  return {
    id: SessionId(id),
    session,
    options: { provider: 'spawn', model: 'deepseek-v4' },
    status: 'idle',
    whenIdle: () => Promise.resolve(),
    steer: () => {},
    ...overrides,
  } as unknown as Agent
}

interface Harness {
  ctx: Context
  workspace: string
  stateDir: string
  agents: Map<string, Agent>
  sendMessage: ReturnType<typeof vi.fn>
  startContinuable: Mock<(spec: never) => Promise<{ childId: SessionId; messageId: string }>>
  interrupted: string[]
  steered: unknown[]
  setFollowup(impl: (...args: never[]) => Promise<unknown>): void
}

async function makeService(options: {
  maxMembers?: number
  memberModel?: string
  qualityGate?: boolean
  passThreshold?: number
} = {}): Promise<Harness> {
  const ctx = new Context()
  const stateDir = '.patent-teams'
  const workspace = await tmpWorkspace()
  const agents = new Map<string, Agent>()
  const interrupted: string[] = []
  let childSeq = 0
  const started: unknown[] = []
  let sendMessageImpl: (...args: never[]) => Promise<unknown> = async () => 'msg'
  const sendMessage = vi.fn((...args: never[]) => sendMessageImpl(...args))
  const provider = {
    name: 'spawn',
    capabilities: { persona: true, toolFilter: true },
    inheritsParentContext: false,
    start: async () => { throw new Error('unused') },
    prepareContinuable: async () => ({}),
  }
  const startContinuable = vi.fn(async (spec: never) => {
    started.push(spec)
    return { childId: SessionId(`member-${++childSeq}`), messageId: 'msg' }
  })
  ctx.provide('agents', { get: (id: string) => agents.get(id) } as never)
  ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config } as never)
  ctx.provide('subagents', {
    getProvider: (name: string) => (name === 'spawn' ? provider : undefined),
    list: () => ['spawn'],
    startContinuable,
    sendMessage,
    interrupt: (id: string) => { interrupted.push(id) },
    listChildren: async () => [],
    listDescendants: async () => [],
  } as never)
  await ctx.plugin(PatentTeamsService, {
    stateDir,
    memberProvider: 'spawn',
    maxMembers: options.maxMembers ?? 8,
    ...options.memberModel === undefined ? {} : { memberModel: options.memberModel },
    qualityGate: options.qualityGate ?? false,
    passThreshold: options.passThreshold ?? 0.7,
  })
  return {
    ctx,
    workspace,
    stateDir,
    agents,
    sendMessage,
    startContinuable,
    interrupted,
    steered: [],
    setFollowup(impl) {
      sendMessageImpl = impl
    },
  }
}

async function createTeam(h: Harness, captain: Agent, name = 'Alpha', description?: string) {
  return h.ctx.patentTeams.create(captain, name, description)
}

async function addMember(h: Harness, captain: Agent, name = 'alice', extra: { role?: string; provider?: string; model?: string } = {}) {
  return h.ctx.patentTeams.addMember(captain, { name, ...extra }, new AbortController().signal)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('create', () => {
  it('creates a team on disk and returns its identity', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    const created = await createTeam(h, captain, 'Alpha', 'goal')
    expect(created.team_id).toBe('alpha')
    expect(created.team_name).toBe('Alpha')
    expect(created.state_dir).toBe(join(h.workspace, h.stateDir, 'alpha'))
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.captainSessionId).toBe(captain.id)
    expect(team?.description).toBe('goal')
  })

  it('rejects empty team names', async () => {
    const h = await makeService()
    await expect(createTeam(h, fakeAgent('captain-1', h.workspace), '   '))
      .rejects.toThrow('team name must not be empty')
  })

  it('rejects a second team for one captain', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain, 'Alpha')
    await expect(createTeam(h, captain, 'Beta')).rejects.toThrow(/you already lead team "Alpha"/)
  })

  it('rejects a team id already taken by another captain', async () => {
    const h = await makeService()
    await createTeam(h, fakeAgent('captain-1', h.workspace), 'Alpha')
    await expect(createTeam(h, fakeAgent('captain-2', h.workspace), 'alpha'))
      .rejects.toThrow('team id "alpha" is taken by another captain')
  })
})

describe('addMember', () => {
  it('spawns a durable member and persists it', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    const member = await addMember(h, captain, 'alice', { role: 'researcher' })
    expect(member.member_name).toBe('alice')
    expect(member.member_id).toMatch(/^member-\d+$/)
    expect(member.provider).toBe('spawn')
    expect(member.model).toBe('deepseek-v4')
    expect(member.status).toBe('idle')
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.members).toHaveLength(1)
    expect(team?.members[0]?.name).toBe('alice')
    expect(team?.members[0]?.role).toBe('researcher')
  })

  it('applies the configured memberModel default', async () => {
    const h = await makeService({ memberModel: 'model-x' })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    const member = await addMember(h, captain, 'alice')
    expect(member.model).toBe('model-x')
  })

  it('rejects blank, reserved, duplicate, and over-cap member names', async () => {
    const h = await makeService({ maxMembers: 1 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await expect(addMember(h, captain, '   ')).rejects.toThrow('member name must not be empty')
    await expect(addMember(h, captain, 'captain')).rejects.toThrow('reserved for the captain')
    await addMember(h, captain, 'alice')
    await expect(addMember(h, captain, 'Alice')).rejects.toThrow('has already been used in team "Alpha"')
    await expect(addMember(h, captain, 'bob')).rejects.toThrow('team "Alpha" is at its member cap (1)')
  })

  it('rejects when the captain LLM route cannot be resolved', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    delete captain.options.provider
    delete captain.options.model
    await createTeam(h, captain)
    await expect(addMember(h, captain, 'alice')).rejects.toThrow('cannot resolve the member LLM route')
  })

  it('retires the orphan and rethrows when persisting the team fails', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    const { chmod } = await import('node:fs/promises')
    // Both the team write and the orphan retirement write fail; the retirement
    // failure is swallowed and the original write error surfaces.
    await chmod(join(h.workspace, h.stateDir, 'alpha'), 0o555)
    await chmod(join(h.workspace, h.stateDir), 0o555)
    try {
      await expect(addMember(h, captain, 'alice')).rejects.toThrow()
    } finally {
      await chmod(join(h.workspace, h.stateDir), 0o755)
      await chmod(join(h.workspace, h.stateDir, 'alpha'), 0o755)
    }
    expect(h.interrupted).toContain('member-1')
  })

  it('keeps the team lock free while the member spawn is in flight', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    h.startContinuable.mockImplementationOnce(async () => {
      // From inside the spawn: the team lock must be free for other callers.
      const task = await h.ctx.patentTeams.createTask(captain, { subject: 'concurrent work' })
      expect(task.task_id).toBe('t1')
      return { childId: SessionId('member-1'), messageId: 'msg' }
    })
    const member = await addMember(h, captain, 'alice')
    expect(member.member_id).toBe('member-1')
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks.map(task => task.id)).toEqual(['t1'])
    expect(team?.members[0]?.name).toBe('alice')
  })

  it('retires the spawned orphan when the team ends while the spawn is in flight', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    h.startContinuable.mockImplementationOnce(async () => {
      await rm(join(h.workspace, h.stateDir, 'alpha'), { recursive: true, force: true })
      return { childId: SessionId('member-1'), messageId: 'msg' }
    })
    await expect(addMember(h, captain, 'alice')).rejects.toThrow('team "alpha" is no longer active')
    expect(h.interrupted).toContain('member-1')
    const retired: unknown = JSON.parse(await readFile(join(h.workspace, h.stateDir, 'retired-members.json'), 'utf8'))
    expect(retired).toContain('member-1')
  })

  it('still schedules a member that first reported status during its own spawn', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    h.startContinuable.mockImplementationOnce(async () => {
      // The child goes live before its team record is persisted; the observer
      // scans, finds nothing, and caches the id as outside every team.
      h.ctx.emit('agent/status', { agent: fakeAgent('member-1', h.workspace), status: 'running' })
      await new Promise(resolve => setTimeout(resolve, 20))
      return { childId: SessionId('member-1'), messageId: 'msg' }
    })
    await addMember(h, captain, 'alice')
    h.ctx.emit('agent/status', { agent: fakeAgent('member-1', h.workspace), status: 'running' })
    await vi.waitFor(async () => {
      expect((await readTeam(join(h.workspace, h.stateDir), 'alpha'))?.members[0]?.status).toBe('working')
    })
  })
})

describe('removeMember', () => {
  it('revokes attempts, requeues tasks, and retires the member', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const removed = await h.ctx.patentTeams.removeMember(captain, 'alice', new AbortController().signal)
    expect(removed.status).toBe('removed')
    expect(removed.requeued_tasks).toEqual(['t1'])
    expect(h.interrupted).toContain('member-1')
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.members[0]?.status).toBe('removed')
    expect(team?.tasks[0]?.status).toBe('pending')
  })

  it('fails for a missing member and for a non-captain', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await expect(h.ctx.patentTeams.removeMember(captain, 'ghost', new AbortController().signal))
      .rejects.toThrow('no active member named "ghost"')
    const stranger = fakeAgent('stranger', h.workspace)
    await expect(h.ctx.patentTeams.removeMember(stranger, 'alice', new AbortController().signal))
      .rejects.toThrow('you are not leading any team yet')
  })
})

describe('createTask', () => {
  it('creates a task with dependencies and assignment', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const task = await h.ctx.patentTeams.createTask(captain, {
      subject: 'research', description: 'deep', dependencies: [], assignee: 'alice',
    })
    expect(task).toMatchObject({ task_id: 't1', subject: 'research', status: 'pending', assignee: 'alice' })
  })

  it('rejects missing dependencies and missing assignees', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await expect(h.ctx.patentTeams.createTask(captain, { subject: 'x', dependencies: ['ghost'] }))
      .rejects.toThrow('dependency "ghost" does not exist in team "Alpha"')
    await expect(h.ctx.patentTeams.createTask(captain, { subject: 'x', assignee: 'ghost' }))
      .rejects.toThrow('no active member named "ghost"')
  })
})

describe('reassignTask', () => {
  async function setupClaimedMemberTask(h: Harness, captain: Agent): Promise<string> {
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    return 't1'
  }

  it('takes a member-owned task over to the captain', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await setupClaimedMemberTask(h, captain)
    const result = await h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal)
    expect(result).toMatchObject({ task_id: 't1', previous_assignee: 'alice', assignee: 'captain', status: 'claimed' })
    expect(result.attempt).toBe(2)
    expect(result.attempt_id).toBeDefined()
  })

  it('reassigns to another member', async () => {
    const h = await makeService({ maxMembers: 2 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await addMember(h, captain, 'bob')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const result = await h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'bob' }, new AbortController().signal)
    expect(result.assignee).toBe('bob')
    expect(result.attempt).toBe(2)
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('claimed')
    expect(team?.tasks[0]?.assignee).toBe('bob')
  })

  it('rejects empty targets, completed tasks, and busy members', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: '  ' }, new AbortController().signal))
      .rejects.toThrow('reassignment assignee must not be empty')
    // A captain-owned completed task is immutable.
    await h.ctx.patentTeams.createTask(captain, { subject: 'done' })
    const takenOver = await h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal)
    await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'in_progress', attempt_id: takenOver.attempt_id! })
    const completed = await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'completed', output: 'done', attempt_id: takenOver.attempt_id! })
    expect(completed.status).toBe('completed')
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'alice' }, new AbortController().signal))
      .rejects.toThrow('completed task t1 is immutable and cannot be reassigned')
    // A busy member cannot be the reassignment target.
    await h.ctx.patentTeams.createTask(captain, { subject: 'second', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't2', assignee: 'alice' })
    await h.ctx.patentTeams.createTask(captain, { subject: 'third', assignee: 'alice' })
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't3', assignee: 'alice' }, new AbortController().signal))
      .rejects.toThrow('member "alice" is busy with t2')
  })

  it('rejects a task that is already being reassigned', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    team!.tasks[0]!.reassigning = true
    await writeTeam(join(h.workspace, h.stateDir), team!)
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'alice' }, new AbortController().signal))
      .rejects.toThrow('task t1 is already being reassigned')
  })

  it('surfaces a quiescence failure after the handoff', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await setupClaimedMemberTask(h, captain)
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { whenIdle: () => Promise.reject(new Error('never idle')) }))
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal))
      .rejects.toThrow('never idle')
  })

  it('refuses to overwrite state changed during the reassignment', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await setupClaimedMemberTask(h, captain)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { whenIdle: () => gate }))
    const reassigning = h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal)
      .catch((error: unknown) => error)
    // While the old member quiesces, a concurrent mutation changes the handoff.
    await new Promise(resolve => setTimeout(resolve, 10))
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    team!.tasks[0]!.handoffId = 'foreign-handoff'
    await writeTeam(join(h.workspace, h.stateDir), team!)
    release()
    const result = await reassigning
    expect(String(result)).toContain('changed during reassignment')
  })
})

describe('claimTask', () => {
  async function setup(h: Harness, captain: Agent): Promise<void> {
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
  }

  it('lets the captain claim on behalf of a member', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await setup(h, captain)
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    expect(claimed.status).toBe('claimed')
    expect(claimed.assignee).toBe('alice')
    expect(claimed.attempt).toBe(1)
    expect(claimed.attempt_id).toBeDefined()
  })

  it('is idempotent for the current owner', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await setup(h, captain)
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const first = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const second = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    expect(second.attempt_id).toBe(first.attempt_id)
    expect(second.attempt).toBe(1)
  })

  it('lets a member claim its own assigned task', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await setup(h, captain)
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    const claimed = await h.ctx.patentTeams.claimTask(alice, { task_id: 't1' })
    expect(claimed.assignee).toBe('alice')
  })

  it('rejects foreign claims, blocked tasks, and busy members', async () => {
    const h = await makeService({ maxMembers: 2 })
    const captain = fakeAgent('captain-1', h.workspace)
    await setup(h, captain)
    await addMember(h, captain, 'bob')
    // Keep both members running so the scheduler cannot auto-dispatch the
    // unassigned shared task between the assertions below.
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { status: 'running' }))
    h.agents.set('member-2', fakeAgent('member-2', h.workspace, { status: 'running' }))
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const bob = fakeAgent('member-2', h.workspace)
    await expect(h.ctx.patentTeams.claimTask(bob, { task_id: 't1' }))
      .rejects.toThrow('assigned to "alice", not you')
    await expect(h.ctx.patentTeams.claimTask(bob, { task_id: 't1', assignee: 'alice' }))
      .rejects.toThrow('members cannot set assignee when claiming a task')
    // An unassigned shared task claimed by the captain without an assignee.
    await h.ctx.patentTeams.createTask(captain, { subject: 'shared' })
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't2' }))
      .rejects.toThrow('claiming an unassigned task needs an assignee')
    // Blocked by an unfinished dependency.
    await h.ctx.patentTeams.createTask(captain, { subject: 'dependent', dependencies: ['t2'] })
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't3', assignee: 'alice' }))
      .rejects.toThrow('blocked by unfinished dependencies: t2')
    // alice claims two tasks: the second claim is refused as busy.
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't2', assignee: 'alice' })
    await h.ctx.patentTeams.createTask(captain, { subject: 'another', assignee: 'alice' })
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't4', assignee: 'alice' }))
      .rejects.toThrow('member "alice" is busy with t2')
  })

  it('rejects claims on reassigning tasks and on tasks claimed by someone else', async () => {
    const h = await makeService({ maxMembers: 2 })
    const captain = fakeAgent('captain-1', h.workspace)
    await setup(h, captain)
    await addMember(h, captain, 'bob')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    // The captain claims for bob on alice's task.
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'bob' }))
      .rejects.toThrow('already claimed by "alice"')
    // A task mid-handoff cannot be claimed.
    await h.ctx.patentTeams.createTask(captain, { subject: 'handoff' })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    team!.tasks[1]!.reassigning = true
    await writeTeam(join(h.workspace, h.stateDir), team!)
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't2', assignee: 'alice' }))
      .rejects.toThrow('task t2 is being reassigned')
  })
})

describe('updateTask', () => {
  it('lets a member progress its task with the current attempt id', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    const updated = await h.ctx.patentTeams.updateTask(alice, {
      task_id: 't1', status: 'completed', output: 'done', attempt_id: claimed.attempt_id!,
    })
    expect(updated.status).toBe('completed')
    expect(updated.output).toBe('done')
  })

  it('rejects stale attempts, foreign ownership, and invalid transitions', async () => {
    const h = await makeService({ maxMembers: 2 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await addMember(h, captain, 'bob')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await expect(h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', attempt_id: 'stale' }))
      .rejects.toThrow('stale attempt for task t1')
    await expect(h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'completed' }))
      .rejects.toThrow('task t1 is owned by member "alice"')
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await expect(h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', attempt_id: claimed.attempt_id! }))
      .resolves.toMatchObject({ status: 'completed' })
    // The captain cannot touch a member-owned task even after completion.
    await expect(h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'failed' }))
      .rejects.toThrow('task t1 is owned by member "alice"')
    // Completed is terminal and immutable for the owning member.
    await expect(h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'failed', attempt_id: claimed.attempt_id! }))
      .rejects.toThrow('terminal task t1 is immutable')
    // A member updating another member's task.
    await h.ctx.patentTeams.createTask(captain, { subject: 'other', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't2', assignee: 'alice' })
    const bob = fakeAgent('member-2', h.workspace)
    await expect(h.ctx.patentTeams.updateTask(bob, { task_id: 't2', status: 'failed' }))
      .rejects.toThrow('assigned to "alice", not you')
    // Invalid transition: claimed -> completed directly on the still-claimed t2.
    const t2Claim = await h.ctx.patentTeams.claimTask(captain, { task_id: 't2', assignee: 'alice' })
    await expect(h.ctx.patentTeams.updateTask(alice, { task_id: 't2', status: 'completed', attempt_id: t2Claim.attempt_id! }))
      .rejects.toThrow('task status cannot move from "claimed" to "completed"')
  })

  it('lets the captain update its own terminal task idempotently', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await h.ctx.patentTeams.createTask(captain, { subject: 'own' })
    // Captain takeover is the production path to a captain-owned task.
    await h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal)
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1' })
    await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'completed', output: 'o', attempt_id: claimed.attempt_id! })
    await expect(h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'completed', output: 'o' }))
      .resolves.toMatchObject({ status: 'completed', output: 'o' })
  })

  it('normalizes a gate-bounced claimed task to in_progress so a resubmission is legal', async () => {
    const h = await makeService({ qualityGate: true, passThreshold: 0.7 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, {
      subject: 'work', assignee: 'alice', worker: 'patent-technical-analyzer',
    })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    // The short output misses the contract's hard fields, so the composite gate
    // bounces the submission while the task is still claimed.
    const gated = await h.ctx.patentTeams.updateTask(alice, {
      task_id: 't1', status: 'completed', output: 'ok', attempt_id: claimed.attempt_id!,
    })
    expect(gated).toMatchObject({ gated: true, status: 'in_progress' })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('in_progress')
    // A resubmission on the same attempt must not throw the claimed->completed
    // transition error (it stays gated:true until the output passes the gate).
    const resubmitted = await h.ctx.patentTeams.updateTask(alice, {
      task_id: 't1', status: 'completed', output: 'ok', attempt_id: claimed.attempt_id!,
    })
    expect(resubmitted).toMatchObject({ gated: true, status: 'in_progress' })
  })
})

describe('sendMessage', () => {
  it('delivers a member report to the live captain and acknowledges it', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    const steered: unknown[] = []
    h.agents.set('captain-1', fakeAgent('captain-1', h.workspace, { steer: (message: unknown) => steered.push(message) }))
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const alice = fakeAgent('member-1', h.workspace)
    const result = await h.ctx.patentTeams.sendMessage(alice, { to: 'captain', content: 'report' }, new AbortController().signal)
    expect(result.delivered).toBe('live')
    expect(steered).toHaveLength(1)
    const unread = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'captain')
    expect(unread).toHaveLength(0)
  })

  it('falls back to the durable mailbox when live delivery is unavailable', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const alice = fakeAgent('member-1', h.workspace)
    const result = await h.ctx.patentTeams.sendMessage(alice, { to: 'captain', content: 'report' }, new AbortController().signal)
    expect(result.delivered).toBe('mailbox')
    const unread = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'captain')
    expect(unread.map(message => message.content)).toEqual(['report'])
  })

  it('falls back when the live captain steer throws', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    h.agents.set('captain-1', fakeAgent('captain-1', h.workspace, { steer: () => { throw new Error('busy') } }))
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const result = await h.ctx.patentTeams.sendMessage(fakeAgent('member-1', h.workspace), { to: 'captain', content: 'report' }, new AbortController().signal)
    expect(result.delivered).toBe('mailbox')
  })

  it('wakes a member recipient through the captain and acknowledges on acceptance', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    h.agents.set('captain-1', captain)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const result = await h.ctx.patentTeams.sendMessage(captain, { to: 'alice', content: 'start' }, new AbortController().signal)
    expect(result.delivered).toBe('wake')
    expect(h.sendMessage).toHaveBeenCalled()
    const unread = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'alice')
    expect(unread).toHaveLength(0)
  })

  it('keeps the mailbox when waking the member is rejected', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    h.agents.set('captain-1', captain)
    h.setFollowup(async () => { throw new Error('member gone') })
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const result = await h.ctx.patentTeams.sendMessage(captain, { to: 'alice', content: 'start' }, new AbortController().signal)
    expect(result.delivered).toBe('mailbox')
    const unread = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'alice')
    expect(unread.map(message => message.content)).toEqual(['start'])
  })

  it('rejects impersonation, unknown recipients, and blank senders', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const alice = fakeAgent('member-1', h.workspace)
    await expect(h.ctx.patentTeams.sendMessage(alice, { to: 'captain', content: 'x', from: 'bob' }, new AbortController().signal))
      .rejects.toThrow('"from" must be your own identity ("alice")')
    await expect(h.ctx.patentTeams.sendMessage(captain, { to: 'ghost', content: 'x' }, new AbortController().signal))
      .rejects.toThrow('no active member named "ghost"')
    await expect(h.ctx.patentTeams.sendMessage(captain, { to: '  ', content: 'x' }, new AbortController().signal))
      .rejects.toThrow('no active member named ""')
  })
})

describe('status', () => {
  it('shows the captain the full team view and acknowledges the captain inbox', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain, 'Alpha', 'goal')
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    const message = createMessage('alice', 'captain', 'hello captain')
    await appendMailbox(join(h.workspace, h.stateDir), 'alpha', 'captain', message)
    const status = await h.ctx.patentTeams.status(captain)
    expect(status.team_name).toBe('Alpha')
    expect(status.description).toBe('goal')
    expect(status.viewer).toBe('captain')
    expect(status.members[0]?.name).toBe('alice')
    expect(status.tasks[0]?.subject).toBe('work')
    expect(status.captain_inbox).toHaveLength(1)
    // The captain reading status acknowledges its own inbox.
    const after = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'captain')
    expect(after).toHaveLength(0)
  })

  it('shows a member only its own inbox and acknowledges it', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await addMember(h, captain, 'bob')
    const message = createMessage('bob', 'alice', 'for you')
    await appendMailbox(join(h.workspace, h.stateDir), 'alpha', 'alice', message)
    const status = await h.ctx.patentTeams.status(fakeAgent('member-1', h.workspace))
    expect(status.viewer).toBe('alice')
    expect(status.member_inboxes.alice).toBeDefined()
    expect(status.member_inboxes.bob).toBeUndefined()
    const after = await readUnreadMailbox(join(h.workspace, h.stateDir), 'alpha', 'alice')
    expect(after).toHaveLength(0)
  })

  it('reports mailbox warnings and unspawned activity', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(join(h.workspace, h.stateDir, 'alpha', 'inbox'), { recursive: true })
    await writeFile(join(h.workspace, h.stateDir, 'alpha', 'inbox', 'captain.jsonl'), 'not-json\n')
    const status = await h.ctx.patentTeams.status(captain)
    expect(status.mailbox_warning_count).toBeGreaterThan(0)
    expect(status.mailbox_warnings[0]).toContain('captain mailbox line 1')
  })
})

describe('delete', () => {
  it('archives the team and retires every member', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const result = await h.ctx.patentTeams.delete(captain, new AbortController().signal)
    expect(result).toEqual({ deleted: true, team_name: 'Alpha' })
    expect(h.interrupted).toContain('member-1')
    const archived = await readArchivedTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(archived?.name).toBe('Alpha')
    expect(await readTeam(join(h.workspace, h.stateDir), 'alpha')).toBeUndefined()
  })

  it('still archives when a member does not quiesce cleanly', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const warn = vi.spyOn(h.ctx.logger, 'warn').mockImplementation(() => {})
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { whenIdle: () => Promise.reject(new Error('stuck')) }))
    const result = await h.ctx.patentTeams.delete(captain, new AbortController().signal)
    expect(result.deleted).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('member did not quiesce cleanly'))
  })

  it('refuses non-captains', async () => {
    const h = await makeService()
    await expect(h.ctx.patentTeams.delete(fakeAgent('stranger', h.workspace), new AbortController().signal))
      .rejects.toThrow('you are not leading any team yet')
  })
})

describe('archive', () => {
  it('lists archived teams and shows one team in detail', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain, 'Alpha', 'goal')
    await addMember(h, captain, 'alice', { role: 'researcher' })
    await h.ctx.patentTeams.createTask(captain, { subject: 'search prior art' })
    await h.ctx.patentTeams.delete(captain, new AbortController().signal)

    const listing = await h.ctx.patentTeams.archive(captain)
    if (listing.mode !== 'list') throw new Error('expected an archive listing')
    const row = listing.teams[0]
    if (row === undefined) throw new Error('expected one archived team row')
    const { created_at: listedAt, ...summary } = row
    expect(typeof listedAt).toBe('number')
    expect(summary).toEqual({
      team_id: 'alpha',
      team_name: 'Alpha',
      members: 1,
      tasks: 1,
      completed_tasks: 0,
    })

    const detail = await h.ctx.patentTeams.archive(captain, 'alpha')
    if (detail.mode !== 'detail') throw new Error('expected an archive detail record')
    const { created_at: detailAt, ...record } = detail.team
    expect(typeof detailAt).toBe('number')
    expect(record).toEqual({
      team_id: 'alpha',
      team_name: 'Alpha',
      description: 'goal',
      members: [{ name: 'alice', role: 'researcher' }],
      tasks: [{
        id: 't1',
        subject: 'search prior art',
        status: 'pending',
        assignee: '',
        dependencies: [],
      }],
    })
  })

  it('is workspace-scoped and empty before any archive exists', async () => {
    const h = await makeService()
    const stranger = fakeAgent('stranger', h.workspace)
    expect(await h.ctx.patentTeams.archive(stranger)).toEqual({ mode: 'list', teams: [] })
    await expect(h.ctx.patentTeams.archive(stranger, 'alpha'))
      .rejects.toThrow('no archived team "alpha" in this workspace — archived teams: none')
  })

  it('fails loud naming the available archives for an unknown id', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await h.ctx.patentTeams.delete(captain, new AbortController().signal)
    await expect(h.ctx.patentTeams.archive(captain, 'ghost'))
      .rejects.toThrow('no archived team "ghost" in this workspace — archived teams: alpha')
  })
})

describe('authorization and edge branches', () => {
  it('falls back to the process cwd and rejects agents outside any team', async () => {
    const h = await makeService()
    const cwdless = fakeAgent('cwdless', '/unused')
    // The agent's session header has no cwd: participantTeam resolves the
    // workspace from process.cwd(), where no team exists.
    const noCwd = {
      ...cwdless,
      session: Session.create(cwdless.id, [], {
        version: SESSION_FORMAT_VERSION,
        id: cwdless.id,
        createdAt: Date.now(),
        isSeeded: false,
      }),
    }
    await expect(h.ctx.patentTeams.claimTask(noCwd, { task_id: 't1' }))
      .rejects.toThrow('you do not lead or belong to any active team yet')
  })

  it('rejects updates for missing tasks', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await expect(h.ctx.patentTeams.updateTask(captain, { task_id: 'ghost' }))
      .rejects.toThrow('no task "ghost" in team "Alpha"')
  })

  it('rejects a member updating an unassigned task', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    // Keep alice busy so the scheduler cannot auto-claim the shared task.
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { status: 'running' }))
    await h.ctx.patentTeams.createTask(captain, { subject: 'shared' })
    await expect(h.ctx.patentTeams.updateTask(fakeAgent('member-1', h.workspace), { task_id: 't1', status: 'failed' }))
      .rejects.toThrow('assigned to "nobody", not you')
  })

  it('rejects claiming a terminal task', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'done' })
    const taken = await h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, new AbortController().signal)
    await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'in_progress', attempt_id: taken.attempt_id! })
    await h.ctx.patentTeams.updateTask(captain, { task_id: 't1', status: 'completed', output: 'o', attempt_id: taken.attempt_id! })
    await expect(h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' }))
      .rejects.toThrow('task status cannot move from "completed" to "claimed"')
  })

  it('adds members with an explicit route and effort', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    const member = await addMember(h, captain, 'alice', { provider: 'other', model: 'model-x', role: 'eng' })
    expect(member.provider).toBe('other')
    expect(member.model).toBe('model-x')
  })

  it('rejects with a cancelled signal before waiting for the member', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    h.agents.set('member-1', fakeAgent('member-1', h.workspace))
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(h.ctx.patentTeams.removeMember(captain, 'alice', signal))
      .rejects.toThrow('cancelled')
  })

  it('surfaces a mid-wait abort through reassignment quiescence', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const { promise, resolve } = Promise.withResolvers<undefined>()
    const enteredWait = Promise.withResolvers<undefined>()
    // Wait for waitForMemberIdle to register its abort listener and call
    // whenIdle, so the abort lands mid-wait on any host speed.
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, {
      whenIdle: () => {
        enteredWait.resolve(undefined)
        return promise
      },
    }))
    const controller = new AbortController()
    const reassigning = h.ctx.patentTeams.reassignTask(captain, {
      task_id: 't1', assignee: 'captain', reason: 'take over',
    }, controller.signal).catch((error: unknown) => error)
    await enteredWait.promise
    controller.abort('user cancelled')
    resolve(undefined)
    const result = await reassigning
    // A non-Error abort reason is wrapped into the cancellation fallback error.
    expect(String(result)).toContain('task reassignment was cancelled')
  })

  it('wraps a non-Error reason when the signal is already aborted before quiescence', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    h.agents.set('member-1', fakeAgent('member-1', h.workspace))
    const signal = AbortSignal.abort('user cancelled')
    await expect(h.ctx.patentTeams.reassignTask(captain, {
      task_id: 't1', assignee: 'captain',
    }, signal)).rejects.toThrow('task reassignment was cancelled')
  })

  it('throws the Error quiescence reason verbatim', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const { promise, resolve } = Promise.withResolvers<undefined>()
    h.agents.set('member-1', fakeAgent('member-1', h.workspace, { whenIdle: () => promise }))
    const controller = new AbortController()
    const reassigning = h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'captain' }, controller.signal)
      .catch((error: unknown) => error)
    await new Promise(resolve2 => setTimeout(resolve2, 10))
    controller.abort(new Error('stopped'))
    resolve(undefined)
    const result = await reassigning
    expect(String(result)).toBe('Error: stopped')
  })

  it('reports the team ending during reassignment', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'work', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    // The scheduler kick after the handoff deletes the whole team, so the
    // post-reassignment read finds no team.
    h.setFollowup(async () => {
      await rm(join(h.workspace, h.stateDir, 'alpha'), { recursive: true, force: true })
      return 'msg'
    })
    await expect(h.ctx.patentTeams.reassignTask(captain, { task_id: 't1', assignee: 'alice' }, new AbortController().signal))
      .rejects.toThrow('team "Alpha" ended during reassignment')
  })

  it('skips completed and foreign tasks while removing a member', async () => {
    const h = await makeService({ maxMembers: 2 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await addMember(h, captain, 'bob')
    // A task completed by alice and a task owned by bob.
    await h.ctx.patentTeams.createTask(captain, { subject: 'done', assignee: 'alice' })
    const claim = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    await h.ctx.patentTeams.updateTask(fakeAgent('member-1', h.workspace), { task_id: 't1', status: 'in_progress', attempt_id: claim.attempt_id! })
    await h.ctx.patentTeams.updateTask(fakeAgent('member-1', h.workspace), { task_id: 't1', status: 'completed', attempt_id: claim.attempt_id! })
    await h.ctx.patentTeams.createTask(captain, { subject: 'bobs', assignee: 'bob' })
    const removed = await h.ctx.patentTeams.removeMember(captain, 'alice', new AbortController().signal)
    expect(removed.requeued_tasks).toEqual([])
  })

  it('cleans up members with open tasks and removed members on delete', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'open', assignee: 'alice' })
    await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    await h.ctx.patentTeams.removeMember(captain, 'alice', new AbortController().signal)
    await expect(h.ctx.patentTeams.delete(captain, new AbortController().signal))
      .resolves.toMatchObject({ deleted: true })
  })

  it('reports a vanished team from inside the mutation lock', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const { teamLockKey, withTeamLock } = await import('../src/state.ts')
    const stateRoot = join(h.workspace, h.stateDir)
    const { promise, resolve } = Promise.withResolvers<undefined>()
    const holder = withTeamLock(teamLockKey(stateRoot, 'alpha'), async () => {
      await promise
      await rm(join(stateRoot, 'alpha'), { recursive: true, force: true })
    })
    const claiming = h.ctx.patentTeams.claimTask(fakeAgent('captain-1', h.workspace), { task_id: 't1' })
      .catch((error: unknown) => error)
    resolve(undefined)
    await holder
    const result = await claiming
    expect(String(result)).toContain('team "alpha" is no longer active')
  })

  it('rejects a participant removed between lookup and mutation', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const { teamLockKey, withTeamLock, writeTeam: persist } = await import('../src/state.ts')
    const stateRoot = join(h.workspace, h.stateDir)
    const { promise, resolve } = Promise.withResolvers<undefined>()
    const holder = withTeamLock(teamLockKey(stateRoot, 'alpha'), async () => {
      await promise
      const team = await readTeam(stateRoot, 'alpha')
      team!.members[0]!.status = 'removed'
      await persist(stateRoot, team!)
    })
    const claiming = h.ctx.patentTeams.claimTask(fakeAgent('member-1', h.workspace), { task_id: 't1' })
      .catch((error: unknown) => error)
    resolve(undefined)
    await holder
    const result = await claiming
    expect(String(result)).toContain('you are no longer an active participant in team "Alpha"')
  })
})

describe('callingAgent', () => {
  it('returns the exec agent or fails loud without one', () => {
    const agent = fakeAgent('captain-1', '/tmp')
    expect(callingAgent({ agent } as never)).toBe(agent)
    expect(() => callingAgent({} as never)).toThrow('patent_teams tools require a calling agent')
  })
})

describe('role contract and quality gate', () => {
  it('creates a task with a worker contract and rejects unknown workers', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    const task = await h.ctx.patentTeams.createTask(captain, { subject: 'search', worker: 'patent-search-commander' })
    expect(task.worker).toBe('patent-search-commander')
    await expect(h.ctx.patentTeams.createTask(captain, { subject: 'x', worker: 'ghost-worker' }))
      .rejects.toThrow('worker "ghost-worker" is not in the patent worker catalog')
  })

  it('records a contract validation verdict on a completing member task', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: '检索式：A；对比文件：D1；公开日：2024', attempt_id: claimed.attempt_id! })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.contractValidation).toMatchObject({ worker: 'patent-search-commander', valid: true, degraded: false })
  })

  it('includes role contract summaries and worker validation in status', async () => {
    const h = await makeService()
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice', { role: 'researcher' })
    await addMember(h, captain, 'bob', { role: 'ghost-role' })
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: '检索式：A；对比文件：D1；公开日：2024', attempt_id: claimed.attempt_id! })
    const status = await h.ctx.patentTeams.status(captain)
    expect(status.members[0]?.role_contract).toEqual({ stance: 'neutral', deliverables: '检索式、对比文件、公开日' })
    expect(status.members[1]?.role_contract).toBeUndefined()
    expect(status.tasks[0]?.worker).toBe('patent-search-commander')
    expect(status.tasks[0]?.contract_validation).toMatchObject({ valid: true, degraded: false })
  })

  // Contract-complete, content-sufficient, section-less work product. A search
  // report/adverse opinion is a segment, not a full multi-section brief, so it
  // must clear the gate (regression for "format dims bounce every segment").
  const CONTRACT_COMPLETE = '检索式：(A AND B) OR C。对比文件：D1 为 CN123456A（公开日 2024-01-01），D2 为 CN654321B（公开日 2023-06-15）。检索途径：CNIPA 全文检索，检索日期 2026-08-23，共命中 12 篇，其中 D1 与 D2 为最接近的现有技术。经逐篇阅读，D1 公开了权1 的全部必要技术特征，其采用相变材料填充散热基板；区别特征在于 D2 通过设置导热翅片实现散热。建议以 D1 为最接近现有技术，按三步法主张二者结合不具备技术启示，并结合 D1 的公开日论证相应时间点。' // prettier-ignore
  // Content-sufficient (>=200 chars) but missing the `公开日` hard field.
  const CONTRACT_MISSING = '检索式：(A AND B) OR C。对比文件：D1 为 CN123456A（申请号 CN202310000001），D2 为 CN654321B；二者均属 IPC 分类号 H05K 领域。检索途径：CNIPA 全文检索；检索日期 2026-08-23；命中 12 篇。经逐篇阅读，D1 公开了权1 的全部必要技术特征，其采用相变材料填充散热基板；区别特征在于 D2 通过设置导热翅片实现散热。建议以 D1 为最接近现有技术，按三步法主张二者结合不具备技术启示。' // prettier-ignore

  it('admits a contract-complete, content-sufficient completion under the default gate', async () => {
    const h = await makeService({ qualityGate: true })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    const result = await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: CONTRACT_COMPLETE, attempt_id: claimed.attempt_id! })
    expect(result.gated).toBeUndefined()
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('completed')
    expect(team?.tasks[0]?.contractValidation?.valid).toBe(true)
  })

  it('bounces a contract-incomplete completion back for rework when the gate is on', async () => {
    const h = await makeService({ qualityGate: true })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    const gated = await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: CONTRACT_MISSING, attempt_id: claimed.attempt_id! })
    expect(gated.gated).toBe(true)
    expect(gated.status).toBe('in_progress')
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('in_progress')
    expect(team?.tasks[0]?.gateFeedback?.satisfied).toBe(false)
    expect(team?.tasks[0]?.gateFeedback?.failures.join('')).toContain('契约缺字段')
  })

  it('bounces a content-thin but contract-complete completion as an empty shell', async () => {
    const h = await makeService({ qualityGate: true })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    const gated = await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: '检索式：A；对比文件：D1；公开日：2024', attempt_id: claimed.attempt_id! })
    expect(gated.gated).toBe(true)
    expect(gated.gate_feedback).toContain('内容充分性')
  })

  it('bounces a completion when the patent-rule gate requires approval', async () => {
    const h = await makeService({ qualityGate: true })
    h.ctx.provide('patentRuleGate', { process: () => ({ needsApproval: true, reviewHits: ['rule'], blockHits: [] }) })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    const gated = await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: CONTRACT_COMPLETE, attempt_id: claimed.attempt_id! })
    expect(gated.gated).toBe(true)
    expect(gated.gate_feedback).toContain('规则需要人工确认')
  })

  it('admits a compliant completion when the rule gate is mounted but no rule fires', async () => {
    const h = await makeService({ qualityGate: true })
    h.ctx.provide('patentRuleGate', { process: () => ({ needsApproval: false, reviewHits: [], blockHits: [] }) })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: CONTRACT_COMPLETE, attempt_id: claimed.attempt_id! })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('completed')
  })

  it('admits a completion whose advisory score is at or above a low pass threshold', async () => {
    const h = await makeService({ qualityGate: true, passThreshold: 0.01 })
    const captain = fakeAgent('captain-1', h.workspace)
    await createTeam(h, captain)
    await addMember(h, captain, 'alice')
    await h.ctx.patentTeams.createTask(captain, { subject: 'search', assignee: 'alice', worker: 'patent-search-commander' })
    const claimed = await h.ctx.patentTeams.claimTask(captain, { task_id: 't1', assignee: 'alice' })
    const alice = fakeAgent('member-1', h.workspace)
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'in_progress', attempt_id: claimed.attempt_id! })
    await h.ctx.patentTeams.updateTask(alice, { task_id: 't1', status: 'completed', output: CONTRACT_COMPLETE, attempt_id: claimed.attempt_id! })
    const team = await readTeam(join(h.workspace, h.stateDir), 'alpha')
    expect(team?.tasks[0]?.status).toBe('completed')
  })
})
