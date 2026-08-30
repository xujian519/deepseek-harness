/**
 * Tests for the ctx.pluginMarket provider: source persistence, catalog
 * search wiring, and the preview-gated install pipeline with stub fetch and
 * a stub package-manager runner.
 */

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginMarketSource } from '../src/index.ts'
import { PluginMarketError } from '../src/index.ts'
import { MarketProvider, readSources, writeSources } from '../src/provider.ts'

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34' }],
}))

/** The package-manager runner signature, for a typed mock. */
type Runner = (cwd: string, args: readonly string[]) => { status: number; stderr: string }

let dir: string
let provider: MarketProvider
let runPnpm: ReturnType<typeof vi.fn<Runner>>

/** The user-registered sources only — the bundled source is always present. */
const persisted = async () => (await provider.listSources()).filter(source => !source.builtin)

/** A fetch stub routing by URL prefix: manifests, catalog pages, registry. */
function stubRoutes(): void {
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-market-provider-'))
  runPnpm = vi.fn<Runner>((_cwd, _args) => ({ status: 0, stderr: '' }))
  provider = new MarketProvider(new Context(), { profileDir: dir, runPnpm })
  stubRoutes()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('source persistence', () => {
  it('adds, lists, and removes sources', async () => {
    const added = await provider.addSource('https://example.dev/manifest.json')
    expect(added.providerId).toBe('example.dev')
    expect(await persisted()).toHaveLength(1)
    await provider.removeSource(added.id)
    expect(await persisted()).toEqual([])
  })

  it('updates an existing source in place', async () => {
    const first = await provider.addSource('https://example.dev/manifest.json')
    const again = await provider.addSource('https://example.dev/manifest.json')
    expect(again.id).toBe(first.id)
    expect(await persisted()).toHaveLength(1)
  })

  it('keeps unrelated sources when re-adding one of several', async () => {
    const first = await provider.addSource('https://example.dev/manifest.json')
    // A second source persisted directly, then a re-add of the first: the
    // in-place update must preserve the unrelated entry.
    const other = { ...first, id: 'other', providerId: 'other.dev' } as PluginMarketSource
    const path = join(dir, '.dsh-plugin-market', 'sources.json')
    writeSources(path, [first, other])
    await provider.addSource('https://example.dev/manifest.json')
    expect((await persisted()).map(source => source.providerId).sort())
      .toEqual(['example.dev', 'other.dev'])
  })

  it('fails loud on a malformed sources file', () => {
    const path = join(dir, '.dsh-plugin-market', 'sources.json')
    mkdirSync(join(dir, '.dsh-plugin-market'), { recursive: true })
    writeFileSync(path, 'not json')
    expect(() => readSources(path)).toThrow(/malformed/)
  })

  it('persists sources through the write helper', () => {
    const path = join(dir, 'sources.json')
    writeSources(path, [])
    expect(readFileSync(path, 'utf8')).toContain('[]')
  })
})

describe('catalog wiring', () => {
  it('searches a registered source and stamps provenance', async () => {
    const added = await provider.addSource('https://example.dev/manifest.json')
    const page = await provider.search(added.id, { q: 'plugin' })
    expect(page.items[0]).toMatchObject({ package: 'dsh-p1', source: 'example.dev' })
  })

  it('rejects an unknown source', async () => {
    await expect(provider.search('missing', {})).rejects.toMatchObject({ code: 'source-not-found' })
    await expect(provider.removeSource('missing')).rejects.toMatchObject({ code: 'source-not-found' })
  })

  it('wraps a catalog failure as a network error', async () => {
    const added = await provider.addSource('https://example.dev/manifest.json')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })))
    await expect(provider.search(added.id, {})).rejects.toMatchObject({ code: 'network' })
  })
})

