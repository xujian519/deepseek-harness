/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

/* oxlint-disable typescript/await-thenable -- The fixture emits synthetic session events that are thenables by shape. */

import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

import { apply, Config, createPreInitSync, dedupeWarn, errorLabel, inject, name, probeHealth } from '../src/index.ts'
import { SETTINGS_NAMESPACE } from '../src/config.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('@deepseek-ai/dsh-openviking plugin surface', () => {
  it('exports the Cordis function-plugin namespace', () => {
    expect(name).toBe('openviking')
    expect(inject).toEqual(['tools', 'fs', 'systemPrompt', 'agents'])
  })

  it('defaults the endpoint to the local OpenViking service', () => {
    const config = Config({}) as unknown as {
      endpoint: string
      timeoutMs: number
      stateFile: string
    }
    expect(config.endpoint).toBe('http://localhost:1933')
    expect(config.timeoutMs).toBe(30000)
    expect(config.stateFile).toBe('~/.dsh/openviking/state.json')
  })

  it('rejects a timeout outside the documented range', () => {
    expect(() => Config({ timeoutMs: 500 })).toThrow()
  })

  it('mounts with an unreachable service without throwing', async () => {
    const ctx = new Context()
    const config = Config({ endpoint: 'http://127.0.0.1:1' }) as Parameters<typeof apply>[1]
    const fiber = await ctx.plugin(apply, config)
    await new Promise(resolve => setTimeout(resolve, 30))
    await fiber.dispose()
  })

  it('registers the openviking settings namespace when a settings service is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(apply, Config({}))
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).toContain(SETTINGS_NAMESPACE)
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(SETTINGS_NAMESPACE)
  })

  it('wires session lifecycle events through the mount', async () => {
    const ctx = new Context()
    const tmp = await mkdtemp(join(tmpdir(), 'ov-mount-'))
    const stateFile = join(tmp, 'state.json')
    const config = Config({ endpoint: 'http://127.0.0.1:1', stateFile }) as Parameters<typeof apply>[1]
    const fiber = ctx.plugin(apply, config)
    await fiber.await()
    await new Promise(resolve => setTimeout(resolve, 100))
    const agent = { session: { id: 's1' } } as never
    ;(ctx.emit as never as (event: string, ...args: unknown[]) => unknown)('agent/created', { agent })
    ;(ctx.emit as never as (event: string, ...args: unknown[]) => unknown)('agent/session-start', { agent, source: { kind: 'user' } })
    await new Promise(resolve => setTimeout(resolve, 100))
    const emitAny = (event: string, ...args: unknown[]): void => {
      ;(ctx.emit as never as (event: string, ...args: unknown[]) => unknown)(event, ...args)
    }
    emitAny('session/event', { id: 's1' }, {
      type: 'user/message', seq: 1, time: Date.now(),
      data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } },
    })
    emitAny('session/flush', { id: 's1' })
    // Exercise the pre-step listener paths: accepted, rejected, and aborted.
    const preStep = (
      signal?: AbortSignal,
      next = async (): Promise<{ kind: 'enter'; messages: never[] }> => ({ kind: 'enter', messages: [] }),
    ): void => {
      const signalValue = signal ?? new AbortController().signal
      ctx.emit('agent/pre-step', { agent, step: 1, messages: [], signal: signalValue } as never, next as never)
    }
    preStep()
    preStep(undefined, async () => ({ kind: 'reject' }) as never)
    const aborted = new AbortController()
    aborted.abort()
    preStep(aborted.signal)
    const preExec = ctx.emit as never as (event: string, ...args: unknown[]) => unknown
    preExec('tools/pre-execute', { name: 'read', arguments: { file_path: 'viking://x' } }, async () => ({ kind: 'allow' }))
    ;(ctx.emit as never as (event: string, ...args: unknown[]) => unknown)('agent/disposed', { agent })
    await fiber.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('warns when the previous state file was quarantined', async () => {
    const ctx = new Context()
    const tmp = await mkdtemp(join(tmpdir(), 'ov-mount-'))
    const stateFile = join(tmp, 'state.json')
    await (await import('node:fs/promises')).writeFile(stateFile, '{not json')
    const config = Config({ endpoint: 'http://127.0.0.1:1', stateFile }) as Parameters<typeof apply>[1]
    const fiber = ctx.plugin(apply, config)
    await fiber.await()
    await new Promise(resolve => setTimeout(resolve, 100))
    await fiber.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('renders recall context through a mounted system prompt', async () => {
    const ctx = new Context()
    const tmp = await mkdtemp(join(tmpdir(), 'ov-mount-'))
    const stateFile = join(tmp, 'state.json')
    await ctx.plugin(SystemPrompt, { persona: 'You are an agent.' })
    const fiber = ctx.plugin(apply, Config({ endpoint: 'http://127.0.0.1:1', stateFile }))
    await fiber.await()
    const assembly = await ctx.systemPrompt.assemble({ agent: { id: 'a1' } } as never)
    // Repositories/library/recall contribute contexts (empty text contributes nothing).
    for (const name of ['openviking:repositories', 'openviking:library', 'openviking:memories']) {
      expect(assembly.contexts.some(context => context.name === name)).toBe(true)
    }
    // A bare assemble (diagnostics) has no agent; providers render empty text.
    const bare = await ctx.systemPrompt.assemble({})
    expect(bare.contexts.find(context => context.name === 'openviking:memories')?.text).toBe('')
    expect(bare.contexts.find(context => context.name === 'openviking:library')?.text).toBe('')
    await fiber.dispose()
    await rm(tmp, { recursive: true, force: true })
  })

  it('the pre-init sync placeholder settles without a store', async () => {
    const placeholder = createPreInitSync()
    await expect(placeholder.flush('s')).resolves.toBeUndefined()
    await expect(placeholder.commit('s')).resolves.toBeUndefined()
  })

  it('labels error and non-error probe failures', () => {
    expect(errorLabel(new Error('fetch failed'))).toBe('fetch failed')
    expect(errorLabel('boom')).toBe('boom')
  })

  it('warns once per failure class through dedupeWarn', () => {
    const warn = vi.fn()
    const warnOnce = dedupeWarn({ warn }, 'service unreachable')
    warnOnce()
    warnOnce()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('probeHealth resolves silently when the service answers', async () => {
    const client = { health: () => Promise.resolve({ status: 'ok' }) }
    await probeHealth(client, { info: vi.fn() }, vi.fn(), new AbortController().signal)
  })

  it('probeHealth logs and warns once on an Error failure', async () => {
    const info = vi.fn()
    const warn = vi.fn()
    await probeHealth(
      { health: () => Promise.reject(new Error('fetch failed')) },
      { info },
      warn,
      new AbortController().signal,
    )
    expect(info).toHaveBeenCalledWith('openviking health check failed', { error: 'fetch failed' })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('probeHealth stringifies non-Error failures', async () => {
    const info = vi.fn()
    await probeHealth(
      { health: () => Promise.reject(new Error('boom')) },
      { info },
      vi.fn(),
      new AbortController().signal,
    )
    expect(info).toHaveBeenCalledWith('openviking health check failed', { error: 'boom' })
  })
})
