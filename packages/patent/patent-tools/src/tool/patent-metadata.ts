/**
 * `patent_metadata` tool: fetch Google Patents metadata by patent number via the
 * nuo scrape engine (LRU-cached). Ported from Sati's patentMetadata.ts.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-metadata
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { scrapePatent as scrapePatentImpl, validatePatentNumber } from '@deepseek-ai/nuo-patent'
import type { ScrapeResult } from '@deepseek-ai/nuo-patent'
import { cachedScrapePatent, mapPatentData } from '@deepseek-ai/dsh-patent-data'
import type { StructuredPatentData } from '@deepseek-ai/dsh-patent-data'
import { PatentToolError } from '../error.ts'

/** Input for the patent_metadata tool. */
export type PatentMetadataInput = {
  /** Patent number, e.g. "US11452699B2" (validated and normalized). */
  patent: string
  /** Request timeout in ms (default 30000). */
  timeout?: number
  /** Extract abstract (default true). */
  returnAbstract?: boolean
  /** Extract legal status (default true). */
  returnLegal?: boolean
}

/** Output of the patent_metadata tool. */
export type PatentMetadataOutput = {
  success: boolean
  patent: string
  url: string
  /** Structured patent data on success (JSON-string fields parsed); null on failure. */
  data: JsonValue | null
  errorCode: string
  errorMessage: string
  /** Non-fatal parse warnings (field gaps from page-structure changes). */
  parseWarnings: Array<{ field: string; message: string }>
}

/** Injected scrape function (tests override; production uses the LRU-cached nuo scrape). */
export type PatentMetadataDeps = {
  scrape?: (
    patent: string,
    opts?: { timeout?: number; returnAbstract?: boolean; returnLegal?: boolean; signal?: AbortSignal },
  ) => Promise<ScrapeResult>
  /** Retry backoff before each repeat attempt (defaults to {@link DEFAULT_SCRAPE_RETRY_DELAYS_MS}). */
  scrapeRetryDelaysMs?: readonly number[]
}

/**
 * Upstream Google Patents answers 503 and drops connections under load; both are
 * transient, so a bounded backoff turns them into a slower answer instead of a
 * failed lookup.
 */
const DEFAULT_SCRAPE_RETRY_DELAYS_MS: readonly number[] = [400, 1_200]

/** Scrape error codes worth another attempt: transient network-layer failures. */
const RETRYABLE_SCRAPE_ERROR_CODES: readonly ScrapeResult['errorCode'][] = ['HTTP_ERROR', 'NETWORK_ERROR']

/**
 * Compact a user-supplied patent number into the form the scrape engine
 * indexes: full-width characters fold to ASCII, case is folded up, whitespace
 * and `-`/`/`/`:` separators drop, and the CN application-number check digit
 * (the `.N` suffix, e.g. `CN202122978405.0`) drops with its separator because it
 * is bookkeeping punctuation rather than part of the number.
 * @param value - the raw patent or application number.
 * @returns the compacted number.
 */
export function compactPatentNumber(value: string): string {
  const folded = value
    .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '')
    .toUpperCase()
  const withCheckDigit = /^(CN)?(\d{12})\.\d$/.exec(folded)
  if (withCheckDigit) return `${withCheckDigit[1] ?? ''}${withCheckDigit[2]}`
  return folded.replace(/[-:/]/g, '')
}

/** Wait for the given delay; the scrape retry never outlives the caller's patience. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Run one scrape, retrying transient upstream failures under a bounded backoff. */
async function scrapeWithRetry(
  scrape: NonNullable<PatentMetadataDeps['scrape']>,
  patent: string,
  options: { timeout: number; returnAbstract: boolean; returnLegal: boolean; signal?: AbortSignal },
  retryDelaysMs: readonly number[],
): Promise<{ result: ScrapeResult; attempts: number }> {
  let attempts = 0
  for (;;) {
    attempts += 1
    const result = await scrape(patent, options)
    const retry = RETRYABLE_SCRAPE_ERROR_CODES.includes(result.errorCode)
    if (!retry || attempts > retryDelaysMs.length) return { result, attempts }
    await delay(retryDelaysMs[attempts - 1] ?? 0)
  }
}


/**
 * Map one nuo ScrapeResult into the tool output, throwing on runtime-class failures.
 * @param result - the settled scrape result.
 * @param attempts - total scrape attempts made, reported when an upstream failure outlived the retries.
 * @returns the tool output for a completed or not-found lookup.
 */
function mapScrapeResult(result: ScrapeResult, attempts: number): PatentMetadataOutput {
  if (result.success && result.data) {
    return {
      success: true,
      patent: result.patent,
      url: result.url,
      data: mapPatentData(result.data, result.patent, result.url) as unknown as JsonValue,
      errorCode: '',
      errorMessage: '',
      parseWarnings: result.parseWarnings,
    }
  }
  switch (result.errorCode) {
    case 'VALIDATION_ERROR':
      throw new PatentToolError('invalid_tool_input', result.errorMessage, { tool: 'patent_metadata', patent: result.patent })
    case 'TIMEOUT':
      throw new PatentToolError('tool_timeout', result.errorMessage, { tool: 'patent_metadata', patent: result.patent })
    case 'NOT_FOUND':
      return {
        success: false,
        patent: result.patent,
        url: result.url,
        data: null,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
        parseWarnings: result.parseWarnings,
      }
    default:
      throw new PatentToolError('tool_execution_failed', attempts > 1
        ? `${result.errorMessage}（已重试 ${attempts - 1} 次仍未成功：上游瞬时失败，可稍后重试，或改用 CNIPR/CNIPA 通道取该专利）`
        : result.errorMessage, {
        tool: 'patent_metadata',
        patent: result.patent,
        errorCode: result.errorCode,
      })
  }
}

