/**
 * `patent_legal_status` tool: batch legal-status + estimated-expiration lookup via
 * the nuo LegalStatusChecker. Ported from Sati's patentLegalStatus.ts.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-legal-status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { LegalStatusChecker } from '@deepseek-ai/nuo-patent'

export type PatentLegalStatusInput = {
  /** Patent numbers (1-20), e.g. ["US11452699B2", "US2668287A"]. */
  patents: string[]
  /** Max concurrent requests (default 4). */
  maxConcurrency?: number
}

export type PatentLegalStatusItem = {
  patentNumber: string
  title: string
  status: string
  ifiStatus: string
  estimatedExpiration: string
  filingDate: string
  grantDate: string
  applicant: string
  inventor: string
  /** Recent transaction/status event summaries. */
  events: Array<{ type: string; date: string; title: string }>
  url: string
  /** Per-patent failure description (does not affect the rest of the batch). */
  error?: string
}

export type PatentLegalStatusOutput = {
  results: PatentLegalStatusItem[]
}

/** Injected checker (tests override; production uses the nuo LegalStatusChecker). */
export type PatentLegalStatusDeps = {
  checker?: Pick<LegalStatusChecker, 'checkBatch'>
}

const MAX_PATENTS = 20

const DESCRIPTION = [
  '- Queries patent legal status (Active / Expired / Abandoned) and estimated expiration from Google Patents',
  '- Batch: pass 1-20 patent numbers; individual failures are reported per-patent without aborting the batch',
  '- Returns title, status, estimated expiration, filing/grant dates, applicant, inventor, and status event history',
  '',
  'Usage notes:',
  '  - Read-only; makes one network request per patent (concurrency 4 by default)',
  '  - For CNIPA (China) legal-status transactions use the cnipa-query skill instead',
].join('\n')

/** Render the canonical legal-status list into model-facing prose. */
function renderLegalStatus(value: PatentLegalStatusOutput): string {
  const lines = value.results.map((item) => {
    const flag = item.error ? '❌' : item.status === 'UNKNOWN' ? '⚠️' : '✅'
    const exp = item.estimatedExpiration ? ` · expires ${item.estimatedExpiration}` : ''
    return `- ${flag} ${item.patentNumber}: ${item.title || item.error || '未知状态'} (${item.status || 'UNKNOWN'})${exp}`
  })
  return [`patent_legal_status: ${value.results.length} result(s)`, '', lines.join('\n')].join('\n')
}

const EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', required: true },
    date: { type: 'string', required: true },
    title: { type: 'string', required: true },
  },
} as const

/**
 * Build the `patent_legal_status` tool over an injectable checker.
 * @param deps - optional checker injection (defaults to the nuo LegalStatusChecker).
 * @returns a registry-ready tool definition.
 */
export function createPatentLegalStatusTool(deps: PatentLegalStatusDeps = {}): ToolDefinition {
  const checker = deps.checker ?? new LegalStatusChecker()
  return defineTool({
    name: 'patent_legal_status',
    description: DESCRIPTION,
    parameters: {
      patents: { type: 'array', required: true, items: { type: 'string' }, description: "Patent numbers (1-20), e.g. ['US11452699B2', 'US2668287A']" },
      maxConcurrency: { type: 'number', description: 'Max concurrent requests (default 4)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                patentNumber: { type: 'string', required: true },
                title: { type: 'string', required: true },
                status: { type: 'string', required: true },
                ifiStatus: { type: 'string', required: true },
                estimatedExpiration: { type: 'string', required: true },
                filingDate: { type: 'string', required: true },
                grantDate: { type: 'string', required: true },
                applicant: { type: 'string', required: true },
                inventor: { type: 'string', required: true },
                events: { type: 'array', required: true, items: EVENT_SCHEMA },
                url: { type: 'string', required: true },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderLegalStatus(value as unknown as PatentLegalStatusOutput) }],
    },
    async execute(args, exec) {
      const patents = args.patents.slice(0, MAX_PATENTS)
      const results = await checker.checkBatch(patents, {
        signal: exec.signal,
        maxConcurrency: args.maxConcurrency ?? 4,
      })
      const items: PatentLegalStatusItem[] = patents.map((pn) => {
        const r = results[pn]
        if (!r) {
          return {
            patentNumber: pn, title: '', status: 'UNKNOWN', ifiStatus: '', estimatedExpiration: '',
            filingDate: '', grantDate: '', applicant: '', inventor: '', events: [], url: '', error: '查询结果缺失',
          }
        }
        return {
          patentNumber: r.patent_number,
          title: r.title,
          status: r.status,
          ifiStatus: r.ifi_status,
          estimatedExpiration: r.estimated_expiration,
          filingDate: r.filing_date,
          grantDate: r.grant_date,
          applicant: r.applicant,
          inventor: r.inventor,
          events: r.events_summary,
          url: r.url,
          ...(r.error !== undefined ? { error: r.error } : {}),
        }
      })
      return { results: items }
    },
  })
}
