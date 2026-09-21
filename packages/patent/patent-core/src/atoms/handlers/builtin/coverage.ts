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
import { type ClaimChart } from '../../../claim-chart/protocol/types.ts'
import { tryParseJson } from '../../../llm-json.ts'
import { deriveInfringementConclusion } from '../../../infringement/conclusion.ts'
import { degraded } from './llm.ts'

/** coverage 原子：侵权的全面覆盖与等同一致性核验。 */
export const coverageAtom: Atom = {
  name: 'coverage',
  description: '侵权全面覆盖与等同一致性核验：逐被控产品四态结论 + 等同未认定清单（纯函数，不调用模型）',
  category: 'compare',
  inputSchema: ['claim_chart_doc'],
  outputSchema: ['coverage_report', 'coverage_conflicts'],
}

/** coverage 执行器：读 claim-chart 文档，输出覆盖结论与等同矛盾。 */
export class CoverageHandler implements StageHandler {
  readonly name = 'coverage'
  readonly category = 'compare' as const

  /**
   * 核验图表：逐被控产品判定覆盖结论，并检出等同认定与映射的矛盾。
   *
   * 图表文档缺失/不可解析、模式非侵权、无被控产品目标三种情形均降级并说明原因。
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
    // 图表文档由本进程的 claim-chart 阶段按 ClaimChart 序列化；此处只做 JSON 解析，
    // 字段形状由写入侧的类型保证（同一进程内的类型化传递，不重复校验）。
    const chart = parsed as unknown as ClaimChart
    if (chart.mode !== 'infringement') {
      return degraded('coverage', `覆盖核验仅适用于侵权模式（当前 mode=${chart.mode}）`)
    }
    // 等同认定记录不在图表内，故不传三要素：按等同落格的行一律报缺认定记录。
    const conclusion = deriveInfringementConclusion(chart)
    if (conclusion.coverage.length === 0) {
      return degraded('coverage', '图表没有被控产品目标（kind: accused-product）')
    }
    return {
      coverage_report: JSON.stringify(conclusion.coverage, null, 2),
      coverage_conflicts: JSON.stringify(conclusion.contradictions, null, 2),
    }
  }
}
