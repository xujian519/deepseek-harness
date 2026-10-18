/**
 * 侵权域原子：coverage（全面覆盖与等同一致性核验）。
 *
 * 读同一 run 内 claim-chart 阶段写入的图表文档（`claim_chart_doc`），逐被控产品目标给出
 * 全面覆盖四态结论，并列出等同认定与图表映射之间的矛盾。核验对象只是图表本身，结论全部
 * 由行级映射算出，原子不接受调用方直接给出的"是否落入保护范围"结论。
 *
 * 等同认定记录（`EquivalenceTriplet`）不在图表内，故按 `doe` 落格的行一律报
 * `doe-without-triplet`（等同认定须另出独立记录才能复核）；`scoreInfringement` 需要的
 * 认定记录、抗辩与赔偿比例同样不在本原子输入范围内，评分仍由调用方组装输入后调用。
 */

import { type Atom } from '../../atom.ts'
import { type PipelineState, type StageExecuteInput, type StageHandler, getStateString } from '../../handler.ts'
import {
  isMapping,
  type ChartRowMatch,
  type ChartTargetRef,
  type ClaimElementRef,
} from '../../../claim-chart/protocol/types.ts'
import { asJsonRecord, readJsonString, tryParseJson } from '../../../llm-json.ts'
import {
  deriveInfringementConclusion,
  type InfringementConclusionChart,
} from '../../../infringement/conclusion.ts'
import { degraded } from './llm.ts'

/** coverage 原子：侵权的全面覆盖与等同一致性核验。 */
export const coverageAtom: Atom = {
  name: 'coverage',
  description: '侵权全面覆盖与等同一致性核验：逐被控产品四态结论 + 等同未认定清单（纯函数，不调用模型）',
  category: 'compare',
  inputSchema: ['claim_chart_doc'],
  outputSchema: ['coverage_report', 'coverage_conflicts'],
}

/** 读取结果：成功携带结论需要的图表列，失败携带可直接展示的原因。 */
type CoverageChartResult =
  | { ok: true; chart: InfringementConclusionChart }
  | { ok: false; reason: string }

/**
 * 从持久化的图表文档中读出覆盖判定需要的列。
 *
 * `claim_chart_doc` 是上一阶段写出的 JSON；本原子只做形状校验，不重新计算映射。逐项
 * 检查数组元素的下标，畸形文档给出可定位的降级原因而不是 `TypeError`。
 * @param parsed - 已确认是 JSON 对象的图表文档。
 * @returns 目标、行映射与要素编号，或失败原因。
 */
function readCoverageChart(parsed: Record<string, unknown>): CoverageChartResult {
  const targetsRaw = parsed.targets
  if (!Array.isArray(targetsRaw)) {
    return { ok: false, reason: 'claim_chart_doc.targets 不是数组（应为 claim-chart 阶段写出的图表文档）' }
  }
  const targets: ChartTargetRef[] = []
  for (const [index, entry] of targetsRaw.entries()) {
    const record = asJsonRecord(entry)
    if (record === undefined) return { ok: false, reason: `claim_chart_doc.targets[${index}] 不是对象` }
    const id = readJsonString(record.id)
    if (id === undefined) return { ok: false, reason: `claim_chart_doc.targets[${index}] 缺少 id` }
    if (record.kind !== 'prior-art' && record.kind !== 'accused-product') {
      return { ok: false, reason: `claim_chart_doc.targets[${index}] 的 kind 非法: ${JSON.stringify(record.kind)}` }
    }
    targets.push({ id, kind: record.kind })
  }

  const elementsRaw = parsed.elements
  if (!Array.isArray(elementsRaw)) {
    return { ok: false, reason: 'claim_chart_doc.elements 不是数组（应为 claim-chart 阶段写出的图表文档）' }
  }
  const elements: ClaimElementRef[] = []
  for (const [index, entry] of elementsRaw.entries()) {
    const record = asJsonRecord(entry)
    if (record === undefined) return { ok: false, reason: `claim_chart_doc.elements[${index}] 不是对象` }
    const id = readJsonString(record.id)
    if (id === undefined) return { ok: false, reason: `claim_chart_doc.elements[${index}] 缺少 id` }
    elements.push({ id })
  }

  const rowsRaw = parsed.rows
  if (!Array.isArray(rowsRaw)) {
    return { ok: false, reason: 'claim_chart_doc.rows 不是数组（应为 claim-chart 阶段写出的图表文档）' }
  }
  const rows: ChartRowMatch[] = []
  for (const [index, entry] of rowsRaw.entries()) {
    const record = asJsonRecord(entry)
    if (record === undefined) return { ok: false, reason: `claim_chart_doc.rows[${index}] 不是对象` }
    const elementId = readJsonString(record.elementId)
    if (elementId === undefined) {
      return { ok: false, reason: `claim_chart_doc.rows[${index}] 缺少 elementId` }
    }
    const targetId = readJsonString(record.targetId)
    if (targetId === undefined) {
      return { ok: false, reason: `claim_chart_doc.rows[${index}] 缺少 targetId` }
    }
    if (!isMapping(record.mapping)) {
      return { ok: false, reason: `claim_chart_doc.rows[${index}] 的 mapping 非法: ${JSON.stringify(record.mapping)}` }
    }
    rows.push({ elementId, targetId, mapping: record.mapping })
  }
  return { ok: true, chart: { targets, rows, elements } }
}

/** coverage 执行器：读 claim-chart 文档，输出覆盖结论与等同矛盾。 */
export class CoverageHandler implements StageHandler {
  readonly name = 'coverage'
  readonly category = 'compare' as const

  /**
   * 核验图表：逐被控产品判定覆盖结论，并检出等同认定与映射的矛盾。
   *
   * 图表文档缺失/不可解析/形状非法、模式非侵权、无被控产品目标均降级并说明原因。
   * @param input - 阶段执行输入（state 携带图表文档）。
   * @returns `coverage_report` 与 `coverage_conflicts`（均为 JSON）。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const doc = getStateString(input.state, 'claim_chart_doc')
    if (doc.trim().length === 0) {
      return degraded('coverage', '缺少 claim_chart_doc（须先执行 claim-chart 阶段）')
    }
    const parsed = tryParseJson(doc)
    if (parsed === undefined) {
      return degraded('coverage', 'claim_chart_doc 不是合法 JSON（应为 claim-chart 阶段写出的图表文档）')
    }
    const mode = readJsonString(parsed.mode)
    if (mode === undefined) {
      return degraded('coverage', 'claim_chart_doc.mode 缺失（应为 claim-chart 阶段写出的图表文档）')
    }
    if (mode !== 'infringement') {
      return degraded('coverage', `覆盖核验仅适用于侵权模式（当前 mode=${mode}）`)
    }
    const read = readCoverageChart(parsed)
    if (!read.ok) return degraded('coverage', read.reason)
    // 等同认定记录不在图表内，故不传三要素：按等同落格的行一律报缺认定记录。
    const conclusion = deriveInfringementConclusion(read.chart)
    if (conclusion.coverage.length === 0) {
      return degraded('coverage', '图表没有被控产品目标（kind: accused-product）')
    }
    return {
      coverage_report: JSON.stringify(conclusion.coverage, null, 2),
      coverage_conflicts: JSON.stringify(conclusion.contradictions, null, 2),
    }
  }
}
