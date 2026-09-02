// Member lifecycle: LLM route resolution, persona/welcome text, the member
// selection bridge (fresh + cold-resume), spawning admission, message
// delivery/interrupt, the retired-member guard, and activity snapshots.
// ctx.subagents / ctx.llm / ctx.agents are stubbed with minimal fakes; the
// durable team files live under real temp directories.
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { roleContract } from '@deepseek-ai/dsh-patent-workflow'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import {
  deliverToMember,
  installRetiredMemberGuard,
  interruptMember,
  memberActivity,
  memberPersona,
  memberWelcome,
  resolveMemberLlmSelection,
  spawnMember,
} from '../src/members.ts'
import type {
  MemberRuntimeConfig,
} from '../src/members.ts'
import { recordRetiredMemberIds } from '../src/state.ts'
import type { TeamMember, TeamState } from '../src/types.ts'

const tmpRoots: string[] = []

async function tmpWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'patent-teams-members-'))
  tmpRoots.push(dir)
  return dir
}

function fakeSession(id: string, cwd: string): Session {
  return Session.create(SessionId(id), [], {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    cwd,
    isSeeded: false,
  })
}

function makeCaptain(id = 'captain-1', cwd?: string): Agent {
  const workspace = cwd ?? '/tmp'
  const session = fakeSession(id, workspace)
  return {
    id: SessionId(id),
    session,
    options: { provider: 'spawn', model: 'deepseek-v4' },
    status: 'idle',
    whenIdle: () => Promise.resolve(),
    steer: () => {},
  } as unknown as Agent
}

function makeTeam(overrides: Partial<TeamState> = {}): TeamState {
  return {
    name: 'Alpha',
    id: 'team1',
    captainSessionId: 'captain-1',
    createdAt: 1,
    members: [],
    tasks: [],
    taskSeq: 0,
    ...overrides,
  }
}

const validMember: TeamMember = {
  id: 'm1',
  name: 'alice',
  role: 'researcher',
  provider: 'spawn',
  model: 'deepseek-v4',
  reasoningEffort: 'high',
  joinedAt: 1,
  status: 'idle',
}

