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
}

/** Map one nuo ScrapeResult into the tool output, throwing on runtime-class failures. */
function mapScrapeResult(result: ScrapeResult): PatentMetadataOutput {
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
      throw new PatentToolError('tool_execution_failed', result.errorMessage, {
        tool: 'patent_metadata',
        patent: result.patent,
        errorCode: result.errorCode,
      })
  }
}

const DESCRIPTION = [
  '- Fetches patent metadata from Google Patents by patent number (e.g. US11452699B2)',
  '- Returns structured data: title, inventors, assignees, dates, legal status, estimated expiration, abstract, PDF URL, classifications, citations',
  '- Validates and normalizes the patent number automatically',
  '- Use for patent due diligence, prior-art detail lookup, legal status checks',
  '',
  'Usage notes:',
  '  - Read-only; makes one network request per patent',
  "  - A 'not found' result (patent does not exist) is returned as data with success:false — not an error",
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
  return defineTool({
    name: 'patent_metadata',
    description: DESCRIPTION,
    parameters: {
      patent: { type: 'string', required: true, description: "Patent number, e.g. 'US11452699B2'. Validated and normalized (uppercase, no spaces)." },
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
      const validation = validatePatentNumber(args.patent)
      if (!validation.valid) {
        /* v8 ignore next -- the vendored validator always supplies a reason for invalid numbers. */
        throw new PatentToolError('invalid_tool_input', validation.reason ?? `Invalid patent number: ${args.patent}`, {
          tool: 'patent_metadata',
          patent: args.patent,
        })
      }
      /* v8 ignore next -- the vendored validator always normalizes valid numbers. */
      const result = await scrape(validation.normalized ?? args.patent, {
        timeout: args.timeout ?? 30000,
        returnAbstract: args.returnAbstract ?? true,
        returnLegal: args.returnLegal ?? true,
        signal: exec.signal,
      })
      return mapScrapeResult(result)
    },
  })
}
