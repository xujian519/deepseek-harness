/**
 * Pure TypeScript library (no ctx dependency) holding the patent-domain engines
 * ported from Sati: the atoms StageProvider/StageHandler vocabulary, the
 * ModelPort LLM adapter, the constitutional rule protocol types + text
 * utilities, the dual-track checker rule engine, the problem atomization
 * checks, the evidence closed-loop ledger/engine, the structured reasoning
 * primitives, the claim-chart engine, the claim-drafting self-checks (claim unity
 * and the claim-to-embodiment coverage matrix), the controlled draft model
 * (SpecDraft/TemplateDraft) with its validators for the patent deliverable tools,
 * the IPC classifier/standards
 * lookup, and the persistence/path helpers.
 * @module @deepseek-ai/dsh-patent-core
 */

// Patent-domain model port contract + adapter.
export type {
  PatentModelEvent,
  PatentModelMessage,
  PatentModelPort,
  PatentModelRequest,
  PatentModelUsage,
  StageProvider,
  StageSearchHit,
} from './types.ts'
export { collectPortText, createLlmModelPort } from './model-port.ts'
export type { CreateLlmModelPortOptions } from './model-port.ts'

// LLM JSON tolerant parsing + the shared JSON-value narrowing guards.
export {
  asJsonArray,
  asJsonRecord,
  isJsonRecord,
  parseJsonRecordArray,
  parseJsonStringArray,
  parseOptionalJsonStringArray,
  readJsonNumber,
  readJsonString,
  readJsonStringArray,
  stripCodeFence,
  tryParseJson,
  type JsonRecordArrayResult,
  type JsonStringArrayResult,
} from './llm-json.ts'

// Controlled draft model + validation: the model submits structured drafts
// (no HTML); converters generate headings and tables from the structure.
export {
  DraftValidationError,
  SPEC_PART_HEADINGS,
  SPEC_PART_ORDER,
  formatTableCaption,
  numberedFigureDescriptions,
  validateSpecDraft,
  validateTemplateDraft,
} from './draft/index.ts'
export type {
  DraftBlock,
  DraftGroundItem,
  NumberedFigureDescription,
  SpecDraft,
  SpecDraftMeta,
  SpecPartId,
  TemplateChoiceOption,
  TemplateDraft,
  TemplateDraftSchema,
  TemplateDraftSection,
  TemplateFieldSlot,
  TemplateSectionSlot,
} from './draft/index.ts'

// Prompt-injection isolation for untrusted text spliced into LLM prompts.
export { dataBlock } from './prompt-hygiene.ts'

// Constitutional rule engine protocol types + text utilities.
export type {
  CitationAnalysisCheck,
  ConstitutionalRule,
  KeywordBlocklistCheck,
  LoadedRuleSet,
  NoticeGroundCoverageCheck,
  PatternAnalysisCheck,
  QuoteRepetitionCheck,
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
  UnraisedStatuteCitationCheck,
} from './rule/types.ts'
export {
  DEFAULT_NEGATION_WINDOW,
  DEFAULT_NEGATION_WORDS,
  hasNegationContext,
  locateMatch,
  locationAt,
  parseCnNumber,
  runeSlice,
} from './rule/text-utils.ts'
export type { MatchLocation, NegationContextOptions } from './rule/text-utils.ts'

// Atoms: the StageProvider/StageHandler vocabulary and the builtin handlers.
export type * from './atoms/index.ts'
export {
  APPROVAL_GRANTED_KEY,
  APPROVAL_GRANTED_NODES_KEY,
  APPROVAL_GRANTED_OUTPUT,
  AmendmentBasisHandler,
  ApprovalGateHandler,
  AtomRegistry,
  AtomRegistryError,
  CitationCheckHandler,
  ClaimChartHandler,
  CompareHandler,
  ConflictingApplicationHandler,
  DEGRADED_ERROR_KEY,
  DEGRADED_RETRYABLE_KEY,
  DraftClaimsHandler,
  EvidenceCheckHandler,
  ExtractHandler,
  GROUND_PROGRAMS,
  GroundednessHandler,
  InterruptStageError,
  KeywordsHandler,
  ListAtoms,
  LookupStageHandler,
  NoveltyHandler,
  NumericRangeHandler,
  PFE_CONSISTENCY_VIOLATION_IDS,
  PriorArtFilterHandler,
  ProblemCheckHandler,
  ReasoningHandler,
  RegisterAtom,
  SearchHandler,
  StageCancelledError,
  StageHandlerRegistry,
  TimeBaselineHandler,
  amendmentBasisAtom,
  approvalGateAtom,
  checkPfeConsistency,
  citationCheckAtom,
  claimChartAtom,
  compareAtom,
  conflictingApplicationAtom,
  degraded,
  deriveOfficeActionTargets,
  evidenceCheckAtom,
  evidenceCoverage,
  extractAtom,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  groundsAtom,
  isApprovalGateHandler,
  isGateApproved,
  isInterruptStageError,
  isStageCancelledError,
  numericRangeAtom,
  priorArtFilterAtom,
  problemCheckAtom,
  registerBuiltinAtoms,
  searchAtom,
  timeBaselineAtom,
} from './atoms/index.ts'

