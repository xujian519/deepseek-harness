/**
 * src/checker — checker 规则集的 `RuleEvaluator` 端口实现。
 *
 * 规则语料随本包发布，评估引擎与端口语义由 `@deepseek-ai/dsh-patent-core`
 * 提供；patent-core 不再内置任何规则，规则门由调用方注入本实现。
 */

import { aggregate, RuleEngine } from '@deepseek-ai/dsh-patent-core'
import type { RuleEvaluator } from '@deepseek-ai/dsh-patent-core'
import { defaultPatentRules } from './rules.ts'

/** checker 规则评估器标识。 */
export const CHECKER_RULE_EVALUATOR_ID = 'patent-rule:checker-rules'

/**
 * 构造基于 checker 71 条规则（47 条场景规则 + 24 条推理模式规则）的评估器。
 * @returns 规则门可注入的评估器；领域列表由规则自身的 `domain` 去重得出。
 */
export function createCheckerRuleEvaluator(): RuleEvaluator {
  const rules = defaultPatentRules()
  // 空域规则（引擎语义：对所有域生效）不构成可声明的支持域。
  const declared = new Set(rules.map(rule => rule.domain))
  declared.delete('')
  const engine = new RuleEngine()
  engine.registerMany(rules)
  return {
    id: CHECKER_RULE_EVALUATOR_ID,
    domains: [...declared],
    evaluate: ({ text, domains: requested }) => {
      const requestedWithGlobal = new Set(['', ...requested])
      const applicable = rules.filter(rule => requestedWithGlobal.has(rule.domain))
      const failures = engine.evaluate(text, { domain: requested })
      return { verdict: aggregate(failures), failures, evaluatedRules: applicable.length }
    },
  }
}
