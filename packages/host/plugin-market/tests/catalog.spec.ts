/**
 * Tests for the catalog client: source manifest validation, endpoint
 * derivation, supported-parameter filtering, and provenance stamping.
 */

import { describe, expect, it, vi } from 'vitest'
import { fetchSourceManifest, searchCatalog } from '../src/catalog.ts'
import type { PluginMarketSource } from '../src/index.ts'

const SOURCE: PluginMarketSource = {
  id: 'example.dev' as PluginMarketSource['id'],
  providerId: 'example.dev',
  name: 'Example Catalog',
  attribution: { name: 'Example', url: 'https://example.dev' },
  endpoint: 'https://catalog.example.dev/v1/plugins',
  query: { supported: ['q', 'cursor', 'limit'] },
}

describe('fetchSourceManifest', () => {
  it('validates a manifest and derives the catalog endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      manifestVersion: '1.0.0',
      providerId: 'example.dev',
      name: 'Example Catalog',
      attribution: { name: 'Example', url: 'https://example.dev' },
      transport: { baseUrl: 'https://catalog.example.dev/' },
      query: { supported: ['q', 'limit'] },
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const source = await fetchSourceManifest('https://example.dev/manifest.json', {}, resolve, fetchImpl)
    expect(source).toMatchObject({
      providerId: 'example.dev',
      name: 'Example Catalog',
      endpoint: 'https://catalog.example.dev/v1/plugins',
    })
    expect(source.query.supported).toEqual(['q', 'limit'])
  })

  it('carries the manifest optional fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      manifestVersion: '1.0.0',
      providerId: 'example.dev',
      name: 'Example Catalog',
      description: 'A catalog of example plugins',
      homepage: 'https://example.dev',
      attribution: { name: 'Example', url: 'https://example.dev' },
      transport: { baseUrl: 'https://catalog.example.dev' },
      query: { supported: ['q'] },
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const source = await fetchSourceManifest('https://example.dev/manifest.json', {}, resolve, fetchImpl)
    expect(source.description).toBe('A catalog of example plugins')
    expect(source.homepage).toBe('https://example.dev')
  })

  it('rejects an invalid URL in a manifest', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      manifestVersion: '1.0.0',
      providerId: 'example.dev',
      name: 'Example Catalog',
      homepage: 'not-a-url',
      attribution: { name: 'Example', url: 'https://example.dev' },
      transport: { baseUrl: 'https://catalog.example.dev' },
      query: { supported: ['q'] },
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(fetchSourceManifest('https://example.dev/manifest.json', {}, resolve, fetchImpl))
      .rejects.toThrow(/manifest is invalid/)
  })

  it('rejects a manifest violating the schema', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(fetchSourceManifest('https://example.dev/manifest.json', {}, resolve, fetchImpl))
      .rejects.toThrow(/manifest is invalid/)
  })
})

describe('searchCatalog', () => {
  it('sends only the parameters the source supports and stamps provenance', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [{ id: 'p1', name: 'Plugin One', package: 'dsh-p1', version: '1.0.0' }],
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const page = await searchCatalog(
      SOURCE,
      { q: 'search', category: 'ignored', limit: 10 },
      {},
      resolve,
      fetchImpl,
    )
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://catalog.example.dev/v1/plugins?q=search&limit=10',
      expect.any(Object),
    )
    expect(page.items[0]).toMatchObject({ package: 'dsh-p1', source: 'example.dev' })
  })

  it('sends no query string when no supported parameter is present', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await searchCatalog(SOURCE, {}, {}, resolve, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith('https://catalog.example.dev/v1/plugins?', expect.any(Object))
  })

  it('rejects a page violating the schema', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: 'x' }] }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(searchCatalog(SOURCE, {}, {}, resolve, fetchImpl))
      .rejects.toThrow(/page from example.dev is invalid/)
  })

  it('carries the next cursor', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [], nextCursor: 'cursor-2',
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const page = await searchCatalog(SOURCE, { cursor: 'cursor-1' }, {}, resolve, fetchImpl)
    expect(page.nextCursor).toBe('cursor-2')
  })

  it('carries every optional entry field and drops unsupported parameters', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      items: [{
        id: 'p1', name: 'Plugin One', description: 'desc', package: 'dsh-p1', version: '1.0.0',
        category: 'agent', capability: ['search'], homepage: 'https://example.dev/p1', license: 'MIT',
      }],
    }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const page = await searchCatalog(SOURCE, { category: 'ignored', q: 'x' }, {}, resolve, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://catalog.example.dev/v1/plugins?q=x',
      expect.any(Object),
    )
    expect(page.items[0]).toMatchObject({
      description: 'desc', category: 'agent', capability: ['search'], homepage: 'https://example.dev/p1', license: 'MIT',
    })
  })

  it('appends parameters with an ampersand when the endpoint already has a query', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const source = { ...SOURCE, endpoint: 'https://catalog.example.dev/v1/plugins?token=abc' }
    await searchCatalog(source, { q: 'x' }, {}, resolve, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://catalog.example.dev/v1/plugins?token=abc&q=x',
      expect.any(Object),
    )
  })
})