describe('install pipeline', () => {
  it('previews, installs, and uninstalls through the managed gate', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
    const added = await provider.addSource('https://example.dev/manifest.json')
    const preview = await provider.preview('dsh-p1@1.0.0')
    expect(preview.verified).toBe(true)
    const receipt = await provider.install(added.id, 'dsh-p1@1.0.0')
    expect(runPnpm).toHaveBeenCalledWith(dir, ['add', 'dsh-p1@1.0.0'])
    expect(await provider.listInstallations()).toHaveLength(1)
    await provider.uninstall(receipt.id)
    expect(await provider.listInstallations()).toHaveLength(0)
  })

  it('refuses to install a package the preview rejects', async () => {
    const added = await provider.addSource('https://example.dev/manifest.json')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0', deprecated: 'gone',
      dist: { tarball: 'x', integrity: 'y' },
    }), { status: 200 })))
    await expect(provider.install(added.id, 'dsh-p1@1.0.0')).rejects.toMatchObject({ code: 'install-failed' })
    expect(runPnpm).not.toHaveBeenCalled()
  })

  it('requires a registered source to install', async () => {
    await expect(provider.install('missing', 'dsh-p1@1.0.0')).rejects.toMatchObject({ code: 'source-not-found' })
  })

  it('refuses to uninstall a receipt belonging to another profile', async () => {
    const receiptsDir = join(dir, '.dsh-plugin-market', 'receipts')
    mkdirSync(receiptsDir, { recursive: true })
    writeFileSync(join(receiptsDir, 'other.json'), JSON.stringify({
      id: 'other', package: 'dsh-p1', version: '1.0.0', profile: '/elsewhere', installedAt: '2026-08-20T00:00:00.000Z',
    }))
    const error = await provider.uninstall('other').then(
      () => undefined,
      (caught: unknown) => caught as PluginMarketError,
    )
    expect(error?.code).toBe('receipt-mismatch')
    expect(error?.message).toContain('/elsewhere')
    expect(runPnpm).not.toHaveBeenCalled()
  })

  it('wraps a failed pnpm remove as install-failed and keeps the receipt', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
    const added = await provider.addSource('https://example.dev/manifest.json')
    const receipt = await provider.install(added.id, 'dsh-p1@1.0.0')
    runPnpm.mockReturnValue({ status: 1, stderr: 'remove boom' })
    await expect(provider.uninstall(receipt.id)).rejects.toMatchObject({ code: 'install-failed' })
    // The receipt survives a failed remove, so the uninstall stays retryable.
    expect(await provider.listInstallations()).toHaveLength(1)
  })

  it('wraps install failures as install-failed', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
    const added = await provider.addSource('https://example.dev/manifest.json')
    runPnpm.mockReturnValue({ status: 1, stderr: 'boom' })
    await expect(provider.install(added.id, 'dsh-p1@1.0.0')).rejects.toMatchObject({ code: 'install-failed' })
  })

  it('wraps an invalid source manifest as source-invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })))
    await expect(provider.addSource('https://example.dev/manifest.json'))
      .rejects.toMatchObject({ code: 'source-invalid' })
  })

  it('wraps a missing receipt as receipt-mismatch on uninstall', async () => {
    await expect(provider.uninstall('missing')).rejects.toMatchObject({ code: 'receipt-mismatch' })
  })

  it('wraps a malformed preview reference as preview-failed', async () => {
    await expect(provider.preview('not-a-ref')).rejects.toMatchObject({ code: 'preview-failed' })
  })

  it('mounts through the apply function with defaulted configuration', async () => {
    const ctx = new Context()
    const { apply } = await import('../src/provider.ts')
    await ctx.plugin(apply, { profileDir: dir })
    const added = await ctx.pluginMarket.addSource('https://example.dev/manifest.json')
    expect(added.providerId).toBe('example.dev')
    await ctx.fiber.dispose()
  })

  it('honors a custom source file and registry configuration', async () => {
    const sourceFile = join(dir, 'custom-sources.json')
    const custom = new MarketProvider(new Context(), { profileDir: dir, sourceFile, registry: 'https://mirror.example', runPnpm })
    const added = await custom.addSource('https://example.dev/manifest.json')
    expect(added.providerId).toBe('example.dev')
    // The custom file, not the default, now holds the source.
    expect(readSources(sourceFile)).toHaveLength(1)
    expect(readSources(join(dir, '.dsh-plugin-market', 'sources.json'))).toHaveLength(0)
    // The custom registry flows into preview and the install gate.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://mirror.example/dsh-p1/1.0.0')) {
        return new Response(JSON.stringify({
          name: 'dsh-p1', version: '1.0.0',
          dist: { tarball: 'https://mirror.example/dsh-p1.tgz', integrity: 'sha512-abc' },
        }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }))
    writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
    const preview = await custom.preview('dsh-p1@1.0.0')
    expect(preview.verified).toBe(true)
    const receipt = await custom.install(added.id, 'dsh-p1@1.0.0')
    expect(receipt.package).toBe('dsh-p1')
  })

  it('mounts through the apply function with explicit overrides', async () => {
    const ctx = new Context()
    const { apply } = await import('../src/provider.ts')
    const sourceFile = join(dir, 'override-sources.json')
    await ctx.plugin(apply, { profileDir: dir, sourceFile, registry: 'https://mirror.example' })
    await ctx.pluginMarket.addSource('https://example.dev/manifest.json')
    expect(readSources(sourceFile)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('builds install options without a runner when the config omits one', async () => {
    const bare = new MarketProvider(new Context(), { profileDir: dir })
    const added = await bare.addSource('https://example.dev/manifest.json')
    // The preview gate rejects before any pnpm runs, yet the options spread
    // (no runPnpm) is exercised.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0', deprecated: 'gone',
      dist: { tarball: 'x', integrity: 'y' },
    }), { status: 200 })))
    await expect(bare.install(added.id, 'dsh-p1@1.0.0')).rejects.toMatchObject({ code: 'install-failed' })
    await expect(bare.uninstall('missing')).rejects.toMatchObject({ code: 'receipt-mismatch' })
  })
})

