/**
 * src/patent/response — 答复计划的确定性拼装（逐权项修改对照 + 意见陈述骨架）。
 *
 * 输入 `parseOfficeAction` 的结构化结果，输出：每一条驳回理由的答复策略与必答段落、
 * 逐权项的修改动作与法条依据、以及无法从通知书确定下来的缺口。全部由闭集对照表完成，
 * 不调用模型，不生成论证内容——论证由人写入，本模块只保证"该答的理由都排上了、该改的
 * 权项都点到了"。
 *
 * 另供输入层两件：`detectIndependentClaims` 从权利要求书正文保守检测独立权项编号（缺省
 * 填充，不作权威判定）；`formatResponsePlan` 把计划渲染为起草阶段消费的文本。
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
  AMENDMENT_ACTION_LABELS,
  REJECTION_AMENDMENT_ACTIONS,
  REJECTION_BASIS,
  REJECTION_SECTIONS,
  REJECTION_STRATEGY,
  STRATEGY_LABELS,
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

/** 从属权利要求的引用措辞：`根据权利要求 1 所述`、`如权利要求 1 或 2 所述` 一类。 */
const DEPENDENT_REFERENCE =
  /(?:根据|如|按照|依据|同)\s*(?:上述|前述|以上)?\s*权利要求\s*\d+|权利要求\s*\d+(?:\s*[-–~至或、,，和]\s*\d+)*\s*(?:中任一项)?\s*所述/

/**
 * 从权利要求书正文保守检测独立权利要求编号。
 *
 * 逐条按行首编号（`1. …`）切分；条内出现"根据权利要求……"一类引用措辞的按从属处理。
 * 检测只作缺省填充：权利要求书缺失或切分不出条目时返回空数组，不确定交给
 * `independent-claim-absent` 缺口提示人工确认，检测本身不作权威判定。
 * @param claimsText - 权利要求书正文。
 * @returns 独立权利要求编号（升序）；无法判定时为空数组。
 */
export function detectIndependentClaims(claimsText: string): number[] {
  const entries: { claim: number; headingStart: number; bodyStart: number }[] = []
  const heading = /(?:^|\n)\s*(\d+)\s*[.．、]\s*/g
  for (const match of claimsText.matchAll(heading)) {
    const claim = Number.parseInt(match[1] as string, 10)
    if (!Number.isInteger(claim) || claim < 1) continue
    const start = match.index
    entries.push({ claim, headingStart: start, bodyStart: start + match[0].length })
  }
  if (entries.length === 0) return []
  const independent: number[] = []
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] as (typeof entries)[number]
    const next = entries[i + 1]
    const body = claimsText.slice(entry.bodyStart, next === undefined ? claimsText.length : next.headingStart)
    if (!DEPENDENT_REFERENCE.test(body)) independent.push(entry.claim)
  }
  return [...new Set(independent)].sort((left, right) => left - right)
}

/**
 * 渲染答复计划为输入层文本（进 draft 阶段的上游产出块）。
 *
 * 逐项列出策略摘要、必答段落、逐权项修改对照与缺口；机器骨架供起草人逐项落实，
 * 不生成论证内容，也不作法律结论。
 * @param plan - 答复计划。
 * @returns 供起草阶段消费的多行文本。
 */
export function formatResponsePlan(plan: ResponsePlan): string {
  const lines: string[] = [
    '【答复计划（机器骨架；逐项落实，不作法律结论）】',
    `策略摘要：${plan.strategySummary}`,
    '',
    '必答段落：',
  ]
  if (plan.sections.length === 0) {
    lines.push('- （未识别到具体驳回条款，段落须人工判读）')
  } else {
    for (const section of plan.sections) {
      lines.push(
        `- ${REJECTION_SHORT_LABELS[section.ground]}（${STRATEGY_LABELS[section.strategy]}）：${section.sections.join('；')}`,
      )
    }
  }
  lines.push('', '修改对照（逐权项）：')
  if (plan.amendmentRows.length === 0) {
    lines.push('- （无修改类理由命中；或修改对象未从通知书确定，见缺口）')
  } else {
    for (const row of plan.amendmentRows) {
      const kind = row.kind === 'independent' ? '独立' : '从属'
      lines.push(`- 权利要求${row.claim}（${kind}）：${AMENDMENT_ACTION_LABELS[row.action]}（依据：${row.basis}）`)
    }
    lines.push(`拟修改权项：${plan.claimsToAmend.join('、')}`)
  }
  if (plan.gaps.length > 0) {
    lines.push('', '缺口（须人工确认）：')
    for (const gap of plan.gaps) lines.push(`- ${gap.detail}`)
  }
  return lines.join('\n')
}