function makeSubagentsStub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getProvider: () => undefined,
    list: () => [],
    startContinuable: async () => ({ childId: SessionId('child-1'), messageId: 'msg-1' }),
    sendMessage: async () => 'message-1',
    interrupt: () => {},
    listChildren: async () => [],
    listDescendants: async () => [],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveMemberLlmSelection', () => {
  it('inherits the captain route when nothing is requested', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    const selection = await resolveMemberLlmSelection(ctx, captain, {})
    expect(selection).toEqual({ provider: 'spawn', model: 'deepseek-v4' })
    expect(resolveCallConfig).toHaveBeenCalledWith(
      { provider: 'spawn', model: 'deepseek-v4' },
      undefined,
    )
  })

  it('inherits the reasoning effort from the session header on the same route', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    captain.session.append('request/header', {
      header: { config: { provider: 'spawn', model: 'deepseek-v4', reasoningEffort: ReasoningEffortId('high') } },
      reason: 'initial',
    })
    const selection = await resolveMemberLlmSelection(ctx, captain, {})
    expect(selection).toEqual({ provider: 'spawn', model: 'deepseek-v4', reasoningEffort: 'high' })
    expect(resolveCallConfig).toHaveBeenCalledWith(
      { provider: 'spawn', model: 'deepseek-v4', reasoningEffort: ReasoningEffortId('high') },
      undefined,
    )
  })

  it('honors an explicit route and drops the inherited effort on a changed route', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    captain.session.append('request/header', {
      header: { config: { provider: 'spawn', model: 'deepseek-v4', reasoningEffort: ReasoningEffortId('high') } },
      reason: 'initial',
    })
    const selection = await resolveMemberLlmSelection(ctx, captain, { provider: 'other', model: 'model-x' })
    expect(selection).toEqual({ provider: 'other', model: 'model-x' })
    expect(resolveCallConfig).toHaveBeenCalledWith({ provider: 'other', model: 'model-x' }, undefined)
  })

  it('applies an explicit reasoning effort and the "default" sentinel', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')

    const explicit = await resolveMemberLlmSelection(ctx, captain, { reasoningEffort: 'low' })
    expect(explicit).toEqual({ provider: 'spawn', model: 'deepseek-v4', reasoningEffort: 'low' })

    const forcedDefault = await resolveMemberLlmSelection(ctx, captain, { reasoningEffort: 'default' })
    expect(forcedDefault).toEqual({ provider: 'spawn', model: 'deepseek-v4' })
  })

  it('uses the configured defaultModel when the captain has no model', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    delete captain.options.model
    const selection = await resolveMemberLlmSelection(ctx, captain, { defaultModel: 'fallback-model' })
    expect(selection).toEqual({ provider: 'spawn', model: 'fallback-model' })
  })

  it('fails loud when the llm service is not mounted', async () => {
    const ctx = new Context()
    const captain = makeCaptain('captain-1', '/tmp')
    await expect(resolveMemberLlmSelection(ctx, captain, {}))
      .rejects.toThrow('patent-teams: llm service is not available')
  })

  it('fails when no provider or model can be resolved', async () => {
    const ctx = new Context()
    ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    delete captain.options.provider
    delete captain.options.model
    await expect(resolveMemberLlmSelection(ctx, captain, {}))
      .rejects.toThrow('cannot resolve the member LLM route from the current captain session')
  })

  it('rejects blank route fields', async () => {
    const ctx = new Context()
    ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    await expect(resolveMemberLlmSelection(ctx, captain, { provider: '  ' }))
      .rejects.toThrow('member LLM provider must not be empty')
    await expect(resolveMemberLlmSelection(ctx, captain, { model: '' }))
      .rejects.toThrow('member model must not be empty')
    await expect(resolveMemberLlmSelection(ctx, captain, { defaultModel: '' }))
      .rejects.toThrow('configured memberModel must not be empty')
    await expect(resolveMemberLlmSelection(ctx, captain, { reasoningEffort: ' ' }))
      .rejects.toThrow('member reasoning effort must not be empty')
  })

  it('rejects a provider without an explicit model', async () => {
    const ctx = new Context()
    ctx.provide('llm', { resolveCallConfig: async (config: unknown) => config } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    await expect(resolveMemberLlmSelection(ctx, captain, { provider: 'other' }))
      .rejects.toThrow('an explicit member LLM provider requires an explicit member model')
  })

  it('forwards the caller cancellation signal', async () => {
    const ctx = new Context()
    const resolveCallConfig = vi.fn(async (config: unknown) => config)
    ctx.provide('llm', { resolveCallConfig } as never)
    const captain = makeCaptain('captain-1', '/tmp')
    const signal = new AbortController().signal
    await resolveMemberLlmSelection(ctx, captain, {}, signal)
    expect(resolveCallConfig).toHaveBeenCalledWith(
      { provider: 'spawn', model: 'deepseek-v4' },
      signal,
    )
  })
})

