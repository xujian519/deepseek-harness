/**
 * `patent_search` tool: keyword/boolean search over Google Patents via the nuo
 * engine (LRU-cached). Ported from Sati's patentSearch.ts.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-search
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { searchPatents as searchPatentsImpl } from '@deepseek-ai/nuo-patent'
import type { PatentSearchHit, PatentSearchResult } from '@deepseek-ai/nuo-patent'
import { cachedSearchPatents } from '@deepseek-ai/dsh-patent-data'
import { PatentToolError } from '../error.ts'

export type PatentSearchInput = {
  /** Google Patents native search syntax (keywords/boolean/assignee:/date range). */
  query: string
  /** Max hits (1-50, default 10). */
  limit?: number
}

export type PatentSearchHitItem = {
  patent: string
  title: string
  assignee: string
  publicationDate: string
  priorityDate: string
  abstract: string
  url: string
}

export type PatentSearchOutput = {
  query: string
  total: number
  hits: PatentSearchHitItem[]
  /** Non-fatal warnings (parse degradation / partial fields / family dedupe). */
  warnings: string[]
}

/** Injected search function (tests override; production uses the LRU-cached nuo search). */
export type PatentSearchDeps = {
  search?: (query: string, opts?: { limit?: number; signal?: AbortSignal }) => Promise<PatentSearchResult>
}

function toItem(h: PatentSearchHit): PatentSearchHitItem {
  return {
    patent: h.patent,
    title: h.title,
    assignee: h.assignee,
    publicationDate: h.publication_date,
    priorityDate: h.priority_date,
    abstract: h.abstract,
    url: h.url,
  }
}

/** Extract the base number of a patent (strip kind code): `CN115690481A`→`CN115690481`. */
export function baseNumber(patent: string): string | undefined {
  const match = /^([A-Z]{2}\d+)[A-Z]\d?$/.exec(patent)
  return match?.[1]
}

/**
 * Deduplicate by base number: Google Patents often returns A/B/C variants of the
 * same application; keep the latest publication date per base, in source order.
 * @param hits - the source hits.
 * @param baseWarnings - existing warnings to append to.
 * @returns deduped hits plus the merged warnings.
 */
export function dedupeByFamily(
  hits: readonly PatentSearchHit[],
  baseWarnings: readonly string[],
): { hits: PatentSearchHit[]; warnings: string[] } {
  const bestByBase = new Map<string, PatentSearchHit>()
  const kept = new Set<string>()
  const dropped = new Map<string, number>()

  for (const hit of hits) {
    const base = baseNumber(hit.patent)
    if (base === undefined) continue
    const current = bestByBase.get(base)
    if (current === undefined) {
      bestByBase.set(base, hit)
      kept.add(hit.patent)
      continue
    }
    if ((hit.publication_date ?? '') > (current.publication_date ?? '')) {
      bestByBase.set(base, hit)
      kept.delete(current.patent)
      kept.add(hit.patent)
    }
    dropped.set(base, (dropped.get(base) ?? 0) + 1)
  }

  const deduped = hits.filter(h => kept.has(h.patent) || baseNumber(h.patent) === undefined)
  const warnings = [...baseWarnings]
  for (const [base, count] of dropped) {
    const best = bestByBase.get(base)
    const date = best?.publication_date ? ` ${best.publication_date}` : ''
    warnings.push(`family 去重：${base}* 的 ${count + 1} 篇公开/授权变体合并为 1 篇（保留 ${best?.patent}${date}）`)
  }
  return { hits: deduped, warnings }
}

const DESCRIPTION = [
  '- Searches Google Patents by keyword or boolean query (e.g. \'(phase change OR PCM) AND thermal\', \'assignee:(Samsung) after:20200101\')',
  '- Returns structured hits: patent number, title, assignee, publication date, abstract, URL',
  '- Use for prior-art search, novelty pre-screening, competitor/assignee analysis',
  '',
  'Usage notes:',
  '  - Read-only; query syntax follows Google Patents search grammar',
  '  - Follow up with patent_metadata to fetch full details of a specific hit',
  '  - A network failure is reported as an error; a genuine zero-result search returns empty hits with warnings',
].join('\n')

/** Render the canonical search value into model-facing Markdown. */
function renderSearch(value: PatentSearchOutput): string {
  const lines = value.hits.map(h =>
    [
      `## ${h.title || h.patent}`,
      `**patent**: ${h.patent}${h.publicationDate ? ` · published ${h.publicationDate}` : ''}`,
      `**assignee**: ${h.assignee || 'N/A'}`,
      `**url**: ${h.url}`,
      ...(h.abstract ? [h.abstract] : []),
    ].join('\n'),
  )
  return [`**patent_search** — ${value.hits.length} result(s) for "${value.query}"`, '', lines.join('\n\n---\n\n')].join('\n')
}

const HIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    patent: { type: 'string', required: true },
    title: { type: 'string', required: true },
    assignee: { type: 'string', required: true },
    publicationDate: { type: 'string', required: true },
    priorityDate: { type: 'string', required: true },
    abstract: { type: 'string', required: true },
    url: { type: 'string', required: true },
  },
} as const

/**
 * Build the `patent_search` tool over an injectable nuo search function.
 * @param deps - optional search-function injection (defaults to the LRU-cached nuo search).
 * @returns a registry-ready tool definition.
 */
export function createPatentSearchTool(deps: PatentSearchDeps = {}): ToolDefinition {
  const search = deps.search ?? cachedSearchPatents(searchPatentsImpl)
  return defineTool({
    name: 'patent_search',
    description: DESCRIPTION,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Search query in Google Patents syntax: keywords, phrases, boolean (AND/OR/NOT), fielded (assignee:/inventor:), date ranges (after:/before:).',
      },
      limit: { type: 'number', description: 'Max hits (1-50, default 10)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          hits: { type: 'array', required: true, items: HIT_SCHEMA },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value as unknown as PatentSearchOutput) }],
    },
    async execute(args, exec) {
      const query = args.query.trim()
      if (query.length === 0) {
        throw new PatentToolError('invalid_tool_input', 'Search query is empty.', { tool: 'patent_search' })
      }
      const result = await search(query, { limit: args.limit ?? 10, signal: exec.signal })

      const failure = result.warnings.find(w => /^(查询条件为空|检索超时|检索失败)/.test(w))
      if (failure) {
        if (failure.startsWith('检索超时')) {
          throw new PatentToolError('tool_timeout', failure, { tool: 'patent_search', query })
        }
        if (failure === '查询条件为空') {
          throw new PatentToolError('invalid_tool_input', failure, { tool: 'patent_search' })
        }
        throw new PatentToolError('tool_execution_failed', failure, { tool: 'patent_search', query })
      }

      const { hits: dedupedHits, warnings } = dedupeByFamily(result.hits, result.warnings)
      const hits = dedupedHits.map(toItem)
      return { query, total: result.total, hits, warnings }
    },
  })
}
