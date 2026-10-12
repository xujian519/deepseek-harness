/**
 * `patent_legal_status` tool: batch legal-status + estimated-expiration lookup via
 * the nuo LegalStatusChecker. Ported from Sati's patentLegalStatus.ts.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-legal-status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { LegalStatusChecker } from '@deepseek-ai/nuo-patent'
import type { CniprChannel, CniprLegalRecord, CniprLegalStatusItem } from '@deepseek-ai/dsh-patent-data'
import { CNIPR_CHANNEL, GOOGLE_PATENTS_CHANNEL } from './internal/upstream-channel.ts'

/** Input for the patent_legal_status tool. */
export type PatentLegalStatusInput = {
  /** Patent numbers (1-20), e.g. ["US11452699B2", "US2668287A"]. */
  patents: string[]
  /** Max concurrent requests (default 4). */
  maxConcurrency?: number
}

/** One patent's legal-status result. */
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
  /** 服务该篇的通道名（Google Patents 或 CNIPR）；报告据此写明每条法律状态的来源。 */
  channel: string
  /** Per-patent failure description (does not affect the rest of the batch). */
  error?: string
}

/** Output of the patent_legal_status tool. */
export type PatentLegalStatusOutput = {
  results: PatentLegalStatusItem[]
  /** Number of patent numbers silently dropped over the 20-item cap. */
  truncatedCount?: number
  /** 通道级告警（某通道被咨询过但未能服务），例如 CNIPR 登录态失效。 */
  warnings: string[]
}

/**
 * 晚绑定的 CNIPR 通道查询。`patent-data` 的插件声明 `inject: ['subprocess']`，在只注入
 * `['tools']` 的消费方里晚一跳激活；在 `apply()` 里读取会冻结当时看到的服务。
 * @returns 具备 `legalStatus` 的通道，本部署未启用或未接线时为 undefined。
 */
export type CniprLegalStatusLookup = () => Pick<CniprChannel, 'legalStatus'> | undefined

/** Injected checker (tests override; production uses the nuo LegalStatusChecker). */
export type PatentLegalStatusDeps = {
  checker?: Pick<LegalStatusChecker, 'checkBatch'>
  /** CNIPR 第二通道（默认不接线：部署未打开该通道时只走 nuo 引擎）。 */
  cnipr?: CniprLegalStatusLookup
}

const MAX_PATENTS = 20

const DESCRIPTION = [
  '- Queries patent legal status (Active / Expired / Abandoned) and estimated expiration from Google Patents',
  '- Batch: pass 1-20 patent numbers; individual failures are reported per-patent without aborting the batch',
  '- Returns title, status, estimated expiration, filing/grant dates, applicant, inventor, and status event history',
  '',
  'Usage notes:',
  '  - Read-only; makes one network request per patent (concurrency 4 by default)',
  '  - 每个结果点名服务它的 channel。中国申请号/公开(公告)号在 Google Patents 通道查不到时，部署启用 CNIPR 通道重查一次：该通道只出法律状态公告记录（announce_date / status / status_info），其余字段为空，status 取其中公告日最新的一条',
  '  - 通道失败不是整批失败：失败的号保留 nuo 通道的原因，被咨询过但未能服务的通道写在 warnings 里',
].join('\n')

/** Render the canonical legal-status list into model-facing prose. */
function renderLegalStatus(value: PatentLegalStatusOutput): string {
  const lines = value.results.map((item) => {
    const flag = item.error ? '❌' : item.status === 'UNKNOWN' ? '⚠️' : '✅'
    const exp = item.estimatedExpiration ? ` · expires ${item.estimatedExpiration}` : ''
    // CNIPR 条目没有标题，只有法律状态记录：标题缺席时退到状态，避免把「有状态」写成「未知状态」。
    const label = item.error ?? (item.title || item.status || '未知状态')
    return `- ${flag} ${item.patentNumber}: ${label} (${item.status || 'UNKNOWN'})${exp} · 通道：${item.channel}`
  })
  const truncation = value.truncatedCount !== undefined && value.truncatedCount > 0
    ? `\n⚠️ ${value.truncatedCount} 个专利号超出 20 条上限被截断，未查询。`
    : ''
  const warningLines = value.warnings.length > 0
    ? ['', '## 通道告警', ...value.warnings.map(w => `- ${w}`)]
    : []
  return [`patent_legal_status: ${value.results.length} result(s)`, '', lines.join('\n') + truncation, ...warningLines].join('\n')
}

