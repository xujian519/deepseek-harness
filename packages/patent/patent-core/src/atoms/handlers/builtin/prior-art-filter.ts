/**
 * 检索域原子：prior-art-filter（现有技术时间过滤）。
 *
 * 包装 `evidence/date.ts` 的公开日认定与截止日比较，按 A22.5 只保留截止日前公开的
 * 文献；A24 的四种首次公开情形在申请日前六个月内发生时，标注为不破坏新颖性并从
 * `prior_art` 中排除。截止日与申请日必须是具体日期：月级输入无法确定边界，降级
 * 而不是按月初或月末猜测。缺少公开日的文献保留并单列，避免把未知日期误判为非现有技术。
 *
 * 过滤后的每篇文献保留原始检索位次 `dLabel`（D1、D2……），供 citation-check 在
 * 数组缩短后仍按原标号校验引用；未标注 A24 或标注落在宽限期外的公开仍作为现有技术。
 */

import { type Atom } from '../../atom.ts'
import {
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  getStateString,
} from '../../handler.ts'
import {
  determinePublicationDate,
  isBeforeReferenceDate,
  isMonthOnlyDate,
  parseDateFlexible,
  type PriorArtReference,
} from '../../../evidence/date.ts'
import { degraded } from './llm.ts'
import { isRecord, resolveConfiguredKey } from './state-keys.ts'

/** A24 四种不丧失新颖性的首次公开情形。 */
export const A24_EXCEPTION_LABELS = {
  'A24.1': '国家出现紧急状态或者非常情况时，为公共利益目的首次公开',
  'A24.2': '在中国政府主办或者承认的国际展览会上首次展出',
  'A24.3': '在规定的学术会议或者技术会议上首次发表',
  'A24.4': '他人未经申请人同意而泄露其内容',
} as const

/** A24 情形的枚举值。 */
export type A24Exception = keyof typeof A24_EXCEPTION_LABELS

/** 检索条目中公开日的默认字段名。 */
export const DEFAULT_PRIOR_ART_PUBLICATION_DATE_KEY = 'publicationDate'

/** 检索条目中 A24 标注的默认字段名。 */
export const DEFAULT_PRIOR_ART_A24_EXCEPTION_KEY = 'a24Exception'

/** prior-art-filter 原子：按截止日与 A24 宽限期过滤检索结果。 */
export const priorArtFilterAtom: Atom = {
  name: 'prior-art-filter',
  description:
    '现有技术时间过滤：只保留截止日前公开的文献，A24 四种首次公开在申请日前六个月内不破坏新颖性；未知公开日保留待核实',
  category: 'search',
  inputSchema: ['prior_art', 'reference_date', 'reference_basis', 'filing_date'],
  outputSchema: ['prior_art_filter_report', 'prior_art', 'prior_art_excluded', 'prior_art_undated'],
}

/** 被排除的条目：保留原始位次与判定依据。 */
type ExcludedEntry = {
  index: number
  label: string
  title: string
  publicationDate: string
  reason: 'not-prior-art' | 'a24-grace-period'
  a24Exception?: A24Exception
}

/** 无法确定公开日但保留下来的条目。 */
type UndatedEntry = {
  index: number
  label: string
  title: string
  reason: string
}

/** 单篇文献的公开日读取结果：认定成功带日期，否则带原因。 */
type PublicationDateResolution =
  | { date: string; reason?: undefined }
  | { date?: undefined; reason: string }

