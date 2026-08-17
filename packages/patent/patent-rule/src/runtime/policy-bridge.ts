/**
 * 宪法规则引擎 — 工具拦截通道（policy-bridge）。
 *
 * 把规则的 block 级检查编译为 deny 规则（source: "policy", behavior: "deny"），
 * 供下游工具拦截策略优先执行（deny 检查位于最前，且 policy 来源不会被 session
 * allow 覆盖）。
 *
 * 当前支持：keyword_blocklist 规则 → `text:` 前缀模式（对工具输入序列化文本做
 * 关键词包含匹配）。negationContext（否定语境）语义复杂，默认跳过以免误拦截
 * （可显式开启）。
 *
 * ⚠️ 接线状态：本函数为纯函数，未接入生产路径——dsh 侧的工具拦截经
 * ctx.tools.guard()（单调 deny，见 src/guard/evidenceComplianceGuards.ts）与
 * tools/post-execute 输出门禁接线，而非把结果注入 PermissionContext；接线前勿
 * 依赖本函数的编译结果。
 * @module @deepseek-ai/dsh-patent-rule/runtime/policy-bridge
 */

import type { RuleAction, RuleSet } from '@deepseek-ai/dsh-patent-core'

/** 编译出的 policy deny 规则（对齐 Sati PermissionRule 的 deny 形态）。 */
export type PolicyDenyRule = {
  source: 'policy'
  behavior: 'deny'
  toolName: string
  pattern: string
}

/** 与 matchPermissionRule 的 TEXT_PATTERN_PREFIX 保持一致。 */
const TEXT_PREFIX = 'text:'

export type RulesToPolicyOptions = {
  /** 规则生效的工具名通配（默认 "*" 匹配全部工具）。 */
  toolNamePattern?: string
  /** 参与编译的 action（默认仅 block）。 */
  includeActions?: RuleAction[]
  /** 是否包含 negationContext 规则（默认 false，避免误拦截否定性描述）。 */
  includeNegationContext?: boolean
  /** 单条规则最多编译的关键词数（控制 pattern 长度，默认 16）。 */
  maxKeywordsPerRule?: number
}

export type RulesToPolicyResult = {
  /** 编译出的 policy deny 规则。 */
  rules: PolicyDenyRule[]
  /** 未编译的规则及原因（供审计/文档）。 */
  skipped: { ruleId: string; reason: string }[]
}

/** 拍平 keyword_blocklist 的 OR 组（"a|b|c" → a,b,c），去重保序。 */
function flattenKeywords(keywords: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of keywords) {
    for (const keyword of entry.split('|')) {
      const trimmed = keyword.trim()
      if (trimmed.length === 0 || seen.has(trimmed)) continue
      seen.add(trimmed)
      out.push(trimmed)
    }
  }
  return out
}

/** 把规则集的 block 级 keyword_blocklist 规则编译为 policy deny 规则。 */
export function rulesToPolicyDenyRules(ruleSet: RuleSet, options?: RulesToPolicyOptions): RulesToPolicyResult {
  const toolNamePattern = options?.toolNamePattern ?? '*'
  const includeActions = options?.includeActions ?? ['block']
  const includeNegationContext = options?.includeNegationContext ?? false
  const maxKeywords = options?.maxKeywordsPerRule ?? 16

  const rules: PolicyDenyRule[] = []
  const skipped: RulesToPolicyResult['skipped'] = []

  for (const rule of ruleSet.rules) {
    if (!includeActions.includes(rule.action)) {
      skipped.push({ ruleId: rule.id, reason: `action=${rule.action} 不在编译范围` })
      continue
    }
    if (rule.check.type !== 'keyword_blocklist') {
      skipped.push({ ruleId: rule.id, reason: `check.type=${rule.check.type} 暂不支持工具拦截` })
      continue
    }
    if (rule.check.negationContext === true && !includeNegationContext) {
      skipped.push({ ruleId: rule.id, reason: 'negationContext 语义复杂，默认跳过（可 includeNegationContext 开启）' })
      continue
    }
    const keywords = flattenKeywords(rule.check.keywords)
    if (keywords.length === 0) {
      skipped.push({ ruleId: rule.id, reason: 'keywords 为空' })
      continue
    }
    const selected = keywords.slice(0, maxKeywords)
    rules.push({
      source: 'policy',
      behavior: 'deny',
      toolName: toolNamePattern,
      pattern: `${TEXT_PREFIX}${selected.join('|')}`,
    })
  }

  return { rules, skipped }
}
