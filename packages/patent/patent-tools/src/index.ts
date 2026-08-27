/**
 * Function plugin registering the 24 model-facing patent tools ported from Sati:
 * search, metadata, legal status, case/wiki/kg knowledge queries, claim-chart,
 * drafting, specification validation, evidence judgment, rule check, figure
 * analysis, PDF download, chemical recognition, knowledge notes, and the
 * workflow/plan state machines. `render_patent_document` is owned by
 * @deepseek-ai/dsh-patent-document (its apply() registers it); this package
 * re-exports its factory but does not register it.
 * @module @deepseek-ai/dsh-patent-tools
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createLlmModelPort, globalAtomRegistry, globalStageHandlerRegistry, registerBuiltinAtoms } from '@deepseek-ai/dsh-patent-core'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { KgStore, PatentKgAdapter, WikiCardLoader } from '@deepseek-ai/dsh-patent-knowledge'
import { candidateRuleDirs } from '@deepseek-ai/dsh-patent-rule'
import { createRenderPatentDocumentTool, renderDocumentResult } from '@deepseek-ai/dsh-patent-document'
import type { GenerateOptions, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import { resolveBrowserBackend } from '@deepseek-ai/dsh-browser-backend'
import { chemistryIndexStore, DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH } from './chemistry/index-store.ts'
import { figureIndexStore, DEFAULT_FIGURE_INDEX_RELATIVE_PATH } from './figure/index-store.ts'
import { resolveImageInputModalities } from './figure/image-capability.ts'
import { PatentToolError } from './error.ts'
import { createPatentSearchTool } from './tool/patent-search.ts'
import { createPatentMetadataTool } from './tool/patent-metadata.ts'
import { createPatentLegalStatusTool } from './tool/patent-legal-status.ts'
import { createPatentCaseSearchTool } from './tool/patent-case-search.ts'
import { createPatentWikiSearchTool } from './tool/patent-wiki-search.ts'
import { createPatentKgQueryTool } from './tool/patent-kg-query.ts'
import { createPatentEvalTool } from './tool/patent-eval.ts'
import { createPatentAnalysisReportTool } from './tool/patent-analysis-report.ts'
import { createClaimChartBuildTool } from './tool/claim-chart-build.ts'
import { createDraftClaimsTool } from './tool/draft-claims.ts'
import { createDraftSpecificationTool } from './tool/draft-specification.ts'
import { createValidateSpecificationTool } from './tool/validate-specification.ts'
import { createEvaluateEvidenceTool } from './tool/evaluate-evidence.ts'
import { createRuleCheckTool } from './tool/rule-check.ts'
import { createAnalyzePatentFigureTool } from './tool/analyze-patent-figure.ts'
import { createSearchPatentFigureTool } from './tool/search-patent-figure.ts'
import { createPatentPdfDownloadTool, type RunEgo } from './tool/patent-pdf-download.ts'
import { createEgoDownloadRunner } from './tool/patent-pdf-download-ego.ts'
import { createRecognizeChemicalStructureTool } from './tool/recognize-chemical-structure.ts'
import { createFlexiblePlanTool } from './tool/patent-flexible-plan.ts'
import { createPatentWorkflowTool } from './tool/patent-workflow.ts'
import { createPatentWorkflowRunTool } from './tool/patent-workflow-run.ts'
import { createPatentPlanTaskTool } from './tool/patent-plan-task.ts'
import { createPatentWorkerValidateTool } from './tool/patent-worker-validate.ts'
import { createKnowledgeNoteSaveTool } from './tool/knowledge-note-save.ts'
import { createNoteFileWriter } from './tool/knowledge-note-file-writer.ts'
import { slopGateAtom, SlopGateHandler } from './atoms/slop-gate.ts'

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
export { createPatentAnalysisReportTool } from './tool/patent-analysis-report.ts'
export type { PatentAnalysisReportInput, PatentAnalysisReportOutput, PatentAnalysisReportDeps } from './tool/patent-analysis-report.ts'
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
export type { SearchPatentFigureInput, SearchPatentFigureOutput, SearchPatentFigureDeps } from './tool/search-patent-figure.ts'
export { figureIndexStore, FIGURE_INDEX_VERSION, DEFAULT_FIGURE_INDEX_RELATIVE_PATH } from './figure/index-store.ts'
export type { FigureIndexEntry, LoadFigureIndexResult } from './figure/index-store.ts'
export { chemistryIndexStore, CHEMISTRY_INDEX_VERSION, DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH } from './chemistry/index-store.ts'
export type { ChemistryIndexEntry } from './chemistry/index-store.ts'
export { createPatentPdfDownloadTool } from './tool/patent-pdf-download.ts'
export type { PatentPdfDownloadInput, PatentPdfDownloadOutput, PatentPdfDownloadDeps, RunEgo, EgoDownloadItem, EgoDownloadRequest, EgoDownloadResult } from './tool/patent-pdf-download.ts'
export type { EgoSessionSeam } from './tool/patent-pdf-download-ego.ts'
export { createBrowserUseDownloadRunner } from './tool/patent-pdf-download-browser-use.ts'
export { createRecognizeChemicalStructureTool, resolveChemicalSourceKey } from './tool/recognize-chemical-structure.ts'
export type { RecognizeChemicalStructureInput, RecognizeChemicalStructureDeps, ChemicalStructureResult, ChemicalSmilesCandidate } from './tool/recognize-chemical-structure.ts'
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
export { createNoteFileWriter } from './tool/knowledge-note-file-writer.ts'
export { slopGateAtom, SlopGateHandler, SLOP_GATE_PASS_THRESHOLD } from './atoms/slop-gate.ts'
export { buildSlopRevisionHint } from './internal/retry-hints.ts'

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
  /** 知识笔记落盘目录（相对或绝对路径）；默认 <cwd>/99-知识库。 */
  noteDir?: string
  /** Max output tokens for the LLM-consuming tools. */
  maxTokens?: number
  /** 附图索引文件路径（相对或绝对路径）；默认 <cwd>/.sati/figures-index.json。 */
  figureIndexFile?: string
  /** 化学结构索引文件路径（相对或绝对路径）；默认 <cwd>/.sati/chemistry-index.json。 */
  chemistryIndexFile?: string
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
  noteDir: z.string(),
  figureIndexFile: z.string(),
  chemistryIndexFile: z.string(),
})

