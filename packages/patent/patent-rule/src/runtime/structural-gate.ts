/**
 * 宪法规则引擎 — 制品结构门禁（pre-execute）。
 *
 * 「缺失即违规」的结构规则（structural_analysis / synonym_match）不能作用于工具结果
 * 全文：普通文本天然缺失大量期望要素，逐条报「要素不完整」不可用。它们的合法执行点是
 * **制品本身**，而制品的全文只出现在交付工具的调用入参里（如
 * `render_patent_document` 的 `draft`）。本模块把这类规则的判定放到工具调用之前：
 * 部署声明「哪个工具的哪个入参承载制品文本、用哪些规则判」，命中 block 级规则即拒绝
 * 该次调用，使不合格制品不会被渲染或落盘。
 *
 * 规则按 id 显式选择而非按域全选——域内规则的判据未必都适用于该制品形态（例如
 * `patent_claims` 域的 CON-301 判据是「清楚/简要/限定/必要技术特征」等评述词，普通
 * 权利要求草案天然不含）。声明了规则集里不存在的 id 时告警并忽略该条（fail-safe：
 * 不半截生效）；内置 preset 用 `strict` 把同一情形升级为加载失败。
 * @module @deepseek-ai/dsh-patent-rule/runtime/structural-gate
 */

import type { ConstitutionalRule, RuleSet, RuleViolation } from '@deepseek-ai/dsh-patent-core'
import { declaredArgsMatch, jsonRecord } from './args-match.ts'
import { evaluateText } from './RuleEngine.ts'
import type { SynonymMap } from './synonym-engine.ts'

/** 一条制品结构门禁声明。 */
export type StructuralGateEntry = {
  /** 被门禁的交付工具名。 */
  tool: string
  /** 承载制品文本的入参名：字符串入参取其值，记录/数组入参取其全部字符串值。 */
  textArgs: string[]
  /** 参与判定的规则 id（取自全量规则集）；规则集里不存在的 id 告警并忽略（`strict` 时改为加载失败）。 */
  ruleIds: string[]
  /**
   * 精确匹配才生效的入参（如 `{ template: 'claims-spec' }`）：声明的每一项都与实际
   * 入参相等时该条才适用，用于同一个工具的不同制品形态各判各的规则。
   */
  whenArgs?: Record<string, string>
  /**
   * 严格声明：规则 id 未在规则集内解析、解析到的规则不是 block 级，或条目本身无法执行
   * （未声明 `textArgs`、`ruleIds` 全空）时在加载期抛 {@link StructuralGateConfigError}，
   * 而不是告警后丢弃该条。内置 preset 用它把「规则资产改名」变成启动失败；不声明时保持
   * 告警并丢弃，外部部署的一处笔误因此不会让整个 profile 起不来。
   */
  strict?: boolean
}

/**
 * 严格声明的制品结构门禁无法按声明生效：规则 id 未解析、规则不是 block 级，或条目本身
 * 无法执行。加载期抛出——静默丢弃会让门禁「看起来生效而实际不判」。
 */
export class StructuralGateConfigError extends Error {
  /** 供调用方分流判断的稳定失败码。 */
  readonly code = 'STRUCTURAL_GATE_UNRESOLVED' as const

  /**
   * @param message - 部署侧可读的失败说明，逐条列出无法生效的声明。
   */
  constructor(message: string) {
    super(message)
    this.name = 'StructuralGateConfigError'
  }
}

/** 解析后的门禁声明：规则 id 换成规则对象。 */
export type ResolvedStructuralGateEntry = {
  /** 原始声明（保留用于文案与 whenArgs 判定）。 */
  entry: StructuralGateEntry
  /** 该声明的规则（已在规则集内解析）。 */
  rules: ConstitutionalRule[]
}

/** 制品结构门禁的运行计划。 */
export type StructuralGatePlan = {
  /** 已解析的门禁声明（规则集内不存在的 id 已剔除）。 */
  entries: ResolvedStructuralGateEntry[]
  /** 加载期告警（未知规则 id、空声明）。 */
  warnings: string[]
}

/** 递归收集一个 JSON 值里的全部字符串（记录取全部值，数组逐项展开）。 */
function collectText(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out)
    return
  }
  const record = jsonRecord(value)
  if (record === null) return
  for (const item of Object.values(record)) collectText(item, out)
}

/**
 * 从工具入参取出制品文本：按声明顺序拼接各入参里的全部字符串。
 * @param args - 工具调用入参（模型侧的 JSON 值——按解析边界做类型收窄）。
 * @param textArgs - 承载制品文本的入参名。
 * @returns 拼接后的制品文本；声明入参不存在或不含字符串时为空串。
 */