/** 一条 CNIPR 记录映射成通道无关的状态事件（该通道只出这四段）。 */
function cniprEvent(record: CniprLegalRecord): { type: string; date: string; title: string } {
  return { type: '法律状态公告', date: record.announce_date, title: record.status_info || record.status }
}

/**
 * 取公告日最新的一条记录：页面按公告日倒序，但同一申请号可能有多轮公告，按日期取最大更稳。
 * @param records - 该号的全部记录。
 * @returns 最新记录，无记录时为 undefined。
 */
function latestCniprRecord(records: readonly CniprLegalRecord[]): CniprLegalRecord | undefined {
  let latest: CniprLegalRecord | undefined
  for (const record of records) {
    if (latest === undefined || record.announce_date > latest.announce_date) latest = record
  }
  return latest
}

/** CNIPR 通道能服务的那一篇：状态与事件来自该通道，其余字段为空（它不发布这些）。 */
function cniprLegalStatusItem(patentNumber: string, records: readonly CniprLegalRecord[]): PatentLegalStatusItem {
  const latest = latestCniprRecord(records)
  return {
    patentNumber,
    title: '',
    status: latest?.status ?? 'UNKNOWN',
    ifiStatus: '',
    estimatedExpiration: '',
    filingDate: '',
    grantDate: '',
    applicant: '',
    inventor: '',
    events: records.map(cniprEvent),
    url: '',
    channel: CNIPR_CHANNEL,
  }
}

/** 该篇是否需要 CNIPR 重查：nuo 通道给了失败原因，或没有给出可用状态。 */
function needsCniprRetry(item: PatentLegalStatusItem): boolean {
  return item.error !== undefined || item.status === '' || item.status === 'UNKNOWN'
}

/**
 * 用 CNIPR 第二通道重查 nuo 通道没给出状态的号，就地把成功的重查替换进 `items`。
 *
 * 只重查「nuo 没给出状态」的号：有状态的条目保持原样，避免用第二通道覆盖第一通道的答案。
 * 通道级失败不是整批失败——条目保留 nuo 通道的原因，失败本身进 warnings，让「第二个通道
 * 不可用」在调用记录里看得见（否则会被读成「不需要它」）。
 * @param deps - 工具依赖；`cnipr` 缺省或本部署未启用时不重查。
 * @param items - 本次调用的条目，成功的重查原地替换对应项。
 * @param signal - 调用方取消信号。
 * @returns 模型可见的通道告警；没有可重查的号或通道未接线时为空。
 */
async function retryThroughCnipr(
  deps: PatentLegalStatusDeps,
  items: PatentLegalStatusItem[],
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const cnipr = deps.cnipr?.()
  if (cnipr === undefined) return []
  const retry = items.filter(needsCniprRetry).map(item => item.patentNumber)
  if (retry.length === 0) return []
  let reported: CniprLegalStatusItem[]
  try {
    reported = await cnipr.legalStatus(retry, { ...(signal === undefined ? {} : { signal }) })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return [`${CNIPR_CHANNEL}不可用（${detail}），${retry.length} 个号只有 ${GOOGLE_PATENTS_CHANNEL} 的结果`]
  }
  for (const item of reported) {
    if (item.records.length === 0) continue
    const index = items.findIndex(existing => existing.patentNumber === item.number)
    if (index >= 0) items[index] = cniprLegalStatusItem(item.number, item.records)
  }
  return []
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
                channel: { type: 'string', required: true },
                error: { type: 'string' },
              },
            },
          },
          truncatedCount: { type: 'number', description: '超出 20 条上限被截断未查询的专利号数量' },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderLegalStatus(value) }],
    },
    async execute(args, exec) {
      const dropped = args.patents.length - Math.min(args.patents.length, MAX_PATENTS)
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
            filingDate: '', grantDate: '', applicant: '', inventor: '', events: [], url: '',
            channel: GOOGLE_PATENTS_CHANNEL, error: '查询结果缺失',
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
          channel: GOOGLE_PATENTS_CHANNEL,
          ...(r.error !== undefined ? { error: r.error } : {}),
        }
      })
      const warnings = await retryThroughCnipr(deps, items, exec.signal)
      return { results: items, warnings, ...(dropped > 0 ? { truncatedCount: dropped } : {}) }
    },
  })
}
