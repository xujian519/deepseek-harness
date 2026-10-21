/**
 * src/patent/checker — 规则门评估器端口。
 *
 * 规则门（图域子图的收口节点）只依赖本端口的语义，不绑定具体规则实现：
 * 调用方注入规则包的评估器（如 `@deepseek-ai/dsh-patent-rule` 的
 * `createCheckerRuleEvaluator()`）或测试替身。规则语料不随 patent-core 发布。
 * 未识别领域、空规则集与评估器异常一律 fail-closed（判 blocked），
 * 不以"没有规则可跑"作为通过。
 */

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
