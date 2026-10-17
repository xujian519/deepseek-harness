/**
 * 答复域原子：response-check（审查意见答复合规检查）。
 *
 * 包装 `patent-rule` 的既有规则资产，不新写规则：
 * - PR-OA-007（26.3 判准落位）：结构分析，话题命中后要求本领域技术人员、
 *   能够实现、说明书记载三要素；
 * - PR-OA-008（驳回理由覆盖）：通知书提出的每条理由简称须在答复中出现；
 * - PR-OA-009（未提条款引用）：答复引用的驳回条款须在通知书援引范围内。
 *
 * 缺少通知书时双输入规则列入 `response_check_unevaluated`，不静默跳过；
 * 答复正文缺失、状态值类型错误或规则资产缺失时降级。
 */

import {
  REJECTION_ORDER,
  REJECTION_SHORT_LABELS,
  degraded,
  parseOfficeAction,
  type Atom,
  type ConstitutionalRule,
  type NoticeRejectionGround,
  type PipelineState,
  type RuleViolation,
  type StageExecuteInput,
  type StageHandler,
} from '@deepseek-ai/dsh-patent-core'
import {
  evaluateDualRule,
  evaluateText,
  isDualInputCheck,
  loadPatentFullRuleSet,
  type OfficeActionRejections,
} from '@deepseek-ai/dsh-patent-rule'
import { readFirstStateText } from './state-text.ts'

/** 本原子检查的规则编号（顺序即报告顺序）。 */
export const RESPONSE_CHECK_RULE_IDS = ['PR-OA-007', 'PR-OA-008', 'PR-OA-009'] as const

/** 答复正文的默认读取键；阶段参数 `response_key` 优先。 */
export const DEFAULT_RESPONSE_TEXT_KEYS: readonly string[] = [
  'draft',
  'response',
  'response_text',
  'statement',
]

/** 通知书结构化结果（`oa-parse` 产出）的默认读取键。 */
export const DEFAULT_OFFICE_ACTION_KEY = 'office_action'

/** 通知书正文的兜底读取键；结构化结果缺失时才解析。 */
export const DEFAULT_NOTICE_TEXT_KEYS: readonly string[] = ['notice', 'office_action_text', 'input']

/** response-check 原子：审查意见答复合规检查。 */
export const responseCheckAtom: Atom = {
  name: 'response-check',
  description:
    '审查意见答复合规检查（PR-OA-007/008/009）：26.3 判准落位、驳回理由覆盖、未提条款引用',
  category: 'gate',
  inputSchema: [
    ...DEFAULT_RESPONSE_TEXT_KEYS,
    DEFAULT_OFFICE_ACTION_KEY,
    ...DEFAULT_NOTICE_TEXT_KEYS,
  ],
  outputSchema: [
    'response_check_report',
    'response_check_passed',
    'response_check_violations',
    'response_check_unevaluated',
  ],
}

/** 规则加载结果：选中的规则、缺失编号与资产警告。 */
export type ResponseRuleLoad = {
  /** 按 {@link RESPONSE_CHECK_RULE_IDS} 顺序选中的规则。 */
  rules: ConstitutionalRule[]
  /** 资产中缺失的规则编号。 */
  missingIds: string[]
  /** 规则资产加载警告。 */
  warnings: string[]
}

/**
 * 加载内置专利全量规则集并选出答复检查规则。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 选中规则、缺失编号与警告。
 */
export function loadResponseCheckRules(rulesDir?: string): ResponseRuleLoad {
  const loaded = loadPatentFullRuleSet(rulesDir)
  const byId = new Map(loaded.ruleSet.rules.map(rule => [rule.id, rule]))
  const rules: ConstitutionalRule[] = []
  const missingIds: string[] = []
  for (const id of RESPONSE_CHECK_RULE_IDS) {
    const rule = byId.get(id)
    if (rule === undefined) missingIds.push(id)
    else rules.push(rule)
  }
  return { rules, missingIds, warnings: loaded.warnings }
}

let cachedRules: ResponseRuleLoad | undefined

/** 读取进程内缓存的规则集（资产固定，无需失效）。 */
function defaultRules(): ResponseRuleLoad {
  cachedRules ??= loadResponseCheckRules()
  return cachedRules
}