export function structuralGateText(args: unknown, textArgs: readonly string[]): string {
  const record = jsonRecord(args)
  if (record === null) return ''
  const parts: string[] = []
  for (const name of textArgs) collectText(record[name], parts)
  return parts.join('\n')
}

/**
 * 解析门禁声明：把规则 id 换成规则集内的规则，剔除未知 id 并告警。
 *
 * 「声明了规则 id 却没有对应规则」是配置错误，静默忽略会让门禁看起来生效而实际不判，
 * 故每条都进 warnings（调用方记录后仍需人工核对）。声明了 `strict` 的条目改为把这些
 * 问题收成一次加载失败，交给 plugin 加载期抛出。
 * @param ruleSet - 全量规则集。
 * @param entries - 部署声明的门禁条目。
 * @returns 运行计划（已解析条目 + 告警）。
 * @throws StructuralGateConfigError - 有条目声明 `strict` 且无法按其声明生效时；
 * 消息逐条列出全部这样的条目，一次报全而不是只报第一条。
 */
export function resolveStructuralGate(
  ruleSet: RuleSet,
  entries: readonly StructuralGateEntry[],
): StructuralGatePlan {
  const byId = new Map(ruleSet.rules.map(rule => [rule.id, rule]))
  const warnings: string[] = []
  const failures: string[] = []
  const resolved: ResolvedStructuralGateEntry[] = []
  for (const entry of entries) {
    const strict = entry.strict === true
    /** 严格声明记加载失败；其余保持原来的告警文案（外部部署据此人工核对）。 */
    const report = (detail: string, degraded: string): void => {
      if (strict) failures.push(`制品结构门禁 ${entry.tool}（strict）: ${detail}`)
      else warnings.push(`制品结构门禁 ${entry.tool}: ${detail}，${degraded}`)
    }
    if (entry.textArgs.length === 0) {
      report('未声明承载制品文本的 textArgs', '该条不生效')
      continue
    }
    const rules: ConstitutionalRule[] = []
    for (const id of entry.ruleIds) {
      const rule = byId.get(id)
      if (rule === undefined) {
        report(`规则集内不存在规则 ${id}`, '该条已忽略')
        continue
      }
      if (rule.action !== 'block') {
        report(`规则 ${id} 的 action 为 ${rule.action}，门禁只执行 block 级规则`, '该条不会拒绝调用')
      }
      rules.push(rule)
    }
    if (rules.length === 0) {
      report('没有可用规则', '该条不生效')
      continue
    }
    resolved.push({ entry, rules })
  }
  if (failures.length > 0) {
    throw new StructuralGateConfigError([
      '制品结构门禁声明无法按 strict 生效（规则资产改名或声明写错都会走到这里）：',
      ...failures,
    ].join('\n'))
  }
  return { entries: resolved, warnings }
}

/**
 * 对一次工具调用执行制品结构门禁，返回命中 block 级规则的违规。
 * @param plan - 运行计划。
 * @param tool - 本次调用的工具名。
 * @param args - 本次调用的入参。
 * @param synonyms - 同义词表（synonym_match 规则用；缺省空表）。
 * @returns block 级违规（无命中为空数组）。
 */
export function structuralGateViolations(
  plan: StructuralGatePlan,
  tool: string,
  args: unknown,
  synonyms?: SynonymMap,
): RuleViolation[] {
  const violations: RuleViolation[] = []
  for (const { entry, rules } of plan.entries) {
    if (entry.tool !== tool || !declaredArgsMatch(entry.whenArgs, args)) continue
    const text = structuralGateText(args, entry.textArgs)
    if (text.trim().length === 0) continue
    const evaluation = evaluateText(text, { rules }, synonyms)
    violations.push(...evaluation.violations.filter(violation => violation.action === 'block'))
  }
  return violations
}

/**
 * 渲染拒绝理由：模型据此知道该改什么，而不是只看到「被拒」。
 * @param tool - 被拒绝的工具名。
 * @param violations - 命中的 block 级违规。
 * @returns 模型可读的拒绝理由。
 */
export function renderStructuralGateDenial(tool: string, violations: readonly RuleViolation[]): string {
  const ids = [...new Set(violations.map(violation => violation.ruleId))].join(', ')
  const lines = violations.map((violation) => {
    const basis = violation.legalBasis === undefined ? '' : `（依据：${violation.legalBasis}）`
    return `- [${violation.ruleId}] ${violation.ruleName}：${violation.message}${basis}`
  })
  return [
    `制品结构门禁拒绝 ${tool}：制品文本命中强制规则 ${ids}。`,
    ...lines,
    '先把制品补齐再调用该工具；门禁判定的是本次调用入参里的制品文本。',
  ].join('\n')
}
