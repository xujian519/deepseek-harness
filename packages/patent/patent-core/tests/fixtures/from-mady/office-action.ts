/**
 * 上游 Mady 表驱动用例（审查意见通知书解析）。
 *
 * 来源：`domains/rules/oa_parser_test.go`（MIT，同作者），提交 `2acb57db166b59d29a807f566382d610ad2ce9b3`
 * （2026-09-14，分支 `main`）。四张表逐例照搬上游的输入文本与上游期望值，用例名译为中文。
 *
 * 期望值按本模块的口径重新核对过：相关性不再兜底为 `A`、引用文献填充同句权项、审查员论点按
 * 码位截取、理由表无命中时不造默认理由。本模块新增的用例（相关性标注形式、公开不充分的三种
 * 写法、权项区间上限等）留在各自的 spec 内，不混入本文件——本文件只承载上游表内的用例。
 */

import type { NoticeRejectionType } from '../../../src/notice/office-action.ts'

/** 上游期望的单类型判定值（`DetectOaRejectionType` 用例）。 */
export type UpstreamRejectionTypeCase = {
  name: string
  text: string
  /** 上游期望的驳回类型（本模块同名取值；上游的 `OaOther` 对应本模块的 `other`）。 */
  want: NoticeRejectionType
}

/** 上游 `TestDetectOaRejectionType` 的 14 例。 */
export const REJECTION_TYPE_CASES: readonly UpstreamRejectionTypeCase[] = [
  { name: '创造性', text: '该权利要求不具备创造性', want: 'inventiveness' },
  { name: '创造性—显而易见', text: '对本领域技术人员而言显而易见', want: 'inventiveness' },
  { name: '创造性—条款', text: '不符合专利法22条第3款的规定', want: 'inventiveness' },
  { name: '新颖性', text: '该技术方案不具备新颖性', want: 'novelty' },
  { name: '新颖性—条款', text: '不符合22条第2款', want: 'novelty' },
  { name: '不清楚', text: '权利要求保护范围不清楚', want: 'clarity' },
  { name: '不清楚—条款', text: '不符合26条第4款', want: 'clarity' },
  { name: '公开不充分', text: '说明书公开不充分', want: 'disclosure' },
  { name: '公开不充分—条款', text: '不符合26条第3款，无法实现', want: 'disclosure' },
  { name: '得不到支持', text: '权利要求得不到说明书支持', want: 'support' },
  { name: '修改超范围', text: '保护范围过宽，不符合33条', want: 'scope' },
  { name: '修改超范围—措辞', text: '修改超范围，不符合33条', want: 'scope' },
  { name: '形式缺陷', text: '存在明显的格式形式错误', want: 'formal' },
  { name: '无条款', text: '这是一段普通文字', want: 'other' },
]

/** 上游期望的类型序列（`DetectOaRejectionTypes` 用例）。 */
export type UpstreamRejectionTypesCase = {
  name: string
  text: string
  /** 上游期望的类型序列；上游用 `nil` 表示无命中。 */
  want: readonly UpstreamRejectionTypeCase['want'][]
}

/** 上游 `TestDetectOaRejectionTypes` 的 6 例。 */
export const REJECTION_TYPES_CASES: readonly UpstreamRejectionTypesCase[] = [
  {
    name: '单一新颖性',
    text: '权利要求1不具备新颖性（专利法第22条第2款）',
    want: ['novelty'],
  },
  {
    name: '新颖性先于创造性',
    text: '权利要求1-3不具备新颖性（第22条第2款）。权利要求4-5相对于对比文件1和2的结合不具备创造性（第22条第3款）。',
    want: ['novelty', 'inventiveness'],
  },
  {
    name: '创造性先于不清楚',
    text: '权利要求1不具备创造性。权利要求2不清楚，不符合26条第4款。',
    want: ['inventiveness', 'clarity'],
  },
  {
    name: '顺序取原文首次出现',
    text: '权利要求5不清楚。权利要求1不具备新颖性。',
    want: ['clarity', 'novelty'],
  },
  {
    name: '同类型去重',
    text: '权利要求1不具备新颖性，权利要求3也不具备新颖性（第22条第2款）。',
    want: ['novelty'],
  },
  {
    name: '无类型',
    text: '这是一段普通文字',
    want: [],
  },
]

/** 引用文献用例。 */
export type UpstreamCitationCase = {
  name: string
  text: string
  /** 上游期望的文献号序列。 */
  want: readonly string[]
}

/** 上游 `TestExtractCitations` 的 5 例（上游只断言文献号）。 */
export const CITATION_CASES: readonly UpstreamCitationCase[] = [
  { name: '单一中国文献', text: '对比文件CN101234567A公开了...', want: ['CN101234567A'] },
  {
    name: '多国文献',
    text: 'CN101234567A和US2009012345A均公开了该技术',
    want: ['CN101234567A', 'US2009012345A'],
  },
  {
    name: '重复去重',
    text: 'CN101234567A公开了... CN101234567A进一步揭示',
    want: ['CN101234567A'],
  },
  { name: '无引用', text: '没有引用任何文献', want: [] },
  { name: 'WO 文献', text: 'WO2015000123A公开', want: ['WO2015000123A'] },
]

/** 权项编号用例。 */
export type UpstreamClaimCase = {
  name: string
  text: string
  /** 上游期望的权项编号序列。 */
  want: readonly number[]
}

/** 上游 `TestExtractAffectedClaims` 的 10 例。 */
export const CLAIM_CASES: readonly UpstreamClaimCase[] = [
  { name: '单号', text: '权利要求1不具备新颖性', want: [1] },
  { name: '多号', text: '权利要求1和权利要求3不具备创造性', want: [1, 3] },
  { name: '区间—项', text: '第1-5项权利要求', want: [1, 2, 3, 4, 5] },
  { name: '区间—至', text: '第1至3项', want: [1, 2, 3] },
  { name: '区间—无项字', text: '权利要求1-3不具备新颖性', want: [1, 2, 3] },
  { name: '区间—至无项字', text: '权利要求1至3不具备创造性', want: [1, 2, 3] },
  { name: '单号与区间混排', text: '权利要求2不符合规定，第4-6项也不符合', want: [2, 4, 5, 6] },
  { name: '区间与单号', text: '权利要求1-2和权利要求5均被对比文件公开', want: [1, 2, 5] },
  { name: '重复去重', text: '权利要求1...权利要求1...权利要求1', want: [1] },
  { name: '无权项', text: '没有任何权利要求', want: [] },
]