/** 规则加载器，供测试注入最小规则集。 */
export type ResponseCheckLoader = () => ResponseRuleLoad

/** 通知书读取结果：已解析、未提供或结构损坏。 */
type NoticeRead =
  | { kind: 'parsed'; notice: OfficeActionRejections }
  | { kind: 'missing'; reason: string }
  | { kind: 'error'; reason: string }

/**
 * 解析阶段参数指定的状态键。
 * @param state - 阶段执行态（阶段参数已合入）。
 * @param paramKey - 阶段参数键。
 * @param fallback - 参数未声明时使用的默认键。
 * @returns 非空键名；参数已声明但非法时返回 undefined。
 */
function resolveKey(state: PipelineState, paramKey: string, fallback: string): string | undefined {
  const value = state[paramKey]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  return value.trim()
}

/**
 * 校验 JSON 中的驳回理由列表。
 * @param value - `JSON.parse` 的产物。
 * @returns 合法的驳回理由；结构不合法时返回 undefined。
 */
function readRejectionTypes(value: unknown): NoticeRejectionGround[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as Record<string, unknown>).rejectionTypes
  if (!Array.isArray(raw)) return undefined
  const grounds: NoticeRejectionGround[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') return undefined
    const ground = REJECTION_ORDER.find(item => item === entry)
    if (ground === undefined) return undefined
    grounds.push(ground)
  }
  return grounds
}

/**
 * 读取通知书：优先使用 `oa-parse` 的结构化结果，缺失时解析正文。
 * @param state - 阶段执行态。
 * @param officeActionKey - 结构化结果键。
 * @param noticeKeys - 通知书正文候选键。
 * @returns 已解析的通知书、缺失原因或结构损坏原因。
 */
function readNotice(
  state: PipelineState,
  officeActionKey: string,
  noticeKeys: readonly string[],
): NoticeRead {
  const raw = state[officeActionKey]
  if (raw !== undefined) {
    if (typeof raw !== 'string') {
      return { kind: 'error', reason: `state.${officeActionKey} 不是字符串` }
    }
    const text = raw.trim()
    if (text.length === 0) {
      return { kind: 'error', reason: `state.${officeActionKey} 为空` }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', reason: `state.${officeActionKey} 不是合法 JSON：${message}` }
    }
    const rejectionTypes = readRejectionTypes(parsed)
    if (rejectionTypes === undefined) {
      return { kind: 'error', reason: `state.${officeActionKey} 缺少合法的 rejectionTypes` }
    }
    return { kind: 'parsed', notice: { rejectionTypes } }
  }

  const noticeText = readFirstStateText(state, noticeKeys, '通知书正文')
  if (noticeText.kind === 'missing') return { kind: 'missing', reason: noticeText.reason }
  if (noticeText.kind === 'error') return noticeText
  return { kind: 'parsed', notice: parseOfficeAction(noticeText.text) }
}

/** 报告渲染参数。 */
type ReportInput = {
  passed: boolean
  violations: readonly RuleViolation[]
  notice: NoticeRead
  unevaluated: readonly string[]
  warnings: readonly string[]
}

/**
 * 渲染检查报告。
 * @param input - 检查结果。
 * @returns 面向模型/用户的 Markdown 文本。
 */
function renderReport(input: ReportInput): string {
  const { passed, violations, notice, unevaluated, warnings } = input
  const lines = [
    `审查意见答复合规检查（PR-OA-007/008/009）：${passed ? '通过（0 条违规）' : `未通过（${violations.length} 条违规）`}`,
  ]
  if (notice.kind === 'parsed') {
    const labels = notice.notice.rejectionTypes.map(ground => REJECTION_SHORT_LABELS[ground])
    lines.push(
      labels.length > 0
        ? `- 通知书驳回理由：${labels.join('、')}`
        : '- 通知书未识别到具体驳回理由（PR-OA-008/009 无从对照）',
    )
  } else {
    lines.push(`- ${notice.reason}（PR-OA-008/009 未评估）`)
  }
  for (const violation of violations) {
    const basis = violation.legalBasis === undefined ? '' : `（依据：${violation.legalBasis}）`
    const evidence = violation.evidence.length > 0
      ? ` 命中「${violation.evidence.join('」「')}」`
      : ''
    const where = violation.line !== undefined && violation.matchedSentence !== undefined
      ? `（第 ${violation.line} 行「${violation.matchedSentence}」）`
      : ''
    lines.push(
      `- [${violation.severity}/${violation.action}] ${violation.ruleId} ${violation.ruleName}：${violation.message}${evidence}${where}${basis}`,
    )
  }
  if (unevaluated.length > 0) {
    lines.push(`- 未评估规则：${unevaluated.join('、')}`)
  }
  if (warnings.length > 0) {
    const shown = warnings.slice(0, 3).join('；')
    const suffix = warnings.length > 3 ? ` 等 ${warnings.length} 条` : ''
    lines.push(`- 规则加载警告：${shown}${suffix}`)
  }
  return lines.join('\n')
}

