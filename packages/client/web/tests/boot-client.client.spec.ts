// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import {
  createClientModuleSystem, parseBootManifest,
  type BootPluginRow, type ClientBundleRegistration, type ClientModuleLoader, type ClientModuleLoaderTarget,
  type WebBootEntry, type WebBootGraph,
} from '@deepseek-ai/dsh-client-modules/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { auditClientActivation, bootClient, type EntryStateLabel } from '../src/boot-client.ts'
import { FIBER_STATE } from '../src/loader-status.ts'

const BOOTSTRAP_ID = '@deepseek-ai/dsh-client-modules'

/** One boot row as the host composes it; these fixtures declare no package edges or prefetch tier. */
function row(id: string, required = true): BootPluginRow {
  return { id, inject: [], immediately: false, required }
}

function graphOf(ids: readonly string[]): WebBootGraph {
  const entries: WebBootEntry[] = ids.map(id => ({ id, url: `/${id}.js`, rev: '1' }))
  return {
    rev: 'graph',
    entries,
    batches: [{ phase: 'application', url: '/application.js', rev: 'batch', entries: [...ids] }],
  }
}

/** Module system seeded with inline plugin modules; `loaded` records every transport call. */
function modulesOf(graph: WebBootGraph, staticModules: Record<string, unknown>): { modules: ClientModuleLoader; loaded: string[] } {
  const loaded: string[] = []
  const pendingQueue: ClientBundleRegistration[] = []
  const target: ClientModuleLoaderTarget = {
    mode: 'queue',
    pendingQueue,
    load: (registration) => { pendingQueue.push(registration) },
    create: options => createClientModuleSystem(target, { id: BOOTSTRAP_ID, exports: {} }, options),
  }
  const modules = target.create({
    boot: graph,
    staticModules,
    loadBundle: async (url) => { loaded.push(url) },
  })
  return { modules, loaded }
}

/** Recording progress sink. */
function stateSink(): { states: Map<string, EntryStateLabel[]>; onEntryState: (name: string, state: EntryStateLabel) => void } {
  const states = new Map<string, EntryStateLabel[]>()
  return {
    states,
    onEntryState: (name, state) => { states.set(name, [...(states.get(name) ?? []), state]) },
  }
}

describe('bootClient', () => {
  it('activates every seeded row without touching the bundle transport', async () => {
    const graph = graphOf(['provider', 'consumer'])
    const { modules, loaded } = modulesOf(graph, {
      provider: { apply: (ctx: Context) => { ctx.reflect.provide('x', { marker: 'x' }) } },
      consumer: { inject: ['x'], apply: () => {} },
    })
    const ctx = new Context()
    const sink = stateSink()

    await bootClient({ ctx, modules, manifest: modules.manifest, onEntryState: sink.onEntryState })

    expect(loaded).toEqual([])
    const consumer = sink.states.get('consumer') ?? []
    expect(consumer[0]).toBe('loading')
    expect(consumer.at(-1)).toBe('active')
    expect(sink.states.get('provider')?.at(-1)).toBe('active')
    await ctx.fiber.dispose()
  })

  it('reports a row waiting on a service the roster never provides', async () => {
    const graph = graphOf(['orphan'])
    const { modules } = modulesOf(graph, { orphan: { inject: ['nothing'], apply: () => {} } })
    const ctx = new Context()

    await expect(bootClient({ ctx, modules, manifest: modules.manifest })).rejects.toThrow(
      'orphan (required): pending (waiting for service: nothing)',
    )
    await ctx.fiber.dispose()
  })

  it('reports and logs an import failure for a row that is neither seeded nor a graph row', async () => {
    const { modules } = modulesOf(graphOf(['seeded']), { seeded: { apply: () => {} } })
    const manifest = parseBootManifest(graphOf(['ghost']))
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    onTestFinished(() => { error.mockRestore() })
    const sink = stateSink()

    await expect(bootClient({ ctx, modules, manifest, onEntryState: sink.onEntryState })).rejects.toThrow(
      'web boot: 1 required entry did not activate\nghost (required): import failed (see console for the import error)',
    )
    expect(sink.states.get('ghost')).toEqual(['loading', 'failed'])
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0]?.[0]).toHaveProperty('message', expect.stringContaining('client-modules: cannot resolve'))
  })

  it('starts the application and names the activation error of a row the profile installed', async () => {
    const graph = graphOf(['local'])
    const { modules } = modulesOf(graph, {
      local: { apply: () => { throw new Error('slot "x" is not declared') } },
    })
    const manifest = parseBootManifest({
      ...graph,
      entries: graph.entries.map(entry => ({ ...entry, required: false })),
    })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => { warn.mockRestore() })

    await expect(bootClient({ ctx, modules, manifest })).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledExactlyOnceWith([
      'web boot: warning: 1 entry did not activate',
      'local: failed: slot "x" is not declared',
      '',
    ].join('\n'))
  })
})