describe('memberPersona and memberWelcome', () => {
  it('renders the persona with the member role and team context', () => {
    const team = makeTeam({ id: 'team1', members: [validMember] })
    const persona = memberPersona(team, validMember, '.patent-teams')
    expect(persona).toContain('You are alice')
    expect(persona).toContain('with the role: researcher')
    expect(persona).toContain('the multi-agent team "Alpha"')
    expect(persona).toContain('Team id: team1')
    expect(persona).toContain('.patent-teams/team1/')
    expect(persona).toContain('patent_teams_claim_task')
    expect(persona).toContain('do not create or delete teams')
  })

  it('omits the role sentence when the member has none', () => {
    const { role: _omittedRole, ...noRoleMember } = validMember
    const persona = memberPersona(makeTeam(), noRoleMember, 'state')
    expect(persona).toContain('You are alice')
    expect(persona).not.toContain('with the role:')
  })

  it('folds a non-HITL role contract into the persona', () => {
    const team = makeTeam({ id: 'team1', members: [validMember] })
    const persona = memberPersona(team, validMember, '.patent-teams', roleContract('researcher'))
    expect(persona).toContain('Role contract:')
    expect(persona).toContain('检索员 (researcher)')
    expect(persona).toContain('Stance: [neutral]')
    expect(persona).toContain('Required deliverables: 检索式、对比文件、公开日')
    expect(persona).toContain('Forbidden:')
    expect(persona).toContain('HITL: deliverables can be completed directly')
  })

  it('marks an HITL role contract as needing confirmation', () => {
    const drafter = { ...validMember, role: 'drafter' }
    const persona = memberPersona(makeTeam(), drafter, 'state', roleContract('drafter'))
    expect(persona).toContain('HITL: deliverables need human confirmation before the final output')
    expect(persona).toContain('Required deliverables: 技术问题、技术特征、技术效果、意见陈述、修改对照')
  })

  it('renders the welcome message with the team name and task count', () => {
    const team = makeTeam({ tasks: [{ id: 't1', subject: 's', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 }] })
    const welcome = memberWelcome(team)
    expect(welcome).toContain('the team "Alpha"')
    expect(welcome).toContain('1 task(s)')
  })
})

describe('spawnMember', () => {
  function provider(overrides: Partial<SubagentProvider> = {}): SubagentProvider {
    return {
      name: 'spawn',
      capabilities: { persona: true, toolFilter: true },
      inheritsParentContext: false,
      start: async () => { throw new Error('unused') },
      prepareContinuable: async () => ({}),
      ...overrides,
    } as SubagentProvider
  }

  const config: MemberRuntimeConfig = { provider: 'spawn' }

  it('spawns a continuable child and fills the member id', async () => {
    const ctx = new Context()
    const started: unknown[] = []
    ctx.provide('subagents', makeSubagentsStub({
      getProvider: () => provider(),
      list: () => ['spawn'],
      startContinuable: async (spec: unknown) => {
        started.push(spec)
        return { childId: SessionId('child-1'), messageId: 'msg-1' }
      },
    }) as never)
    const captain = makeCaptain('captain-1')
    const team = makeTeam()
    const member: TeamMember = { ...validMember, id: '' }
    await spawnMember(ctx, config, { provider: 'p', model: 'm' }, captain, team, member, '.patent-teams', new AbortController().signal)
    expect(member.id).toBe('child-1')
    const spec = started[0] as {
      label: string
      request: {
        prompt: unknown[]
        parent: Agent
        persona: string
        toolFilter: { deny: string[] }
        agentOptions: {
          provider: string
          model: string
        }
        maxDepth?: number
      }
    }
    expect(spec.label).toBe('patent-teams:team1:alice')
    expect(spec.request.parent).toBe(captain)
    expect(spec.request.persona).toContain('You are alice')
    expect(spec.request.toolFilter.deny).toContain('patent_teams_create')
    expect(spec.request.toolFilter.deny).toContain('patent_teams_delete')
    expect(spec.request.agentOptions).toEqual({ provider: 'p', model: 'm' })
    expect(spec.request.prompt).toHaveLength(1)
    expect(spec.request.maxDepth).toBeUndefined()
  })

  it('passes the configured maxDepth through', async () => {
    const ctx = new Context()
    let captured: { request: { maxDepth?: number } } | undefined
    ctx.provide('subagents', makeSubagentsStub({
      getProvider: () => provider(),
      startContinuable: async (spec: never) => {
        captured = spec
        return { childId: SessionId('child-1'), messageId: 'msg-1' }
      },
    }) as never)
    const member: TeamMember = { ...validMember, id: '' }
    await spawnMember(ctx, { provider: 'spawn', maxDepth: 2 }, { provider: 'p', model: 'm' }, makeCaptain('captain-1'), makeTeam(), member, 'state', new AbortController().signal)
    expect(captured!.request.maxDepth).toBe(2)
  })

  it('fails loud when the provider is not registered', async () => {
    const ctx = new Context()
    ctx.provide('subagents', makeSubagentsStub({ getProvider: () => undefined, list: () => [] }) as never)
    const member: TeamMember = { ...validMember, id: '' }
    await expect(spawnMember(ctx, config, { provider: 'p', model: 'm' }, makeCaptain('captain-1'), makeTeam(), member, 'state', new AbortController().signal))
      .rejects.toThrow(/no subagent provider "spawn" is registered/)
  })

  it('fails loud when the provider lacks continuable support', async () => {
    const ctx = new Context()
    const p = provider()
    delete (p as Partial<SubagentProvider>).prepareContinuable
    ctx.provide('subagents', makeSubagentsStub({ getProvider: () => p }) as never)
    const member: TeamMember = { ...validMember, id: '' }
    await expect(spawnMember(ctx, config, { provider: 'p', model: 'm' }, makeCaptain('captain-1'), makeTeam(), member, 'state', new AbortController().signal))
      .rejects.toThrow(/does not support continuable members/)
  })

  it('fails loud when the provider cannot apply a persona', async () => {
    const ctx = new Context()
    ctx.provide('subagents', makeSubagentsStub({
      getProvider: () => provider({
        capabilities: { persona: false, toolFilter: true, outputSchema: false, depthLimit: false, agentOptions: false },
      }),
    }) as never)
    const member: TeamMember = { ...validMember, id: '' }
    await expect(spawnMember(ctx, config, { provider: 'p', model: 'm' }, makeCaptain('captain-1'), makeTeam(), member, 'state', new AbortController().signal))
      .rejects.toThrow(/cannot apply a member persona/)
  })

  it('fails loud when the provider cannot restrict captain-only tools', async () => {
    const ctx = new Context()
    ctx.provide('subagents', makeSubagentsStub({
      getProvider: () => provider({
        capabilities: { persona: true, toolFilter: false, outputSchema: false, depthLimit: false, agentOptions: true },
      }),
    }) as never)
    const member: TeamMember = { ...validMember, id: '' }
    await expect(spawnMember(ctx, config, { provider: 'p', model: 'm' }, makeCaptain('captain-1'), makeTeam(), member, 'state', new AbortController().signal))
      .rejects.toThrow(/cannot restrict captain-only tools/)
  })
})

