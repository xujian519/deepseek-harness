/**
 * src/patent/response — 答复策略、修改动作与意见陈述段落的闭集对照表。
 *
 * 四张表把"驳回类型"映射到机械可核验的答复要素：策略（争辩/修改/组合）、权项修改动作
 * （按独立/从属区分）、意见陈述必答段落、法条依据。表全部是闭集，调用方给出的驳回类型
 * 必然命中，不会落到默认值。
 *
 * 与上游 Mady `domains/workflows/patent/oa_helpers.go` 的差异：
 * - 组合策略只留给 `other` 一种入口。上游 `determineResponseStrategy` 的默认分支兼作未知
 *   类型兜底，等于把"没识别出的驳回类型"当成需要争辩加修改；本模块的 `other` 是明确取值
 *   ——"未识别到具体驳回条款"，其答复内容须人工判读。
 * - 修改动作按独立/从属给出两个取值。上游 `claimAmendmentType(rejectionType, claimNum)`
 *   虽有两分支，但调用方只传受影响权项中最靠前的一个编号（`oa_response.go:158-163`），
 *   从属权利要求的动作因此从不生效。
 * - 法条依据补齐充分公开与形式缺陷。上游 `amendmentBasis` 对公开不充分与形式缺陷都落到
 *   "审查指南相关规定"，并把新颖性/创造性的依据写成"非修改，争辩"。
 * - 不移植答复书模板名。上游 `selectOATemplate` 把驳回类型映射到 `novelty-defense` 一类模板
 *   名；答复书模板由 `@deepseek-ai/dsh-doc-template` 包拥有，本模块不另立一套平行模板名。
 */

import { REJECTION_SHORT_LABELS, type NoticeRejectionType } from '../notice/index.ts'
import type { ClaimKind } from '../claim-coverage/index.ts'

/** 答复策略：以争辩为主、以修改为主、或两者组合。 */
export type ResponseStrategy = 'argument' | 'amendment' | 'combined'

/** 权项修改动作；`none` 表示该驳回理由不产生修改。 */
export type AmendmentAction = 'clarify' | 'narrow' | 'delete' | 'adjust-reference' | 'none'

/** 答复策略的中文标签。 */
export const STRATEGY_LABELS: Record<ResponseStrategy, string> = {
  argument: '争辩',
  amendment: '修改',
  combined: '争辩+修改',
}

/** 修改动作的中文标签。 */
export const AMENDMENT_ACTION_LABELS: Record<AmendmentAction, string> = {
  clarify: '澄清限定',
  narrow: '限缩',
  delete: '删除',
  'adjust-reference': '从属引用调整',
  none: '无需修改',
}

/**
 * 驳回类型对应的答复策略。
 *
 * 新颖性、创造性、公开不充分以争辩为主（争议在事实认定与法律适用，通常不修改权利要求）；
 * 不清楚、不支持、修改超范围、形式缺陷以修改为主。
 */
export const REJECTION_STRATEGY: Record<NoticeRejectionType, ResponseStrategy> = {
  novelty: 'argument',
  inventiveness: 'argument',
  disclosure: 'argument',
  clarity: 'amendment',
  support: 'amendment',
  scope: 'amendment',
  formal: 'amendment',
  other: 'combined',
}

/**
 * 各驳回类型的修改动作，按独立/从属权利要求分开。
 *
 * 争辩型理由为 `none`：其答复方式是论证，不是修改（上游把这类理由的修改动作写成"调整"，
 * 与策略"争辩"并列出现在同一张修改对照表里）。修改超范围理由下独立权利要求宜限缩至原
 * 记载范围、仍不成立时删除，从属权利要求通常直接删除。
 */
export const REJECTION_AMENDMENT_ACTIONS: Record<NoticeRejectionType, Record<ClaimKind, AmendmentAction>> = {
  novelty: { independent: 'none', dependent: 'none' },
  inventiveness: { independent: 'none', dependent: 'none' },
  disclosure: { independent: 'none', dependent: 'none' },
  clarity: { independent: 'clarify', dependent: 'adjust-reference' },
  support: { independent: 'narrow', dependent: 'narrow' },
  scope: { independent: 'narrow', dependent: 'delete' },
  formal: { independent: 'clarify', dependent: 'adjust-reference' },
  other: { independent: 'none', dependent: 'none' },
}

/**
 * 各驳回类型的法条依据（修改依据，或争辩型理由的答复依据）。
 *
 * 只写已核验的《专利法》条号；形式缺陷的依据是《专利审查指南》的格式与撰写要求，不写
 * 具体章节号。
 */
export const REJECTION_BASIS: Record<NoticeRejectionType, string> = {
  novelty: '专利法第22条第2款（新颖性，以争辩为主）',
  inventiveness: '专利法第22条第3款（创造性，以争辩为主）',
  disclosure: '专利法第26条第3款（充分公开）',
  clarity: '专利法第26条第4款（清楚）',
  support: '专利法第26条第4款（支持）',
  scope: '专利法第33条（修改不超出原说明书和权利要求书记载的范围）',
  formal: '《专利审查指南》关于申请文件格式与撰写形式的规定',
  other: '未识别到具体驳回条款，依据须人工判读',
}

/**
 * 各驳回类型在意见陈述中必须逐项回应的段落（段落标题即必答项）。
 *
 * 段落是答复的机器可核验骨架：段落齐全不等于论证成立，段落缺失即答复不完整。
 */
export const REJECTION_SECTIONS: Record<NoticeRejectionType, readonly string[]> = {
  novelty: ['区别技术特征的认定', '单独对比（单篇文件是否公开全部技术特征）'],
  inventiveness: ['最接近的现有技术', '区别技术特征与实际解决的技术问题', '技术启示（非显而易见）'],
  disclosure: ['说明书公开的内容', '本领域技术人员能否实现'],
  clarity: ['修改内容与理由', '修改后用语含义唯一确定'],
  support: ['修改后权利要求的说明书依据', '上位概括与所公开技术效果的对应'],
  scope: ['修改内容的原申请文件出处', '未引入新技术内容、未扩大保护范围'],
  formal: ['缺陷逐项修正说明'],
  other: ['逐条回应审查意见（驳回条款须人工判读）'],
}

/** 产生权利要求修改的策略。 */
const AMENDMENT_STRATEGIES: readonly ResponseStrategy[] = ['amendment', 'combined']

/**
 * 该策略是否产生权利要求修改。
 * @param strategy - 答复策略。
 * @returns 产生修改时为 `true`。
 */
export function isAmendmentStrategy(strategy: ResponseStrategy): boolean {
  return AMENDMENT_STRATEGIES.includes(strategy)
}

/**
 * 取一组驳回类型对应的答复策略，顺序与输入一致。
 * @param types - 驳回类型列表（按首次出现位置排序）。
 * @returns 与输入等长的策略列表。
 */
export function strategiesFor(types: readonly NoticeRejectionType[]): ResponseStrategy[] {
  return types.map(type => REJECTION_STRATEGY[type])
}

/**
 * 渲染"类型→策略"的紧凑摘要，如 `创造性→争辩、不清楚→修改`。
 * @param types - 驳回类型列表（按首次出现位置排序）。
 * @returns 摘要文本；输入为空时为 `综合答复`。
 */
export function summarizeStrategies(types: readonly NoticeRejectionType[]): string {
  return types.length === 0
    ? '综合答复'
    : types.map(type => `${REJECTION_SHORT_LABELS[type]}→${STRATEGY_LABELS[REJECTION_STRATEGY[type]]}`).join('、')
}
