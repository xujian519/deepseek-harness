// @vitest-environment jsdom
/**
 * Real tsdown artifact shape: lib/client.js hands off through
 * window.__ModuleLoader__.load, resolves externals through the injected
 * require, returns the exports (apply + inject), and a mounted apply
 * registers the document view tab, the produced-file targets, and the
 * preset auto-switch against real registries. Skips when dist/ is not built
 * (`pnpm --filter @deepseek-ai/dsh-client-ui-document-studio bundle`).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConversationEventRegistry, ConversationViewRegistry, SlotRegistry,
  createSnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-document-studio'

interface Handoff { id: string; factory: (require: (spec: string) => unknown) => Record<string, unknown> }
type Win = { __ModuleLoader__?: { load(h: Handoff): void } }

function readBundle(): string | undefined {
  try {
    return readFileSync(resolve('packages/client/ui-document-studio/lib/client.js'), 'utf8')
  } catch {
    return undefined
  }
}

afterEach(() => {
  delete (window as Win).__ModuleLoader__
  for (const el of document.querySelectorAll('style')) el.remove()
})

describe('tsdown client artifact', () => {
  const code = readBundle()

  async function loadArtifact() {
    let handoff: Handoff | undefined
    ;(window as Win).__ModuleLoader__ = { load: (h) => { handoff = h } }
    // The implied-eval ban targets accidental string execution, not this
    // deliberate built-bundle fixture running in the window scope.
    // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call
    new Function(code!)()
    expect(handoff).toBeDefined()
    const modules = new Map<string, unknown>([
      ['react', await import('react')],
      ['react/jsx-runtime', await import('react/jsx-runtime')],
      ['react-dom', await import('react-dom')],
      ['@deepseek-ai/dsh-client-runtime/client', await import('@deepseek-ai/dsh-client-runtime/client')],
      ['@deepseek-ai/dsh-client-connection/client', await import('@deepseek-ai/dsh-client-connection/client')],
      ['@deepseek-ai/dsh-client-ui-conversation/client', await import('@deepseek-ai/dsh-client-ui-conversation/client')],
      ['@deepseek-ai/dsh-client-ui-primitives', await import('@deepseek-ai/dsh-client-ui-primitives')],
    ])
    const exports = handoff!.factory((spec) => {
      if (!modules.has(spec)) throw new Error(`unexpected require: ${spec}`)
      return modules.get(spec)
    })
    return { handoff: handoff!, exports: exports as { apply: (ctx: Context) => void; inject: string[] } }
  }

  interface SessionsState {
    current: string | undefined
    byId: Record<string, { agentPreset?: string; cwd?: string } | undefined>
  }

  async function harness(exports: { apply: (ctx: Context) => void }, state: SessionsState) {
    const ctx = new Context()
    const slots = new SlotRegistry(ctx)
    await ctx.plugin(ConversationEventRegistry).await()
    await ctx.plugin(ConversationViewRegistry).await()
    slots.register({
      name: 'root',
      children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    }, (_p: { renderSlot?: unknown }) => null)
    const sessionsList = createSnapshotStore<SessionsState>(state)
    ctx.provide('sessions', {
      list: sessionsList,
      binding: () => undefined,
    } as never)
    const viewSetters: Array<[string, string]> = []
    ctx.provide('conversation', {
      setActiveView: (sessionId: string, view: string): boolean => {
        viewSetters.push([sessionId, view])
        return true
      },
    } as never)
    ctx.provide('connection', {
      api: { host: { readFileText: async () => ({ rpcId: 'x', result: { ok: true as const, value: { content: '', truncated: false } } }) } },
      isLoopback: true,
      hostDescription: createSnapshotStore({ canOpenPath: true }),
    } as never)
    ctx.provide('workspaces', { openPath: vi.fn(() => Promise.resolve()) } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = await import('@deepseek-ai/dsh-client-locale/client')
    ctx.plugin({ inject: [...locale.inject], apply: locale.apply })
    const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
    return { ctx, fiber, slots, sessionsList, viewSetters }
  }

  it.skipIf(code === undefined)('hands off with the manifest id and the DI-require factory', async () => {
    const { handoff, exports } = await loadArtifact()
    expect(handoff.id).toBe(PLUGIN_ID)
    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual([
      'slots', 'locale', 'conversation', 'conversationEvents', 'conversationViews', 'sessions', 'connection', 'workspaces',
    ])
  })

  it.skipIf(code === undefined)('mounts the view tab and the produced-file targets, and disposes them', async () => {
    const { exports } = await loadArtifact()
    const { ctx, fiber, slots } = await harness(exports, { current: undefined, byId: {} })
    await fiber.await()
    const events = ctx.get('conversationEvents') as ConversationEventRegistry
    const views = ctx.get('conversationViews') as ConversationViewRegistry
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['document'])
    expect(events.entries().map(entry => entry.kind)).toContain('documentDeliverables')
    expect(views.entries().map(entry => entry.target)).toEqual(['documentDeliverables'])
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(events.entries()).toEqual([])
    expect(views.entries()).toEqual([])
  })

  it.skipIf(code === undefined)('auto-switches a document-preset session to the studio view', async () => {
    const { exports } = await loadArtifact()
    const { fiber, viewSetters, sessionsList } = await harness(exports, {
      current: 's1',
      byId: { s1: { agentPreset: 'document', cwd: '/tmp/w' } },
    })
    await fiber.await()
    expect(viewSetters).toEqual([['s1', 'document']])
    // A non-document session switch does not fire again.
    sessionsList.update((draft) => { draft.current = 's2' })
    await Promise.resolve()
    expect(viewSetters).toEqual([['s1', 'document']])
    // Re-entering the document session switches again (session entry only).
    sessionsList.update((draft) => { draft.current = 's1' })
    await Promise.resolve()
    expect(viewSetters).toEqual([['s1', 'document'], ['s1', 'document']])
    await fiber.dispose()
  })

  it.skipIf(code === undefined)('retries until the setter reports success, then gives up on the cap', async () => {
    vi.useFakeTimers()
    try {
      const { exports } = await loadArtifact()
      const ctx = new Context()
      const slots = new SlotRegistry(ctx)
      await ctx.plugin(ConversationEventRegistry).await()
      await ctx.plugin(ConversationViewRegistry).await()
      slots.register({
        name: 'root',
        children: { 'conversation.view': { kind: 'list', scope: 'session' } },
      }, (_p: { renderSlot?: unknown }) => null)
      const sessionsList = createSnapshotStore<SessionsState>({
        current: 's1',
        byId: { s1: { agentPreset: 'document' } },
      })
      ctx.provide('sessions', { list: sessionsList, binding: () => undefined } as never)
      // Setter reports false until it exists: exercise the retry cadence.
      let attempts = 0
      ctx.provide('conversation', {
        setActiveView: (): boolean => { attempts += 1; return false },
      } as never)
      ctx.provide('connection', {
        api: { host: { readFileText: async () => ({ rpcId: 'x', result: { ok: true as const, value: { content: '', truncated: false } } }) } },
        isLoopback: true,
        hostDescription: createSnapshotStore({ canOpenPath: true }),
      } as never)
      ctx.provide('workspaces', { openPath: vi.fn(() => Promise.resolve()) } as never)
      ctx.provide('remote', { $on: () => () => {} } as never)
      ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
      const locale = await import('@deepseek-ai/dsh-client-locale/client')
      ctx.plugin({ inject: [...locale.inject], apply: locale.apply })
      const fiber = ctx.plugin(exports as { apply: (ctx: Context) => void })
      await fiber.await()
      const initial = attempts
      vi.advanceTimersByTime(150)
      expect(attempts).toBe(initial + 1)
      vi.advanceTimersByTime(150 * (20 + 2))
      expect(attempts).toBeLessThanOrEqual(initial + 1 + 20)
      await fiber.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it.skipIf(code === undefined)('injects plugin-tagged module CSS during factory execution', async () => {
    await loadArtifact()
    const tags = document.querySelectorAll(`style[data-plugin=${JSON.stringify(PLUGIN_ID)}]`)
    expect(tags.length).toBeGreaterThan(0)
  })
})