describe('deliverToMember and interruptMember', () => {
  it('delivers a message and reports success', async () => {
    const ctx = new Context()
    const sendMessage = vi.fn(async () => 'message-id')
    ctx.provide('subagents', { sendMessage } as never)
    const captain = makeCaptain('captain-1')
    const signal = new AbortController().signal
    const accepted = await deliverToMember(ctx, captain, 'child-1', 'work', signal)
    expect(accepted).toBe(true)
    expect(sendMessage).toHaveBeenCalledWith(
      captain,
      SessionId('child-1'),
      [{ type: 'text', text: 'work' }],
      { signal },
    )
  })

  it('reports false and warns when the send fails', async () => {
    const ctx = new Context()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.provide('subagents', {
      sendMessage: async () => { throw new Error('member gone') },
    } as never)
    const accepted = await deliverToMember(ctx, makeCaptain('captain-1'), 'child-1', 'work', new AbortController().signal)
    expect(accepted).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('send to member child-1 failed'))
  })

  it('interrupts a member and swallows failures with a warning', () => {
    const ctx = new Context()
    const interrupt = vi.fn()
    ctx.provide('subagents', { interrupt } as never)
    const captain = makeCaptain('captain-1')
    interruptMember(ctx, captain, 'child-1')
    expect(interrupt).toHaveBeenCalledWith(SessionId('child-1'), { kind: 'ancestor', agent: captain })

    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    interrupt.mockImplementation(() => { throw new Error('no authority') })
    interruptMember(ctx, captain, 'child-2')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('interrupt of member child-2 failed'))
  })
})

