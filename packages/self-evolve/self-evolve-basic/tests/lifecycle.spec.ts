/**
 * Real-lifecycle regression tests: a live `agentLoop` agent, a scripted model,
 * and a failing tool. These cover the trigger paths that a fake
 * `runMaintenance` cannot: whether the idle boundary actually reaches the
 * provider, whether the maintenance reservation happens before the first
 * await, and whether the run bracket stays balanced.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/tests/lifecycle
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BasicSelfEvolveEngine from '../src/index.ts'
import type { BasicSelfEvolveConfig } from '../src/types.ts'

/** One text-only model response. */
function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** One response that calls `bash` and ends the turn awaiting the tool result. */
function bashResponse(callId: string, command: string): StreamChunk[] {
  const id = ToolCallId(callId)
  const args = JSON.stringify({ command })
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'bash', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'bash', arguments: args } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** Scripted adapter: one entry per model call, in order. */
class ScriptedAdapter extends LlmAdapter {
  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of entry) yield chunk
  }
}

/** Wait for the agent's next transition to idle. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

function userMessage(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('self-evolve under a real agent loop', () => {
  let cwd: string
  let home: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'self-evolve-lifecycle-'))
    home = await mkdtemp(join(tmpdir(), 'self-evolve-lifecycle-home-'))
    process.env.DSH_HOME = home
  })

  afterEach(async () => {
    delete process.env.DSH_HOME
    await rm(cwd, { recursive: true, force: true })
    await rm(home, { recursive: true, force: true })
  })

  /**
   * Build a live agent whose `bash` tool always fails, with the provider
   * mounted as a plugin. The tool renders the same `[exit code: N]` marker a
   * real shell tool does, so the failure-pattern projection classifies the
   * result and the idle loop has something to mine.
   * `allowUnverifiedAutonomousRuns` keeps the idle trigger reachable without a
   * real verifier; the run then rejects at validation, which is enough to
   * observe the bracket.
   */
  async function harness(config: Partial<BasicSelfEvolveConfig> = {}): Promise<{ ctx: Context; agent: Agent }> {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['mock'], new ScriptedAdapter([
      bashResponse('call-1', 'false'),
      bashResponse('call-2', 'false'),
      textResponse('done'),
      textResponse('idle-loop-done'),
    ]))
    ctx.tools.register({
      name: 'bash',
      description: 'Run a shell command.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      output: { schema: { type: 'string' }, render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }] },
      execute: async () => 'boom\n[exit code: 1]',
    } as never)
    ctx.provide('skills', {
      register: () => () => {},
      snapshot: async () => ({ skills: [], complete: true }),
    } as never)
    await ctx.plugin(BasicSelfEvolveEngine, {
      allowUnverifiedAutonomousRuns: true,
      minPatternOccurrences: 1,
      maxProposalsPerLoop: 1,
      defaultLevels: ['L1-skill'],
      triggers: {
        'idle-maintenance': { enabled: true, minIntervalMs: 0 },
        pressure: { enabled: true, minIntervalMs: 0 },
        'user-command': { enabled: true, minIntervalMs: 0 },
        'validation-retry': { enabled: true, minIntervalMs: 0 },
      },
      ...config,
    })
    const agent = await ctx.agentLoop.create(SessionId('lifecycle-session'), { provider: 'mock', model: 'mock' }, { cwd })
    return { ctx, agent }
  }

  function bracket(agent: Agent): { starts: number; ends: number } {
    const events = agent.session.snapshotEvents()
    return {
      starts: events.filter(event => event.type === 'self-evolve/start').length,
      ends: events.filter(event => event.type === 'self-evolve/end').length,
    }
  }

  it('opens and closes exactly one run bracket after a failed turn', async () => {
    const { ctx, agent } = await harness()
    const idle = waitForIdle(ctx, agent)
    agent.followup(userMessage('please fail twice'))
    await idle
    // `whenIdle()` follows the maintenance job the idle listener started, so
    // the bracket must already be balanced when it resolves.
    await agent.whenIdle()
    expect(bracket(agent)).toEqual({ starts: 1, ends: 1 })
  })

  it('never races the running turn for the maintenance phase', async () => {
    const { ctx, agent } = await harness()
    const idle = waitForIdle(ctx, agent)
    agent.followup(userMessage('please fail twice'))
    await idle
    await agent.whenIdle()
    const failures = agent.session.snapshotEvents()
      .filter(event => event.type === 'self-evolve/start' || event.type === 'self-evolve/end')
      .map(event => (event.data as { error?: string }).error)
      .filter((error): error is string => typeof error === 'string')
    // The bug this covers surfaced as `agent "..." already has active work`.
    expect(failures.join('\n')).not.toContain('already has active work')
  })

  it('starts at most one loop per idle boundary', async () => {
    const { ctx, agent } = await harness()
    const idle = waitForIdle(ctx, agent)
    agent.followup(userMessage('please fail twice'))
    await idle
    await agent.whenIdle()
    // A second idle transition with no new failure mines nothing new.
    const second = waitForIdle(ctx, agent)
    agent.followup(userMessage('just say done'))
    await second
    await agent.whenIdle()
    expect(bracket(agent).starts).toBeLessThanOrEqual(2)
    expect(bracket(agent).starts).toBe(bracket(agent).ends)
  })

  it('runs no autonomous loop when the deployment cannot verify a proposal', async () => {
    const { ctx, agent } = await harness({ allowUnverifiedAutonomousRuns: false })
    const idle = waitForIdle(ctx, agent)
    agent.followup(userMessage('please fail twice'))
    await idle
    await agent.whenIdle()
    // Default deployments stay a no-op rather than looping to a guaranteed
    // `verifier-unavailable` rejection.
    expect(bracket(agent)).toEqual({ starts: 0, ends: 0 })
  })
})
