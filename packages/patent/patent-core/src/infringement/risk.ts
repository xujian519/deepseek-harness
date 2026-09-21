/**
 * src/patent/infringement — 侵权风险的加权评分与分级。
 *
 * 五个维度加权求和得到"侵权成立可能性"（0–1，从专利权人视角：越高越可能被认定侵权），
 * 再按权重量程归一后分级为 high / medium / low。评分只用可复核的输入列，全部维度由结构化
 * 事实算出，不接受调用方直接给出的分数或等级。
 *
 * 与上游 Mady `domains/infringement/scorer.go` 的差异：
 * - 字面覆盖与等同覆盖合成一个维度。上游把 `literal_match`（0.25）与 `equivalence`（0.20）
 *   分列加权，于是"字面全部覆盖"的案子等同等 0，合成分只有 0.25——全面覆盖已经成立却
 *   评为低风险。本模块按"要素是否被覆盖（相同或以经核验的等同）"取一个覆盖度。
 * - 删除 `strategy_viability` 维度。该维度按"建议动作中 priority=immediate 的占比"取值，
 *   测的是助手给出的建议文本，不是案件事实，会因措辞变化改变风险等级。
 * - 删除固定的赔偿额上限。上游把赔偿区间中值除以硬编码的 1000 万元（`avg / 10_000_000`）
 *   作为 `remedy_exposure`；上限随案件与地域变化，改由调用方按案件给出的
 *   `remedyExposureRatio`（0–1）传入。
 * - 求和次序固定。上游对 `map` 求和，Go 的 map 迭代顺序随机，浮点求和次序随之变化；
 *   本模块按 `INFRINGEMENT_DIMENSIONS` 的固定次序求和。
 * - 权重非法或比例越界即抛错，不静默产出分数。
 *
 * 分级阈值沿用上游的 0.7 / 0.4，但以**权重量程**为准（上游权重之和恰为 1，本模块保留下来的
 * 五个维度权重之和为 0.9，故阈值按 `ratio × 权重之和` 取）。
 */

import type { AllElementsCoverage } from './all-elements.ts'
import type { EquivalenceContradiction, EquivalenceTriplet } from './equivalence.ts'

/** 评分维度。 */
export type InfringementDimension =
  | 'elementsCovered'
  | 'estoppelAvailable'
  | 'dedicationAvailable'
  | 'defenseStrength'
  | 'remedyExposure'

/** 维度次序，同时是加权求和的固定次序。 */
export const INFRINGEMENT_DIMENSIONS: readonly InfringementDimension[] = [
  'elementsCovered',
  'estoppelAvailable',
  'dedicationAvailable',
  'defenseStrength',
  'remedyExposure',
]

/** 各维度权重。 */
export type InfringementWeights = Record<InfringementDimension, number>

/**
 * 默认权重：覆盖度 0.45、抗辩强度 0.20、禁止反悔可用 0.10、捐献规则可用 0.05、补救风险 0.10。
 *
 * 覆盖度取上游 `literal_match`（0.25）与 `equivalence`（0.20）之和；其余沿用上游同名维度的
 * 权重；上游两个信息性维度（`remedy_exposure` 的固定上限、`strategy_viability`）已删除，其
 * 权重不再分配。
 */
export const DEFAULT_INFRINGEMENT_WEIGHTS: InfringementWeights = {
  elementsCovered: 0.45,
  estoppelAvailable: 0.10,
  dedicationAvailable: 0.05,
  defenseStrength: 0.20,
  remedyExposure: 0.10,
}

/** 高风险阈值占权重量程的比例（沿用上游 0.7）。 */
export const RISK_HIGH_RATIO = 0.7

/** 中风险阈值占权重量程的比例（沿用上游 0.4）。 */
export const RISK_MEDIUM_RATIO = 0.4

/** 风险等级。 */
export type InfringementRiskLevel = 'high' | 'medium' | 'low'

/** 抗辩成立可能性；`high` 与 `medium` 计为强抗辩。 */
export type DefenseViability = 'high' | 'medium' | 'low'

/** 评分输入（全部为可复核的结构化事实）。 */
export type InfringementScoreInput = {
  /** 全面覆盖判定结果。 */
  coverage: AllElementsCoverage
  /** 逐要素的等同三要素记录。 */
  triplets: readonly EquivalenceTriplet[]
  /** 等同认定的矛盾列表（矛盾要素的等同不计入覆盖）。 */
  contradictions: readonly EquivalenceContradiction[]
  /** 是否适用禁止反悔原则（适用即压缩等同范围）。 */
  estoppelApplied: boolean
  /** 是否适用捐献规则（适用即丧失未写入权利要求的方案）。 */
  dedicationApplied: boolean
  /** 各抗辩的成立可能性。 */
  defenses: readonly DefenseViability[]
  /** 补救风险（0–1），由调用方按案件金额量程归一；本模块不设金额上限。 */
  remedyExposureRatio: number
}

/** 评分结果。 */
export type InfringementScore = {
  dimensions: Record<InfringementDimension, number>
  weightSum: number
  /** 加权和，未经量程归一。 */
  composite: number
  riskLevel: InfringementRiskLevel
  /** 高风险与中风险的判定阈值（已按权重量程折算）。 */
  thresholds: { high: number; medium: number }
  /** 计入等同覆盖的要素 id。 */
  equivalentElements: string[]
}

