/**
 * src/checker — checker 规则语料与规则门评估器实现。
 *
 * 语料（71 条）与评估器随本包发布；`RuleEvaluator` 端口、`RuleEngine` 与
 * 规则类型在 `@deepseek-ai/dsh-patent-core`。依赖方向保持 patent-rule → patent-core。
 */

export {
  CHECKER_RULE_EVALUATOR_ID,
  createCheckerRuleEvaluator,
} from './evaluator.ts'
export {
  defaultPatentRules,
  designRules,
  disclosureRules,
  infringementRules,
  inventivenessRules,
  invalidationRules,
  noveltyRules,
  priorityRules,
  publicAccessRules,
  reasoningPatternRules,
  reexaminationRules,
  specRules,
  subjectMatterRules,
} from './rules.ts'
