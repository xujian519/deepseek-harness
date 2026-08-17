import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'
import { ConnectorRegistry } from '../src/runtime/connector-registry.ts'
import { createArxivConnector } from '../src/runtime/connectors/arxiv.ts'
import { createOpenAlexConnector } from '../src/runtime/connectors/openalex.ts'
import { createSemanticScholarConnector } from '../src/runtime/connectors/semantic-scholar.ts'
import { createCrossrefConnector } from '../src/runtime/connectors/crossref.ts'
import { createPaperSearchTool } from '../src/tool/paper-search.ts'
import { createPaperListSourcesTool } from '../src/tool/paper-list-sources.ts'

const testToolSignal = new AbortController().signal

const ATOM_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T00:00:00Z</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on complex recurrent networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
  </entry>
</feed>`

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>none</title></feed>`

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

function execute(ctx: Context, name: string, args: unknown, callLabel: string) {
  return ctx.tools.execute({ signal: testToolSignal, callId: CallId(callLabel), name, arguments: args })
}

async function setupPlugin(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, {})
  return ctx
}

/** Test injection: skip arXiv/S2 per-host rate limits and retry backoff to keep the suite fast. */
function makeRegistry(fetchImpl: typeof fetch): ConnectorRegistry {
  const registry = new ConnectorRegistry()
  registry.register(createArxivConnector({ fetchImpl, rateLimit: { minIntervalMs: 0 }, retry: { maxRetries: 0 } }))
  registry.register(createOpenAlexConnector({ fetchImpl }))
  registry.register(createSemanticScholarConnector({ fetchImpl, rateLimit: { minIntervalMs: 0 }, retry: { maxRetries: 0 } }))
  registry.register(createCrossrefConnector({ fetchImpl }))
  return registry
}

async function setupRegistry(registry: ConnectorRegistry): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createPaperSearchTool(registry))
  ctx.tools.register(createPaperListSourcesTool(registry))
  return ctx
}

async function withFetch(fetchImpl: typeof fetch, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
}

describe('dsh-tool-literature (plugin-registered tools)', () => {
  it('registers paper_search and paper_list_sources', async () => {
    const ctx = await setupPlugin()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('paper_search')
    expect(names).toContain('paper_list_sources')
  })

  it('paper_list_sources lists every source with no network', async () => {
    const ctx = await setupPlugin()
    const result = await execute(ctx, 'paper_list_sources', {}, 'list-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected paper_list_sources success')
    const value = result.value as { sources: { id: string }[]; domains: string[] }
    expect(value.sources.map(s => s.id)).toEqual(['arxiv', 'openalex', 'semantic-scholar', 'crossref'])
    expect(value.domains).toEqual(['literature'])
    const t = text(result)
    for (const id of ['arxiv', 'openalex', 'semantic-scholar', 'crossref']) {
      expect(t).toContain(`**${id}**`)
    }
  })

  it('paper_search searches arxiv with a patched globalThis.fetch', async () => {
    const ctx = await setupPlugin()
    await withFetch(async () => new Response(ATOM_FEED, { status: 200 }), async () => {
      const result = await execute(ctx, 'paper_search', { db: 'arxiv', query: 'attention is all you need' }, 'search-1')
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected paper_search success')
      const value = result.value as { db: string; query: string; hits: unknown[] }
      expect(value.db).toBe('arxiv')
      expect(value.query).toBe('attention is all you need')
      expect(value.hits.length).toBe(1)
      const t = text(result)
      expect(t).toContain('Attention Is All You Need')
      expect(t).toContain('1706.03762v7')
    })
  })

  it('unregisters the tools when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(s => s.name === 'paper_search')).toBe(true)
    expect(ctx.tools.schemas().some(s => s.name === 'paper_list_sources')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'paper_search')).toBe(false)
    expect(ctx.tools.schemas().some(s => s.name === 'paper_list_sources')).toBe(false)
  })
})

describe('paper_search over an injected-fetchImpl registry', () => {
  it('returns an unknown-db error with available sources', async () => {
    const registry = makeRegistry(async () => new Response('', { status: 200 }))
    const ctx = await setupRegistry(registry)
    const result = await execute(ctx, 'paper_search', { db: 'nope', query: 'anything' }, 'unknown-db')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('Available: arxiv, openalex, semantic-scholar, crossref')
  })

  it('surfaces rate-limit source errors with actionable guidance', async () => {
    const registry = makeRegistry(async () => new Response('rate limited', { status: 429 }))
    const ctx = await setupRegistry(registry)
    const result = await execute(ctx, 'paper_search', { db: 'arxiv', query: 'attention' }, 'rate-limit')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('rate limiting')
    expect(text(result)).toContain('arXiv allows ~1 request every 3s')
  })

  it('returns empty result for genuine zero hits (not an error)', async () => {
    const registry = makeRegistry(async () => new Response(EMPTY_FEED, { status: 200 }))
    const ctx = await setupRegistry(registry)
    const result = await execute(ctx, 'paper_search', { db: 'arxiv', query: 'zzzz nonexistent' }, 'empty')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { hits: unknown[] }).hits).toEqual([])
    expect(text(result)).toContain('No results')
  })

  it('renders hits with pdf links', async () => {
    const registry = makeRegistry(async () => new Response(ATOM_FEED, { status: 200 }))
    const ctx = await setupRegistry(registry)
    const result = await execute(ctx, 'paper_search', { db: 'arxiv', query: 'attention is all you need' }, 'pdf')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { hits: unknown[] }).hits.length).toBe(1)
    const t = text(result)
    expect(t).toContain('## Attention Is All You Need')
    expect(t).toContain('**id**: 1706.03762v7')
    expect(t).toContain('**pdf**: http://arxiv.org/pdf/1706.03762v7')
    expect(t).toContain('**url**: http://arxiv.org/abs/1706.03762v7')
  })

  it('clamps limit to 50', async () => {
    let url = ''
    const registry = makeRegistry(async (input: RequestInfo | URL) => {
      url = String(input)
      return new Response(ATOM_FEED, { status: 200 })
    })
    const ctx = await setupRegistry(registry)
    await execute(ctx, 'paper_search', { db: 'arxiv', query: 'attention', limit: 999 }, 'clamp')
    expect(url.includes('max_results=50')).toBe(true)
  })
})
