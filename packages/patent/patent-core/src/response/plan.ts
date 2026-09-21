/**
 * src/patent/response — 答复计划的确定性拼装（逐权项修改对照 + 意见陈述骨架）。
 *
 * 输入 `parseOfficeAction` 的结构化结果，输出：每一条驳回理由的答复策略与必答段落、
 * 逐权项的修改动作与法条依据、以及无法从通知书确定下来的缺口。全部由闭集对照表完成，
 * 不调用模型，不生成论证内容——论证由人写入，本模块只保证"该答的理由都排上了、该改的
 * 权项都点到了"。
 *
 * 与上游 Mady `domains/workflows/patent/{oa_response,oa_helpers}.go` 的差异：
 * - 修改对照表逐权项出行。上游对每个修改类理由只取"受影响权项中最靠前的一个编号"判定
 *   修改动作，再在"涉及权利要求"列写出全部权项（`oa_response.go:145-165`），于是从属
 *   权利要求的动作从不生效、列出的权项与判定的动作不对应。
 * - 修改对象不明时报缺口而不兜底。上游在未抽出权项编号时默认按权利要求 1 出表，等于
 *   把"不知道改哪条"当成了"改权利要求 1"。
 * - 无驳回理由时不产出空骨架。上游只在 `rejectionTypes` 为空时抛错，无法表达"通知书
 *   存在但未识别到条款"；本模块把该情形作为缺口输出，答复依据交由人工判读。
 */

import { REJECTION_SHORT_LABELS, type NoticeRejectionGround, type ParsedOfficeAction } from '../notice/index.ts'
import type { ClaimKind } from '../claim-coverage/index.ts'
import {
  REJECTION_AMENDMENT_ACTIONS,
  REJECTION_BASIS,
  REJECTION_SECTIONS,
  REJECTION_STRATEGY,
  isAmendmentStrategy,
  strategiesFor,
  summarizeStrategies,
  type AmendmentAction,
  type ResponseStrategy,
} from './strategy.ts'

/** 答复计划的调用方输入。 */
export type ResponsePlanOptions = {
  /**
   * 申请的独立权利要求编号。
   *
   * 修改动作按独立/从属权利要求区分（如修改超范围理由下独立权利要求限缩、从属权利要求
   * 删除），故调用方须给出独立权利要求编号；未给出的权项按从属处理并报
   * `independent-claim-absent` 缺口。
   */
  independentClaims: readonly number[]
}

/** 单条驳回理由的答复段落骨架。 */
export type ResponsePlanSection = {
  ground: NoticeRejectionGround
  strategy: ResponseStrategy
  /** 意见陈述中必须逐项回应的段落标题。 */
  sections: readonly string[]
}

/** 一条修改对照行：某驳回理由下某条权利要求的修改动作。 */
export type ClaimAmendmentRow = {
  claim: number
  kind: ClaimKind
  ground: NoticeRejectionGround
  action: AmendmentAction
  /** 该理由的法条依据。 */
  basis: string
}

/** 答复计划的缺口类型。 */
export type ResponsePlanGapKind =
  | 'no-ground-detected'
  | 'amendment-ground-without-claims'
  | 'independent-claim-absent'

/** 一处无法从通知书确定下来的缺口。 */
export type ResponsePlanGap = {
  kind: ResponsePlanGapKind
  /** 相关驳回理由；`no-ground-detected` 时为 `null`。 */
  ground: NoticeRejectionGround | null
  detail: string
}

/** 答复计划。 */
export type ResponsePlan = {
  /** "类型→策略"摘要。 */
  strategySummary: string
  /** 逐驳回理由的段落骨架，顺序与通知书驳回类型顺序一致。 */
  sections: ResponsePlanSection[]
  /** 逐权项修改对照行，按（驳回类型顺序，权项编号）。 */
  amendmentRows: ClaimAmendmentRow[]
  /** 需要修改的权利要求编号（升序去重）。 */
  claimsToAmend: number[]
  /** 通知书提到的权利要求编号（原样取自解析结果）。 */
  claimsMentioned: number[]
  /** 缺口列表。 */
  gaps: ResponsePlanGap[]
}

/**
 * 由通知书解析结果拼装答复计划。
 * @param notice - 通知书解析结果。
 * @param options - 独立权利要求编号。
 * @returns 答复计划。
 */
export function buildResponsePlan(notice: ParsedOfficeAction, options: ResponsePlanOptions): ResponsePlan {
  const types = notice.rejectionTypes
  const strategies = strategiesFor(types)
  const sections: ResponsePlanSection[] = types.map((ground, index) => ({
    ground,
    strategy: strategies[index] as ResponseStrategy,
    sections: REJECTION_SECTIONS[ground],
  }))

  const gaps: ResponsePlanGap[] = []
  if (types.length === 0) {
    gaps.push({
      kind: 'no-ground-detected',
      ground: null,
      detail: `通知书未识别到具体驳回条款（rejectionType=${notice.rejectionType}），答复依据须人工判读`,
    })
  }

  const amendmentRows: ClaimAmendmentRow[] = []
  for (const ground of types) {
    if (!isAmendmentStrategy(REJECTION_STRATEGY[ground])) continue
    if (notice.affectedClaims.length === 0) {
      gaps.push({
        kind: 'amendment-ground-without-claims',
        ground,
        detail: `${REJECTION_SHORT_LABELS[ground]}须修改权利要求，但通知书未抽出权项编号，修改对象须人工确认`,
      })
      continue
    }
    for (const claim of notice.affectedClaims) {
      const kind = claimKind(claim, options.independentClaims)
      amendmentRows.push({
        claim,
        kind,
        ground,
        action: REJECTION_AMENDMENT_ACTIONS[ground][kind],
        basis: REJECTION_BASIS[ground],
      })
    }
  }

  if (amendmentRows.length > 0 && !amendmentRows.some(row => row.kind === 'independent')) {
    gaps.push({
      kind: 'independent-claim-absent',
      ground: null,
      detail: `修改类驳回涉及的权项（${amendmentRows.map(row => row.claim).join('、')}）中没有独立权利要求被点出，`
        + '修改动作按从属权利要求取值，请确认独立权利要求是否也需要修改',
    })
  }

  return {
    strategySummary: summarizeStrategies(types),
    sections,
    amendmentRows,
    claimsToAmend: [...new Set(amendmentRows.map(row => row.claim))].sort((left, right) => left - right),
    claimsMentioned: notice.affectedClaims,
    gaps,
  }
}

/**
 * 判定权项类型：编号在调用方给出的独立权利要求编号中即独立，否则按从属处理。
 * @param claim - 权利要求编号。
 * @param independentClaims - 独立权利要求编号。
 * @returns 权项类型。
 */
function claimKind(claim: number, independentClaims: readonly number[]): ClaimKind {
  return independentClaims.includes(claim) ? 'independent' : 'dependent'
}
