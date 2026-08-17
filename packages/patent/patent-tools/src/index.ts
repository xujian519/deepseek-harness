/**
 * Function plugin registering the 23 model-facing patent tools ported from Sati:
 * search, metadata, legal status, case/wiki/kg knowledge queries, claim-chart,
 * drafting, specification validation, evidence judgment, rule check, figure
 * analysis, PDF download, chemical recognition, knowledge notes, and the
 * workflow/plan state machines. `render_patent_document` is owned by
 * @deepseek-ai/dsh-patent-document (its apply() registers it); this package
 * re-exports its factory but does not register it.
 * @module @deepseek-ai/dsh-patent-tools
 */

import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createLlmModelPort } from '@deepseek-ai/dsh-patent-core'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { KgStore, PatentKgAdapter, WikiCardLoader } from '@deepseek-ai/dsh-patent-knowledge'
import type { PatentKnowledge } from '@deepseek-ai/dsh-patent-knowledge'
import { candidateRuleDirs } from '@deepseek-ai/dsh-patent-rule'
import { createRenderPatentDocumentTool, renderDocumentResult } from '@deepseek-ai/dsh-patent-document'
import type { GenerateOptions, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import { resolveImageInputModalities } from './figure/image-capability.ts'
import { PatentToolError } from './error.ts'
import { createPatentSearchTool } from './tool/patent-search.ts'
import { createPatentMetadataTool } from './tool/patent-metadata.ts'
import { createPatentLegalStatusTool } from './tool/patent-legal-status.ts'
import { createPatentCaseSearchTool } from './tool/patent-case-search.ts'
import { createPatentWikiSearchTool } from './tool/patent-wiki-search.ts'
import { createPatentKgQueryTool } from './tool/patent-kg-query.ts'
import { createPatentEvalTool } from './tool/patent-eval.ts'
import { createClaimChartBuildTool } from './tool/claim-chart-build.ts'
import { createDraftClaimsTool } from './tool/draft-claims.ts'
import { createDraftSpecificationTool } from './tool/draft-specification.ts'
import { createValidateSpecificationTool } from './tool/validate-specification.ts'
import { createEvaluateEvidenceTool } from './tool/evaluate-evidence.ts'
import { createRuleCheckTool } from './tool/rule-check.ts'
import { createAnalyzePatentFigureTool } from './tool/analyze-patent-figure.ts'
import { createSearchPatentFigureTool } from './tool/search-patent-figure.ts'
import { createPatentPdfDownloadTool } from './tool/patent-pdf-download.ts'
import { createRecognizeChemicalStructureTool } from './tool/recognize-chemical-structure.ts'
import { createFlexiblePlanTool } from './tool/patent-flexible-plan.ts'
import { createPatentWorkflowTool } from './tool/patent-workflow.ts'
import { createPatentWorkflowRunTool } from './tool/patent-workflow-run.ts'
import { createPatentPlanTaskTool } from './tool/patent-plan-task.ts'
import { createPatentWorkerValidateTool } from './tool/patent-worker-validate.ts'
import { createKnowledgeNoteSaveTool } from './tool/knowledge-note-save.ts'

// ---- public library surface (factories + error + render_patent_document) ----
export { PatentToolError } from './error.ts'
export type { PatentToolErrorCode } from './error.ts'
export { checkImageCapability, resolveImageInputModalities } from './figure/image-capability.ts'
export type { ImageCapabilityDecision, ModelInfoQuery } from './figure/image-capability.ts'
export { createPatentSearchTool, baseNumber, dedupeByFamily } from './tool/patent-search.ts'
export type { PatentSearchInput, PatentSearchOutput, PatentSearchHitItem, PatentSearchDeps } from './tool/patent-search.ts'
export { createPatentMetadataTool } from './tool/patent-metadata.ts'
export type { PatentMetadataInput, PatentMetadataOutput, PatentMetadataDeps } from './tool/patent-metadata.ts'
export { createPatentLegalStatusTool } from './tool/patent-legal-status.ts'
export type { PatentLegalStatusInput, PatentLegalStatusOutput, PatentLegalStatusItem, PatentLegalStatusDeps } from './tool/patent-legal-status.ts'
export { createPatentCaseSearchTool } from './tool/patent-case-search.ts'
export type { PatentCaseSearchInput, PatentCaseSearchOutput, PatentCaseSearchDeps } from './tool/patent-case-search.ts'
export { createPatentWikiSearchTool, PATENT_WIKI_DIRS } from './tool/patent-wiki-search.ts'
export type { PatentWikiSearchInput, PatentWikiSearchOutput, PatentWikiSearchDeps, PatentWikiDir } from './tool/patent-wiki-search.ts'
export { createPatentKgQueryTool } from './tool/patent-kg-query.ts'
export type { PatentKgQueryInput, PatentKgQueryOutput, PatentKgHit, PatentKgNeighbor, PatentKgQueryDeps, KgAdapter } from './tool/patent-kg-query.ts'
export { createPatentEvalTool, evaluatePatentContent } from './tool/patent-eval.ts'
export type { PatentEvalInput, PatentEvalOutput, PatentEvalMode, PatentEvalDimension } from './tool/patent-eval.ts'
export { createClaimChartBuildTool } from './tool/claim-chart-build.ts'
export type { ClaimChartInput, ClaimChartOutput, ClaimChartTargetInput, ClaimChartBuildDeps } from './tool/claim-chart-build.ts'
export { createDraftClaimsTool, draftClaims, DOMAIN_KEYWORDS } from './tool/draft-claims.ts'
export type { DraftClaimsInput, DraftClaimsOutput, DraftedClaim, ClaimViolation, TechDomain, PatentType } from './tool/draft-claims.ts'
export { createDraftSpecificationTool, draftSpecification } from './tool/draft-specification.ts'
export type { DraftSpecificationInput, DraftSpecificationOutput, SpecificationSection } from './tool/draft-specification.ts'
export { createValidateSpecificationTool } from './tool/validate-specification.ts'
export type { ValidateSpecificationInput, ValidateSpecificationOutput, ValidateSpecificationDeps } from './tool/validate-specification.ts'
export { createEvaluateEvidenceTool } from './tool/evaluate-evidence.ts'
export type { EvaluateEvidenceInput, EvaluateEvidenceOutput, EvaluateEvidenceDeps } from './tool/evaluate-evidence.ts'
export { createRuleCheckTool } from './tool/rule-check.ts'
export type { RuleCheckInput, RuleCheckOutput, RuleViolationView, RuleCheckDeps } from './tool/rule-check.ts'
export { createAnalyzePatentFigureTool, FIGURE_SPEC_GUIDE, resolveGateRoute } from './tool/analyze-patent-figure.ts'
export type { AnalyzePatentFigureInput, AnalyzePatentFigureDeps, FigureAnalysisResult, FigureComponent, FigureType } from './tool/analyze-patent-figure.ts'
export { createSearchPatentFigureTool, tokenizeFigureText } from './tool/search-patent-figure.ts'
export type { SearchPatentFigureInput, SearchPatentFigureOutput, SearchPatentFigureDeps, LoadFigureIndexResult } from './tool/search-patent-figure.ts'
export { createPatentPdfDownloadTool } from './tool/patent-pdf-download.ts'
export type { PatentPdfDownloadInput, PatentPdfDownloadOutput, PatentPdfDownloadDeps, RunEgo } from './tool/patent-pdf-download.ts'
export { createRecognizeChemicalStructureTool } from './tool/recognize-chemical-structure.ts'
export type { RecognizeChemicalStructureInput, ChemicalStructureResult, ChemicalSmilesCandidate } from './tool/recognize-chemical-structure.ts'
export { createFlexiblePlanTool } from './tool/patent-flexible-plan.ts'
export type { FlexiblePlanToolInput, FlexiblePlanOutput, FlexiblePlanToolDeps, FlexiblePlanAction, FlexiblePlanStageInput } from './tool/patent-flexible-plan.ts'
export { createPatentWorkflowTool } from './tool/patent-workflow.ts'
export type { PatentWorkflowInput, PatentWorkflowOutput, PatentWorkflowToolDeps } from './tool/patent-workflow.ts'
export { createPatentWorkflowRunTool } from './tool/patent-workflow-run.ts'
export type { PatentWorkflowRunInput, PatentWorkflowRunOutput, PatentWorkflowRunDeps, PatentWorkflowRunGraph } from './tool/patent-workflow-run.ts'
export { createPatentPlanTaskTool } from './tool/patent-plan-task.ts'
export type { PatentPlanTaskInput, PatentPlanTaskOutput, PatentPlanTaskAction } from './tool/patent-plan-task.ts'
export { createPatentWorkerValidateTool } from './tool/patent-worker-validate.ts'
export type { PatentWorkerValidateInput, PatentWorkerValidateOutput } from './tool/patent-worker-validate.ts'
export { createKnowledgeNoteSaveTool } from './tool/knowledge-note-save.ts'
export type { KnowledgeNoteSaveInput, KnowledgeNoteSaveOutput, KnowledgeNoteSaveDeps, KnowledgeNote } from './tool/knowledge-note-save.ts'

// render_patent_document is owned by dsh-patent-document; re-export for library consumers.
export { createRenderPatentDocumentTool, renderDocumentResult }

/** Cordis plugin name used by loader diagnostics. */
export const name = 'patent-tools'

/** The tool registry is the only required service; optional services are read via ctx.get. */
export const inject = ['tools']

/** Model-facing patent-tools plugin configuration. */
export interface Config {
  /** LLM provider route for the LLM-consuming tools (claim_chart_build / workflow run / figure analysis). */
  provider?: string
  /** LLM model id for the LLM-consuming tools. */
  model?: string
  /** Dedicated figure/image model route whose input modalities gate analyze_patent_figure. */
  imageModel?: ImageModelConfig
  /** Max output tokens for the LLM-consuming tools. */
  maxTokens?: number
}

/** Figure/image model route used by the figure-analysis tool. */
export interface ImageModelConfig {
  /** LLM provider route for figure/image analysis. */
  provider?: string
  /** LLM model id for figure/image analysis. */
  model?: string
}

/** Schemastery configuration: optional LLM route/model for the LLM-consuming tools. */
export const Config: z<Config> = z.object({
  provider: z.string(),
  model: z.string(),
  imageModel: z.object({ provider: z.string(), model: z.string() }),
  maxTokens: z.number(),
})

/** Build a ModelPort from Config + ctx.llm, or a fail-loud stub when not configured. */
function buildModelPort(ctx: Context, config: Config): PatentModelPort {
  if (config.provider !== undefined && config.model !== undefined) {
    const llm = ctx.get('llm') as { stream: (o: GenerateOptions) => AsyncIterable<StreamChunk> } | undefined
    if (llm !== undefined) {
      return createLlmModelPort(o => llm.stream(o), {
        provider: config.provider,
        model: config.model,
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      })
    }
  }
  return {
    stream: async function* () {
      throw new PatentToolError('setup_required', '未配置 LLM provider/model（Config.provider/model 未设置），无法执行 LLM 工具。', {})
    },
  }
}

/** Resolve the Config figure-model route for the image gate: imageModel override, else provider/model. */
function figureRoute(config: Config): { provider: string; model: string } | undefined {
  const imageModel = config.imageModel
  if (imageModel !== undefined && imageModel.provider !== undefined && imageModel.model !== undefined) {
    return { provider: imageModel.provider, model: imageModel.model }
  }
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  return undefined
}

/** Build the image-gate capability resolver from ctx.llm (undefined when no capability source). */
function buildImageGateResolver(
  ctx: Context,
): ((provider: string, model: string) => Promise<readonly ModelModality[] | undefined>) | undefined {
  const llm = ctx.get('llm') as { resolveModelInfo: (provider: string, model: string) => Promise<LlmResolvedModelInfo> } | undefined
  if (llm === undefined) return undefined
  return (provider, model) => resolveImageInputModalities(llm.resolveModelInfo.bind(llm), provider, model)
}

/**
 * Register the 23 patent tools.
 * @param ctx - registrant context carrying the tool registry and optional services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const model = buildModelPort(ctx, config)
  const gateModel = figureRoute(config)
  const resolveImageInputModalitiesFor = buildImageGateResolver(ctx)
  const knowledge = ctx.get('patentKnowledge') as PatentKnowledge | undefined

  // Search / metadata / legal status: default to the nuo engine (no service needed).
  ctx.tools.register(createPatentSearchTool())
  ctx.tools.register(createPatentMetadataTool())
  ctx.tools.register(createPatentLegalStatusTool())

  // Knowledge tools: wire ctx.patentKnowledge when present, else fail loud at execute.
  if (knowledge !== undefined) {
    const wiki = new WikiCardLoader(knowledge.paths.wikiDir)
    ctx.tools.register(createPatentCaseSearchTool({
      search: (q, o) => knowledge.caseLawSearch(q, o),
      dbPath: knowledge.paths.queryDbPath,
    }))
    ctx.tools.register(createPatentWikiSearchTool({
      searchIn: (prefix, keyword, limit) => wiki.searchIn(prefix, keyword, limit),
      formatAsContext: (id, maxChars) => wiki.formatAsContext(id, maxChars),
      wikiDir: knowledge.paths.wikiDir,
    }))
    const kgDeps = existsSync(knowledge.paths.queryDbPath)
      ? { adapter: new PatentKgAdapter(new KgStore(knowledge.paths.queryDbPath)), dbPath: knowledge.paths.queryDbPath }
      : { dbPath: knowledge.paths.queryDbPath }
    ctx.tools.register(createPatentKgQueryTool(kgDeps))
  } else {
    ctx.tools.register(createPatentCaseSearchTool({}))
    ctx.tools.register(createPatentWikiSearchTool({}))
    ctx.tools.register(createPatentKgQueryTool({}))
  }

  // Pure deterministic tools.
  ctx.tools.register(createPatentEvalTool())
  ctx.tools.register(createDraftClaimsTool())
  ctx.tools.register(createDraftSpecificationTool())
  ctx.tools.register(createValidateSpecificationTool())
  ctx.tools.register(createRuleCheckTool())
  ctx.tools.register(createPatentWorkerValidateTool())
  ctx.tools.register(createPatentPlanTaskTool())
  ctx.tools.register(createRecognizeChemicalStructureTool())

  // LLM-consuming tools.
  ctx.tools.register(createClaimChartBuildTool({ model }))
  ctx.tools.register(createPatentWorkflowRunTool({ model }))
  ctx.tools.register(createFlexiblePlanTool({ model }))
  ctx.tools.register(createAnalyzePatentFigureTool({
    model,
    ...(gateModel === undefined ? {} : { gateModel }),
    ...(resolveImageInputModalitiesFor === undefined ? {} : { resolveImageInputModalities: resolveImageInputModalitiesFor }),
  }))

  // Evidence + rule-asset + recap + figure-index + notes.
  ctx.tools.register(createEvaluateEvidenceTool({ ruleDirs: candidateRuleDirs() }))
  ctx.tools.register(createPatentWorkflowTool({}))
  // Search figure index: analyze_patent_figure does not persist an index in
  // this port, so the tool fails loud until an integrator wires a real loader.
  ctx.tools.register(createSearchPatentFigureTool({
    loadIndex: async () => {
      throw new PatentToolError('setup_required', 'search_patent_figure 需要附图索引加载器（analyze_patent_figure 当前不落盘索引）；未接线。', { tool: 'search_patent_figure' })
    },
  }))

  // PDF download: the ego-browser runner adapter is a deferred integration point;
  // the tool fails loud until a real runEgo is wired.
  ctx.tools.register(createPatentPdfDownloadTool({
    runEgo: async () => {
      throw new PatentToolError('setup_required', 'patent_pdf_download 需要 ego-browser 运行器（经 ctx.patentData.createEgoSession 注入）；当前未接线。', { tool: 'patent_pdf_download' })
    },
    fetchImpl: globalThis.fetch,
  }))
  ctx.tools.register(createKnowledgeNoteSaveTool({
    writeNote: async () => {
      throw new PatentToolError('setup_required', 'knowledge_note_save 需要存储写入器（经 ctx.storage 注入）；当前未接线。', { tool: 'knowledge_note_save' })
    },
  }))
}
