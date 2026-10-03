/**
 * 宪法规则引擎 — 制品结构门禁（pre-execute）。
 *
 * 「缺失即违规」的结构规则（structural_analysis / synonym_match）不能作用于工具结果
 * 全文：普通文本天然缺失大量期望要素，逐条报「要素不完整」不可用。它们的合法执行点是
 * **制品本身**，而制品的全文只出现在交付工具的调用入参里（如
 * `render_patent_document` 的 `sections`）。本模块把这类规则的判定放到工具调用之前：
 * 部署声明「哪个工具的哪个入参承载制品文本、用哪些规则判」，命中 block 级规则即拒绝
 * 该次调用，使不合格制品不会被渲染或落盘。
 *
 * 规则按 id 显式选择而非按域全选——域内规则的判据未必都适用于该制品形态（例如
 * `patent_claims` 域的 CON-301 判据是「清楚/简要/限定/必要技术特征」等评述词，普通
 * 权利要求草案天然不含）。声明了规则集里不存在的 id 时告警并忽略该条（fail-safe：
 * 不半截生效）。
 * @module @deepseek-ai/dsh-patent-rule/runtime/structural-gate
 */

import type { ConstitutionalRule, RuleSet, RuleViolation } from '@deepseek-ai/dsh-patent-core'
import { declaredArgsMatch, jsonRecord } from './args-match.ts'
import { evaluateText } from './RuleEngine.ts'

/** 一条制品结构门禁声明。 */
export type StructuralGateEntry = {
  /** 被门禁的交付工具名。 */
  tool: string
  /** 承载制品文本的入参名：字符串入参取其值，记录/数组入参取其全部字符串值。 */
  textArgs: string[]
  /** 参与判定的规则 id（取自全量规则集）；规则集里不存在的 id 告警并忽略。 */
  ruleIds: string[]
  /**
   * 精确匹配才生效的入参（如 `{ template: 'claims-spec' }`）：声明的每一项都与实际
   * 入参相等时该条才适用，用于同一个工具的不同制品形态各判各的规则。
   */
  whenArgs?: Record<string, string>
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
 * 故每条都进 warnings（调用方记录后仍需人工核对）。
 * @param ruleSet - 全量规则集。
 * @param entries - 部署声明的门禁条目。
 * @returns 运行计划（已解析条目 + 告警）。
 */
export function resolveStructuralGate(
  ruleSet: RuleSet,
  entries: readonly StructuralGateEntry[],
): StructuralGatePlan {
  const byId = new Map(ruleSet.rules.map(rule => [rule.id, rule]))
  const warnings: string[] = []
  const resolved: ResolvedStructuralGateEntry[] = []
  for (const entry of entries) {
    const rules: ConstitutionalRule[] = []
    for (const id of entry.ruleIds) {
      const rule = byId.get(id)
      if (rule === undefined) {
        warnings.push(`制品结构门禁 ${entry.tool}: 规则集内不存在规则 ${id}，该条已忽略`)
        continue
      }
      rules.push(rule)
    }
    if (rules.length === 0) {
      warnings.push(`制品结构门禁 ${entry.tool}: 没有可用规则，该条不生效`)
      continue
    }
    resolved.push({ entry, rules })
  }
  return { entries: resolved, warnings }
}

/**
 * 对一次工具调用执行制品结构门禁，返回命中 block 级规则的违规。
 * @param plan - 运行计划。
 * @param tool - 本次调用的工具名。
 * @param args - 本次调用的入参。
 * @returns block 级违规（无命中为空数组）。
 */
export function structuralGateViolations(
  plan: StructuralGatePlan,
  tool: string,
  args: unknown,
): RuleViolation[] {
  const violations: RuleViolation[] = []
  for (const { entry, rules } of plan.entries) {
    if (entry.tool !== tool || !declaredArgsMatch(entry.whenArgs, args)) continue
    const text = structuralGateText(args, entry.textArgs)
    if (text.trim().length === 0) continue
    const evaluation = evaluateText(text, { rules })
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
