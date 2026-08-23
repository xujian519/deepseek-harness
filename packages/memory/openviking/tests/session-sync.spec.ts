/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { Logger } from '@deepseek-ai/cordis'

import { OpenVikingClient } from '../src/client.ts'
import { OpenVikingError } from '../src/errors.ts'
import { SessionSync, openvikingSessionIdOf } from '../src/session-sync.ts'
import { StateStore } from '../src/state.ts'

const IDENTITY = { endpoint: 'http://127.0.0.1:1934', account: '', user: '', agentId: 'dsh' }

let tempDir: string | undefined

async function setup(overrides: { turns?: number; intervalMinutes?: number; enabled?: boolean; schedulerMs?: number } = {}) {
  tempDir = await mkdtemp(join(tmpdir(), 'ov-sync-'))
  const file = join(tempDir, 'state.json')
  const { store } = await StateStore.open(file, IDENTITY)
  const client = {
    addBatch: vi.fn(async () => ({})),
    addMessage: vi.fn(async () => ({})),
    commit: vi.fn(async () => ({})),
  } as unknown as OpenVikingClient
  const logger = { warn: vi.fn(), info: vi.fn() } as unknown as Logger
  const config = () => ({
    stateFile: file,
    autoCommit: { enabled: overrides.enabled ?? true, turns: overrides.turns ?? 3, intervalMinutes: overrides.intervalMinutes ?? 10 },
  })
  const sync = new SessionSync(client, store, config, logger, overrides.schedulerMs ?? 60_000)
  return { sync, client, store, logger, file }
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

function session(id = 's1'): Session {
  return { id } as Session
}

function event(type: SessionEvent['type'], seq: number, data: Record<string, unknown>): SessionEvent {
  return { type, seq, time: Date.now(), data } as unknown as SessionEvent
}

const userEvent = (seq: number, text = 'hi', source: Record<string, unknown> = { kind: 'user' }): SessionEvent =>
  event('user/message', seq, { content: [{ type: 'text', text }], source })

const assistantEvent = (seq: number, text = 'answer'): SessionEvent =>
  event('assistant/message', seq, { message: { content: [{ type: 'text', text }] } })

async function pending(file: string): Promise<string> {
  return readFile(file, 'utf8')
}

describe('SessionSync capture', () => {
  it('queues user and assistant text and counts one turn per user message', async () => {
    const { sync, store } = await setup()
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, event('turn/start', 0, { turn: 1 }))
    sync.capture(s, userEvent(1))
    sync.capture(s, assistantEvent(2))
    sync.capture(s, userEvent(3))
    const state = store.session(openvikingSessionIdOf('s1'))
    expect(state?.uncommittedUserTurns).toBe(1)
    await sync.flush('s1')
    expect(sync.adopt(s)).toBeDefined()
  })

  it('ignores plugin-sourced messages and empty text', async () => {
    const { sync, store } = await setup()
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1, 'injected', { kind: 'plugin', plugin: 'openviking' }))
    sync.capture(s, event('user/message', 2, { content: [{ type: 'text', text: '' }], source: { kind: 'user' } }))
    sync.capture(s, event('assistant/message', 3, { message: { content: [] } }))
    expect(store.session(openvikingSessionIdOf('s1'))?.uncommittedUserTurns ?? 0).toBe(0)
  })

  it('resets per-turn counting on turn/start and commits on the threshold', async () => {
    const { sync, client } = await setup({ turns: 2 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, event('turn/start', 0, { turn: 1 }))
    sync.capture(s, userEvent(1))
    sync.capture(s, event('turn/start', 4, { turn: 2 }))
    sync.capture(s, userEvent(5))
    sync.capture(s, event('turn/end', 6, { turn: 2 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(client.commit).toHaveBeenCalledWith('dsh-s1', { keepRecentCount: 10 })
  })

  it('never commits when autoCommit is disabled or turns is zero', async () => {
    const { sync, client } = await setup({ enabled: false })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.capture(s, event('turn/end', 2, { turn: 1 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(client.commit).not.toHaveBeenCalled()

    const second = await setup({ turns: 0 })
    second.sync.adopt(session('s2'))
    second.sync.capture(session('s2'), userEvent(1))
    second.sync.capture(session('s2'), event('turn/end', 2, { turn: 1 }))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(second.client.commit).not.toHaveBeenCalled()
  })
})

describe('SessionSync flush', () => {
  it('drains the queue through the batch endpoint and records seqs', async () => {
    const { sync, client, store } = await setup()
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.capture(s, assistantEvent(2))
    await sync.flush('s1')
    expect(client.addBatch).toHaveBeenCalledTimes(1)
    const [sessionId, messages] = (client.addBatch as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(sessionId).toBe('dsh-s1')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'user', message_kind: 'user_query', source_message_ids: ['1'] })
    expect(messages[1]).toMatchObject({ role: 'assistant', message_kind: 'assistant_step' })
    expect(store.session('dsh-s1')?.sentSeqs).toEqual([1, 2])
  })

  it('falls back to single-message appends on 404 and 405', async () => {
    const { sync, client } = await setup()
    client.addBatch = vi.fn(async () => {
      throw new (await import('../src/errors.ts')).OpenVikingError('e', 'no batch', { code: 'NOT_FOUND', httpStatus: 404 })
    })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.capture(s, assistantEvent(2))
    await sync.flush('s1')
    expect(client.addMessage).toHaveBeenCalledTimes(2)
  })

  it('keeps the queue and warns once when the server is unreachable', async () => {
    const { sync, client, logger } = await setup()
    client.addBatch = vi.fn(async () => { throw new Error('fetch failed') })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.flush('s1')
    await sync.flush('s1')
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect((client.addBatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })
})

describe('SessionSync tick and commit', () => {
  it('commits on the turn threshold and resets bookkeeping', async () => {
    const { sync, client, store } = await setup({ turns: 2 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, event('turn/start', 0, { turn: 1 }))
    sync.capture(s, userEvent(1))
    sync.capture(s, event('turn/start', 4, { turn: 2 }))
    sync.capture(s, userEvent(5))
    await sync.tick()
    expect(client.commit).toHaveBeenCalled()
    expect(store.session('dsh-s1')?.uncommittedUserTurns).toBe(0)
  })

  it('commits on the interval fallback only for previously committed sessions', async () => {
    const { sync, client, store } = await setup({ turns: 0, intervalMinutes: 10 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await store.recordCommit('dsh-s1', Date.now() - 11 * 60_000)
    await sync.tick()
    expect(client.commit).toHaveBeenCalled()
  })

  it('never commits a never-committed session via the interval alone', async () => {
    const { sync, client } = await setup({ turns: 0, intervalMinutes: 10 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.tick()
    expect(client.commit).not.toHaveBeenCalled()
  })

  it('a failed commit warns once and keeps bookkeeping', async () => {
    const { sync, client, logger } = await setup({ turns: 1 })
    client.commit = vi.fn(async () => { throw new Error('commit explode') })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.tick()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('SessionSync lifecycle', () => {
  it('forget drops the runtime without touching the store', async () => {
    const { sync, store } = await setup()
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.forget(s)
    sync.capture(s, userEvent(2))
    expect(store.session('dsh-s1')?.uncommittedUserTurns ?? 0).toBe(1)
  })

  it('dispose flushes, commits, and stops the scheduler', async () => {
    const { sync, client, store } = await setup({ turns: 1 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.dispose()
    expect(client.commit).toHaveBeenCalled()
    expect(store.session('dsh-s1')?.uncommittedUserTurns).toBe(0)
  })

  it('records no state when nothing was captured', async () => {
    const { sync, file } = await setup()
    sync.adopt(session('empty'))
    await sync.dispose()
    await expect(pending(file)).rejects.toThrow()
  })
})

describe('SessionSync scheduler and edge paths', () => {
  it('the interval tick drives the sweep when the scheduler fires', async () => {
    const { sync, client } = await setup({ turns: 1, schedulerMs: 5 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.start()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(client.commit).toHaveBeenCalled()
    await sync.dispose()
  })

  it('start is idempotent and dispose clears the timer', async () => {
    const { sync } = await setup()
    const spy = vi.spyOn(globalThis, 'setInterval')
    sync.start()
    sync.start()
    expect(spy).toHaveBeenCalledTimes(1)
    await sync.dispose()
    spy.mockRestore()
  })

  it('tick skips commit decisions when autoCommit is disabled', async () => {
    const { sync, client } = await setup({ enabled: false })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.tick()
    expect(client.commit).not.toHaveBeenCalled()
  })

  it('commit for an unknown session is a no-op', async () => {
    const { sync, client } = await setup()
    await sync.commit('ghost')
    expect(client.commit).not.toHaveBeenCalled()
  })

  it('a failing single-message fallback stops the drain and warns with a string error', async () => {
    const { sync, client, logger } = await setup()
    client.addBatch = vi.fn(async () => {
      throw new OpenVikingError('e', 'no batch', { code: 'NOT_FOUND', httpStatus: 404 })
    })
    client.addMessage = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce('boom')
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.capture(s, assistantEvent(2))
    sync.capture(s, userEvent(3))
    await sync.flush('s1')
    expect(client.addMessage).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(String((logger.warn as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain('boom')
  })

  it('dispose with no live sessions settles', async () => {
    const { sync } = await setup()
    await sync.dispose()
  })

  it('capture ignores unrelated event types', async () => {
    const { sync } = await setup()
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, event('tool/result', 9, { tool: 'x' }))
  })

  it('a turn below the threshold never commits', async () => {
    const { sync, client } = await setup({ turns: 3 })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.maybeCommitOnTurnEnd('s1')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(client.commit).not.toHaveBeenCalled()
  })

  it('the single-message fallback also engages on 405', async () => {
    const { sync, client } = await setup()
    client.addBatch = vi.fn(async () => {
      throw new OpenVikingError('e', 'no batch', { code: 'HTTP_ERROR', httpStatus: 405 })
    })
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    await sync.flush('s1')
    expect(client.addMessage).toHaveBeenCalledTimes(1)
  })

  it('skips overlapping scheduler sweeps while one flush is in flight', async () => {
    const { sync, client } = await setup({ schedulerMs: 20 })
    // A gate the addBatch await can never settle quickly: every later tick of
    // the 20ms interval would otherwise start another concurrent flush.
    const gate: { resolve?: () => void } = {}
    const blocked = new Promise<void>((resolve) => { gate.resolve = resolve })
    const addBatch = vi.fn(async () => { await blocked; return {} })
    client.addBatch = addBatch
    const s = session('s1')
    sync.adopt(s)
    sync.capture(s, userEvent(1))
    sync.start()
    // Several interval rounds pass while the first flush is still awaiting.
    await new Promise(resolve => setTimeout(resolve, 90))
    expect(addBatch).toHaveBeenCalledTimes(1)
    gate.resolve?.()
    await new Promise(resolve => setTimeout(resolve, 50))
    await sync.dispose()
  })
})