/** 条目的可读名称：标题 > 专利号 > URL > 位次。 */
function entryTitle(doc: unknown, index: number): string {
  if (!isRecord(doc)) return `#${index + 1}`
  for (const key of ['title', 'patent', 'url']) {
    const value = doc[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return `#${index + 1}`
}

/** 为保留条目补上原始检索位次；已有标注时不覆盖。 */
function withDLabel(doc: unknown, label: string): unknown {
  if (!isRecord(doc)) return doc
  return typeof doc.dLabel === 'string' && doc.dLabel.trim().length > 0 ? doc : { ...doc, dLabel: label }
}

/**
 * 读取并认定条目的公开日。
 * @param doc - 检索条目。
 * @param key - 公开日字段名。
 * @param reference - 截止日。
 * @returns 认定后的公开日，或无法认定的原因。
 */
function resolvePublicationDate(
  doc: unknown,
  key: string,
  reference: PriorArtReference,
): PublicationDateResolution {
  if (!isRecord(doc)) return { reason: '条目不是对象，无法读取公开日' }
  const raw = doc[key]
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { reason: `${key} 不是字符串` }
  }
  const claimed = typeof raw === 'string' ? raw.trim() : ''
  const url = typeof doc.url === 'string' ? doc.url : undefined
  const determination = determinePublicationDate(claimed, url, reference)
  if (determination.determined === '' || determination.determined === 'unknown') {
    return { reason: claimed.length > 0 ? `公开日无法解析：${claimed}` : '缺少公开日' }
  }
  return { date: determination.determined }
}

/**
 * 读取 A24 标注。
 * @param doc - 检索条目。
 * @param key - A24 标注字段名。
 * @returns 标注值；字段缺失时为空，非法时返回错误原因。
 */
function resolveA24Exception(doc: unknown, key: string): { value?: A24Exception; error?: string } {
  if (!isRecord(doc)) return {}
  const raw = doc[key]
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { error: `${key} 必须是非空字符串（A24.1..A24.4）` }
  }
  const value = raw.trim()
  if (!(value in A24_EXCEPTION_LABELS)) {
    return { error: `${key} 不是 A24.1..A24.4：${value}` }
  }
  return { value: value as A24Exception }
}

/** 申请日前六个月对应的日历日；月末日期收敛到目标月最后一天。 */
function monthsBefore(date: Date, months: number): Date {
  const targetYear = date.getUTCFullYear()
  const targetMonth = date.getUTCMonth() - months
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)))
}

/** 判断公开日是否落在申请日前六个月（含起点、不含申请日）。 */
function withinGracePeriod(publicationDate: string, filingDate: Date): boolean {
  const publication = parseDateFlexible(publicationDate)
  /* v8 ignore next -- determinePublicationDate only emits parseable dates. */
  if (publication === null) return false
  const start = monthsBefore(filingDate, 6)
  return publication.getTime() >= start.getTime() && publication.getTime() < filingDate.getTime()
}

/** prior-art-filter 执行器：按截止日与 A24 宽限期过滤检索结果。 */
export class PriorArtFilterHandler implements StageHandler {
  readonly name = 'prior-art-filter'
  readonly category = 'search' as const

