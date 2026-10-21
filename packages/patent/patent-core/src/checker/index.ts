/**
 * src/patent/checker — dual-track 确定性规则检查引擎。
 *
 * 引擎与规则门端口随本包发布，规则语料由规则包提供（当前为
 * `@deepseek-ai/dsh-patent-rule` 的 71 条 checker 规则）。使用示例：
 * ```ts
 * import { RuleEngine, aggregate } from "./checker/index.ts";
 * const engine = new RuleEngine();
 * engine.registerMany(rules); // rules 由规则包注入
 * const failures = engine.evaluate(text, { domain: "patent_novelty" });
 * const verdict = aggregate(failures); // "pass" | "needs_revision" | "blocked"
 * ```
 */

export type {
  CheckRule,
  CheckType,
  RuleCheckResult,
  RuleEngineOptions,
  RuleLevel,
  Severity,
  Verdict,
} from './types.ts'
export { LevelMust, LevelQuality, LevelShould } from './types.ts'

export {
  RuleEngine,
  aggregate,
  formatRuleResults,
  matchKeyword,
  matchKeywordsAll,
  matchKeywordsAny,
} from './engine.ts'

export {
  type RuleEvaluator,
  type RuleGateAssessment,
  type RuleGateRequest,
} from './evaluator.ts'

export {
  TERM_CAN_USE,
  TERM_CLOSEST_PRIOR_ART,
  TERM_CLOSEST_PRIOR_ART_FULL,
  TERM_COMBINATION_HINT,
  TERM_COMBINATION_MOTIVATION,
  TERM_COMMON_KNOWLEDGE,
  TERM_DESIGN_PATENT,
  TERM_DIFF_FEATURES,
  TERM_DISTINGUISHING_FEATURES,
  TERM_ENABLE,
  TERM_ENABLEMENT,
  TERM_EXP_DATA,
  TERM_FILING_DATE,
  TERM_FUNCTIONAL_LIMIT,
  TERM_INTERNET_DISCLOSURE,
  TERM_INVENTIVENESS,
  TERM_MENTAL_ACTIVITY,
  TERM_NATURAL_LAW,
  TERM_NOVELTY,
  TERM_OBVIOUS,
  TERM_OVERALL_VISUAL,
  TERM_PERSON_SKILLED,
  TERM_PRIORITY,
  TERM_PRIORITY_DATE,
  TERM_PRIOR_ART,
  TERM_PRIOR_ART_DOC,
  TERM_PRODUCT_CATEGORY,
  TERM_PROTECTION_SCOPE,
  TERM_SCI_DISCOVERY,
  TERM_SUFFICIENT_DISCLOSURE,
  TERM_TECH_EFFECT,
  TERM_TECH_FEATURE,
  TERM_TECH_HINT,
  TERM_TECH_SOLUTION,
  TERM_USE_LIMIT,
  DOMAIN_AMENDMENT,
  DOMAIN_CLAIMS,
  DOMAIN_DESIGN,
  DOMAIN_DISCLOSURE,
  DOMAIN_EXAMINATION,
  DOMAIN_INFRINGEMENT,
  DOMAIN_INVALIDATION,
  DOMAIN_INVENTIVENESS,
  DOMAIN_NOVELTY,
  DOMAIN_REEXAMINATION,
  DOMAIN_SPEC,
  SPEC_COMMERCIAL_BAN_PHRASES,
  SPEC_SCOPE_BAN_PHRASES,
  SPEC_SECTION_TERMS,
  DIM_CONSISTENCY,
  DIM_CLARITY,
  DIM_ESSENTIAL,
  DIM_SUPPORT,
} from './constants.ts'
