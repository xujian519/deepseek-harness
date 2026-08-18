import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as tool from '../src/index.ts'
import { buildImageGateResolver } from '../src/index.ts'

const signal = new AbortController().signal

function exec(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: CallId(label), name, arguments: args })
}

async function mounted(config: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, config)
  return ctx
}

/** Minimal knowledge.db satisfying the KgStore schema introspection (kg_nodes/kg_edges). */
function createKgDb(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(
    'CREATE TABLE kg_nodes (id TEXT, node_type TEXT, name TEXT, title TEXT, content TEXT, law_refs TEXT, source TEXT, full_ref TEXT, chapter TEXT, article_number TEXT)',
  )
  db.exec('CREATE TABLE kg_edges (source_id TEXT, target_id TEXT, relation TEXT)')
  db.close()
}

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

describe('patent-tools plugin wiring', () => {
  it('resolves Config provider/model into the model port and uses it', async () => {
    // No llm service on this context: the resolved route still builds the
    // fail-loud stub port, whose stream throws setup_required on first use.
    const ctx = await mounted({ provider: 'p', model: 'm' })
    const result = await exec(ctx, 'claim_chart_build', { mode: 'invalidity', claim_text: 'c', targets: [] }, 'w-1')
    expect(result.isError).toBe(true)
  })

  it('passes Config maxTokens into the model port', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('llm', {
      stream: async function* () {
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    })
    await ctx.plugin(tool, { provider: 'p', model: 'm', maxTokens: 128 })
    const result = await exec(ctx, 'claim_chart_build', { mode: 'invalidity', claim_text: 'c', targets: [] }, 'w-2')
    expect(result.isError).toBe(true)
  })

  it('uses the Config imageModel override for the figure route', async () => {
    const ctx = await mounted({ imageModel: { provider: 'img-p', model: 'img-m' } })
    expect(ctx.tools.schemas().map(s => s.name)).toContain('analyze_patent_figure')
  })

  it('builds the image-capability resolver when the llm declares resolveModelInfo', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('llm', { resolveModelInfo: async () => ({ inputModalities: ['text'] }) })
    await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().map(s => s.name)).toContain('analyze_patent_figure')
  })

  it('resolves declared modalities through the built image-gate resolver', async () => {
    const ctx = new Context()
    ctx.provide('llm', {
      resolveModelInfo: async (provider: string, model: string) => ({
        inputModalities: provider === 'p' && model === 'm' ? (['text', 'image'] as const) : ([] as const),
      }),
    })
    const resolver = buildImageGateResolver(ctx)
    expect(resolver).toBeDefined()
    await expect(resolver!('p', 'm')).resolves.toEqual(['text', 'image'])
    await expect(resolver!('p', 'other')).resolves.toEqual([])
  })

  it('returns undefined from the gate resolver without an llm capability source', () => {
    expect(buildImageGateResolver(new Context())).toBeUndefined()
  })

  it('wires the knowledge tools from ctx.patentKnowledge with a present db', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-tools-kg-'))
    createKgDb(join(temp, 'query.db'))
    await mkdir(join(temp, 'wiki'))
    await writeFile(join(temp, 'wiki', 'a.md'), '卡片A')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('patentKnowledge', {
      paths: { wikiDir: join(temp, 'wiki'), queryDbPath: join(temp, 'query.db') },
      caseLawSearch: () => [],
    })
    await ctx.plugin(tool, {})

    const caseResult = await exec(ctx, 'patent_case_search', { query: '创造性' }, 'w-3')
    expect(caseResult.isError).toBe(false)
    const wikiResult = await exec(ctx, 'patent_wiki_search', { query: 'a', include_body: true }, 'w-4')
    expect(wikiResult.isError).toBe(false)
  })

  it('keeps the kg tool dbPath-only when the knowledge db is absent', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-tools-kg-'))
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('patentKnowledge', {
      paths: { wikiDir: join(temp, 'wiki'), queryDbPath: join(temp, 'missing.db') },
      caseLawSearch: () => [],
    })
    await ctx.plugin(tool, {})
    const result = await exec(ctx, 'patent_kg_query', { query: 'x' }, 'w-5')
    expect(result.isError).toBe(true)
  })

  it('fails loud through the deferred search-index loader stub', async () => {
    const ctx = await mounted({})
    const result = await exec(ctx, 'search_patent_figure', { query: 'x' }, 'w-6')
    expect(result.isError).toBe(true)
  })

  it('fails loud through the deferred ego-browser runner stub', async () => {
    const ctx = await mounted({})
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-tools-pdf-'))
    const result = await exec(ctx, 'patent_pdf_download', { patents: ['US1A'], outputDir: temp }, 'w-7')
    expect(result.isError).toBe(true)
  })

  it('fails loud through the deferred note-writer stub', async () => {
    const ctx = await mounted({})
    const result = await exec(ctx, 'knowledge_note_save', { title: 't', content: 'c' }, 'w-8')
    expect(result.isError).toBe(true)
  })
})