/** 从 Config 或部署默认路由解析 provider/model（agent-default-model 宿主服务）。 */
function resolveModelRoute(ctx: Context, config: Config): { provider: string; model: string } | undefined {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  const defaults = ctx.get('agentDefaultModel') as { currentSelection: () => { provider: string; model: string } } | undefined
  const selection = defaults?.currentSelection()
  if (selection !== undefined && selection.provider !== '' && selection.model !== '') {
    return { provider: selection.provider, model: selection.model }
  }
  return undefined
}

/** Build a ModelPort from Config + ctx.llm, or a fail-loud stub when not configured. */
function buildModelPort(ctx: Context, config: Config): PatentModelPort {
  const route = resolveModelRoute(ctx, config)
  if (route !== undefined) {
    const llm = ctx.get('llm') as { stream: (o: GenerateOptions) => AsyncIterable<StreamChunk> } | undefined
    if (llm !== undefined) {
      return createLlmModelPort(o => llm.stream(o), {
        provider: route.provider,
        model: route.model,
        ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
      })
    }
  }
  return {
    // oxlint-disable-next-line typescript/require-await -- PatentModelPort.stream contract returns AsyncIterable
    stream: async function* () {
      throw new PatentToolError('setup_required', '未配置 LLM provider/model（Config.provider/model 或部署默认路由不可用），无法执行 LLM 工具。', {})
    },
  }
}

/** Resolve the Config figure-model route for the image gate: imageModel override, else provider/model, else the deployment default. */
function figureRoute(ctx: Context, config: Config): { provider: string; model: string } | undefined {
  const imageModel = config.imageModel
  if (imageModel !== undefined && imageModel.provider !== undefined && imageModel.model !== undefined) {
    return { provider: imageModel.provider, model: imageModel.model }
  }
  return resolveModelRoute(ctx, config)
}

/**
 * Build the image-gate capability resolver from ctx.llm.
 * @param ctx - registrant context carrying the llm service.
 * @returns the resolver, or `undefined` when no llm capability source exists.
 */
export function buildImageGateResolver(
  ctx: Context,
): ((provider: string, model: string) => Promise<readonly ModelModality[] | undefined>) | undefined {
  const llm = ctx.get('llm') as { resolveModelInfo: (provider: string, model: string) => Promise<LlmResolvedModelInfo> } | undefined
  if (llm === undefined) return undefined
  return (provider, model) => resolveImageInputModalities(llm.resolveModelInfo.bind(llm), provider, model)
}

/** Resolve the knowledge-note directory: Config.noteDir (absolute or relative to cwd), else <cwd>/99-知识库. */
function resolveNoteDir(config: Config): string {
  return config.noteDir !== undefined ? resolve(config.noteDir) : join(process.cwd(), '99-知识库')
}

/** Resolve the figure-index file: Config.figureIndexFile (absolute or relative to cwd), else <cwd>/.sati/figures-index.json. */
function resolveFigureIndexFile(config: Config): string {
  return config.figureIndexFile !== undefined
    ? resolve(config.figureIndexFile)
    : resolve(process.cwd(), DEFAULT_FIGURE_INDEX_RELATIVE_PATH)
}

/** Resolve the chemistry-index file: Config.chemistryIndexFile (absolute or relative to cwd), else <cwd>/.sati/chemistry-index.json. */
function resolveChemistryIndexFile(config: Config): string {
  return config.chemistryIndexFile !== undefined
    ? resolve(config.chemistryIndexFile)
    : resolve(process.cwd(), DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH)
}

/** Inputs for the patent PDF-download runner resolver. */
export type DownloadRunnerResolverOptions = {
  /** ego-browser batch runner (fail-loud stub when patent-data is not mounted). */
  runEgo: RunEgo
  /** Backend resolver (tests inject a fake; defaults to resolveBrowserBackend). */
  resolve?: typeof resolveBrowserBackend
}