describe('auditClientActivation', () => {
  interface FakeEntry { name: string; fiber?: { state: number; inject: Record<string, null>; await?: () => Promise<unknown> } }

  /** Loader-shaped double: entries with scripted fiber states, services by name. */
  function auditCtx(entries: readonly FakeEntry[], services: Record<string, unknown> = {}): Context {
    return {
      loader: {
        * entries() {
          for (const entry of entries) yield { options: { name: entry.name }, fiber: entry.fiber }
        },
      },
      get: (name: string) => services[name],
    } as unknown as Context
  }

  const silent = { importError: () => undefined }
  const requiredRows = (...ids: string[]): BootPluginRow[] => ids.map(id => row(id))

  it('passes when every entry is active', async () => {
    await expect(auditClientActivation(
      auditCtx([{ name: 'a', fiber: { state: FIBER_STATE.ACTIVE, inject: {} } }]),
      silent,
      requiredRows('a'),
    )).resolves.toBeUndefined()
  })

  it('names import failures, missing services, other non-active states, and the activation error', async () => {
    const ctx = auditCtx([
      { name: 'lost' },
      { name: 'waiting', fiber: { state: FIBER_STATE.PENDING, inject: { present: null, a: null, b: null } } },
      { name: 'opaque', fiber: { state: FIBER_STATE.PENDING, inject: {} } },
      { name: 'broken', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: () => Promise.reject(new Error('apply threw')) } },
      { name: 'gone', fiber: { state: FIBER_STATE.DISPOSED, inject: {}, await: () => Promise.resolve() } },
    ], { present: {} })

    await expect(auditClientActivation(ctx, silent, requiredRows('lost', 'waiting', 'opaque', 'broken', 'gone'))).rejects.toThrow([
      'web boot: 5 required entries did not activate',
      'lost (required): import failed (see console for the import error)',
      'waiting (required): pending (waiting for services: a, b)',
      'opaque (required): pending (waiting for services: unknown)',
      'broken (required): failed: apply threw',
      'gone (required): disposed',
    ].join('\n'))
  })

  it('uses the singular form for one blocking entry', async () => {
    await expect(auditClientActivation(auditCtx([{ name: 'lost' }]), silent, requiredRows('lost'))).rejects.toThrow(
      'web boot: 1 required entry did not activate\n',
    )
  })

  it('names the recorded import error of a fiberless entry when the module system is supplied', async () => {
    const recorded = new Map([['lost', new Error('client-modules: could not load "lost": plugins/??lost/client.js&rev=0: bundle script failed to load')]])
    const modules = { importError: (id: string) => recorded.get(id) }
    await expect(auditClientActivation(auditCtx([{ name: 'lost' }, { name: 'quiet' }]), modules, requiredRows('lost', 'quiet'))).rejects.toThrow([
      'web boot: 2 required entries did not activate',
      'lost (required): import failed: client-modules: could not load "lost": plugins/??lost/client.js&rev=0: bundle script failed to load',
      'quiet (required): import failed (see console for the import error)',
    ].join('\n'))
  })

  it('keeps a failed profile-installed entry out of the rejection and lists every failure in the warning', async () => {
    const ctx = auditCtx([
      { name: 'mine', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: () => Promise.reject(new Error('cannot register')) } },
      { name: 'theirs', fiber: { state: FIBER_STATE.PENDING, inject: {} } },
    ])
    const warn = vi.fn()

    await expect(auditClientActivation(
      ctx, silent, [row('mine', false), row('theirs', false)], warn,
    )).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledExactlyOnceWith([
      'web boot: warning: 2 entries did not activate',
      'mine: failed: cannot register',
      'theirs: pending (waiting for services: unknown)',
      '',
    ].join('\n'))
  })

  it('rejects with every inactive entry when one boot-graph row is required and another is optional', async () => {
    const ctx = auditCtx([
      { name: 'mine', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: () => Promise.reject(new Error('cannot register')) } },
      { name: 'shell', fiber: { state: FIBER_STATE.PENDING, inject: { missing: null } } },
    ])

    await expect(auditClientActivation(
      ctx, silent, [row('mine', false), row('shell')], vi.fn(),
    )).rejects.toThrow([
      'web boot: 1 required entry did not activate',
      'mine: failed: cannot register',
      'shell (required): pending (waiting for service: missing)',
    ].join('\n'))
  })

  it('reports a failed entry whose fiber rethrows no reason, and one that rethrows a non-Error', async () => {
    const ctx = auditCtx([
      { name: 'silent', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: () => Promise.resolve() } },
      { name: 'primitive', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: async () => { throw 'denied' } } },
    ])

    await expect(auditClientActivation(ctx, silent, requiredRows('silent', 'primitive'))).rejects.toThrow([
      'web boot: 2 required entries did not activate',
      'silent (required): failed',
      'primitive (required): failed: denied',
    ].join('\n'))
  })

  it('treats an entry outside the boot graph as required', async () => {
    const ctx = auditCtx([{ name: 'child', fiber: { state: FIBER_STATE.FAILED, inject: {}, await: () => Promise.reject(new Error('boom')) } }])

    await expect(auditClientActivation(ctx, silent, [row('rocket', false)], vi.fn()))
      .rejects.toThrow('child (required): failed: boom')
  })
})
