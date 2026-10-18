/**
 * 检索域原子：time-baseline（现有技术时间基准）。
 *
 * 包装 `evidence/date.ts` 的 `priorArtReference`，不新写日期规则：取申请日与
 * 优先权日中较早者作为现有技术截止日（专利法 A22.5；优先权见 A29），供检索、
 * 对比与引用校验阶段判断公开日是否早于该日。
 *
 * 日期必须由调用方显式给出：本层不从交底书正文推断申请日。任一已提供的日期无法
 * 解析即降级，不静默改用另一个日期；两个日期都缺失时同样降级。
 */

import { type Atom } from '../../atom.ts'
import { type PipelineState, type StageExecuteInput, type StageHandler, getStateString } from '../../handler.ts'
import { isMonthOnlyDate, parseDateFlexible, priorArtReference } from '../../../evidence/date.ts'
import { degraded } from './llm.ts'
import { resolveConfiguredKey } from './state-keys.ts'

/** time-baseline 原子：申请日/优先权日 → 现有技术截止日。 */
export const timeBaselineAtom: Atom = {
  name: 'time-baseline',
  description: '现有技术时间基准：取申请日与优先权日较早者作为截止日（A22.5/A29），日期缺失或不可解析时降级',
  category: 'extract',
  inputSchema: ['filing_date', 'priority_date'],
  outputSchema: ['time_baseline_report', 'reference_date', 'reference_basis', 'filing_date', 'priority_date'],
}

/** 单个日期的读取结果：value 为可解析日期，error 为拒绝原因。 */
type DateResolution = {
  value?: string
  error?: string
}

/**
 * 读取并校验一个日期状态键。
 *
 * 月级日期（`2024-06`、`2024年6月`）不足以确定现有技术截止日：按月初解释会
 * 提前排除本应属于现有技术的公开，故一律降级并要求具体日期。
 * @param state - 阶段执行态。
 * @param key - 日期所在的状态键。
 * @param label - 报告用的日期名称。
 * @returns 可解析的日期或错误原因；键为空时两者皆无。
 */
function readDate(state: PipelineState, key: string, label: string): DateResolution {
  const raw = getStateString(state, key).trim()
  if (raw === '') return {}
  if (isMonthOnlyDate(raw)) {
    return {
      error: `${label}（state.${key}）仅精确到月，现有技术截止日需要具体日期（yyyy-MM-dd）：${raw}`,
    }
  }
  if (parseDateFlexible(raw) === null) {
    return { error: `${label}（state.${key}）无法解析：${raw}` }
  }
  return { value: raw }
}

/** time-baseline 执行器：解析两个日期并写入截止日。 */
export class TimeBaselineHandler implements StageHandler {
  readonly name = 'time-baseline'
  readonly category = 'extract' as const

  /**
   * 执行时间基准解析。
   * @param input - 阶段执行输入（state 携带申请日与优先权日）。
   * @returns `time_baseline_report`（主输出）、`reference_date`、`reference_basis` 与两个原始日期。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const filingKey = resolveConfiguredKey(state, 'filing_date_key', 'filing_date')
    if (filingKey === undefined) {
      return degraded('time-baseline', 'params.filing_date_key 必须是非空字符串')
    }
    const priorityKey = resolveConfiguredKey(state, 'priority_date_key', 'priority_date')
    if (priorityKey === undefined) {
      return degraded('time-baseline', 'params.priority_date_key 必须是非空字符串')
    }

    const filing = readDate(state, filingKey, '申请日')
    if (filing.error !== undefined) return degraded('time-baseline', filing.error)
    const priority = readDate(state, priorityKey, '优先权日')
    if (priority.error !== undefined) return degraded('time-baseline', priority.error)

    const reference = priorArtReference({
      ...(filing.value !== undefined ? { filingDate: filing.value } : {}),
      ...(priority.value !== undefined ? { priorityDate: priority.value } : {}),
    })
    if (reference === undefined) {
      return degraded(
        'time-baseline',
        `缺少申请日与优先权日（至少提供 state.${filingKey} 或 state.${priorityKey}）`,
      )
    }
    const label = reference.basis === 'priority-date' ? '优先权日' : '申请日'
    return {
      time_baseline_report: `现有技术时间基准：${reference.date}（${label}；A22.5 现有技术，优先权见 A29）`,
      reference_date: reference.date,
      reference_basis: reference.basis,
      filing_date: filing.value ?? '',
      priority_date: priority.value ?? '',
    }
  }
}
