/**
 * src/patent/checker — 规则门评估器端口。
 *
 * 规则门（图域子图的收口节点）只依赖本端口的语义，不绑定具体规则实现：
 * 调用方可注入 checker 默认规则评估器、其他规则包的适配器或测试替身。
 * 未识别领域、空规则集与评估器异常一律 fail-closed（判 blocked），
 * 不以"没有规则可跑"作为通过。
 */

import { aggregate, RuleEngine } from './engine.ts'
import { defaultPatentRules } from './rules.ts'
import type { RuleCheckResult, Verdict } from './types.ts'

/** 规则门评估请求。 */
export interface RuleGateRequest {
  /** 待评估文本（由规则门从声明的来源键汇总）。 */
  text: string
  /** 本次评估声明的领域；空列表是配置错误，规则门拒绝放行。 */
  domains: readonly string[]
}

/** 规则门评估结论。 */
export interface RuleGateAssessment {
  /** 聚合判级。 */
  verdict: Verdict
  /** 全部失败规则。 */
  failures: RuleCheckResult[]
  /**
   * 本次实际参与评估的规则条数。0 表示声明领域内没有规则可跑
   * （规则集为空或领域配置错误），规则门据此 fail-closed。
   */
  evaluatedRules: number
}

/**
 * 可注入规则门的确定性评估器。
 *
 * `domains` 声明评估器认识的领域；规则门对未声明的请求领域 fail-closed。
 * 省略 `domains` 表示评估器自行处理任意领域（通用适配器/测试替身）。
 */
export interface RuleEvaluator {
  /** 评估器标识，写入 `rule_gate_evaluator` 供审计与回归定位。 */
  readonly id: string
  /** 支持的规则领域；省略表示不限制。 */
  readonly domains?: readonly string[]
  /**
   * 评估文本并返回失败规则与聚合判级。
   * @param request - 待评估文本与声明领域（领域非空且已通过规则门校验）。
   * @returns 失败规则、聚合判级与实际评估的规则条数。
   */
  evaluate(request: RuleGateRequest): RuleGateAssessment
}

/** 默认 checker 评估器标识。 */
export const DEFAULT_RULE_EVALUATOR_ID = 'checker:default'

/**
 * 构造过渡期默认评估器：checker 内置 71 条规则 + 聚合判级。
 * patent-rule 的规则集适配器接管后，调用方应显式注入并删除本默认值。
 * @returns 基于 checker 默认规则集的评估器。
 */
export function createDefaultRuleEvaluator(): RuleEvaluator {
  const rules = defaultPatentRules()
  // 空域规则（引擎语义：对所有域生效）不构成可声明的支持域。
  const declared = new Set(rules.map(rule => rule.domain))
  declared.delete('')
  const engine = new RuleEngine()
  engine.registerMany(rules)
  return {
    id: DEFAULT_RULE_EVALUATOR_ID,
    domains: [...declared],
    evaluate: ({ text, domains: requested }) => {
      const requestedWithGlobal = new Set(['', ...requested])
      const applicable = rules.filter(rule => requestedWithGlobal.has(rule.domain))
      const failures = engine.evaluate(text, { domain: requested })
      return { verdict: aggregate(failures), failures, evaluatedRules: applicable.length }
    },
  }
}
