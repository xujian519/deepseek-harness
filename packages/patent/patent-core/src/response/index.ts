/**
 * src/patent/response — 答复与复审请求的准备段 barrel。
 *
 * - strategy.ts：答复策略、修改动作、意见陈述段落、法条依据四张闭集对照表。
 * - plan.ts：由通知书解析结果拼装答复计划（逐理由段落 + 逐权项修改对照 + 缺口）。
 * - reexamination.ts：复审四段准备（对比表、A33 论证、质疑预演、口审时间线）。
 *
 * 三个文件都不调用模型：输出是必须逐项落实的结构化骨架与缺口，不是答复正文，也不对
 * 缺陷是否成立、修改是否足以克服缺陷作判断。
 */

export {
  AMENDMENT_ACTION_LABELS,
  REJECTION_AMENDMENT_ACTIONS,
  REJECTION_BASIS,
  REJECTION_SECTIONS,
  REJECTION_STRATEGY,
  STRATEGY_LABELS,
  isAmendmentStrategy,
  strategiesFor,
  summarizeStrategies,
  type AmendmentAction,
  type ResponseStrategy,
} from './strategy.ts'

export {
  buildResponsePlan,
  type ClaimAmendmentRow,
  type ResponsePlan,
  type ResponsePlanGap,
  type ResponsePlanGapKind,
  type ResponsePlanOptions,
  type ResponsePlanSection,
} from './plan.ts'

export {
  AMENDMENT_COMPARISON_TABLE,
  AMENDMENT_NON_EXTENSION_BASIS,
  AMENDMENT_NON_EXTENSION_ITEMS,
  CHALLENGE_QUESTIONS,
  GROUND_ARGUMENT_ACTIONS,
  TECH_COMPARISON_TABLE,
  buildReexaminationPreparation,
  type HearingPhase,
  type PrepTable,
  type RehearsalChallenge,
  type ReexaminationPrepOptions,
  type ReexaminationPreparation,
  type ReexaminationSection,
} from './reexamination.ts'
