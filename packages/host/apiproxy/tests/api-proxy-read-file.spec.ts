/**
 * host.readFileText: bounded UTF-8 preview reads against real temp files —
 * content round-trip, truncation at the cap, invalid UTF-8, missing files,
 * and cancellation.
 */
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`read-file-${String(nextRpc++)}`), payload }
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

async function harness() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-read-file-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(options.sessionId)
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { api, cwd }
}

describe('host.readFileText', () => {
  it('returns the UTF-8 content of a readable text file', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'report.html')
    writeFileSync(path, '<h1>交付报告</h1>', 'utf8')

    const response = await api.host.readFileText(request({ path }), new AbortController().signal)

    expect(response.result).toEqual({
      ok: true,
      value: { content: '<h1>交付报告</h1>', truncated: false },
    })
  })

  it('returns the head when the file exceeds the caller cap and marks it truncated', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'long.txt')
    writeFileSync(path, 'hello world', 'utf8')

    const response = await api.host.readFileText(request({ path, maxBytes: 5 }), new AbortController().signal)

    expect(response.result).toEqual({ ok: true, value: { content: 'hello', truncated: true } })
  })

  it('drops a multi-byte character split by the cap so the head stays valid UTF-8', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'cjk.html')
    // '报' is a 3-byte character at offsets 5..7; a cap of 6 cuts inside it.
    writeFileSync(path, 'AAAAA报BBBBBBBBBB', 'utf8')

    const response = await api.host.readFileText(request({ path, maxBytes: 6 }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value).toEqual({ content: 'AAAAA', truncated: true })
  })

  it('keeps a character whose last byte lands exactly on the cap', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'cjk-boundary.html')
    // The 3-byte character ends at offset 8, exactly on the cap.
    writeFileSync(path, 'AAAAA报B', 'utf8')

    const response = await api.host.readFileText(request({ path, maxBytes: 8 }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value).toEqual({ content: 'AAAAA报', truncated: true })
  })

  it('caps at 4 MiB regardless of the requested budget', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'huge.bin')
    writeFileSync(path, 'x'.repeat(8 * 1024 * 1024), 'utf8')

    const response = await api.host.readFileText(request({ path, maxBytes: 8 * 1024 * 1024 }), new AbortController().signal)

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.truncated).toBe(true)
    expect(response.result.value.content.length).toBe(4 * 1024 * 1024)
  })

  it('fails with file-unreadable for a missing path and names the path', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'absent.html')

    const response = await api.host.readFileText(request({ path }), new AbortController().signal)

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('file-unreadable')
    expect(response.result.error.details).toEqual({ path })
  })

  it('fails with file-unreadable for non-UTF-8 content', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'binary.bin')
    writeFileSync(path, Buffer.from([0xff, 0xfe, 0x00, 0x80]))

    const response = await api.host.readFileText(request({ path }), new AbortController().signal)

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('file-unreadable')
    expect(response.result.error.message).toContain('not valid UTF-8')
  })

  it('answers cancelled for an aborted caller even when the read would fail', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'absent.html')

    const response = await api.host.readFileText(request({ path }), AbortSignal.abort())

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('cancelled')
  })

  it('checks the caller abort on the failure path only, like openPath', async () => {
    const { api, cwd } = await harness()
    const path = join(cwd, 'ok.txt')
    writeFileSync(path, 'fine', 'utf8')
    const controller = new AbortController()
    controller.abort()

    const response = await api.host.readFileText(request({ path }), controller.signal)

    expect(response.result).toEqual({ ok: true, value: { content: 'fine', truncated: false } })
  })
})
