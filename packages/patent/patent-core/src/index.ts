/**
 * Pure TypeScript library (no ctx dependency) holding the patent-domain engines
 * ported from Sati: the atoms StageProvider/StageHandler vocabulary, the
 * ModelPort LLM adapter, the constitutional rule protocol types + text
 * utilities, the dual-track checker rule engine, the problem atomization
 * checks, the evidence closed-loop ledger/engine, the structured reasoning
 * primitives, the claim-chart engine, the IPC classifier/standards lookup, and
 * the persistence/path helpers.
 * @module @deepseek-ai/dsh-patent-core
 */

// Patent-domain model port contract + adapter.
export type {
  PatentModelEvent,
  PatentModelMessage,
  PatentModelPort,
  PatentModelRequest,
  StageProvider,
  StageSearchHit,
} from './types.ts'
export { collectPortText, createLlmModelPort } from './model-port.ts'
export type { CreateLlmModelPortOptions } from './model-port.ts'

// LLM JSON tolerant parsing.
export { stripCodeFence, tryParseJson } from './llm-json.ts'

// Constitutional rule engine protocol types + text utilities.
export type {
  CitationAnalysisCheck,
  ConstitutionalRule,
  KeywordBlocklistCheck,
  LoadedRuleSet,
  PatternAnalysisCheck,
  RuleAction,
  RuleCheck,
  RuleCheckType,
  RuleEvaluation,
  RuleOutputGate,
  RuleOutputGateResult,
  RuleSet,
  RuleSetValidationIssue,
  RuleSeverity,
  RuleViolation,
  StructuralAnalysisCheck,
  StructuralElement,
  SynonymMatchCheck,
  SynonymRequirement,
} from './rule/types.ts'
export {
  DEFAULT_NEGATION_WINDOW,
  DEFAULT_NEGATION_WORDS,
  hasNegationContext,
  parseCnNumber,
} from './rule/text-utils.ts'
export type { NegationContextOptions } from './rule/text-utils.ts'

// Atoms: the StageProvider/StageHandler vocabulary and the builtin handlers.
export * from './atoms/index.ts'

// Claim-chart engine (element validation / mapping / gap / pin-cite / store).
export * from './claim-chart/index.ts'

// Dual-track deterministic checker (novelty/inventiveness/infringement/...).
export * from './checker/index.ts'

// Atomic technical-problem checks (creative-analysis three-step step 2).
export * from './problem/index.ts'

// Evidence closed-loop: receipt ledger, spans, binding, conflict, judgment engine.
export * from './evidence/index.ts'

// Structured reasoning primitives: fact blackboard + syllogism.
export * from './reasoning/index.ts'

// Persistence + path helpers (single home; re-exported by dsh-patent-data).
export { JsonFileStore, SAFE_ID_PATTERN, assertSafeId, atomicWriteJson } from './persist-utils.ts'
export {
  CASE_OUTPUTS_REL,
  CASE_ROOT_REL,
  CASE_WORKFLOW_RUNS_REL,
  caseOutputsDir,
  caseWorkflowRunsDir,
} from './paths.ts'

// IPC classification + examination-standard lookup.
export {
  DEFAULT_IPC_CONFIDENCE,
  DEFAULT_IPC_SECTION,
  HIGH_CONFIDENCE_THRESHOLD,
  IPC_DETAIL_DOMAINS,
  IPC_DETAIL_MIN_CONFIDENCE,
  IPC_DOMAINS,
  MULTI_CLASSIFY_MIN_CONFIDENCE,
  classifyIpc,
  classifyIpcTop,
  getIpcDomain,
  isHighConfidence,
} from './ipc/ipc-classifier.ts'
export type { IpcDetailDomainMeta, IpcDomainMeta } from './ipc/ipc-classifier.ts'
export {
  formatStandardsAsContext,
  loadIpcStandards,
  queryByArticle,
  queryIpcDetail,
  queryIpcStandards,
  searchStandards,
} from './ipc/ipc-standards-loader.ts'
export type { IpcStandardsIndex } from './ipc/ipc-standards-loader.ts'
export type { IpcClassification, IpcStandardCard } from './ipc/types.ts'
// Graph engine (Pregel-style superstep) + the three patentability subgraphs.
export * from './graph/index.ts'

// The atoms barrel and the graph barrel both re-export the structurally identical
// state readers getStateString / getStateArray; pin the atoms copies so the
// star-export collision does not silently drop them from this package's surface.
export { getStateString, getStateArray } from './atoms/handler.ts'

// Workflow manifest contract, pre-positioned so the graph adapter (manifestToGraph)
// has no dependency on the P3.1 workflow executor. The runWorkflow executor and
// builtin manifests land in dsh-patent-workflow and re-import these from here.
export { validateWorkflowManifest } from './workflow/manifest.ts'
export { WorkflowError } from './workflow/types.ts'
export type {
  StageExecutor,
  WorkflowContext,
  WorkflowInterrupt,
  WorkflowManifest,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowRunStore,
  WorkflowStage,
  WorkflowStageResult,
  WorkflowStrategy,
} from './workflow/types.ts'