// Claim-chart engine (element validation / mapping / gap / pin-cite / store).
export type * from './claim-chart/index.ts'
export {
  DRAFT_NOTICE,
  chartFileBase,
  deriveClaimRefs,
  deriveDistinguishingFeatures,
  deriveInvalidityConclusion,
  deriveNoveltyCoverage,
  deriveNoveltyCoverageByClaim,
  detectGaps,
  loadClaimChart,
  normalizeWhitespace,
  parseReferenceNumbers,
  referencedClosure,
  renderChartMarkdown,
  renderInvalidityConclusion,
  saveClaimChart,
  splitClaimSegments,
  validateClaimRefs,
  validateElements,
  validatePinCite,
  validateRowMapping,
  verifyQuoteInSource,
} from './claim-chart/index.ts'

// Claim-drafting self-checks: claim unity (A31.1) and the claim-to-embodiment coverage matrix.
export type * from './claim-coverage/index.ts'
export {
  checkClaimUnity,
  checkEmbodimentCoverage,
} from './claim-coverage/index.ts'

// Patent analysis product contract + deterministic aggregator (Athena-inspired report).
export type * from './analysis-report/index.ts'
export {
  buildAnalysisReport,
  computeClarityScore,
  computeCompletenessScore,
  computeFeatureStatistics,
  determineFeatureType,
  determineImportance,
  extractTechnicalFeatures,
  mergeScores,
  toIpcSummary,
} from './analysis-report/index.ts'

// Dual-track deterministic checker (novelty/inventiveness/infringement/...).
export type * from './checker/index.ts'
export {
  DIM_CLARITY,
  DIM_CONSISTENCY,
  DIM_ESSENTIAL,
  DIM_SUPPORT,
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
  LevelMust,
  LevelQuality,
  LevelShould,
  RuleEngine,
  SPEC_COMMERCIAL_BAN_PHRASES,
  SPEC_SCOPE_BAN_PHRASES,
  SPEC_SECTION_TERMS,
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
  aggregate,
  formatRuleResults,
  matchKeyword,
  matchKeywordsAll,
  matchKeywordsAny,
} from './checker/index.ts'

// Atomic technical-problem checks (creative-analysis three-step step 2).
export type * from './problem/index.ts'
export {
  checkAtomic,
  extractTechnicalProblem,
  technicalProblemCheck,
} from './problem/index.ts'

// TRIZ contradiction analysis for the inventor side: disclosure gaps and
// candidate solution directions. Never a three-step-step-2 problem statement.
export type * from './triz/index.ts'
export {
  buildTrizAnalysis,
  extractTrizContradictions,
} from './triz/index.ts'

// Evidence closed-loop: receipt ledger, spans, binding, conflict, judgment engine.
export type * from './evidence/index.ts'
export {
  ClaimBinding,
  ConflictDetector,
  EVIDENCE_SNIPPET_LIMIT,
  EvidenceEngine,
  EvidenceExtension,
  Ledger,
  STANDARD_CLEAR_CONVINCING,
  STANDARD_PREPONDERANCE,
  buildWorkflowEvidenceLedger,
  contentHash,
  createSpan,
  credibilityToScore,
  determinePublicationDate,
  evaluatePublicIntent,
  extractDateFromText,
  extractWaybackMachineDate,
  inferEvidenceType,
  inferredMonthEnd,
  isBeforeReferenceDate,
  isLocatable,
  isMonthOnlyDate,
  isPreciseDate,
  loadEvidenceRulesEngine,
  parseDateFlexible,
  platformCategory,
  platformCredibility,
  priorArtReference,
  receiptFromToolExecution,
} from './evidence/index.ts'

// Structured reasoning primitives: fact blackboard + syllogism.
export type * from './reasoning/index.ts'
export {
  ConfirmedRuleSet,
  FactBlackboard,
  SyllogismBuilder,
  SyllogismError,
  assertChain,
  ruleAssertion,
} from './reasoning/index.ts'

