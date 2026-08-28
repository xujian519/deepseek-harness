import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createPatentSearchTool, baseNumber, dedupeByFamily } from '../src/tool/patent-search.ts'
import { createPatentMetadataTool } from '../src/tool/patent-metadata.ts'
import { createPatentLegalStatusTool } from '../src/tool/patent-legal-status.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

describe('patent_search', () => {
  it('baseNumber strips the kind code', () => {
    expect(baseNumber('CN115690481A')).toBe('CN115690481')
    expect(baseNumber('US11452699B2')).toBe('US11452699')
    expect(baseNumber('CN115690481')).toBeUndefined()
  })

  it('dedupeByFamily keeps the latest publication per base', () => {
    const hits = [
      { patent: 'CN115690481A', title: 'a', assignee: '', publication_date: '2023-01-01', priority_date: '', abstract: '', url: 'u' },
      { patent: 'CN115690481B', title: 'b', assignee: '', publication_date: '2024-01-01', priority_date: '', abstract: '', url: 'u' },
      { patent: 'US1A', title: 'c', assignee: '', publication_date: '2023-01-01', priority_date: '', abstract: '', url: 'u' },
    ]
    const { hits: deduped, warnings } = dedupeByFamily(hits, [])
    expect(deduped.map(h => h.patent)).toEqual(['CN115690481B', 'US1A'])
    expect(warnings.length).toBe(1)
  })

  it('searches and renders hits', async () => {
    const fake = { query: 'q', total: 1, hits: [{ patent: 'CN115690481A', title: 't', assignee: 'a', publication_date: '2023', priority_date: '2022', abstract: 'abs', url: 'u' }], warnings: [] }
    const tool = createPatentSearchTool({ search: async () => fake })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_search', { query: 'q' }, 's-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('patent_search')
    expect(text(result)).toContain('CN115690481A')
  })

  it('throws on an empty query', async () => {
    const tool = createPatentSearchTool({ search: async () => ({ query: '', total: 0, hits: [], warnings: [] }) })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_search', { query: '   ' }, 's-2')
    expect(result.isError).toBe(true)
  })
})

describe('patent_metadata', () => {
  it('maps a successful scrape', async () => {
    const tool = createPatentMetadataTool({
      scrape: async patent => ({
        success: true, patent, url: 'https://patents.google.com/patent/CN1',
        data: { title: 'T', application_number: '', inventor_name: '[]', assignee_name_orig: '[]', assignee_name_current: '[]', pub_date: '', filing_date: '', priority_date: '', grant_date: '', expiration_date: '', legal_status: '', ifi_status: '', estimated_expiration: '', pdf_url: '', classifications: '[]', forward_cite_no_family: '[]', forward_cite_yes_family: '[]', backward_cite_no_family: '[]', backward_cite_yes_family: '[]', abstract_text: 'A' },
        errorCode: '' as const, errorMessage: '', parseWarnings: [],
      }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('T')
  })

  it('returns success:false for a NOT_FOUND scrape', async () => {
    const tool = createPatentMetadataTool({
      scrape: async patent => ({ success: false, patent, url: 'u', data: null, errorCode: 'NOT_FOUND', errorMessage: 'not found', parseWarnings: [] }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('not found')
  })
})

describe('patent_legal_status', () => {
  it('maps a batch result', async () => {
    const tool = createPatentLegalStatusTool({
      checker: { checkBatch: async () => ({ 'US1A': { patent_number: 'US1A', title: 'T', status: 'Active', ifi_status: 'x', estimated_expiration: '2030', filing_date: '2010', grant_date: '2012', applicant: 'A', inventor: 'I', events_summary: [], url: 'u' } }) },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_legal_status', { patents: ['US1A'] }, 'l-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('US1A')
    expect(text(result)).toContain('Active')
  })
})
