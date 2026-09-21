/**
 * src/patent/infringement — 侵权判定的确定性内核 barrel。
 *
 * - all-elements.ts：全面覆盖原则的判定（字面覆盖、待解释、需等同、缺项四类要素）。
 * - equivalence.ts：等同三要素记录与图表映射的一致性核验。
 * - risk.ts：五维加权评分与风险分级。
 * - conclusion.ts：由 claim-chart 装配上述三者（`coverage` 原子与 `claim_chart_build` 工具共用）。
 *
 * 四个文件都不调用模型，也不产出代理意见：输入是 claim-chart 的行级映射与调用方给出的
 * 认定记录，输出是可复核的要素清单、矛盾清单与分数。等同的技术结论（手段/功能/效果是否
 * 基本相同）由人给出，本模块只核对该结论是否自洽、是否落到了图表上。
 */

export {
  deriveInfringementConclusion,
  type InfringementConclusion,
  type InfringementConclusionInput,
  type InfringementScoringFacts,
} from './conclusion.ts'

export {
  FULL_COVERAGE_BASIS,
  deriveAllElementsCoverage,
  type AllElementsCoverage,
  type AllElementsOutcome,
} from './all-elements.ts'

export {
  EQUIVALENCE_BASIS,
  findEquivalenceContradictions,
  type EquivalenceContradiction,
  type EquivalenceContradictionKind,
  type EquivalenceTriplet,
} from './equivalence.ts'

export {
  DEFAULT_INFRINGEMENT_WEIGHTS,
  INFRINGEMENT_DIMENSIONS,
  RISK_HIGH_RATIO,
  RISK_MEDIUM_RATIO,
  riskLevel,
  scoreInfringement,
  type DefenseViability,
  type InfringementDimension,
  type InfringementRiskLevel,
  type InfringementScore,
  type InfringementScoreInput,
  type InfringementWeights,
} from './risk.ts'
