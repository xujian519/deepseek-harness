/**
 * Side Chat coverage for the degenerate shapes the behavior specs do not
 * reach: the seed copier's envelope fields (surfaceOp/sourceEventSeqs/
 * ignorable), torn (sparse) logs, malformed tool envelopes in the snapshot
 * builder, the boundary recognizers, and every optional-service degradation
 * of the four routes (absent presets/persistence/title services, absent or
 * failing agents registry, non-Error refusals, minimal live info).
 */
import { describe, expect, it, vi } from 'vitest'
import { anyString } from './matchers.ts'
import { buildSidechatApi } from '../src/sidechat-routes.ts'
import { SidebarError } from '../src/wire.ts'
import {
  buildOpenTurnSnapshot,
  buildSidechatInheritance,
  boundaryDelivered,
  hasDanglingToolCall,
  isContextInjectionMessage,
  resolvePresetId,
  SIDE_BOUNDARY_PROMPT,
  SIDE_NEW_THREAD_TITLE,
  sidechatSeed,
  type SidechatLogEvent,
} from '../src/sidechat-core.ts'
import type { Context } from '../src/context-types.ts'

/** One seed event; message-producing rows carry the surface marker. */
function ev(
  type: string, seq: number, data: Record<string, unknown>,
  extra: Partial<SidechatLogEvent> & { surfaceOp?: string; sourceEventSeqs?: unknown; ignorable?: true } = {},
): SidechatLogEvent {
  const event: SidechatLogEvent & { surfaceOp?: string } = { type, seq, time: seq * 1000, data, ...extra }
  if ((type === 'user/message' || type === 'assistant/message' || type === 'tool/result') && event.surfaceOp === undefined) {
    event.surfaceOp = 'append'
  }
  return event
}

/** A fake live agent (inject/followup/cancel spied). */
function agent(id: string, over: { events?: SidechatLogEvent[]; header?: Record<string, unknown>; options?: Record<string, unknown>; status?: 'idle' | 'running' } = {}) {
  return {
    id,
    status: over.status ?? 'idle',
    options: over.options ?? {},
    session: {
      id,
      header: { delegationDepth: 0, ...over.header },
      snapshotEvents: () => over.events ?? [],
    },
    inject: vi.fn(),
    followup: vi.fn(),
    cancel: vi.fn(),
  }
}

type AgentLike = ReturnType<typeof agent>
type Handle = { agent: AgentLike; dispose: () => Promise<void> }

/** Standard optional services for the routes (all spied). */
function services(parent: AgentLike | undefined, child: AgentLike) {
  const create = vi.fn(async (_options: unknown): Promise<Handle> => ({ agent: child, dispose: vi.fn(async () => {}) }))
  const resume = vi.fn(async (_options: unknown): Promise<Handle> => ({ agent: child, dispose: vi.fn(async () => {}) }))
  const get = vi.fn((id: unknown) => (id === child.id ? child : parent))
  const rename = vi.fn(() => ({ title: 'x', eventSeq: 1 }))
  const resolve = vi.fn(async () => ({ id: 'preset-a' }))
  const mount = vi.fn(async () => {})
  const inspect = vi.fn(async () => ({ meta: {}, events: [] as SidechatLogEvent[] }))
  return {
    agents: { get, create, resume },
    agentPresets: { resolve, mount },
    sessionTitle: { rename },
    sessionPersistence: { inspect },
    create,
    resume,
    get,
    rename,
    resolve,
    mount,
    inspect,
  }
}

function ctxWith(servicesTable: Record<string, unknown>): Context {
  return { get: (key: string) => servicesTable[key] } as unknown as Context
}

