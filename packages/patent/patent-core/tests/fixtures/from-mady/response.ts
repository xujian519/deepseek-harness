/**
 * 上游 Mady 表驱动用例（OA 答复的策略、修改动作与法条依据）与本模块取值的对照。
 *
 * 来源：`domains/workflows/patent/oa_response_test.go`（`TestDetermineResponseStrategy` 7 例、
 * `TestClassifyRejectionNode` 6 例）与 `domains/workflows/patent/oa_helpers.go` 的
 * `claimAmendmentType`/`amendmentBasis` 分派（MIT，同作者），提交
 * `2acb57db166b59d29a807f566382d610ad2ce9b3`。
 *
 * 对照方式：每条记上游输入与上游期望，另记本模块的闭集取值。语义相同的直接断言相等；
 * 本模块有意改写的记 `ours` 与 `note`，由 spec 断言改写后的取值——两处口径差都在表里可见，
 * 不用去读上游源码比对。
 *
 * 未纳入对照的上游表：`TestSelectOATemplate`（模板名 `novelty-defense` 等）。本模块不移植
 * 模板名——答复书的模板由 `@deepseek-ai/dsh-doc-template` 包拥有，另立一套平行模板名会形成
 * 第二个权威。
 */

import type { AmendmentAction, ResponseStrategy } from '../../../src/response/strategy.ts'

/** 上游的驳回类型标识。 */
export type UpstreamRejectionType =
  | 'novelty'
  | 'inventiveness'
  | 'clarity'
  | 'support'
  | 'disclosure'
  | 'scope'
  | 'formal'

/** 策略对照用例。 */
export type StrategyCase = {
  type: UpstreamRejectionType
  /** 上游 `determineResponseStrategy` 的期望取值。 */
  upstream: ResponseStrategy
  /** 本模块取值；与上游不同时由 `note` 说明。 */
  ours: ResponseStrategy
  note?: string
}

/** 上游 `TestDetermineResponseStrategy` 与 `TestClassifyRejectionNode` 的 7 类理由，取值一致。 */
export const STRATEGY_CASES: readonly StrategyCase[] = [
  { type: 'novelty', upstream: 'argument', ours: 'argument' },
  { type: 'inventiveness', upstream: 'argument', ours: 'argument' },
  { type: 'clarity', upstream: 'amendment', ours: 'amendment' },
  { type: 'support', upstream: 'amendment', ours: 'amendment' },
  { type: 'scope', upstream: 'amendment', ours: 'amendment' },
  { type: 'disclosure', upstream: 'argument', ours: 'argument' },
  { type: 'formal', upstream: 'amendment', ours: 'amendment' },
]

/** 修改动作对照用例（上游 `claimAmendmentType(rejectionType, claimNum)`）。 */
export type AmendmentActionCase = {
  type: UpstreamRejectionType
  /** 上游判定的权项编号：1 走独立权利要求分支，其余走从属分支。 */
  claimNumber: number
  /** 上游的期望取值（中文动作名）。 */
  upstream: string
  /** 本模块闭集动作。 */
  ours: AmendmentAction
  note?: string
}

/**
 * 上游 `claimAmendmentType` 的分支取值。
 *
 * 上游只有"权利要求 1"与"其余权项"两分支，调用方又只传受影响权项中最靠前的一个编号，
 * 从属分支实际不生效；本模块按调用方给出的独立权利要求编号判定，两条分支都可达。
 */
export const AMENDMENT_ACTION_CASES: readonly AmendmentActionCase[] = [
  { type: 'clarity', claimNumber: 1, upstream: '澄清限定', ours: 'clarify' },
  { type: 'clarity', claimNumber: 2, upstream: '从属引用调整', ours: 'adjust-reference' },
  { type: 'support', claimNumber: 1, upstream: '限缩', ours: 'narrow' },
  { type: 'support', claimNumber: 2, upstream: '限缩', ours: 'narrow' },
  {
    type: 'scope',
    claimNumber: 1,
    upstream: '限缩/删除',
    ours: 'narrow',
    note: '上游一格写两种动作；本模块独立权利要求取限缩，删除作为限缩仍不成立时的后续动作记录在动作表说明中',
  },
  { type: 'scope', claimNumber: 2, upstream: '删除', ours: 'delete' },
]

/** 法条依据对照用例（上游 `amendmentBasis`）。 */
export type BasisCase = {
  type: UpstreamRejectionType
  /** 上游返回的依据文本。 */
  upstream: string
  /** 本模块返回值；与上游不同时由 `note` 说明。 */
  ours: string
  note?: string
}

/** 上游 `amendmentBasis` 与 `REJECTION_BASIS` 的对照。 */
export const BASIS_CASES: readonly BasisCase[] = [
  { type: 'clarity', upstream: '专利法第26条第4款（清楚）', ours: '专利法第26条第4款（清楚）' },
  { type: 'support', upstream: '专利法第26条第4款（支持）', ours: '专利法第26条第4款（支持）' },
  {
    type: 'scope',
    upstream: '专利法第33条（修改不超范围）',
    ours: '专利法第33条（修改不超出原说明书和权利要求书记载的范围）',
    note: '按法条原文表述补齐范围要件',
  },
  {
    type: 'novelty',
    upstream: '区别技术特征（非修改，争辩）',
    ours: '专利法第22条第2款（新颖性，以争辩为主）',
    note: '上游把答复方式写进依据列；本模块该列只放依据，答复方式由策略列承担',
  },
  {
    type: 'inventiveness',
    upstream: '区别技术特征（非修改，争辩）',
    ours: '专利法第22条第3款（创造性，以争辩为主）',
    note: '同新颖性',
  },
  {
    type: 'disclosure',
    upstream: '审查指南相关规定',
    ours: '专利法第26条第3款（充分公开）',
    note: '补上充分公开的法条依据',
  },
  {
    type: 'formal',
    upstream: '审查指南相关规定',
    ours: '《专利审查指南》关于申请文件格式与撰写形式的规定',
    note: '形式缺陷的依据确为审查指南，写明所依据的内容而不写未核验的章节号',
  },
]
