// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginMarketTab } from '../src/client/PluginMarketTab.tsx'
import type { PluginMarketTabInjected } from '../src/client/PluginMarketTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SOURCES = [
  { id: 'official', providerId: 'official', name: 'Official', attribution: { name: 'Official', url: 'https://example.com' }, endpoint: 'https://catalog.example.com', query: { supported: ['q', 'category'] }, builtin: true },
  { id: 'community', providerId: 'community', name: 'Community', attribution: { name: 'Community', url: 'https://c.example.com' }, endpoint: 'https://c.example.com', query: { supported: ['q'] } },
]

const PAGE = {
  items: [
    { id: 'doc', name: 'Docs Plugin', package: '@fixture/docs', version: '1.0.0', description: 'Adds docs', category: 'doc', capability: ['docs'], source: 'official' },
  ],
}

type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const listSources = vi.fn<() => Promise<Result<typeof SOURCES>>>()
  .mockResolvedValue({ ok: true, value: SOURCES })
const search = vi.fn<(sourceId: string, query: unknown) => Promise<Result<typeof PAGE>>>()
  .mockResolvedValue({ ok: true, value: PAGE })
const PREVIEW = { package: '@fixture/docs', version: '1.0.0', verified: true, reasons: [], lifecycleScripts: [], compatible: true }
const preview = vi.fn<(ref: string) => Promise<Result<typeof PREVIEW>>>()
  .mockResolvedValue({ ok: true, value: PREVIEW })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.pluginMarket', { listSources, search, preview })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-plugin-market browser plugin', () => {
  it('declares only the services used by the plugin-market Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginMarket'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.plugins.tab')[0]!
    expect(entry.component).toBe(PluginMarketTab)
    expect(entry.options).toMatchObject({ id: 'market', order: 30 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件市场')
    expect(listSources).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginMarketTabInjected)()
    await expect(injected.listSources()).resolves.toEqual(SOURCES)
    expect(listSources).toHaveBeenCalledOnce()

    listSources.mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK', message: 'offline' } })
    await expect(injected.listSources()).rejects.toThrow('pluginMarket.listSources failed: NETWORK: offline')
    await b.ctx.fiber.dispose()
  })

  it('forwards search and preview and rewrites Remote failures into thrown errors', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const injected = (b.slots.entries('settings.plugins.tab')[0]!.inject as unknown as () => PluginMarketTabInjected)()
    await expect(injected.search('official', { q: 'docs' })).resolves.toEqual(PAGE)
    expect(search).toHaveBeenCalledWith('official', { q: 'docs' })

    await expect(injected.preview('@fixture/docs@1.0.0')).resolves.toMatchObject({ verified: true })
    expect(preview).toHaveBeenCalledWith('@fixture/docs@1.0.0')

    search.mockResolvedValueOnce({ ok: false, error: { code: 'SOURCE_NOT_FOUND', message: 'gone' } })
    await expect(injected.search('missing', undefined)).rejects.toThrow('pluginMarket.search failed: SOURCE_NOT_FOUND: gone')

    preview.mockResolvedValueOnce({ ok: false, error: { code: 'PREVIEW_FAILED', message: 'no such ref' } })
    await expect(injected.preview('@fixture/docs@1.0.0')).rejects.toThrow('pluginMarket.preview failed: PREVIEW_FAILED: no such ref')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.plugins.tab')[0]!.options.label)).toBe('Plugin market')

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginMarketTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
