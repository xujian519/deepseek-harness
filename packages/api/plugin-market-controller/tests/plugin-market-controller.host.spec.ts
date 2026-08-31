import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { PluginMarket, PluginMarketError } from '@deepseek-ai/dsh-host-plugin-market'
import type {
  CatalogPage, CatalogQuery, InstallPreview, InstallReceipt, PluginMarketSource,
} from '@deepseek-ai/dsh-host-plugin-market/types'
import PluginMarketController from '../src/index.ts'

const SOURCE: PluginMarketSource = {
  id: 'source-1' as PluginMarketSource['id'],
  providerId: 'acme',
  name: 'Acme Catalog',
  description: 'A test catalog',
  attribution: { name: 'Acme', url: 'https://example.com' },
  endpoint: 'https://example.com/v1/plugins',
  query: { supported: ['q'] },
}

const PAGE: CatalogPage = {
  items: [{ id: 'item-1', name: 'Tool', package: '@acme/tool', version: '1.0.0', source: 'acme' }],
}

const PREVIEW: InstallPreview = {
  package: '@acme/tool',
  version: '1.0.0',
  verified: true,
  reasons: [],
  lifecycleScripts: [],
  compatible: true,
}

/** A minimal in-memory `ctx.pluginMarket` recording the calls it receives. */
class FakeMarket extends PluginMarket {
  sources: readonly PluginMarketSource[] = []
  listSourcesError: unknown = undefined
  searchError: unknown = undefined
  previewError: unknown = undefined
  receivedSourceId: string | undefined
  receivedQuery: CatalogQuery | undefined
  receivedRef: string | undefined

  override async listSources(): Promise<readonly PluginMarketSource[]> {
    if (this.listSourcesError !== undefined) throw this.listSourcesError
    return this.sources
  }

  override addSource(): Promise<PluginMarketSource> {
    return Promise.reject(new Error('not used'))
  }

  override removeSource(): Promise<void> {
    return Promise.reject(new Error('not used'))
  }

  override async search(sourceId: string, query?: CatalogQuery): Promise<CatalogPage> {
    this.receivedSourceId = sourceId
    this.receivedQuery = query
    if (this.searchError !== undefined) throw this.searchError
    return PAGE
  }

  override async preview(ref: string): Promise<InstallPreview> {
    this.receivedRef = ref
    if (this.previewError !== undefined) throw this.previewError
    return PREVIEW
  }

  override install(): Promise<InstallReceipt> {
    return Promise.reject(new Error('not used'))
  }

  override uninstall(): Promise<void> {
    return Promise.reject(new Error('not used'))
  }

  override listInstallations(): Promise<readonly InstallReceipt[]> {
    return Promise.resolve([])
  }
}

async function boot(fake: FakeMarket) {
  const ctx = new Context()
  ctx.provide('pluginMarket', fake)
  await ctx.plugin(PluginMarketController)
  return { ctx, market: fake }
}

describe('the plugin-market Remote namespace a discovery page calls', () => {
  it('publishes the pluginMarket namespace from its own service key', async () => {
    const { ctx } = await boot(new FakeMarket(new Context()))
    expect(ctx.pluginMarketController.typertRemote.serviceKey).toBe('pluginMarketController')
    expect(ctx.pluginMarketController.typertRemote.namespace).toBe('pluginMarket')
    expect(remoteMethods(ctx.pluginMarketController).map(method => method.method)).toEqual([
      'listSources',
      'search',
      'preview',
    ])
  })

  it('forwards listSources to the mounted provider', async () => {
    const market = new FakeMarket(new Context())
    market.sources = [SOURCE]
    const { ctx } = await boot(market)
    await expect(ctx.pluginMarketController.listSources()).resolves.toEqual([SOURCE])
  })

  it('projects a listSources PluginMarketError to a business-code Remote failure', async () => {
    const market = new FakeMarket(new Context())
    market.listSourcesError = new PluginMarketError('source-invalid', 'sources file is malformed')
    const { ctx } = await boot(market)
    const failure = await ctx.pluginMarketController.listSources().catch((error: unknown) => error)
    const remote = remoteErrorOf(failure)
    expect(remote?.code).toBe('source-invalid')
    expect(remote?.message).toBe('sources file is malformed')
    expect(remote?.details).toEqual({})
  })

  it('forwards search and normalizes an absent query to an empty object', async () => {
    const market = new FakeMarket(new Context())
    const { ctx } = await boot(market)
    const page = await ctx.pluginMarketController.search('source-1', { q: 'tool' })
    expect(page).toEqual(PAGE)
    expect(market.receivedSourceId).toBe('source-1')
    expect(market.receivedQuery).toEqual({ q: 'tool' })

    await ctx.pluginMarketController.search('source-1', undefined)
    expect(market.receivedQuery).toEqual({})
  })

  it('forwards preview with the package reference', async () => {
    const market = new FakeMarket(new Context())
    const { ctx } = await boot(market)
    const preview = await ctx.pluginMarketController.preview('@acme/tool@1.0.0')
    expect(preview).toEqual(PREVIEW)
    expect(market.receivedRef).toBe('@acme/tool@1.0.0')
  })

  it('projects a PluginMarketError to a business-code Remote failure', async () => {
    const market = new FakeMarket(new Context())
    market.searchError = new PluginMarketError('source-not-found', 'no source source-1')
    const { ctx } = await boot(market)
    const failure = await ctx.pluginMarketController.search('source-1', {}).catch((error: unknown) => error)
    const remote = remoteErrorOf(failure)
    expect(remote?.code).toBe('source-not-found')
    expect(remote?.message).toBe('no source source-1')
    expect(remote?.details).toEqual({ subject: 'source-1' })
  })

  it('projects a foreign refusal to an internal-code Remote failure', async () => {
    const market = new FakeMarket(new Context())
    market.previewError = new Error('registry is down')
    const { ctx } = await boot(market)
    const failure = await ctx.pluginMarketController.preview('@acme/tool@1.0.0').catch((error: unknown) => error)
    const remote = remoteErrorOf(failure)
    expect(remote?.code).toBe('gateway/internal')
    expect(remote?.message).toBe('registry is down')
  })

  it('stringifies a non-Error throw as the internal failure message', async () => {
    const market = new FakeMarket(new Context())
    market.searchError = 'boom'  // thrown as a bare value, not an Error instance
    const { ctx } = await boot(market)
    const failure = await ctx.pluginMarketController.search('source-1', {}).catch((error: unknown) => error)
    const remote = remoteErrorOf(failure)
    expect(remote?.code).toBe('gateway/internal')
    expect(remote?.message).toBe('boom')
  })

  it('reports the actionable configuration error while no provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(PluginMarketController)
    const failure = await ctx.pluginMarketController.listSources().catch((error: unknown) => error)
    const remote = remoteErrorOf(failure)
    expect(remote?.code).toBe('gateway/internal')
    expect(remote?.message).toContain('plugin-market service is absent')
  })
})
