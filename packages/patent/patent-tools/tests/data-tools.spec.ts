import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createPatentSearchTool, baseNumber, dedupeByFamily } from '../src/tool/patent-search.ts'
import { createPatentMetadataTool } from '../src/tool/patent-metadata.ts'
import { createPatentLegalStatusTool } from '../src/tool/patent-legal-status.ts'
import type { PatentData } from '@deepseek-ai/nuo-patent'

const signal = new AbortController().signal

/** Minimal scraped page payload: every field present, every JSON field empty. */
function minimalPatentData(): PatentData {
  return {
    title: 'T',
    application_number: '',
    inventor_name: '[]',
    assignee_name_orig: '[]',
    assignee_name_current: '[]',
    pub_date: '',
    filing_date: '',
    priority_date: '',
    grant_date: '',
    expiration_date: '',
    legal_status: '',
    ifi_status: '',
    estimated_expiration: '',
    pdf_url: '',
    classifications: '[]',
    forward_cite_no_family: '[]',
    forward_cite_yes_family: '[]',
    backward_cite_no_family: '[]',
    backward_cite_yes_family: '[]',
    abstract_text: 'A',
  }
}

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

  it('renders the non-fatal warnings alongside the hits', async () => {
    const fake = {
      query: 'q',
      total: 3,
      hits: [
        { patent: 'CN115690481A', title: 'a', assignee: '', publication_date: '2023-01-01', priority_date: '', abstract: '', url: 'u' },
        { patent: 'CN115690481B', title: 'b', assignee: '', publication_date: '2024-01-01', priority_date: '', abstract: '', url: 'u' },
      ],
      warnings: [],
    }
    const tool = createPatentSearchTool({ search: async () => fake })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_search', { query: 'q' }, 's-warn')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const out = text(result)
    expect(out).toContain('## 警告')
    expect(out).toContain('- family 去重：CN115690481* 的 2 篇公开/授权变体合并为 1 篇（保留 CN115690481B 2024-01-01）')
  })

  it('renders the warnings of a zero-hit search', async () => {
    const tool = createPatentSearchTool({
      search: async () => ({ query: 'q', total: 0, hits: [], warnings: ['部分字段未解析：publication_date'] }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_search', { query: 'q' }, 's-warn-empty')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('- 部分字段未解析：publication_date')
  })

  it('renders no warning section when there is nothing to warn about', async () => {
    const fake = { query: 'q', total: 1, hits: [{ patent: 'CN115690481A', title: 't', assignee: 'a', publication_date: '2023', priority_date: '2022', abstract: 'abs', url: 'u' }], warnings: [] }
    const tool = createPatentSearchTool({ search: async () => fake })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_search', { query: 'q' }, 's-no-warn')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).not.toContain('## 警告')
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

  it('compacts separators, full-width characters, and a CN application check digit', async () => {
    const seen: string[] = []
    const tool = createPatentMetadataTool({
      scrape: async (patent) => {
        seen.push(patent)
        return { success: false, patent, url: 'u', data: null, errorCode: 'NOT_FOUND', errorMessage: 'not found', parseWarnings: [] }
      },
    })
    const ctx = await ctxWith(tool)
    for (const [index, input] of ['CN202122978405.0', 'ｃｎ２０２１２２９７８４０５.０', 'CN-218483312-U'].entries()) {
      await execute(ctx, 'patent_metadata', { patent: input }, `m-c-${index}`)
    }
    expect(seen).toEqual(['CN202122978405', 'CN202122978405', 'CN218483312U'])
  })

  it('rejects a number without a country code with actionable guidance', async () => {
    const tool = createPatentMetadataTool({ scrape: async () => { throw new Error('must not scrape') } })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: '202122978405' }, 'm-no-cc')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('中国专利可补国家码')
  })

  it('retries a transient upstream failure and keeps the successful answer', async () => {
    let calls = 0
    const tool = createPatentMetadataTool({
      scrapeRetryDelaysMs: [0, 0],
      scrape: async (patent) => {
        calls += 1
        if (calls === 1) {
          return { success: false, patent, url: 'u', data: null, errorCode: 'HTTP_ERROR', errorMessage: 'HTTP 503', parseWarnings: [] }
        }
        return {
          success: true, patent, url: 'https://patents.google.com/patent/CN1',
          data: { title: 'T', application_number: '', inventor_name: '[]', assignee_name_orig: '[]', assignee_name_current: '[]', pub_date: '', filing_date: '', priority_date: '', grant_date: '', expiration_date: '', legal_status: '', ifi_status: '', estimated_expiration: '', pdf_url: '', classifications: '[]', forward_cite_no_family: '[]', forward_cite_yes_family: '[]', backward_cite_no_family: '[]', backward_cite_yes_family: '[]', abstract_text: 'A' },
          errorCode: '' as const, errorMessage: '', parseWarnings: [],
        }
      },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-retry')
    expect(result.isError).toBe(false)
    expect(calls).toBe(2)
  })

  it('reports the exhausted retries on a persistent upstream failure', async () => {
    let calls = 0
    const tool = createPatentMetadataTool({
      scrapeRetryDelaysMs: [0],
      scrape: async (patent) => {
        calls += 1
        return { success: false, patent, url: 'u', data: null, errorCode: 'HTTP_ERROR', errorMessage: 'HTTP 503', parseWarnings: [] }
      },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-retry-out')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('已重试 1 次仍未成功')
    expect(calls).toBe(2)
  })

  it('does not retry a parse failure', async () => {
    let calls = 0
    const tool = createPatentMetadataTool({
      scrapeRetryDelaysMs: [0],
      scrape: async (patent) => {
        calls += 1
        return { success: false, patent, url: 'u', data: null, errorCode: 'PARSE_ERROR', errorMessage: 'bad page', parseWarnings: [] }
      },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-parse')
    expect(result.isError).toBe(true)
    expect(calls).toBe(1)
  })

  it('renders the non-fatal parse warnings of a successful scrape', async () => {
    const tool = createPatentMetadataTool({
      scrape: async patent => ({
        success: true,
        patent,
        url: 'https://patents.google.com/patent/CN1',
        data: minimalPatentData(),
        errorCode: '' as const,
        errorMessage: '',
        parseWarnings: [
          { field: 'assigneesCurrent', message: '页面结构变化：申请人字段未解析' },
          { field: 'legalStatus', message: '页面结构变化：法律状态字段未解析' },
        ],
      }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-warn')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const out = text(result)
    expect(out).toContain('## 警告')
    expect(out).toContain('- assigneesCurrent: 页面结构变化：申请人字段未解析')
    expect(out).toContain('- legalStatus: 页面结构变化：法律状态字段未解析')
  })

  it('renders the parse warnings that accompany a failed lookup', async () => {
    const tool = createPatentMetadataTool({
      scrape: async patent => ({
        success: false,
        patent,
        url: 'u',
        data: null,
        errorCode: 'NOT_FOUND',
        errorMessage: 'not found',
        parseWarnings: [{ field: 'title', message: '页面结构变化：标题未解析' }],
      }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-warn-fail')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const out = text(result)
    expect(out).toContain('not found')
    expect(out).toContain('## 警告')
    expect(out).toContain('- title: 页面结构变化：标题未解析')
  })

  it('renders no warning section when the parse is clean', async () => {
    const tool = createPatentMetadataTool({
      scrape: async patent => ({
        success: true,
        patent,
        url: 'https://patents.google.com/patent/CN1',
        data: minimalPatentData(),
        errorCode: '' as const,
        errorMessage: '',
        parseWarnings: [],
      }),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_metadata', { patent: 'CN1A' }, 'm-clean')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).not.toContain('## 警告')
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