/**
 * Build the download-runner resolver for patent_pdf_download. With the unified
 * ego stack the download channel resolves only the ego backend and always runs
 * the ego runner; browseros-neo / playwright / browser-use participate in the
 * probe matrix but never take a download (no intercept/extract execution).
 * @param options - the ego runner and an optional resolver.
 * @returns a resolver returning the ego runner.
 */
export function createDownloadRunnerResolver(options: DownloadRunnerResolverOptions): () => Promise<RunEgo> {
  const resolveBackend = options.resolve ?? resolveBrowserBackend
  return async () => {
    // 统一 ego 栈后下载通道只认 ego；browseros-neo / playwright / browser-use 参与探测矩阵但不参与下载。
    await resolveBackend({ exclude: ['browseros-neo', 'playwright', 'browser-use'] }).catch(() => {
      // No backend is detectable on this host. The caller explicitly wired the
      // ego channel (runEgo comes from ctx.patentData), so honor it rather than
      // failing the download with install guidance.
    })
    return options.runEgo
  }
}

/**
 * Register the 24 patent tools.
 * @param ctx - registrant context carrying the tool registry and optional services.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // 内置原子（契约 + 运行时）注册进全局注册表；幂等。不注册则 atom-bearing
  // manifest 在 runWorkflow 的 fail-fast 处抛错，工作流工具全部不可用。
  registerBuiltinAtoms()
  // slop-gate 依赖本包的 slop 引擎，按依赖方向注册在 patent-core 内置之外。
  globalAtomRegistry.register(slopGateAtom)
  globalStageHandlerRegistry.register(new SlopGateHandler())
  const model = buildModelPort(ctx, config)
  const gateModel = figureRoute(ctx, config)
  const resolveImageInputModalitiesFor = buildImageGateResolver(ctx)
  const figureIndexFile = resolveFigureIndexFile(config)
  const chemistryIndexFile = resolveChemistryIndexFile(config)
  const knowledge = ctx.get('patentKnowledge')

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
  ctx.tools.register(createRecognizeChemicalStructureTool({
    // 识别引擎不可用（RDKit 未安装）时 usable 恒 false，该写入闭包不可达；
    // RDKit 接入并产出 usable 结果后移除 ignore（与 recognize 工具内注释呼应）。
    /* v8 ignore next -- dead until the chemistry engine produces a usable result. */
    upsertIndex: entry => chemistryIndexStore.upsert(chemistryIndexFile, entry),
  }))

  // LLM-consuming tools.
  ctx.tools.register(createPatentAnalysisReportTool({ model }))
  ctx.tools.register(createClaimChartBuildTool({ model }))
  ctx.tools.register(createPatentWorkflowRunTool({ model }))
  ctx.tools.register(createFlexiblePlanTool({ model }))
  ctx.tools.register(createAnalyzePatentFigureTool({
    model,
    ...(gateModel === undefined ? {} : { gateModel }),
    ...(resolveImageInputModalitiesFor === undefined ? {} : { resolveImageInputModalities: resolveImageInputModalitiesFor }),
    upsertIndex: entry => figureIndexStore.upsert(figureIndexFile, entry),
  }))

  // Evidence + rule-asset + recap + figure-index + notes.
  ctx.tools.register(createEvaluateEvidenceTool({ ruleDirs: candidateRuleDirs() }))
  ctx.tools.register(createPatentWorkflowTool({}))
  // Search figure index: analyze_patent_figure persists its results through
  // figureIndexStore.upsert into the configured figureIndexFile, which the
  // search tool loads on each call.
  ctx.tools.register(createSearchPatentFigureTool({
    loadIndex: () => figureIndexStore.load(figureIndexFile),
  }))

  // PDF download: wire the runner through a browser-backend cold decision.
  // The unified ego stack routes the download to ego-browser only; browseros-neo
  // / playwright / browser-use stay out of the download path (no intercept/
  // extract execution yet). Without patent-data the ego channel fails loud at
  // resolution, as before.
  const patentData = ctx.get('patentData')
  const runEgo = patentData !== undefined
    ? createEgoDownloadRunner(patentData.createEgoSession())
    : () => Promise.reject(new PatentToolError('setup_required', 'patent_pdf_download 需要 patent-data 服务（preset 挂载 @deepseek-ai/dsh-patent-data 后自动接线 ego 通道）；当前未挂载。', { tool: 'patent_pdf_download' }))
  ctx.tools.register(createPatentPdfDownloadTool({
    runEgo,
    fetchImpl: globalThis.fetch,
    resolveRunner: createDownloadRunnerResolver({ runEgo }),
  }))

  // Notes land as files under the configured noteDir (default <cwd>/99-知识库):
  // no storage service dependency, works in headless and web compositions.
  ctx.tools.register(createKnowledgeNoteSaveTool({
    writeNote: createNoteFileWriter(resolveNoteDir(config)),
  }))
}