/**
 * 去重证据，保持首次出现顺序。
 * @param violations - 规则违规。
 * @returns 证据已去重的副本。
 */
function uniqueEvidence(violations: readonly RuleViolation[]): RuleViolation[] {
  return violations.map(violation => ({
    ...violation,
    evidence: [...new Set(violation.evidence)],
  }))
}

/** response-check 执行器：包装 PR-OA-007/008/009 的确定性评估。 */
export class ResponseCheckHandler implements StageHandler {
  readonly name = 'response-check'
  readonly category = 'gate' as const

  private readonly loadRules: ResponseCheckLoader

  /**
   * @param loadRules - 规则加载器；缺省读取内置专利全量规则集。
   */
  constructor(loadRules: ResponseCheckLoader = defaultRules) {
    this.loadRules = loadRules
  }

  /**
   * 执行答复检查阶段。
   * @param input - 阶段执行输入（state 中已合入阶段参数）。
   * @returns 下一步状态：报告、通过标记、违规项与未评估规则。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const responseKey = resolveKey(state, 'response_key', 'draft')
    if (responseKey === undefined) {
      return degraded('response-check', 'params.response_key 必须是非空字符串')
    }
    const officeActionKey = resolveKey(state, 'office_action_key', DEFAULT_OFFICE_ACTION_KEY)
    if (officeActionKey === undefined) {
      return degraded('response-check', 'params.office_action_key 必须是非空字符串')
    }
    const noticeKey = resolveKey(state, 'notice_key', DEFAULT_NOTICE_TEXT_KEYS[0] ?? 'notice')
    if (noticeKey === undefined) {
      return degraded('response-check', 'params.notice_key 必须是非空字符串')
    }

    const response = readFirstStateText(
      state,
      [...new Set([responseKey, ...DEFAULT_RESPONSE_TEXT_KEYS])],
      '答复正文',
    )
    if (response.kind === 'missing') return degraded('response-check', response.reason)
    if (response.kind === 'error') return degraded('response-check', response.reason)

    const notice = readNotice(
      state,
      officeActionKey,
      [...new Set([noticeKey, ...DEFAULT_NOTICE_TEXT_KEYS])],
    )
    if (notice.kind === 'error') return degraded('response-check', notice.reason)

    let loaded: ResponseRuleLoad
    try {
      loaded = this.loadRules()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return degraded('response-check', `规则资产加载失败：${message}`)
    }
    if (loaded.missingIds.length > 0) {
      return degraded(
        'response-check',
        `规则资产缺失：${loaded.missingIds.join('、')}（patent-full scope）`,
      )
    }

    const violations: RuleViolation[] = []
    const unevaluated: string[] = []
    for (const rule of loaded.rules) {
      if (isDualInputCheck(rule.check.type)) {
        if (notice.kind === 'missing') {
          unevaluated.push(rule.id)
          continue
        }
        const found = evaluateDualRule(rule, { notice: notice.notice, response: response.text })
        if (found !== null) violations.push(found)
        continue
      }
      violations.push(...evaluateText(response.text, { rules: [rule] }).violations)
    }

    const deduped = uniqueEvidence(violations)
    const passed = deduped.length === 0
    return {
      response_check_report: renderReport({ passed, violations: deduped, notice, unevaluated, warnings: loaded.warnings }),
      response_check_passed: passed,
      response_check_violations: deduped,
      response_check_unevaluated: unevaluated,
    }
  }
}