const DESCRIPTION = [
  '- Fetches patent metadata from Google Patents by patent number (e.g. US11452699B2)',
  '- Returns structured data: title, inventors, assignees, dates, legal status, estimated expiration, abstract, PDF URL, classifications, citations',
  '- Validates and normalizes the patent number automatically; a CN application number keeps its 12-digit form (CN202122978405.0 → CN202122978405) and full-width characters, whitespace, and - / : separators fold away',
  '- Use for patent due diligence, prior-art detail lookup, legal status checks',
  '',
  'Usage notes:',
  '  - Read-only; makes one network request per patent',
  '  - A country code is required; a bare application number (202122978405) is rejected — prepend CN or use the publication number',
  "  - A 'not found' result (patent does not exist) is returned as data with success:false — not an error",
  '  - A transient upstream failure (HTTP 503, dropped connection) is retried twice before the call fails',
  '  - Non-fatal parse warnings are surfaced in parseWarnings when the page structure changes',
].join('\n')

/** Render the canonical metadata value into model-facing Markdown. */
function renderMetadata(value: PatentMetadataOutput): string {
  if (!value.success || value.data === null) {
    return `patent_metadata(${value.patent}): ${value.errorMessage}`
  }
  const d = value.data as unknown as StructuredPatentData
  const lines = [
    `## ${d.title}`,
    `**patent**: ${d.patent} · **url**: ${d.url}`,
    `**inventors**: ${d.inventors.join(', ') || 'N/A'}`,
    `**assignees**: ${d.assigneesCurrent.join(', ') || 'N/A'}`,
    `**dates**: filing ${d.filingDate || 'N/A'} · grant ${d.grantDate || 'N/A'} · pub ${d.pubDate || 'N/A'}`,
    `**legal status**: ${d.legalStatus || 'N/A'}${d.estimatedExpiration ? ` · est. expiration ${d.estimatedExpiration}` : ''}`,
    `**classifications**: ${d.classifications.join(', ') || 'N/A'}`,
    `**citations**: ${d.backwardCites.length} backward · ${d.forwardCites.length} forward`,
  ]
  if (d.pdfUrl) lines.push(`**pdf**: ${d.pdfUrl}`)
  if (d.abstractText) lines.push('', d.abstractText)
  return lines.join('\n')
}

const WARNING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    field: { type: 'string', required: true },
    message: { type: 'string', required: true },
  },
} as const

/**
 * Build the `patent_metadata` tool over an injectable nuo scrape function.
 * @param deps - optional scrape-function injection (defaults to the LRU-cached nuo scrape).
 * @returns a registry-ready tool definition.
 */
export function createPatentMetadataTool(deps: PatentMetadataDeps = {}): ToolDefinition {
  const scrape = deps.scrape ?? cachedScrapePatent(scrapePatentImpl)
  const retryDelaysMs = deps.scrapeRetryDelaysMs ?? DEFAULT_SCRAPE_RETRY_DELAYS_MS
  return defineTool({
    name: 'patent_metadata',
    description: DESCRIPTION,
    parameters: {
      patent: { type: 'string', required: true, description: "Patent number, e.g. 'US11452699B2'. Validated and normalized (uppercase, no spaces, no - / : separators; a CN application check digit is dropped)." },
      timeout: { type: 'number', description: 'Request timeout in ms (default 30000)' },
      returnAbstract: { type: 'boolean', description: 'Include abstract (default true)' },
      returnLegal: { type: 'boolean', description: 'Include legal status (default true)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          patent: { type: 'string', required: true },
          url: { type: 'string', required: true },
          data: { type: 'json' },
          errorCode: { type: 'string', required: true },
          errorMessage: { type: 'string', required: true },
          parseWarnings: { type: 'array', required: true, items: WARNING_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderMetadata(value as unknown as PatentMetadataOutput) }],
    },
    async execute(args, exec) {
      const compacted = compactPatentNumber(args.patent)
      const validation = validatePatentNumber(compacted)
      if (!validation.valid) {
        /* v8 ignore next -- the vendored validator always supplies a reason for invalid numbers. */
        const reason = validation.reason ?? `Invalid patent number: ${args.patent}`
        throw new PatentToolError('invalid_tool_input', `${reason}；中国专利可补国家码（如 CN202122978405），或改用公开号（如 CN218483312U）`, {
          tool: 'patent_metadata',
          patent: args.patent,
        })
      }
      /* v8 ignore next -- the vendored validator always normalizes valid numbers. */
      const patent = validation.normalized ?? compacted
      const { result, attempts } = await scrapeWithRetry(scrape, patent, {
        timeout: args.timeout ?? 30000,
        returnAbstract: args.returnAbstract ?? true,
        returnLegal: args.returnLegal ?? true,
        signal: exec.signal,
      }, retryDelaysMs)
      return mapScrapeResult(result, attempts)
    },
  })
}