  /**
   * 执行现有技术过滤。
   * @param input - 阶段执行输入（state 携带检索结果、截止日与申请日）。
   * @returns `prior_art_filter_report`（主输出）、过滤后的 `prior_art`、被排除与待核实条目。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const priorArtKey = resolveConfiguredKey(state, 'prior_art_key', 'prior_art')
    if (priorArtKey === undefined) return degraded('prior-art-filter', 'params.prior_art_key 必须是非空字符串')
    const referenceKey = resolveConfiguredKey(state, 'reference_date_key', 'reference_date')
    if (referenceKey === undefined) {
      return degraded('prior-art-filter', 'params.reference_date_key 必须是非空字符串')
    }
    const filingKey = resolveConfiguredKey(state, 'filing_date_key', 'filing_date')
    if (filingKey === undefined) return degraded('prior-art-filter', 'params.filing_date_key 必须是非空字符串')
    const publicationKey = resolveConfiguredKey(
      state,
      'publication_date_key',
      DEFAULT_PRIOR_ART_PUBLICATION_DATE_KEY,
    )
    if (publicationKey === undefined) {
      return degraded('prior-art-filter', 'params.publication_date_key 必须是非空字符串')
    }
    const exceptionKey = resolveConfiguredKey(state, 'a24_exception_key', DEFAULT_PRIOR_ART_A24_EXCEPTION_KEY)
    if (exceptionKey === undefined) {
      return degraded('prior-art-filter', 'params.a24_exception_key 必须是非空字符串')
    }

    const rawDocs = state[priorArtKey]
    if (!Array.isArray(rawDocs)) {
      return degraded('prior-art-filter', `state.${priorArtKey} 不是数组（检索阶段未产出）`)
    }

    const referenceDate = getStateString(state, referenceKey).trim()
    if (referenceDate === '') {
      return degraded('prior-art-filter', `缺少现有技术截止日（state.${referenceKey}）`)
    }
    if (isMonthOnlyDate(referenceDate)) {
      return degraded(
        'prior-art-filter',
        `现有技术截止日（state.${referenceKey}）仅精确到月，需要具体日期（yyyy-MM-dd）：${referenceDate}`,
      )
    }
    if (parseDateFlexible(referenceDate) === null) {
      return degraded('prior-art-filter', `现有技术截止日（state.${referenceKey}）无法解析：${referenceDate}`)
    }

    const filingDateText = getStateString(state, filingKey).trim()
    if (filingDateText !== '' && isMonthOnlyDate(filingDateText)) {
      return degraded(
        'prior-art-filter',
        `申请日（state.${filingKey}）仅精确到月，A24 宽限期判定需要具体日期（yyyy-MM-dd）：${filingDateText}`,
      )
    }
    const filingDate = filingDateText === '' ? undefined : (parseDateFlexible(filingDateText) ?? undefined)
    if (filingDateText !== '' && filingDate === undefined) {
      return degraded('prior-art-filter', `申请日（state.${filingKey}）无法解析：${filingDateText}`)
    }

    const basis = getStateString(state, 'reference_basis') === 'priority-date' ? 'priority-date' : 'filing-date'
    const reference: PriorArtReference = { date: referenceDate, basis }
    const kept: unknown[] = []
    const excluded: ExcludedEntry[] = []
    const undated: UndatedEntry[] = []
    const notes: string[] = []

    for (const [index, doc] of rawDocs.entries()) {
      const label = `D${index + 1}`
      const title = entryTitle(doc, index)
      const exception = resolveA24Exception(doc, exceptionKey)
      if (exception.error !== undefined) {
        return degraded('prior-art-filter', `${label} ${exception.error}`)
      }

      const publication = resolvePublicationDate(doc, publicationKey, reference)
      if (publication.date === undefined) {
        kept.push(withDLabel(doc, label))
        undated.push({
          index,
          label,
          title,
          reason: publication.reason,
        })
        if (exception.value !== undefined) {
          notes.push(`${label} 标注 ${exception.value}，但公开日未知，A24 未判定`)
        }
        continue
      }

      if (exception.value !== undefined) {
        if (filingDate === undefined) {
          notes.push(`${label} 标注 ${exception.value}，但缺少申请日，A24 未判定`)
        } else if (withinGracePeriod(publication.date, filingDate)) {
          excluded.push({
            index,
            label,
            title,
            publicationDate: publication.date,
            reason: 'a24-grace-period',
            a24Exception: exception.value,
          })
          continue
        } else {
          notes.push(
            `${label} 标注 ${exception.value}，但公开日 ${publication.date} 在宽限期外（申请日 ${filingDateText} 前 6 个月内），A24 不适用`,
          )
        }
      }

      if (isBeforeReferenceDate(publication.date, referenceDate)) {
        kept.push(withDLabel(doc, label))
        continue
      }

      excluded.push({
        index,
        label,
        title,
        publicationDate: publication.date,
        reason: 'not-prior-art',
      })
    }

    const basisLabel = basis === 'priority-date' ? '优先权日' : '申请日'
    const lines = [
      `现有技术过滤：保留 ${kept.length} 篇，排除 ${excluded.length} 篇（截止日 ${referenceDate}，${basisLabel}；A22.5）`,
    ]
    for (const entry of excluded) {
      const reason =
        entry.reason === 'a24-grace-period' && entry.a24Exception !== undefined
          ? `A24 宽限期（${entry.a24Exception}：${A24_EXCEPTION_LABELS[entry.a24Exception]}），不破坏新颖性`
          : '公开日不早于截止日，不属于现有技术'
      lines.push(`- ${entry.label} ${entry.title}：公开日 ${entry.publicationDate}，${reason}`)
    }
    for (const entry of undated) {
      lines.push(`- ${entry.label} ${entry.title}：${entry.reason}，保留待人工核实`)
    }
    for (const note of notes) {
      lines.push(`- 注意：${note}`)
    }
    if (rawDocs.length === 0) {
      lines.push('- 检索结果为空，无需过滤')
    }

    return {
      prior_art_filter_report: lines.join('\n'),
      prior_art: kept,
      prior_art_excluded: excluded,
      prior_art_undated: undated,
    }
  }
}