describe('sidechat-core seed and snapshot edges', () => {
  it('preserves the full event envelope (surfaceOp, sourceEventSeqs, ignorable) in the seed', () => {
    const events: SidechatLogEvent[] = [
      ev('user/message', 0, { content: [{ type: 'text', text: 'q' }] }, { surfaceOp: 'replace', sourceEventSeqs: [0], ignorable: true }),
      ev('turn/start', 1, { turn: 1 }),
      ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
    ]
    const { seed, snapshot } = buildSidechatInheritance(events)
    expect(snapshot).toBeNull()
    expect(seed[0]).toMatchObject({ surfaceOp: 'replace', sourceEventSeqs: [0], ignorable: true })
    expect(seed.map(event => event.type)).toEqual(['user/message', 'turn/start', 'turn/end'])
  })

  it('copies a log with no turn boundary verbatim', () => {
    const events = [ev('user/message', 0, { content: 'pending question' })]
    const { seed, snapshot } = buildSidechatInheritance(events)
    expect(seed).toHaveLength(1)
    expect(snapshot).toBeNull()
    expect(sidechatSeed(events)).toEqual(seed)
  })

  it('defaults a non-numeric turn marker to 0 in the synthetic close', () => {
    const events = [
      ev('turn/start', 0, { turn: 'corrupt' }),
      ev('step/start', 1, {}),
      ev('assistant/message', 2, { message: { content: [{ type: 'text', text: 'partial' }] } }),
    ]
    const { seed } = buildSidechatInheritance(events)
    const close = seed.at(-1)!
    expect(close.type).toBe('turn/end')
    expect(close.data).toEqual({ turn: 0, reason: { kind: 'interrupted' } })
  })

  it('treats a torn (sparse) log as no open step and no dangling calls', () => {
    const events: SidechatLogEvent[] = new Array<SidechatLogEvent>(4)
    events[0] = ev('turn/start', 0, { turn: 1 })
    events[3] = ev('assistant/chunk', 3, { chunk: { type: 'text-delta', text: 'x' } })
    // The holes must be skipped, not crash: no open step number, no dangling call.
    expect(hasDanglingToolCall(events, 0)).toBe(false)
    const { seed } = buildSidechatInheritance(events)
    // The copy is verbatim: torn rows stay holes, and only the honest
    // synthetic turn close is appended (no step was open).
    expect(seed.map(event => event?.type)).toEqual(['turn/start', undefined, undefined, 'assistant/chunk', 'turn/end'])
  })

  it('ignores tool rows with non-string call ids when detecting dangling calls', () => {
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      ev('tool/call', 1, { callId: 42, name: 'bash' }),
      ev('tool/result', 2, { message: { source: { callId: null } } }),
    ]
    expect(hasDanglingToolCall(events, 0)).toBe(false)
  })

  it('falls back to the snapshot when a tool call is still executing', () => {
    const events = [
      ev('user/message', 0, { content: [{ type: 'text', text: 'q' }] }),
      ev('turn/start', 1, { turn: 2 }),
      ev('step/start', 2, { turn: 2, step: 1 }),
      ev('tool/call', 3, { callId: 'c1', name: 'bash', arguments: '{"cmd":"sleep"}' }),
    ]
    const { seed, snapshot } = buildSidechatInheritance(events)
    expect(seed.map(event => event.type)).toEqual(['user/message'])
    expect(snapshot).toContain('`bash` (executing)')
  })

  it('extracts tool-result text from well-formed blocks only (snapshot path)', () => {
    // buildOpenTurnSnapshot is reached directly here to pin the malformed
    // envelope handling of the tool/result text extractor.
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      ev('tool/result', 1, { message: 'not-an-envelope' }),
      ev('tool/result', 2, { message: { content: 'not-an-array' } }),
      ev('tool/result', 3, { message: { content: [null, { type: 'text' }, { type: 'tool-result' }, { type: 'tool-result', content: 'x' }, { type: 'tool-result', content: [null, { type: 'text', text: 5 }, { type: 'text', text: 'kept' }] }] } }),
    ]
    const snapshot = buildOpenTurnSnapshot(events)
    expect(snapshot).toContain('  Result: kept')
  })

  it('renders tool activity lines with unknown, failed, argument-less, and silent results', () => {
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      // A call whose id is not a string never pairs with a result.
      ev('tool/call', 1, { callId: 7, name: 'ignored' }),
      // A result with no recognizable callId renders as the generic `tool`.
      ev('tool/result', 2, { message: { source: {}, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'orphan' }] }] } }),
      // A failed result with arguments.
      ev('tool/call', 3, { callId: 'f1', name: 'bash', arguments: 'ls -la' }),
      ev('tool/result', 4, { error: { message: 'boom' }, message: { source: { callId: 'f1' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'stderr text' }] }] } }),
      // A successful result with no arguments and an empty result body.
      ev('tool/call', 5, { callId: 'q1', name: 'noop' }),
      ev('tool/result', 6, { message: { source: { callId: 'q1' }, content: [{ type: 'tool-result', content: [] }] } }),
    ]
    const snapshot = buildOpenTurnSnapshot(events)!
    expect(snapshot).toContain('- `tool`\n  Result: orphan')
    expect(snapshot).toContain('- `bash` (failed) — arguments: `ls -la`')
    expect(snapshot).toContain('  Result: stderr text')
    expect(snapshot).toContain('- `noop`')
    expect(snapshot).toContain('Tool activity:')
  })

  it('folds text and reasoning chunks and drops malformed chunk rows', () => {
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      ev('assistant/chunk', 1, { chunk: 'malformed' }),
      ev('assistant/chunk', 2, { chunk: null }),
      ev('assistant/chunk', 3, { chunk: { type: 'text-delta', text: 'hello ' } }),
      ev('assistant/chunk', 4, { chunk: { type: 'reasoning-delta', text: 'thinking' } }),
      ev('assistant/chunk', 5, { chunk: { type: 'unknown-kind' } }),
      // Non-string call metadata renders the generic fallbacks.
      ev('tool/call', 6, { callId: 'c1' }),
    ]
    const snapshot = buildOpenTurnSnapshot(events)!
    expect(snapshot).toContain('Assistant output so far:\n\nhello ')
    expect(snapshot).toContain('Reasoning so far:\n\nthinking')
    expect(snapshot).toContain('- `tool` (executing) — arguments: ``')
  })

  it('returns null when the open turn produced nothing readable', () => {
    const events = [ev('turn/start', 0, { turn: 1 }), ev('assistant/chunk', 1, { chunk: { type: 'unknown' } })]
    expect(buildOpenTurnSnapshot(events)).toBeNull()
  })

  it('caps the snapshot body with an ellipsis', () => {
    const longText = 'x'.repeat(9000)
    const events = [
      ev('turn/start', 0, { turn: 1 }),
      ev('assistant/chunk', 1, { chunk: { type: 'text-delta', text: longText } }),
    ]
    const snapshot = buildOpenTurnSnapshot(events)!
    expect(snapshot.startsWith('Parent session in-progress turn (reference only):')).toBe(true)
    expect(snapshot.endsWith('…')).toBe(true)
    expect(snapshot.length).toBeLessThan(longText.length)
  })

  it('skips a torn log tail when folding the open turn', () => {
    const events: SidechatLogEvent[] = new Array<SidechatLogEvent>(3)
    events[0] = ev('turn/start', 0, { turn: 1 })
    events[1] = ev('assistant/chunk', 1, { chunk: { type: 'text-delta', text: 'tail text' } })
    // events[2] is a hole; the fold must skip it and still emit the text.
    const snapshot = buildOpenTurnSnapshot(events)
    expect(snapshot).toContain('tail text')
  })

  it('boundaryDelivered skips non-user rows and reads block-array content', () => {
    expect(boundaryDelivered([ev('turn/start', 0, {}), ev('assistant/message', 1, {})])).toBe(false)
    expect(boundaryDelivered([
      ev('user/message', 0, { content: [{ type: 'text', text: `${SIDE_BOUNDARY_PROMPT}\nmore` }] }),
    ])).toBe(true)
    expect(boundaryDelivered([ev('user/message', 0, { content: [{ type: 'image' }] })])).toBe(false)
  })

  it('isContextInjectionMessage recognizes plugin-sourced rows and boundary leads', () => {
    expect(isContextInjectionMessage({ source: { kind: 'plugin' } })).toBe(true)
    expect(isContextInjectionMessage({ content: [{ type: 'text', text: SIDE_BOUNDARY_PROMPT }] })).toBe(true)
    expect(isContextInjectionMessage({ content: 'plain user text' })).toBe(false)
  })

  it('resolvePresetId ignores non-string event presets and falls back to the header', () => {
    const header = { agentPreset: 'header-preset' }
    const events = [ev('agent-preset/selected', 0, { agentPreset: 42 })]
    expect(resolvePresetId(header, events)).toBe('header-preset')
  })
})

