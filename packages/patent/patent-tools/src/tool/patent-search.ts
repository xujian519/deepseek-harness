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
import { retryBounded } from './internal/bounded-retry.ts'
import { GOOGLE_PATENTS_CHANNEL, renderUpstreamFailure } from './internal/upstream-channel.ts'

/** Input for the patent_search tool. */
export type PatentSearchInput = {
  /** Google Patents native search syntax (keywords/boolean/assignee:/date range). */
  query: string
  /** Max hits (1-50, default 10). */
  limit?: number
}

/** One normalized search hit. */
export type PatentSearchHitItem = {
  patent: string
  title: string
  assignee: string
  publicationDate: string
  priorityDate: string
  abstract: string
  url: string
}

/** Output of the patent_search tool. */
export type PatentSearchOutput = {
  query: string
  /** Channel this search read from; a report cites it as the fact's source. */
  channel: string
  total: number
  hits: PatentSearchHitItem[]
  /** Non-fatal warnings (parse degradation / partial fields / family dedupe). */
  warnings: string[]
}

/** Injected search function (tests override; production uses the LRU-cached nuo search). */
export type PatentSearchDeps = {
  search?: (query: string, opts?: { limit?: number; signal?: AbortSignal }) => Promise<PatentSearchResult>
  /** Retry backoff before each repeat attempt (defaults to {@link DEFAULT_SEARCH_RETRY_DELAYS_MS}). */
  searchRetryDelaysMs?: readonly number[]
}

/**
 * The engine answers timeouts and dropped connections under load; both are
 * transient, so a bounded backoff turns them into a slower answer instead of a
 * failed search. The delays mirror `patent_metadata`'s scrape retry.
 */
const DEFAULT_SEARCH_RETRY_DELAYS_MS: readonly number[] = [400, 1_200]

/** Failure-class warning prefixes: the engine reports failures in `warnings`, not an error code. */
const SEARCH_FAILURE_WARNING = /^(查询条件为空|检索超时|检索失败)/

/** The subset of failure warnings worth another attempt: transient upstream failures. */
const RETRYABLE_SEARCH_FAILURE_WARNING = /^(检索超时|检索失败)/

/** The failure-class warning carried by a result, if any. */
function failureWarning(result: PatentSearchResult): string | undefined {
  return result.warnings.find(w => SEARCH_FAILURE_WARNING.test(w))
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

/**
 * Extract the base number of a patent (strip kind code): `CN115690481A`→`CN115690481`.
 * @param patent - the patent number to extract from.
 * @returns the base number, or undefined when the format does not match.
 */
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
    if (hit.publication_date > current.publication_date) {
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
  '  - One call reads one channel, named in the result and in any failure, so a report cites the channel it actually used instead of inferring one from a hit URL',
  '  - A network failure is reported as an error naming that channel; a genuine zero-result search returns empty hits',
  '  - A transient upstream failure (timeout, dropped connection) is retried twice; a failure that outlives the retries names the channel, the upstream error, and the attempts made',
  '  - Non-fatal warnings (family dedupe, fields the page structure left empty) are listed under 警告 in the rendered result',
].join('\n')

/**
 * Render the canonical search value into model-facing Markdown.
 *
 * Warnings are rendered, not merely carried: the description promises the model
 * sees them, and a zero-hit render would otherwise state `0 result(s)` without
 * the reason the upstream reported.
 */
function renderSearch(value: PatentSearchOutput): string {
  const hits = value.hits.map(h =>
    [
      `## ${h.title || h.patent}`,
      `**patent**: ${h.patent}${h.publicationDate ? ` · published ${h.publicationDate}` : ''}`,
      `**assignee**: ${h.assignee || 'N/A'}`,
      `**url**: ${h.url}`,
      ...(h.abstract ? [h.abstract] : []),
    ].join('\n'),
  )
  const header = `**patent_search** — ${value.hits.length} result(s) for "${value.query}" · channel: ${value.channel}`
  const warningLines = value.warnings.length > 0
    ? ['', '## 警告', ...value.warnings.map(w => `- ${w}`)]
    : []
  return [header, '', hits.join('\n\n---\n\n'), ...warningLines].join('\n')
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
  const retryDelaysMs = deps.searchRetryDelaysMs ?? DEFAULT_SEARCH_RETRY_DELAYS_MS
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
          channel: { type: 'string', required: true },
          total: { type: 'integer', required: true },
          hits: { type: 'array', required: true, items: HIT_SCHEMA },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args, exec) {
      const query = args.query.trim()
      if (query.length === 0) {
        throw new PatentToolError('invalid_tool_input', 'Search query is empty.', { tool: 'patent_search' })
      }
      const { result, attempts } = await retryBounded(
        () => search(query, { limit: args.limit ?? 10, signal: exec.signal }),
        (settled) => {
          const warning = failureWarning(settled)
          return warning !== undefined && RETRYABLE_SEARCH_FAILURE_WARNING.test(warning)
        },
        retryDelaysMs,
        exec.signal,
      )

      const failure = failureWarning(result)
      if (failure) {
        if (failure.startsWith('检索超时')) {
          throw new PatentToolError('tool_timeout', renderUpstreamFailure(failure, attempts), { tool: 'patent_search', query })
        }
        if (failure === '查询条件为空') {
          throw new PatentToolError('invalid_tool_input', failure, { tool: 'patent_search' })
        }
        throw new PatentToolError('tool_execution_failed', renderUpstreamFailure(failure, attempts), { tool: 'patent_search', query })
      }

      const { hits: dedupedHits, warnings } = dedupeByFamily(result.hits, result.warnings)
      const hits = dedupedHits.map(toItem)
      return { query, channel: GOOGLE_PATENTS_CHANNEL, total: result.total, hits, warnings }
    },
  })
}