describe('read-only discovery mode', () => {
  it('works without a profileDir for list/search/preview', async () => {
    const sourceFile = join(dir, 'readonly-sources.json')
    const ro = new MarketProvider(new Context(), { sourceFile })
    const added = await ro.addSource('https://example.dev/manifest.json')
    expect((await ro.listSources()).filter(source => !source.builtin)).toHaveLength(1)
    const page = await ro.search(added.id, { q: 'plugin' })
    expect(page.items[0]).toMatchObject({ package: 'dsh-p1' })
    const preview = await ro.preview('dsh-p1@1.0.0')
    expect(preview.verified).toBe(true)
  })

  it('rejects install/uninstall/list as install-unavailable without a profileDir', async () => {
    const sourceFile = join(dir, 'readonly-sources.json')
    const ro = new MarketProvider(new Context(), { sourceFile })
    const added = await ro.addSource('https://example.dev/manifest.json')
    writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
    await expect(ro.install(added.id, 'dsh-p1@1.0.0')).rejects.toMatchObject({ code: 'install-unavailable' })
    await expect(ro.uninstall('missing')).rejects.toMatchObject({ code: 'install-unavailable' })
    await expect(ro.listInstallations()).rejects.toMatchObject({ code: 'install-unavailable' })
  })

  it('fails loud when neither a sourceFile nor a profileDir is configured', () => {
    expect(() => new MarketProvider(new Context(), {})).toThrow(/sourceFile or a profileDir/)
  })

  it('treats an empty profileDir string as omitted for a read-only row', async () => {
    // The Loader emits '' for an unset field; a hand-built row normalizes it
    // to undefined so the provider stays read-only and honors the sourceFile.
    const sourceFile = join(dir, 'empty-profile-sources.json')
    const ro = new MarketProvider(new Context(), { profileDir: '', sourceFile })
    expect((await ro.listSources()).map(source => source.providerId)).toEqual(['builtin-deepseek'])
    await expect(ro.install('missing', 'x@1.0.0')).rejects.toMatchObject({ code: 'install-unavailable' })
  })

  it('forwards a custom runner through apply', async () => {
    const ctx = new Context()
    const { apply } = await import('../src/provider.ts')
    await ctx.plugin(apply, { profileDir: dir, runPnpm })
    const added = await ctx.pluginMarket.addSource('https://example.dev/manifest.json')
    expect(added.providerId).toBe('example.dev')
    await ctx.fiber.dispose()
  })
})
