/**
 * 宪法规则引擎 — 评估器。
 *
 * 对文本逐条执行规则检查，产出 RuleViolation[]。全部为确定性规则检查
 * （无 LLM 调用），用于输出门禁与工具拦截的底层判定。
 * @module @deepseek-ai/dsh-patent-rule/runtime/RuleEngine
 */

import type {
  ConstitutionalRule,
  KeywordBlocklistCheck,
  PatternAnalysisCheck,
  RuleEvaluation,
  RuleSeverity,
  RuleSet,
  RuleViolation,
  StructuralAnalysisCheck,
} from '@deepseek-ai/dsh-patent-core'
import { hasNegationContext, parseCnNumber } from '@deepseek-ai/dsh-patent-core'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { checkSynonymRequirements, type SynonymMap } from './synonym-engine.ts'

/** 证据截断长度。 */
const EVIDENCE_MAX = 80

function truncate(text: string): string {
  return text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX)}…` : text
}

/** 检查单个 keyword_blocklist 条目（"a|b|c" OR 组），返回证据。 */
function checkKeywordEntry(
  entry: string,
  text: string,
  negationContext: boolean,
  adjacentWords: readonly string[] | undefined,
): string[] {
  const alternatives = entry
    .split('|')
    .map(s => s.trim())
    .filter(s => s.length > 0)
  if (alternatives.length === 0) return []
  const evidence: string[] = []
  // 默认否定词表由 hasNegationContext 自己填，这里只补领域前缀表；可选属性在
  // exactOptionalPropertyTypes 下不接受显式 undefined，故按需构造一次（循环不变量）。
  const contextOptions = adjacentWords === undefined ? undefined : { adjacentWords }
  let searchFrom = 0
  let guard = 0
  while (searchFrom < text.length && guard < 200) {
    guard += 1
    let best: { index: number; word: string } | null = null
    for (const word of alternatives) {
      const index = text.indexOf(word, searchFrom)
      if (index >= 0 && (best === null || index < best.index)) best = { index, word }
    }
    if (best === null) break
    if (!negationContext || !hasNegationContext(text, best.index, contextOptions)) {
      evidence.push(best.word)
    }
    searchFrom = best.index + best.word.length
  }
  return evidence
}

function checkKeywordBlocklist(check: KeywordBlocklistCheck, text: string): string[] {
  // 两个键正交：`negationContext` 是唯一的开关，`additionalNegationWords` 只提供词。
  // 「声明了词却没开开关」由 RuleLoader 的加载校验与补丁路径告警（不在这里静默开启，
  // 否则 `negationContext: false` + 词表这种自相矛盾的组合会变成"词表说了算"，读代码看不出来谁生效）。
  // 领域词走 adjacentWords（紧邻前缀）而非并入 DEFAULT_NEGATION_WORDS：后者是**全局**词表，
  // 并入会同时放大所有否定语境规则（PAT-RISK-001 / PAT-ABS-001 / INV-EVIDENCE-001 …）
  // 的放行面，且 24 字窗口会让「防」这类单字前缀对窗口内任意命中生效。
  const negationContext = check.negationContext === true
  const evidence: string[] = []
  for (const entry of check.keywords) {
    evidence.push(
      ...checkKeywordEntry(entry, text, negationContext, check.additionalNegationWords),
    )
  }
  return evidence
}

function checkPatternAnalysis(check: PatternAnalysisCheck, text: string): string[] {
  const minMatches = check.minMatches ?? 1
  const evidence: string[] = []
  for (const pattern of check.patterns) {
    let count = 0
    const matches: string[] = []
    try {
      const regex = new RegExp(pattern, 'gi')
      let match: RegExpExecArray | null
      while ((match = regex.exec(text)) !== null) {
        const fullMatch = match[0]
        count += 1
        if (matches.length < 4) matches.push(fullMatch)
        if (fullMatch.length === 0) regex.lastIndex += 1
      }
    } catch {
      // 非法正则已在加载期拦截；此处防御性跳过
    }
    // 禁止模式语义：命中次数达到 minMatches 才判定违规
    if (count >= minMatches) {
      evidence.push(...matches)
    }
  }
  return evidence
}

function checkStructuralAnalysis(
  check: StructuralAnalysisCheck,
  text: string,
): { confidence: number; missing: string[] } {
  let hit = 0
  const missing: string[] = []
  for (const element of check.requiresAll) {
    const matched = element.patterns.some((pattern) => {
      try {
        return new RegExp(pattern, 'i').test(text)
      } catch {
        return false
      }
    })
    if (matched) {
      hit += 1
    } else {
      missing.push(element.element)
    }
  }
  const total = check.requiresAll.length
  return { confidence: total === 0 ? 1 : hit / total, missing }
}

/** 提取法条引用（R1 存在性检查用）："专利法第N条" / "专利法实施细则第N条"（N 支持中文数字）。 */
const CITATION_RE = /(专利法实施细则|专利法)第\s*([0-9零一二三四五六七八九十百]+)\s*条/g

function checkCitationAnalysis(
  check: { type: 'citation_analysis'; statutes: Record<string, { max: number; topics?: Record<number, string[]> }> },
  text: string,
): string[] {
  const evidence: string[] = []
  let match: RegExpExecArray | null
  while ((match = CITATION_RE.exec(text)) !== null) {
    const fullMatch = match[0]
    const articleText = match[2]
    /* v8 ignore next -- the citation regex always captures a non-empty article group. */
    if (articleText === undefined) break
    const statuteName = match[1] === '专利法实施细则' ? '专利法实施细则' : '专利法'
    const article = parseCnNumber(articleText)
    if (article === null) continue
    const statute = check.statutes[statuteName]
    if (statute !== undefined && article > statute.max) {
      evidence.push(fullMatch)
    }
  }
  return evidence
}

/**
 * 构造置信度不足的违规消息；达到阈值时返回 null（不违规）。
 * @param noun - 要素类别名词（"结构" / "同义"）。
 * @param confidence - 实际置信度（0..1）。
 * @param missing - 缺失要素清单。
 * @param minConfidence - 置信度阈值。
 * @returns 违规消息；达到阈值时为 null。
 */
function confidenceViolation(noun: string, confidence: number, missing: string[], minConfidence: number): string | null {
  if (confidence >= minConfidence) return null
  return `${noun}要素不完整：缺失 ${missing.join('、')}（置信度 ${(confidence * 100).toFixed(0)}% < ${(minConfidence * 100).toFixed(0)}%）`
}

/** evaluateText 可选评估选项。 */
export type EvaluateTextOptions = {
  /**
   * 领域过滤（分层规则包与作业 scope 场景）：单个域或域列表；已声明 `domain`
   * 且不在其中的规则跳过，未声明 `domain` 的规则（通用规则）始终评估。
   * 空串与空数组等同于不过滤。缺省不过滤（向后兼容）。
   */
  domain?: string | readonly string[]
}

/** 归一化域过滤参数：undefined / "" / 空数组 → 不过滤；单字符串 → 单元素数组。 */
function normalizeDomains(rawDomain: string | readonly string[] | undefined): readonly string[] {
  if (rawDomain === undefined || rawDomain === '') return []
  return typeof rawDomain === 'string' ? [rawDomain] : rawDomain
}

/**
 * 评估一段文本，返回全部违规（synonyms 为同义词表，供 synonym_match 检查；缺省空表）。
 * @param text - 待评估文本。
 * @param ruleSet - 规则集。
 * @param synonyms - 同义词表（缺省空表）。
 * @param options - 可选评估选项（领域过滤）。
 * @returns 评估结果（含全部违规）。
 */
export function evaluateText(
  text: string,
  ruleSet: RuleSet,
  synonyms?: SynonymMap,
  options?: EvaluateTextOptions,
): RuleEvaluation {
  const violations: RuleViolation[] = []
  const domains = normalizeDomains(options?.domain)
  for (const rule of ruleSet.rules) {
    if (domains.length > 0 && rule.domain && !domains.includes(rule.domain)) continue
    const found = evaluateRule(rule, text, synonyms)
    if (found !== null) violations.push(found)
  }
  return { violations }
}

/**
 * 评估单条规则；无违规返回 null。
 * @param rule - 待评估规则。
 * @param text - 待评估文本。
 * @param synonyms - 同义词表（synonym_match 检查用）。
 * @returns 违规对象，无违规为 null。
 */
export function evaluateRule(rule: ConstitutionalRule, text: string, synonyms?: SynonymMap): RuleViolation | null {
  const check = rule.check
  let evidence: string[] = []
  let message: string | null = null
  let severity: RuleSeverity = rule.severity

  switch (check.type) {
    case 'keyword_blocklist': {
      evidence = checkKeywordBlocklist(check, text)
      if (evidence.length === 0) return null
      severity = check.severityIfFound ?? rule.severity
      message = `命中禁止词：${[...new Set(evidence)].join('、')}`
      break
    }
    case 'pattern_analysis': {
      evidence = checkPatternAnalysis(check, text)
      if (evidence.length === 0) return null
      message = `命中禁止模式：${[...new Set(evidence)].slice(0, 4).join('、')}`
      break
    }
    case 'structural_analysis': {
      const { confidence, missing } = checkStructuralAnalysis(check, text)
      const violation = confidenceViolation('结构', confidence, missing, check.minConfidence ?? 1)
      if (violation === null) return null
      message = violation
      break
    }
    case 'citation_analysis': {
      evidence = checkCitationAnalysis(check, text)
      if (evidence.length === 0) return null
      message = `法条引用超出范围：${[...new Set(evidence)].join('、')}`
      break
    }
    case 'synonym_match': {
      const { confidence, missing } = checkSynonymRequirements(text, check.requirements, synonyms ?? new Map())
      const violation = confidenceViolation('同义', confidence, missing, check.minConfidence ?? 1)
      if (violation === null) return null
      message = violation
      break
    }
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new check type here. */
    default:
      assertNever(check, 'rule check type')
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    severity,
    action: rule.action,
    ...(rule.legalBasis !== undefined ? { legalBasis: rule.legalBasis } : {}),
    message,
    evidence: [...new Set(evidence)].map(truncate),
  }
}

/**
 * 便捷入口：按 action 分组违规（block / review / warn / log）。
 * @param evaluation - 评估结果。
 * @returns 按 action 分组的违规映射。
 */
export function groupByAction(evaluation: RuleEvaluation): Record<string, RuleViolation[]> {
  const grouped: Record<string, RuleViolation[]> = { block: [], review: [], warn: [], log: [] }
  for (const violation of evaluation.violations) {
    (grouped[violation.action] ??= []).push(violation)
  }
  return grouped
}
