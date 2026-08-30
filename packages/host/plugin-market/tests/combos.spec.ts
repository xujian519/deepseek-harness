/**
 * Real-Loader composition test: boot a `cordis.yml` that mounts the plugin-market
 * provider as a namespace-form function plugin, then assert the read-only
 * discovery contract (list/search/preview) and the `install-unavailable` write
 * boundary. This is the test that proves a composition row can mount the market
 * at all — unit suites only build the provider by hand.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as provider from '../src/provider.ts'

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34' }],
}))

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllGlobals()
})

/**
 * Boot a composition mounting plugin-market read-only. The provider resolves
 * through the Loader's internal import map, the same way a shipped row does.
 * @param sourceFile - the sources file the row configures.
 * @returns the booted context.
 */
async function loadYaml(sourceFile: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-market-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: plugin-market',
    "  name: '@deepseek-ai/dsh-host-plugin-market/provider'",
    '  config:',
    `    sourceFile: ${sourceFile}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-plugin-market/provider', provider],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** A fetch stub routing only the manifest and registry routes discovery needs. */
function stubFetch(): void {
  const routes: Record<string, () => unknown> = {
    'https://example.dev/manifest.json': () => ({
      manifestVersion: '1.0.0',
      providerId: 'example.dev',
      name: 'Example Catalog',
      attribution: { name: 'Example', url: 'https://example.dev' },
      transport: { baseUrl: 'https://catalog.example.dev' },
      query: { supported: ['q', 'limit'] },
    }),
    'https://catalog.example.dev/v1/plugins': () => ({
      items: [{ id: 'p1', name: 'Plugin One', package: 'dsh-p1', version: '1.0.0' }],
    }),
    'https://registry.npmjs.org/dsh-p1/1.0.0': () => ({
      name: 'dsh-p1', version: '1.0.0',
      dist: { tarball: 'https://registry.npmjs.org/dsh-p1/-/dsh-p1-1.0.0.tgz', integrity: 'sha512-abc' },
    }),
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    if (route === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(route[1]()), { status: 200 })
  }))
}

describe('real Loader composition', () => {
  // First real-Loader resolution after the host/client program split is slow
  // enough to trip the default 5s budget on cold caches.
  it('mounts plugin-market from a composition and exposes a read-only ctx.pluginMarket', { timeout: 60_000 }, async () => {
    const sourceFile = join(await mkdtemp(join(tmpdir(), 'dsh-plugin-market-src-')), 'sources.json')
    const loaded = await loadYaml(sourceFile)
    stubFetch()

    expect(loaded.pluginMarket).toBeInstanceOf(provider.MarketProvider)
    // The bundled catalog is present out of the box; no network source yet.
    expect((await loaded.pluginMarket.listSources()).map(source => source.providerId)).toEqual(['builtin-deepseek'])
    // The bundled source serves its entries from memory, and cannot be removed.
    const builtinPage = await loaded.pluginMarket.search('builtin-deepseek', { q: 'bash' })
    expect(builtinPage.items[0]).toMatchObject({ package: '@deepseek-ai/dsh-tool-bash' })
    await expect(loaded.pluginMarket.removeSource('builtin-deepseek')).rejects.toMatchObject({ code: 'source-invalid' })

    // Source registration and catalog search work in read-only mode.
    const added = await loaded.pluginMarket.addSource('https://example.dev/manifest.json')
    const page = await loaded.pluginMarket.search(added.id, { q: 'plugin' })
    expect(page.items[0]).toMatchObject({ package: 'dsh-p1' })
    expect((await loaded.pluginMarket.preview('dsh-p1@1.0.0')).verified).toBe(true)

    // The write boundary is refused: no profileDir is supplied to the row.
    await expect(loaded.pluginMarket.install(added.id, 'dsh-p1@1.0.0'))
      .rejects.toMatchObject({ code: 'install-unavailable' })
    await expect(loaded.pluginMarket.listInstallations())
      .rejects.toMatchObject({ code: 'install-unavailable' })
  })
})
