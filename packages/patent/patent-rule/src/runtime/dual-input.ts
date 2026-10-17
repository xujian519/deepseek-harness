/**
 * 规则引擎 — 双输入检查族（通知书解析结果 + 答复正文）。
 *
 * 单文本评估（`evaluateRule`）对双输入族返回 null；`rule_check` 在提供 `notice` 时
 * 调本模块逐条评估。判据是确定性的文本对照，不做实质法律判断：
 * - `notice_ground_coverage`：通知书提出的每条驳回理由（简称）须在答复中出现；
 *   覆盖按简称核验，覆盖不等于论证成立。
 * - `unraised_statute_citation`：答复引用的驳回条款（22.2/22.3/26.3/26.4/33）须在
 *   通知书援引范围内；通知书未识别到具体条款时不评估（无从对照，避免把"没解析出来"
 *   当成"没提出"）。
 * @module @deepseek-ai/dsh-patent-rule/runtime/dual-input
 */

import {
  REJECTION_SHORT_LABELS,
  type ConstitutionalRule,
  type NoticeRejectionGround,
  type ParsedOfficeAction,
  type RuleCheckType,
  type RuleViolation,
} from '@deepseek-ai/dsh-patent-core'

/** 双输入检查族（需要通知书解析结果的检查类型）。 */
export const DUAL_INPUT_CHECK_TYPES: readonly RuleCheckType[] = [
  'notice_ground_coverage',
  'unraised_statute_citation',
]

/**
 * 该检查类型是否属于双输入族。
 * @param type - 检查类型。
 * @returns 需要 `notice` 输入时为 true。
 */
export function isDualInputCheck(type: RuleCheckType): boolean {
  return (DUAL_INPUT_CHECK_TYPES as readonly string[]).includes(type)
}

/**
 * 双输入规则实际读取的通知书字段。
 *
 * 只有驳回理由参与判定；收窄类型让调用方可以直接传 `oa-parse` 的解析结果，
 * 不必构造解析器的全部字段。
 */
export type OfficeActionRejections = Pick<ParsedOfficeAction, 'rejectionTypes'>

/** 双输入规则评估的输入。 */
export type DualInputRuleInput = {
  /** 通知书解析结果（只消费驳回理由）。 */
  notice: OfficeActionRejections
  /** 被检文本（答复正文）。 */
  response: string
}

/** 答复引用的法条条号 → 该条号对应的驳回条款族（与通知书已提条款对照用）。 */
const STATUTE_GROUNDS: readonly {
  article: number
  paragraph?: number
  grounds: readonly NoticeRejectionGround[]
}[] = [
  { article: 22, paragraph: 2, grounds: ['novelty'] },
  { article: 22, paragraph: 3, grounds: ['inventiveness'] },
  { article: 22, grounds: ['novelty', 'inventiveness'] },
  { article: 26, paragraph: 3, grounds: ['disclosure'] },
  { article: 26, paragraph: 4, grounds: ['clarity', 'support'] },
  { article: 26, grounds: ['disclosure', 'clarity', 'support'] },
  { article: 33, grounds: ['scope'] },
]

/** 答复中的专利法驳回条款引用：`专利法第22条第3款` / `专利法第 33 条`。 */
const STATUTE_CITATION = /专利法第\s*(\d+)\s*条(?:\s*第\s*(\d+)\s*款)?/gu

/**
 * 取条号在对照表中最具体的条目：带款号先精确匹配，退回同条不带款号的族。
 * @param article - 专利法条号。
 * @param paragraph - 款号；未写时为 undefined。
 * @returns 命中的对照条目；不属于驳回条款族时为 undefined。
 */
function statuteEntry(
  article: number,
  paragraph: number | undefined,
): (typeof STATUTE_GROUNDS)[number] | undefined {
  const specific = paragraph === undefined
    ? undefined
    : STATUTE_GROUNDS.find(entry => entry.article === article && entry.paragraph === paragraph)
  return specific ?? STATUTE_GROUNDS.find(entry => entry.article === article && entry.paragraph === undefined)
}

/**
 * 组装双输入违规记录（无字面命中位置，故不带 line/matchedSentence）。
 * @param rule - 命中的规则。
 * @param message - 面向模型的说明。
 * @param evidence - 证据片段。
 * @returns 违规记录。
 */
function violation(rule: ConstitutionalRule, message: string, evidence: string[]): RuleViolation {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    action: rule.action,
    ...(rule.legalBasis !== undefined ? { legalBasis: rule.legalBasis } : {}),
    message,
    evidence,
  }
}

/**
 * 评估一条双输入规则。
 * @param rule - 规则（check 必须属于双输入族）。
 * @param input - 通知书解析结果与答复正文。
 * @returns 违规；不适用或无违规时为 null。
 */
export function evaluateDualRule(rule: ConstitutionalRule, input: DualInputRuleInput): RuleViolation | null {
  switch (rule.check.type) {
    case 'notice_ground_coverage': {
      const missing = input.notice.rejectionTypes.filter(
        ground => !input.response.includes(REJECTION_SHORT_LABELS[ground]),
      )
      if (missing.length === 0) return null
      const labels = missing.map(ground => REJECTION_SHORT_LABELS[ground])
      return violation(
        rule,
        `答复未覆盖通知书提出的驳回理由：${labels.join('、')}（按理由简称核验，须逐条回应）`,
        labels,
      )
    }
    case 'unraised_statute_citation': {
      if (input.notice.rejectionTypes.length === 0) return null
      const unraised: string[] = []
      for (const match of input.response.matchAll(STATUTE_CITATION)) {
        const article = Number(match[1])
        const paragraph = match[2] === undefined ? undefined : Number(match[2])
        const entry = statuteEntry(article, paragraph)
        if (entry === undefined) continue
        const raised = entry.grounds.some(ground => input.notice.rejectionTypes.includes(ground))
        if (!raised) unraised.push(match[0])
      }
      if (unraised.length === 0) return null
      return violation(
        rule,
        `答复引用了通知书未提出的驳回条款：${[...new Set(unraised)].join('、')}（如系主动澄清，须说明引用来源）`,
        unraised,
      )
    }
    /* v8 ignore next -- 调用方只会传入双输入族；其余类型走单文本评估，不会到达这里。 */
    default:
      return null
  }
}
