/**
 * 答复域原子：response-check（审查意见答复合规检查）。
 *
 * 包装 `patent-rule` 的既有规则资产，不新写规则。规则分两条判定通道，各自一个布尔键：
 * - 合规通道（{@link COMPLIANCE_RULE_IDS}）→ `response_check_passed`：
 *   PR-OA-007（26.3 判准落位）、PR-OA-008（驳回理由覆盖）、PR-OA-009（未提条款引用）；
 * - 表达质量通道（{@link CONCISION_RULE_IDS}）→ `response_concision_passed`：
 *   PR-OA-005（计数式论证）、PR-OA-006（重复引证）、PR-OA-010（空节）、
 *   PR-OA-011（结论重复）。
 *
 * 两条通道分开而非合并，是因为两者的后果不同：合规通道的命中说明文书不满足法定或
 * 程序要求（`legal-gaps` 里按 block 记账），表达质量通道的命中说明该改稿、说明篇幅
 * 与论证密度不划算，不是「法律上不合规」。合成一个布尔会让「句子写啰嗦了」以法律
 * 阻断项的样子出现，也会改掉 `response_check_passed` 既有语义。
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

/** 合规通道的规则编号（顺序即报告顺序）：决定 `response_check_passed`。 */
export const COMPLIANCE_RULE_IDS = ['PR-OA-007', 'PR-OA-008', 'PR-OA-009'] as const

/** 表达质量通道的规则编号：决定 `response_concision_passed`，不翻合规判定。 */
export const CONCISION_RULE_IDS = ['PR-OA-005', 'PR-OA-006', 'PR-OA-010', 'PR-OA-011'] as const

/**
 * 历史名称：等于 {@link COMPLIANCE_RULE_IDS}。
 *
 * 保留是因为它是包入口的公开导出，且语义一直是「合规通道那三条」——改名会让调用方
 * 以为判定范围变了。新代码请直接用 `COMPLIANCE_RULE_IDS`。
 */
export const RESPONSE_CHECK_RULE_IDS = COMPLIANCE_RULE_IDS

/** 全部规则编号：合规通道在前，表达质量通道在后。 */
const ALL_RULE_IDS: readonly string[] = [...COMPLIANCE_RULE_IDS, ...CONCISION_RULE_IDS]

/** 表达质量通道的编号集合，用于把规则分派到两个通道。 */
const CONCISION_ID_SET: ReadonlySet<string> = new Set(CONCISION_RULE_IDS)

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
    '审查意见答复检查：合规（PR-OA-007/008/009）与表达质量（PR-OA-005/006/010/011）分两通道，各出一个通过标记',
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
    'response_concision_report',
    'response_concision_passed',
    'response_concision_violations',
  ],
}

/** 规则加载结果：选中的规则、缺失编号与资产警告。 */
export type ResponseRuleLoad = {
  /** 按「合规通道 → 表达质量通道」顺序选中的规则。 */
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
  for (const id of ALL_RULE_IDS) {
    const rule = byId.get(id)
    if (rule === undefined) missingIds.push(id)
    else rules.push(rule)
  }
  return { rules, missingIds, warnings: loaded.warnings }
}

/**
 * 规则归属的通道：编号在表达质量表里归质量通道，其余（含测试注入的自定义规则）
 * 归合规通道。
 *
 * 未登记的规则默认走合规通道而不是被丢弃：自定义规则此前就影响
 * `response_check_passed`，静默把它移出判定会让门禁悄悄放宽。
 * @param ruleId - 规则编号。
 * @returns 通道名。
 */
function channelOf(ruleId: string): 'compliance' | 'concision' {
  return CONCISION_ID_SET.has(ruleId) ? 'concision' : 'compliance'
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
      /* v8 ignore next -- JSON.parse only rejects with Error values */
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

/** 合规报告渲染参数。 */
type ReportInput = {
  /** 合规通道结果。 */
  compliance: { passed: boolean; violations: readonly RuleViolation[] }
  notice: NoticeRead
  unevaluated: readonly string[]
  warnings: readonly string[]
}

/** 违规的 Markdown 行（证据、定位与依据按有无渲染）。 */
function violationLine(violation: RuleViolation): string {
  const basis = violation.legalBasis === undefined ? '' : `（依据：${violation.legalBasis}）`
  const evidence = violation.evidence.length > 0
    ? ` 命中「${violation.evidence.join('」「')}」`
    : ''
  const where = violation.line !== undefined && violation.matchedSentence !== undefined
    ? `（第 ${violation.line} 行「${violation.matchedSentence}」）`
    : ''
  return `- [${violation.severity}/${violation.action}] ${violation.ruleId} ${violation.ruleName}：${violation.message}${evidence}${where}${basis}`
}

/**
 * 渲染检查报告。
 * @param input - 检查结果。
 * @returns 面向模型/用户的 Markdown 文本。
 */
function renderReport(input: ReportInput): string {
  const { compliance, notice, unevaluated, warnings } = input
  const lines = [
    `审查意见答复合规检查（${COMPLIANCE_RULE_IDS.join('/')}）：${compliance.passed ? '通过（0 条违规）' : `未通过（${compliance.violations.length} 条违规）`}`,
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
  for (const violation of compliance.violations) lines.push(violationLine(violation))
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
 * 渲染表达质量报告。单列一份而不是并进合规报告：两条通道的结论级别不同，
 * 混在一份里会让「句子啰嗦」读起来像一条法律结论。
 * @param passed - 质量通道是否通过。
 * @param violations - 质量通道违规。
 * @returns Markdown 文本。
 */
function renderConcisionReport(passed: boolean, violations: readonly RuleViolation[]): string {
  const verdict = passed ? '通过（0 条违规）' : `未通过（${violations.length} 条违规）`
  return [
    `答复表达质量检查（${CONCISION_RULE_IDS.join('/')}）：${verdict}`,
    '- 本通道不构成法律合规阻断：命中说明该处篇幅与论证密度不划算，改法是删内容而不是压句子；合规结论见 response_check_report',
    ...violations.map(violationLine),
  ].join('\n')
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
    /* v8 ignore next -- the default key list is non-empty by declaration */
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
    const concisionViolations: RuleViolation[] = []
    const unevaluated: string[] = []
    for (const rule of loaded.rules) {
      const target = channelOf(rule.id) === 'concision' ? concisionViolations : violations
      if (isDualInputCheck(rule.check.type)) {
        if (notice.kind === 'missing') {
          unevaluated.push(rule.id)
          continue
        }
        const found = evaluateDualRule(rule, { notice: notice.notice, response: response.text })
        if (found !== null) target.push(found)
        continue
      }
      target.push(...evaluateText(response.text, { rules: [rule] }).violations)
    }

    const deduped = uniqueEvidence(violations)
    const concisionDeduped = uniqueEvidence(concisionViolations)
    const passed = deduped.length === 0
    const concisionPassed = concisionDeduped.length === 0
    return {
      response_check_report: renderReport({
        compliance: { passed, violations: deduped },
        notice,
        unevaluated,
        warnings: loaded.warnings,
      }),
      response_check_passed: passed,
      response_check_violations: deduped,
      response_check_unevaluated: unevaluated,
      response_concision_report: renderConcisionReport(concisionPassed, concisionDeduped),
      response_concision_passed: concisionPassed,
      response_concision_violations: concisionDeduped,
    }
  }
}
