/**
 * 内置 Pipeline 原子聚合（按职责分域，公共 LLM 骨架见 llm.ts）。
 *
 * - search.ts：search（检索）/ keywords（关键词生成）
 * - extract.ts：extract（结构化抽取）/ merge（PFE 融合）
 * - compare.ts：compare（特征对比）/ novelty（逐特征新颖性）
 * - reason.ts：reasoning（自由推理）/ groundedness（原文依据过滤）
 * - draft.ts：draft-claims（权利要求草稿）
 * - gate.ts：approval-gate（人机审批门）
 * - chart.ts：claim-chart（要素级证据网格）
 */

export {
  searchAtom,
  SearchHandler,
  keywordsAtom,
  KeywordsHandler,
} from './search.ts'
export {
  extractAtom,
  ExtractHandler,
  mergeAtom,
  MergeHandler,
  type PFETriple,
} from './extract.ts'
export {
  compareAtom,
  CompareHandler,
  noveltyAtom,
  NoveltyHandler,
  evidenceCoverage,
} from './compare.ts'
export {
  reasoningAtom,
  ReasoningHandler,
  groundednessAtom,
  GroundednessHandler,
  GROUNDEDNESS_THRESHOLD,
} from './reason.ts'
export { draftClaimsAtom, DraftClaimsHandler } from './draft.ts'
export {
  approvalGateAtom,
  ApprovalGateHandler,
  APPROVAL_GRANTED_KEY,
  APPROVAL_GRANTED_OUTPUT,
  isApprovalGateHandler,
} from './gate.ts'
export { claimChartAtom, ClaimChartHandler } from './chart.ts'