/** 否定等同认定的矛盾类型：命中即该要素的等同不计入覆盖。 */
const DENYING_CONTRADICTIONS = new Set<EquivalenceContradiction['kind']>([
  'doe-without-triplet',
  'triplet-denies-doe',
  'doe-without-common-element',
  'inventive-effort-required',
])

/** 强抗辩的成立可能性。 */
const STRONG_DEFENSES = new Set<DefenseViability>(['high', 'medium'])

/**
 * 计算侵权风险评分与等级。
 * @param input - 评分输入。
 * @param weights - 维度权重；缺省用 `DEFAULT_INFRINGEMENT_WEIGHTS`。
 * @returns 评分结果。
 * @throws RangeError 权重含负数或非有限值、权重之和不为正、`remedyExposureRatio` 不在 0–1 内。
 */
export function scoreInfringement(
  input: InfringementScoreInput,
  weights: InfringementWeights = DEFAULT_INFRINGEMENT_WEIGHTS,
): InfringementScore {
  const weightSum = checkWeights(weights)
  checkRatio(input.remedyExposureRatio)

  const equivalentElements = verifiedEquivalentElements(input)
  const dimensions: Record<InfringementDimension, number> = {
    elementsCovered: coveredRatio(input.coverage, equivalentElements.length),
    estoppelAvailable: input.estoppelApplied ? 0 : 1,
    dedicationAvailable: input.dedicationApplied ? 0 : 1,
    defenseStrength: defenseStrength(input.defenses),
    remedyExposure: input.remedyExposureRatio,
  }

  let composite = 0
  for (const dimension of INFRINGEMENT_DIMENSIONS) composite += dimensions[dimension] * weights[dimension]

  return {
    dimensions,
    weightSum,
    composite,
    riskLevel: riskLevel(composite, weightSum),
    thresholds: { high: RISK_HIGH_RATIO * weightSum, medium: RISK_MEDIUM_RATIO * weightSum },
    equivalentElements,
  }
}

/**
 * 按"加权和占权重量程的比例"分级。
 * @param composite - 加权和。
 * @param weightSum - 权重量程（权重之和）。
 * @returns 风险等级。
 */
export function riskLevel(composite: number, weightSum: number): InfringementRiskLevel {
  if (composite >= RISK_HIGH_RATIO * weightSum) return 'high'
  return composite >= RISK_MEDIUM_RATIO * weightSum ? 'medium' : 'low'
}

/**
 * 覆盖度：字面覆盖的要素与经核验构成等同的要素各计 1，待解释要素与缺项不计。
 * @param coverage - 全面覆盖判定结果。
 * @param equivalentCount - 经核验构成等同的要素数。
 * @returns 覆盖度（0–1）；无要素时为 0。
 */
function coveredRatio(coverage: AllElementsCoverage, equivalentCount: number): number {
  if (coverage.elementCount === 0) return 0
  return (coverage.literalElements.length + equivalentCount) / coverage.elementCount
}

/**
 * 取经核验构成等同的要素 id：该目标下按等同落格、有认定记录、认定构成等同，且无否定矛盾。
 * @param input - 评分输入。
 * @returns 要素 id 列表（按候选要素顺序）。
 */
function verifiedEquivalentElements(input: InfringementScoreInput): string[] {
  const denied = new Set(
    input.contradictions
      .filter(item => item.targetId === input.coverage.targetId && DENYING_CONTRADICTIONS.has(item.kind))
      .map(item => item.elementId),
  )
  return input.coverage.equivalenceCandidates.filter(
    elementId =>
      !denied.has(elementId)
      && input.triplets.some(
        triplet =>
          triplet.isEquivalent
          && triplet.elementId === elementId
          && triplet.targetId === input.coverage.targetId,
      ),
  )
}

/**
 * 抗辩强度：强抗辩占比越高，侵权成立可能性越低。
 * @param defenses - 各抗辩的成立可能性。
 * @returns 抗辩强度（0–1）；未提供抗辩时为 1（不因缺少抗辩分析而降低风险）。
 */
function defenseStrength(defenses: readonly DefenseViability[]): number {
  if (defenses.length === 0) return 1
  const strong = defenses.filter(viability => STRONG_DEFENSES.has(viability)).length
  return 1 - strong / defenses.length
}

/**
 * 校验权重。
 * @param weights - 维度权重。
 * @returns 权重之和。
 * @throws RangeError 权重含负数或非有限值，或权重之和不为正。
 */
function checkWeights(weights: InfringementWeights): number {
  let sum = 0
  for (const dimension of INFRINGEMENT_DIMENSIONS) {
    const weight = weights[dimension]
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`权重 ${dimension} 非法：${weight}（须为有限非负数）`)
    }
    sum += weight
  }
  if (sum <= 0) throw new RangeError('权重之和须为正数')
  return sum
}

/**
 * 校验补救风险比例。
 * @param ratio - 补救风险比例。
 * @throws RangeError 比例不是 0–1 内的有限数。
 */
function checkRatio(ratio: number): void {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new RangeError(`remedyExposureRatio 非法：${ratio}（须为 0–1 内的有限数）`)
  }
}
