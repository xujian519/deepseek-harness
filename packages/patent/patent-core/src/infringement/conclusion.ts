/**
 * src/patent/infringement — 由 claim-chart 直接算出的侵权结论（不调用模型）。
 *
 * 三个内核（全面覆盖判定、等同一致性核验、风险评分）的装配点：两个消费方
 * （`coverage` 原子与 `claim_chart_build` 工具）都要"逐被控产品判定 + 列出等同矛盾"，
 * 装配口径在此收口，避免两处各写一遍。
 *
 * 输入的图表与等同认定记录都由调用方给出；本文件只做装配，判定口径归
 * `all-elements.ts` / `equivalence.ts` / `risk.ts`。
 */

import type { ClaimChart } from '../claim-chart/protocol/types.ts'
import { deriveAllElementsCoverage, type AllElementsCoverage } from './all-elements.ts'
import { findEquivalenceContradictions, type EquivalenceContradiction, type EquivalenceTriplet } from './equivalence.ts'
import { scoreInfringement, type DefenseViability, type InfringementScore } from './risk.ts'

/** 评分事实：`scoreInfringement` 需要、而图表本身给不出的输入。 */
export type InfringementScoringFacts = {
  /** 各抗辩的成立可能性；未提供按"无抗辩"处理（不因缺少抗辩分析而降低风险）。 */
  defenses?: readonly DefenseViability[]
  /** 补救风险（0–1），由调用方按案件金额量程归一。 */
  remedyExposureRatio: number
  /** 是否适用禁止反悔原则。 */
  estoppelApplied?: boolean
  /** 是否适用捐献规则。 */
  dedicationApplied?: boolean
}

/** 侵权结论的可选输入。 */
export type InfringementConclusionInput = {
  /** 逐要素的等同三要素认定记录；缺省空数组（按等同落格的行即报缺认定记录）。 */
  triplets?: readonly EquivalenceTriplet[]
  /** 评分事实；提供时逐被控产品计算风险等级。 */
  scoring?: InfringementScoringFacts
}

/** 由图表算出的侵权结论。 */
export type InfringementConclusion = {
  /** 逐被控产品的全面覆盖判定，按图表目标顺序。 */
  coverage: AllElementsCoverage[]
  /** 等同认定与图表映射的矛盾（全部目标，按行序/记录序）。 */
  contradictions: EquivalenceContradiction[]
  /** 逐被控产品的风险评分；与 `coverage` 同序，仅在给出评分事实时存在。 */
  scores?: InfringementScore[]
}

/**
 * 由 claim-chart 装配侵权结论：逐被控产品判定全面覆盖、核验等同一致性，并在给出评分
 * 事实时计算风险等级。非被控产品目标（现有技术侧）不参与判定。
 * @param chart - 侵权模式的 claim-chart。
 * @param input - 等同认定记录与可选评分事实。
 * @returns 覆盖判定、等同矛盾与（可选的）逐目标评分。
 * @throws RangeError 评分事实非法（比例越界）——由 `scoreInfringement` 抛出，不静默出分。
 */
export function deriveInfringementConclusion(
  chart: ClaimChart,
  input: InfringementConclusionInput = {},
): InfringementConclusion {
  const triplets = input.triplets ?? []
  const contradictions = findEquivalenceContradictions(chart.rows, triplets)
  const coverage = chart.targets
    .filter(target => target.kind === 'accused-product')
    .map(target => deriveAllElementsCoverage(chart.rows, target.id, chart.elements))
  const scoring = input.scoring
  if (scoring === undefined) return { coverage, contradictions }
  return {
    coverage,
    contradictions,
    scores: coverage.map(entry =>
      scoreInfringement({
        coverage: entry,
        triplets,
        contradictions,
        estoppelApplied: scoring.estoppelApplied ?? false,
        dedicationApplied: scoring.dedicationApplied ?? false,
        defenses: scoring.defenses ?? [],
        remedyExposureRatio: scoring.remedyExposureRatio,
      }),
    ),
  }
}