describe('installRetiredMemberGuard', () => {
  interface GuardRuntime {
    listChildren: (parentId: SessionId, signal?: AbortSignal) => Promise<Array<{ id: string }>>
    listDescendants: (rootId: SessionId, signal?: AbortSignal) => Promise<Array<{ id: string }>>
    sendMessage: (sender: Agent, targetId: SessionId, content: unknown, options?: unknown) => Promise<unknown>
  }

  async function setupGuard(parent?: Agent): Promise<{
    ctx: Context
    stateDir: string
    runtime: GuardRuntime
  }> {
    const ctx = new Context()
    const stateDir = '.patent-teams-guard'
    const runtime = {
      listChildren: vi.fn(async () => [
        { kind: 'child', id: 'retired-1', mode: 'continuable', label: 'x', activity: 'inactive', hasChildren: false },
        { kind: 'child', id: 'live-1', mode: 'continuable', label: 'y', activity: 'inactive', hasChildren: false },
      ]),
      listDescendants: vi.fn(async () => [
        { kind: 'child', id: 'retired-1', mode: 'continuable', label: 'x', activity: 'inactive', hasChildren: false, parentId: SessionId('root'), depth: 1 },
        { kind: 'child', id: 'live-1', mode: 'continuable', label: 'y', activity: 'inactive', hasChildren: false, parentId: SessionId('root'), depth: 1 },
      ]),
      sendMessage: vi.fn(async (_p: Agent, _id: SessionId, _c: unknown, _o: unknown) => 'msg'),
    }
    ctx.provide('subagents', runtime)
    ctx.provide('agents', {
      get: (id: string) => {
        if (parent === undefined) return undefined
        return id === parent.id ? parent : undefined
      },
    })
    installRetiredMemberGuard(ctx, stateDir)
    return { ctx, stateDir, runtime }
  }

  it('filters retired ids from children and descendants listings', async () => {
    const workspace = await tmpWorkspace()
    const captain = makeCaptain('captain-1', workspace)
    await recordRetiredMemberIds(join(workspace, '.patent-teams-guard'), ['retired-1'])
    const { runtime } = await setupGuard(captain)

    const children = await runtime.listChildren(SessionId('captain-1'))
    expect(children.map(entry => entry.id)).toEqual(['live-1'])

    const descendants = await runtime.listDescendants(SessionId('captain-1'))
    expect(descendants.map(entry => entry.id)).toEqual(['live-1'])
  })

  it('rejects sends to retired members with a NOT_RESUMABLE error', async () => {
    const workspace = await tmpWorkspace()
    const captain = makeCaptain('captain-1', workspace)
    await recordRetiredMemberIds(join(workspace, '.patent-teams-guard'), ['retired-1'])
    const { runtime } = await setupGuard(captain)

    await expect(runtime.sendMessage(captain, SessionId('retired-1'), [{ type: 'text', text: 'x' }], {}))
      .rejects.toThrow(SubagentError)
    await expect(runtime.sendMessage(captain, SessionId('retired-1'), [{ type: 'text', text: 'x' }], {}))
      .rejects.toMatchObject({ code: 'NOT_RESUMABLE' })

    await expect(runtime.sendMessage(captain, SessionId('live-1'), [{ type: 'text', text: 'x' }], {})).resolves.toBe('msg')
  })

  it('does not filter when the parent is offline (no retired index to read)', async () => {
    const { runtime } = await setupGuard(undefined)
    const children = await runtime.listChildren(SessionId('captain-1'))
    expect(children.map(entry => entry.id)).toEqual(['retired-1', 'live-1'])
  })

  it('reads the retired index from the process cwd when the parent has none', async () => {
    // A live parent without a cwd in its session header: the guard falls back
    // to process.cwd(), where no retired index exists, so nothing is filtered
    // and a send still delegates.
    const parent = makeCaptain('parent-1')
    const cwdless = {
      ...parent,
      session: Session.create(parent.id, [], {
        version: SESSION_FORMAT_VERSION,
        id: parent.id,
        createdAt: Date.now(),
        isSeeded: false,
      }),
    }
    const { runtime } = await setupGuard(cwdless)
    const children = await runtime.listChildren(cwdless.id)
    expect(children.map(entry => entry.id)).toEqual(['retired-1', 'live-1'])
    await expect(runtime.sendMessage(cwdless, SessionId('anything'), [], {})).resolves.toBe('msg')
  })

  it('restores the original implementations when the owning fiber disposes', async () => {
    const ctx = new Context()
    const stateDir = '.patent-teams-guard'
    const runtime: {
      listChildren: unknown
      listDescendants: unknown
      sendMessage: unknown
    } = {
      listChildren: vi.fn(async () => []),
      listDescendants: vi.fn(async () => []),
      sendMessage: vi.fn(async (_p: Agent, _id: SessionId, _c: unknown, _o: unknown) => 'msg'),
    }
    const originalChildren = runtime.listChildren
    const originalDescendants = runtime.listDescendants
    const originalSend = runtime.sendMessage
    // The guard installs its wrappers through ctx.effect, so the originals are
    // restored when that fiber unloads.
    const fiber = ctx.plugin((scope: Context) => {
      scope.provide('subagents', runtime as never)
      scope.provide('agents', { get: () => undefined } as never)
      installRetiredMemberGuard(scope, stateDir)
    })
    await fiber
    expect(runtime.listChildren).not.toBe(originalChildren)
    expect(runtime.listDescendants).not.toBe(originalDescendants)
    expect(runtime.sendMessage).not.toBe(originalSend)
    await fiber.dispose()
    expect(runtime.listChildren).toBe(originalChildren)
    expect(runtime.listDescendants).toBe(originalDescendants)
    expect(runtime.sendMessage).toBe(originalSend)
  })

  it('leaves foreign replacements alone when the owning fiber disposes', async () => {
    const ctx = new Context()
    const stateDir = '.patent-teams-guard'
    const runtime: {
      listChildren: unknown
      listDescendants: unknown
      sendMessage: unknown
    } = {
      listChildren: vi.fn(async () => []),
      listDescendants: vi.fn(async () => []),
      sendMessage: vi.fn(async (_p: Agent, _id: SessionId, _c: unknown, _o: unknown) => 'msg'),
    }
    const replacement = vi.fn(async () => [])
    const fiber = ctx.plugin((scope: Context) => {
      scope.provide('subagents', runtime as never)
      scope.provide('agents', { get: () => undefined } as never)
      installRetiredMemberGuard(scope, stateDir)
    })
    await fiber
    // Another party replaces the guarded implementation before the fiber
    // unloads; the guard must not clobber the foreign replacement.
    runtime.listChildren = replacement
    runtime.listDescendants = replacement
    runtime.sendMessage = replacement
    await fiber.dispose()
    expect(runtime.listChildren).toBe(replacement)
    expect(runtime.listDescendants).toBe(replacement)
    expect(runtime.sendMessage).toBe(replacement)
  })
})

