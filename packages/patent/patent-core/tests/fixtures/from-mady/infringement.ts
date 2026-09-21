/**
 * 上游 Mady 表驱动用例（侵权判定）与本模块取值的对照。
 *
 * 来源：`domains/infringement/infringement_test.go`（提交内 `TestRiskLevel_High/Medium/Low`、
 * `TestEquivalenceTestRule_LogicalContradiction`、`TestAllElementsRule_MissingFeature`、
 * `TestAllElementsRule_AllMatched`、`TestAllElementsRule_AllMatchedWithExtra`、
 * `TestScorer_AllLiteralMatch`、`TestScorer_PartialEquivalence`）与
 * `domains/infringement/scorer.go` 的维度权重（MIT，同作者），提交
 * `2acb57db166b59d29a807f566382d610ad2ce9b3`。
 *
 * 对照方式：每条记上游输入与上游期望，另记本模块的判定；语义相同的直接断言相等，本模块
 * 有意改写的记 `ours` 与 `note`。上游七维权重中 `literal_match` 与 `equivalence` 已合并为
 * 本模块的 `elementsCovered`，`strategy_viability` 与固定赔偿上限已删除（见 `risk.ts`）。
 */

/** 风险分级用例（上游 `riskLevel(composite)`，权重之和为 1）。 */
export type RiskLevelCase = {
  name: string
  /** 上游合成分。 */
  composite: number
  /** 上游期望的风险等级，本模块同名取值。 */
  want: 'high' | 'medium' | 'low'
}

/** 上游 `TestRiskLevel_*` 的 3 例；阈值同为 0.7 / 0.4。 */
export const RISK_LEVEL_CASES: readonly RiskLevelCase[] = [
  { name: '高风险', composite: 0.75, want: 'high' },
  { name: '中风险', composite: 0.5, want: 'medium' },
  { name: '低风险', composite: 0.3, want: 'low' },
]

/** 全面覆盖用例（上游 `TestAllElementsRule_*`）。 */
export type AllElementsCase = {
  name: string
  /** 上游 `LiteralResult`：是否全部匹配、是否含额外特征。 */
  upstream: { allElementsMet: boolean; hasExtraFeature: boolean }
  /** 上游期望规则是否通过。 */
  upstreamPassed: boolean
  /** 本模块判定：缺任一特征即不落入，额外特征不出现在行内。 */
  ours: 'literal' | 'not-covered'
  note?: string
}

/** 上游 `TestAllElementsRule_*` 的 3 例。 */
export const ALL_ELEMENTS_CASES: readonly AllElementsCase[] = [
  {
    name: '缺一项特征',
    upstream: { allElementsMet: false, hasExtraFeature: false },
    upstreamPassed: false,
    ours: 'not-covered',
  },
  {
    name: '全部匹配',
    upstream: { allElementsMet: true, hasExtraFeature: false },
    upstreamPassed: true,
    ours: 'literal',
  },
  {
    name: '全部匹配且有额外特征',
    upstream: { allElementsMet: true, hasExtraFeature: true },
    upstreamPassed: true,
    ours: 'literal',
    note: '本模块的行按权利要求要素建键，被诉方案的额外特征不进入行表，因此不需要专门分支',
  },
]

/** 等同认定对应用例（上游 `TestEquivalenceTestRule_LogicalContradiction`）。 */
export type EquivalenceCase = {
  name: string
  /** 上游三要素与等同认定。 */
  upstream: { sameMeans: boolean; sameFunction: boolean; sameEffect: boolean; isEquivalent: boolean }
  /** 上游期望规则通过（通过即未检出矛盾）。 */
  upstreamPassed: boolean
  /** 本模块检出的矛盾类型；`[]` 表示未检出。 */
  ours: readonly string[]
  note?: string
}

/** 上游等同三要素核验的 2 例。 */
export const EQUIVALENCE_CASES: readonly EquivalenceCase[] = [
  {
    name: '三项均不同却认定等同',
    upstream: { sameMeans: false, sameFunction: false, sameEffect: false, isEquivalent: true },
    upstreamPassed: false,
    ours: ['doe-without-common-element'],
    note: '本模块另核"认定等同但同时需创造性劳动"与"按等同落格却无认定记录"，上游无此两项',
  },
  {
    name: '三项基本相同且认定等同',
    upstream: { sameMeans: true, sameFunction: true, sameEffect: true, isEquivalent: true },
    upstreamPassed: true,
    ours: [],
  },
]

/** 评分维度对应用例（上游 `TestScorer_*`）。 */
export type ScorerCase = {
  name: string
  /** 上游维度名与期望值。 */
  upstream: { dimension: string; value: number }
  /** 本模块维度名与期望值。 */
  ours: { dimension: 'elementsCovered'; value: number }
  /** 本模块输入：全部权利要求要素 id、逐行映射、有经核验等同认定的要素 id。 */
  input: {
    elements: readonly string[]
    mappings: readonly (readonly [string, 'literal' | 'doe'])[]
    equivalent: readonly string[]
  }
  note?: string
}

/** 上游 `TestScorer_*` 的 2 例。 */
export const SCORER_CASES: readonly ScorerCase[] = [
  {
    name: '全部字面匹配',
    upstream: { dimension: 'literal_match', value: 1 },
    ours: { dimension: 'elementsCovered', value: 1 },
    input: {
      elements: ['1a', '1b', '1c'],
      mappings: [['1a', 'literal'], ['1b', 'literal'], ['1c', 'literal']],
      equivalent: [],
    },
  },
  {
    name: '部分等同',
    upstream: { dimension: 'equivalence', value: 0.5 },
    ours: { dimension: 'elementsCovered', value: 2 / 3 },
    input: {
      elements: ['1a', '1b', '1c'],
      mappings: [['1a', 'literal'], ['1b', 'doe']],
      equivalent: ['1b'],
    },
    note: '上游把字面与等同分列加权（字面全覆盖合成分只有 0.25）；本模块合成一个覆盖度：'
      + '三要素中一项按字面覆盖、一项有经核验的等同认定、一项缺项，故为 2/3——等同可补上未被字面覆盖的要素',
  },
]