describe('sidechat routes optional-service degradation', () => {
  it('starts a thread without presets, cwd, model, or title services (minimal meta)', async () => {
    const parent = agent('parent', {
      header: { cwd: undefined, delegationDepth: undefined },
      options: {},
    })
    const child = agent('child')
    const table = services(parent, child)
    delete (table as Record<string, unknown>).agentPresets
    delete (table as Record<string, unknown>).sessionTitle
    const api = buildSidechatApi(ctxWith(table))

    // No question field at all: the Codex-style immediate create.
    const { childId } = await api['sidechat.start']({ sessionId: 'parent' })

    expect(childId).toMatch(/^session-/)
    const options = table.create.mock.calls[0]![0] as {
      meta: Record<string, unknown>
      seed: Array<{ type: string }>
      setup: (ctx: unknown) => Promise<void>
    }
    expect(options.meta).toEqual({
      parentSession: 'parent',
      isSeeded: true,
      origin: 'subagent',
      delegationDepth: 1,
    })
    expect(options.seed.map(event => event.type)).toEqual(['subagent/descriptor'])
    expect(table.rename).not.toHaveBeenCalled()
    expect(child.inject).not.toHaveBeenCalled()
    // The composition setup without a presets service is a no-op resolve.
    await expect(options.setup({})).resolves.toBeUndefined()
  })

  it('composes the parent preset and mounts it through the child setup', async () => {
    const parent = agent('parent', {
      events: [
        ev('user/message', 0, { content: [{ type: 'text', text: 'q' }] }),
        ev('turn/end', 1, { turn: 1, reason: { kind: 'completed' } }),
        ev('agent-preset/selected', 2, { agentPreset: 'preset-b' }),
      ],
    })
    const child = agent('child')
    const table = services(parent, child)
    const api = buildSidechatApi(ctxWith(table))
    await api['sidechat.start']({ sessionId: 'parent', question: 'hello there' })
    expect(table.resolve).toHaveBeenCalledWith('preset-b')
    const options = table.create.mock.calls[0]![0] as { setup: (ctx: unknown) => Promise<void>; meta: Record<string, unknown> }
    await options.setup({ agentScope: true })
    expect(table.mount).toHaveBeenCalledWith({ agentScope: true }, 'preset-a')
    expect(options.meta.agentPreset).toBe('preset-a')
    expect(table.rename).toHaveBeenCalledWith(child.session, 'Side: hello there')
  })

  it('degrades to a 503 when the agents service lacks create', async () => {
    const parent = agent('parent')
    const table = services(parent, agent('child'))
    const api = buildSidechatApi(ctxWith({ agents: { get: table.agents.get } }))
    await expect(api['sidechat.start']({ sessionId: 'parent', question: 'q' })).rejects.toMatchObject({
      code: 'sidechat-error',
      status: 503,
    })
  })

  it('wraps create failures (Error and non-Error) into a 500 sidechat-error', async () => {
    const parent = agent('parent')
    for (const thrown of [new Error('registry exploded'), 'registry string failure']) {
      const table = services(parent, agent('child'))
      table.agents.create = vi.fn(async () => { throw thrown })
      const api = buildSidechatApi(ctxWith(table))
      await expect(api['sidechat.start']({ sessionId: 'parent', question: 'q' })).rejects.toMatchObject({
        code: 'sidechat-error',
        status: 500,
        message: anyString(thrown instanceof Error ? 'registry exploded' : 'registry string failure'),
      })
    }
  })

  it('rejects blank prompt text as bad-request', async () => {
    const table = services(undefined, agent('child'))
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.prompt']({ childId: 'child', text: '   ' })).rejects.toThrow(SidebarError)
  })

  it('degrades a cold prompt to a 503 without an agents service', async () => {
    const api = buildSidechatApi(ctxWith({}))
    await expect(api['sidechat.prompt']({ childId: 'ghost', text: 'hi' })).rejects.toMatchObject({ status: 503 })
  })

  it('wraps resume failures (Error and non-Error) into a 500 sidechat-error', async () => {
    for (const thrown of [new Error('resume exploded'), 'resume string failure']) {
      const table = services(undefined, agent('child'))
      table.agents.get = vi.fn(() => undefined)
      table.agents.resume = vi.fn(async () => { throw thrown })
      const api = buildSidechatApi(ctxWith(table))
      await expect(api['sidechat.prompt']({ childId: 'child', text: 'hi' })).rejects.toMatchObject({
        status: 500,
        message: anyString(thrown instanceof Error ? 'resume exploded' : 'resume string failure'),
      })
    }
  })

  it('cold-resumes through the persisted preset composition', async () => {
    const child = agent('child')
    const table = services(undefined, child)
    table.agents.get = vi.fn(() => undefined)
    table.sessionPersistence.inspect = vi.fn(async () => ({
      meta: { agentPreset: 'persisted-preset' },
      events: [ev('agent-preset/selected', 0, { agentPreset: 'persisted-preset' })],
    }))
    const api = buildSidechatApi(ctxWith(table))
    await api['sidechat.prompt']({ childId: 'child', text: 'after restart' })
    expect(table.sessionPersistence.inspect).toHaveBeenCalledWith('child')
    expect(table.resolve).toHaveBeenCalledWith('persisted-preset')
    const resumeOptions = table.resume.mock.calls[0]![0] as { setup: (ctx: unknown) => Promise<void> }
    await resumeOptions.setup({ resumed: true })
    expect(table.mount).toHaveBeenCalledWith({ resumed: true }, 'preset-a')
  })

  it('cold-resumes without composition when persistence or presets are absent', async () => {
    const child = agent('child')
    const table = services(undefined, child)
    table.agents.get = vi.fn(() => undefined)
    delete (table as Record<string, unknown>).sessionPersistence
    delete (table as Record<string, unknown>).agentPresets
    const api = buildSidechatApi(ctxWith(table))
    await api['sidechat.prompt']({ childId: 'child', text: 'bare resume' })
    const resumeOptions = table.resume.mock.calls[0]![0] as { setup: (ctx: unknown) => Promise<void> }
    await expect(resumeOptions.setup({})).resolves.toBeUndefined()
    expect(table.mount).not.toHaveBeenCalled()
  })

  it('delivers a first contact without a title service (no rename attempted)', async () => {
    const child = agent('child')
    const table = services(undefined, child)
    delete (table as Record<string, unknown>).sessionTitle
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.prompt']({ childId: 'child', text: 'first message' })).resolves.toEqual({ accepted: true })
    expect(child.inject).toHaveBeenCalledTimes(1)
    expect(child.followup).toHaveBeenCalledTimes(1)
    expect(table.rename).not.toHaveBeenCalled()
  })

  it('cancels an unknown child without failing', async () => {
    const table = services(undefined, agent('child'))
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.cancel']({ childId: 'ghost' })).resolves.toEqual({ accepted: true })
  })

  it('reports minimal live info when provider, model, and preset are absent', async () => {
    const child = agent('child', { header: { agentPreset: undefined }, options: {} })
    const table = services(undefined, child)
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.info']({ childId: 'child' })).resolves.toEqual({ live: true, status: 'idle' })
  })

  it('reports a bare cold info without a persistence service', async () => {
    const table = services(undefined, agent('child'))
    table.agents.get = vi.fn(() => undefined)
    delete (table as Record<string, unknown>).sessionPersistence
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.info']({ childId: 'ghost' })).resolves.toEqual({ live: false })
  })

  it('reports a cold info without a preset when persistence has none', async () => {
    const table = services(undefined, agent('child'))
    table.agents.get = vi.fn(() => undefined)
    const api = buildSidechatApi(ctxWith(table))
    await expect(api['sidechat.info']({ childId: 'child' })).resolves.toEqual({ live: false })
  })

  it('starts an empty thread without a parked snapshot on a balanced parent log', async () => {
    const parent = agent('parent', {
      events: [ev('turn/end', 0, { turn: 1, reason: { kind: 'completed' } })],
    })
    const child = agent('child')
    const table = services(parent, child)
    const api = buildSidechatApi(ctxWith(table))
    const { childId } = await api['sidechat.start']({ sessionId: 'parent', question: '  ' })
    expect(table.rename).toHaveBeenCalledWith(child.session, SIDE_NEW_THREAD_TITLE)
    // The first prompt then delivers the boundary alone (nothing parked).
    table.agents.get = vi.fn((id: unknown) => (id === childId ? child : parent))
    await api['sidechat.prompt']({ childId, text: 'the real question' })
    const injection = child.inject.mock.calls[0]![0] as { content: Array<{ text: string }> }
    expect(injection.content[0]!.text.startsWith(SIDE_BOUNDARY_PROMPT)).toBe(true)
    expect(injection.content[0]!.text).not.toContain('reference only')
  })
})