describe('memberActivity', () => {
  it('maps live children to their driver activity and marks cold children ready', async () => {
    const ctx = new Context()
    ctx.provide('subagents', {
      listChildren: async () => [
        { kind: 'child', id: 'c1', mode: 'continuable', label: 'x', activity: 'running', hasChildren: false },
        { kind: 'child', id: 'c2', mode: 'continuable', label: 'y', activity: 'inactive', hasChildren: false },
        { kind: 'diagnostic', id: 'broken', reason: 'corrupt' },
      ],
    } as never)
    ctx.provide('agents', {
      get: (id: string) => (id === 'c1' ? { status: 'running' } : id === 'c2' ? { status: 'idle' } : undefined),
    } as never)
    const activity = await memberActivity(ctx, 'captain-1')
    expect([...activity.entries()]).toEqual([
      ['c1', 'running'],
      ['c2', 'idle'],
    ])
  })

  it('marks children without a live agent as ready', async () => {
    const ctx = new Context()
    ctx.provide('subagents', {
      listChildren: async () => [
        { kind: 'child', id: 'c1', mode: 'continuable', label: 'x', activity: 'inactive', hasChildren: false },
      ],
    } as never)
    ctx.provide('agents', { get: () => undefined } as never)
    const activity = await memberActivity(ctx, 'captain-1')
    expect([...activity.entries()]).toEqual([['c1', 'ready']])
  })
})