// Persistence + path helpers (single home; re-exported by dsh-patent-data).
export { JsonFileStore, SAFE_ID_PATTERN, assertSafeId, assertSafePathSegment, atomicWriteJson } from './persist-utils.ts'
export {
  CASE_OUTPUTS_REL,
  CASE_ROOT_REL,
  CASE_WORKFLOW_RUNS_REL,
  caseOutputsDir,
  caseWorkflowRunsDir,
} from './paths.ts'

// Shared conventions of the two PDF download tools (body verification + dated output dir).
export {
  MIN_PDF_BYTES,
  PDF_MAGIC,
  datedOutputDir,
  inspectPdfBody,
  isHtmlContentType,
  resolveDatedOutputDir,
} from './pdf-download.ts'
export type { PdfBodyFault } from './pdf-download.ts'

// IPC classification + examination-standard lookup.
export {
  DEFAULT_IPC_CONFIDENCE,
  DEFAULT_IPC_SECTION,
  HIGH_CONFIDENCE_THRESHOLD,
  IPC_DETAIL_DOMAINS,
  IPC_DETAIL_MIN_CONFIDENCE,
  IPC_DOMAINS,
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
export type * from './graph/index.ts'
export {
  absorbHandlerDegradation,
  CompiledGraph,
  DEGRADATION_SUFFIX,
  DOMAIN_GRAPHS,
  GRAPH_END,
  GraphBuilder,
  GraphEngineError,
  GraphInterruptError,
  GraphMergeError,
  InMemoryCheckpointStore,
  JsonFileCheckpointStore,
  buildCitationCheckGraph,
  buildEnablementGraph,
  buildInventivenessGraph,
  buildNoveltyGraph,
  checkCitations,
  cloneState,
  collectStateText,
  degradationSummary,
  detectTechnicalDomain,
  evaluateRuleGate,
  extractCitationCheckResult,
  extractCitationIds,
  extractDocIds,
  extractEnablementResult,
  extractInventivenessResult,
  getDegradationMark,
  grantApproval,
  handlerNode,
  isDegraded,
  isGraphInterruptError,
  manifestToGraph,
  markDegraded,
  mergeWithSchema,
  requireRuleEvaluator,
  ruleGateNode,
  runGraphWithCheckpoints,
  runNodeWithPolicy,
  runStageHandler,
} from './graph/index.ts'

// Deterministic numeric-range novelty check, run beside the LLM semantic track.
export type * from './novelty/index.ts'
export {
  NUMERIC_RANGE_SEPARATOR_CLASS,
  NUMERIC_UNIT_ALTERNATION,
  analyzeNumericRanges,
  extractNumericFindings,
  extractNumericRanges,
  isNumericVerdict,
  normalizeNumericUnit,
  readNumericVerdict,
} from './novelty/index.ts'

// Deterministic parsers for procedure documents (office action, invalidation /
// reexamination / design grounds).
export type * from './notice/index.ts'
export {
  REJECTION_ORDER,
  REJECTION_SHORT_LABELS,
  extractCitations,
  formatOfficeActionSummary,
  identifyInvalidationGrounds,
  parseOfficeAction,
} from './notice/index.ts'

// Response preparation: per-claim amendment plan for an office action and the
// reexamination preparation sections.
export type * from './response/index.ts'

// Deterministic infringement kernel: all-elements coverage, equivalence
// consistency, weighted risk grading.
export type * from './infringement/index.ts'
export {
  deriveAllElementsCoverage,
  deriveInfringementConclusion,
} from './infringement/index.ts'

// The atoms barrel and the graph barrel both re-export the structurally identical
// state readers getStateString / getStateArray; pin the atoms copies so the
// star-export collision does not silently drop them from this package's surface.
export { getStateString, getStateArray } from './atoms/handler.ts'

// Workflow manifest contract, pre-positioned so the graph adapter (manifestToGraph)
// has no dependency on the P3.1 workflow executor. The runWorkflow executor and
// builtin manifests land in dsh-patent-workflow and re-import these from here.
export { validateWorkflowManifest } from './workflow/manifest.ts'
export { countWorkflowLlmStages, validateWorkflowBudget } from './workflow/budget.ts'
export type { WorkflowStageBudget } from './workflow/budget.ts'
export { compileSignal, signalMatches } from './workflow/signal.ts'
export { clearStageOutputs } from './workflow/stage-outputs.ts'
export type { ClearStageOutputsOptions } from './workflow/stage-outputs.ts'
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
