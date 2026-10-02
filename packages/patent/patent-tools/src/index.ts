/**
 * Function plugin registering the 31 model-facing patent tools ported from Sati:
 * search, metadata, legal status, case/wiki/kg knowledge queries, claim-chart,
 * office-action parsing, drafting, specification validation, evidence judgment,
 * rule check, figure analysis + generation, PDF download, chemical recognition,
 * knowledge notes, the workflow/plan state machines, and the personal-workbench
 * case bridge. `render_patent_document` is owned by
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
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { KgStore, PatentKgAdapter, WikiCardLoader } from '@deepseek-ai/dsh-patent-knowledge'
import { candidateRuleDirs } from '@deepseek-ai/dsh-patent-rule'
import { createRenderPatentDocumentTool, renderDocumentResult } from '@deepseek-ai/dsh-patent-document'
import type { GenerateOptions, LlmResolvedModelInfo, ModelModality, StreamChunk } from '@deepseek-ai/dsh-llm'
import { resolveBrowserBackend } from '@deepseek-ai/dsh-browser-backend'
import { chemistryIndexStore, DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH } from './chemistry/index-store.ts'
import { figureIndexStore, DEFAULT_FIGURE_INDEX_RELATIVE_PATH } from './figure/index-store.ts'
import { createTwoStepAnalysisEngine } from './figure/analysis-engine.ts'
import { resolveImageInputModalities } from './figure/image-capability.ts'
import { DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS } from './figure/graphviz-renderer.ts'
import { DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS, exportWithInkscape, findInkscape, outlineSvgText } from './figure/inkscape-renderer.ts'
import type { ExportFigurePort, OutlineTextPort } from './figure/inkscape-renderer.ts'
import { pickRenderer } from './figure/render-selector.ts'
import type { FigureRendererMode } from './figure/render-selector.ts'
import { PatentToolError } from './error.ts'
import { createPatentSearchTool } from './tool/patent-search.ts'
import { createPatentMetadataTool } from './tool/patent-metadata.ts'
import { createPatentLegalStatusTool } from './tool/patent-legal-status.ts'
import { createPatentCaseSearchTool } from './tool/patent-case-search.ts'
import { createLawSearchTool } from './tool/law-search.ts'
import { createPatentWikiSearchTool } from './tool/patent-wiki-search.ts'
import { createPatentKgQueryTool } from './tool/patent-kg-query.ts'
import { createPatentEvalTool } from './tool/patent-eval.ts'
import { createPatentAnalysisReportTool } from './tool/patent-analysis-report.ts'
import { createClaimChartBuildTool } from './tool/claim-chart-build.ts'
import { createTrizContradictionAnalysisTool } from './tool/triz-contradiction-analysis.ts'
import { createParseOfficeActionTool } from './tool/parse-office-action.ts'
import { createDraftClaimsTool } from './tool/draft-claims.ts'
import { createDraftSpecificationTool } from './tool/draft-specification.ts'
import { createValidateSpecificationTool } from './tool/validate-specification.ts'
import { createEvaluateEvidenceTool } from './tool/evaluate-evidence.ts'
import { createRuleCheckTool } from './tool/rule-check.ts'
import { createAnalyzePatentFigureTool } from './tool/analyze-patent-figure.ts'
import { createSearchPatentFigureTool } from './tool/search-patent-figure.ts'
import { createGeneratePatentFigureTool } from './tool/generate-patent-figure.ts'
import { createGenerateStructureFigureTool } from './tool/generate-structure-figure.ts'
import type { GenerateStructureFigureDeps } from './tool/generate-structure-figure.ts'
import { STRUCTURE_VIEWS, type StructureViewName } from './figure/freecad-structure-script.ts'
import { DEFAULT_FREECAD_RENDER_TIMEOUT_MS, renderSectionGeometry, renderSectionHatch, renderStructureViews } from './figure/freecad-renderer.ts'
import type { SectionSourcePorts } from './figure/section-source.ts'
import { createAddPatentFigureReferencesTool } from './tool/add-patent-figure-references.ts'
import { createVerifyPatentFigureTool } from './tool/verify-patent-figure.ts'
import { createPatentPdfDownloadTool, type RunEgo } from './tool/patent-pdf-download.ts'
import { createDownloadChannelRunner } from './tool/patent-pdf-download-channel.ts'
import { createRecognizeChemicalStructureTool } from './tool/recognize-chemical-structure.ts'
import { createFlexiblePlanTool } from './tool/patent-flexible-plan.ts'
import { createPatentWorkflowTool } from './tool/patent-workflow.ts'
import { createPatentWorkflowRunTool } from './tool/patent-workflow-run.ts'
import { createPatentPlanTaskTool } from './tool/patent-plan-task.ts'
import { createWorkbenchLinkPatentCaseTool } from './tool/workbench-link-patent-case.ts'
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
export { createLawSearchTool } from './tool/law-search.ts'
export type { LawSearchInput, LawSearchOutput, LawSearchScope, LawSearchDeps } from './tool/law-search.ts'
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
export { createTrizContradictionAnalysisTool, renderTrizContradictionAnalysis } from './tool/triz-contradiction-analysis.ts'
export type { TrizContradictionAnalysisInput, TrizContradictionAnalysisDeps } from './tool/triz-contradiction-analysis.ts'
export { createParseOfficeActionTool } from './tool/parse-office-action.ts'
export type { ParseOfficeActionInput, ParseOfficeActionOutput } from './tool/parse-office-action.ts'
export { createDraftClaimsTool, draftClaims, DOMAIN_KEYWORDS } from './tool/draft-claims.ts'
export type { DraftClaimsInput, DraftClaimsOutput, DraftedClaim, ClaimViolation, TechDomain, PatentType } from './tool/draft-claims.ts'
export { createDraftSpecificationTool, draftSpecification } from './tool/draft-specification.ts'
export type { DraftSpecificationInput, DraftSpecificationOutput, SpecificationSection } from './tool/draft-specification.ts'
export { createValidateSpecificationTool } from './tool/validate-specification.ts'
export type { ValidateSpecificationInput, ValidateSpecificationOutput, ValidateSpecificationDeps } from './tool/spec-types.ts'
export { createEvaluateEvidenceTool } from './tool/evaluate-evidence.ts'
export type { EvaluateEvidenceInput, EvaluateEvidenceOutput, EvaluateEvidenceDeps } from './tool/evaluate-evidence.ts'
export { createRuleCheckTool } from './tool/rule-check.ts'
export type { RuleCheckInput, RuleCheckOutput, RuleViolationView, RuleCheckDeps } from './tool/rule-check.ts'
export { createAnalyzePatentFigureTool, FIGURE_SPEC_GUIDE, resolveGateRoute } from './tool/analyze-patent-figure.ts'
export type { AnalyzePatentFigureInput, AnalyzePatentFigureDeps, FigureAnalysisResult, FigureComponent, FigureType } from './tool/analyze-patent-figure.ts'
export { createSearchPatentFigureTool, tokenizeFigureText } from './tool/search-patent-figure.ts'
export type { SearchPatentFigureInput, SearchPatentFigureOutput, SearchPatentFigureDeps } from './tool/search-patent-figure.ts'
export { createGeneratePatentFigureTool } from './tool/generate-patent-figure.ts'
export { FIGURE_GENERATOR_MODEL_USED } from './tool/figure-input.ts'
export { expandSectionSource, SectionSourceError, SECTION_SOURCE_SIZE_TOLERANCE } from './figure/section-source.ts'
export type { SectionSourcePorts, SectionSourceOptions, SectionSourceExpansion, SectionSourceErrorCode } from './figure/section-source.ts'
export { createGenerateStructureFigureTool, STRUCTURE_FIGURE_MODEL_USED } from './tool/generate-structure-figure.ts'
export type {
  GenerateStructureFigureInput,
  GenerateStructureFigureOutput,
  GenerateStructureFigureDeps,
  StructureCalloutInput,
  StructureFigureView,
  StructureManifest,
  StructureManifestView,
  StructureManifestAnchor,
} from './tool/generate-structure-figure.ts'
export { findFreeCadCmd, probeFreeCad, renderStructureViews, freecadInstallMessage, FREECAD_CMD_CANDIDATES } from './figure/freecad-renderer.ts'
export type {
  FreeCadProbeResult,
  FreeCadProbeOptions,
  FreeCadRenderOptions,
  StructureRenderOutcome,
  StructureRenderSpec,
  StructureRenderErrorCode,
} from './figure/freecad-renderer.ts'
export { DEFAULT_FREECAD_RENDER_TIMEOUT_MS, DEFAULT_FREECAD_PROBE_TIMEOUT_MS } from './figure/freecad-renderer.ts'
export {
  buildStructureScript,
  STRUCTURE_VIEWS,
  DEFAULT_STRUCTURE_VIEWS,
  STRUCTURE_VIEW_DIRECTIONS,
  structureSvgFilename,
  STRUCTURE_MANIFEST_FILENAME,
} from './figure/freecad-structure-script.ts'
export type { StructureViewName, StructureCallout, StructureScriptParams } from './figure/freecad-structure-script.ts'
export type {
  GeneratePatentFigureInput,
  GeneratePatentFigureOutput,
  GeneratePatentFigureDeps,
  GeneratePatentFigureIndexEntry,
  GenerateFigureType,
  GeneratePatentFigurePanelInput,
  GeneratePatentFigurePanelOutput,
} from './tool/figure-input.ts'
export { createAddPatentFigureReferencesTool } from './tool/add-patent-figure-references.ts'
export { createVerifyPatentFigureTool } from './tool/verify-patent-figure.ts'
export type { VerifyPatentFigureInput, VerifyPatentFigureOutput, VerifyPatentFigureDeps } from './tool/verify-patent-figure.ts'
export { checkFigureRendering } from './figure/render-check.ts'
export type { RenderCheckFinding, RenderCheckKind, RenderCheckReport } from './figure/render-check.ts'
export type { AddPatentFigureReferencesInput, AddPatentFigureReferencesOutput, AddPatentFigureReferencesDeps } from './tool/add-patent-figure-references.ts'
export { figureIndexStore, FIGURE_INDEX_VERSION, DEFAULT_FIGURE_INDEX_RELATIVE_PATH } from './figure/index-store.ts'
export type { FigureIndexEntry, LoadFigureIndexResult } from './figure/index-store.ts'
export { findDot, probeGraphviz, renderWithGraphviz, sanitizeDotFilename, graphvizInstallMessage, DOT_CANDIDATES } from './figure/graphviz-renderer.ts'
export { findInkscape, outlineSvgText, exportWithInkscape, inkscapeInstallMessage, INKSCAPE_CANDIDATES, DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS } from './figure/inkscape-renderer.ts'
export type { ExportFigurePort, InkscapeExportFormat, InkscapeExportSpec, InkscapeOutlineOutcome, InkscapeOutlineSpec } from './figure/inkscape-renderer.ts'
export { createTwoStepAnalysisEngine } from './figure/analysis-engine.ts'
export type { FigureAnalysisEngine, FigureAnalysisRequest } from './figure/analysis-engine.ts'
export type {
  GraphvizProbeResult,
  GraphvizProbeOptions,
  GraphvizRenderOptions,
  GraphvizRenderOutcome,
  GraphvizRenderSpec,
  GraphvizRenderErrorCode,
} from './figure/graphviz-renderer.ts'
export { DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS, DEFAULT_GRAPHVIZ_PROBE_TIMEOUT_MS } from './figure/graphviz-renderer.ts'
export { renderWithVizWasm, vizLoadFailureMessage } from './figure/viz-wasm-renderer.ts'
export { pickRenderer } from './figure/render-selector.ts'
export type { FigureRendererMode } from './figure/render-selector.ts'
export { chemistryIndexStore, CHEMISTRY_INDEX_VERSION, DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH } from './chemistry/index-store.ts'
export type { ChemistryIndexEntry } from './chemistry/index-store.ts'
export { createPatentPdfDownloadTool } from './tool/patent-pdf-download.ts'
export type { PatentPdfDownloadInput, PatentPdfDownloadOutput, PatentPdfDownloadDeps, RunEgo, EgoDownloadItem, EgoDownloadRequest, EgoDownloadResult } from './tool/patent-pdf-download.ts'
export type { EgoSessionSeam } from './tool/patent-pdf-download-ego.ts'
export { createDownloadChannelRunner, createScrapeChannelRunner } from './tool/patent-pdf-download-channel.ts'
export type { DownloadChannelDeps, PatentDataLookup, PatentScrape } from './tool/patent-pdf-download-channel.ts'
export { createRecognizeChemicalStructureTool, resolveChemicalSourceKey } from './tool/recognize-chemical-structure.ts'
export type { RecognizeChemicalStructureInput, RecognizeChemicalStructureDeps, ChemicalStructureResult, ChemicalSmilesCandidate } from './tool/recognize-chemical-structure.ts'
export { createFlexiblePlanTool, ATOM_PARAM_DESCRIPTION } from './tool/patent-flexible-plan.ts'
export type { FlexiblePlanToolInput, FlexiblePlanOutput, FlexiblePlanToolDeps, FlexiblePlanAction, FlexiblePlanStageInput } from './tool/patent-flexible-plan.ts'
export { createPatentWorkflowTool } from './tool/patent-workflow.ts'
export type { PatentWorkflowInput, PatentWorkflowOutput, PatentWorkflowToolDeps } from './tool/patent-workflow.ts'
export { createPatentWorkflowRunTool } from './tool/patent-workflow-run.ts'
export type { PatentWorkflowRunInput, PatentWorkflowRunOutput, PatentWorkflowRunDeps, PatentWorkflowRunGraph } from './tool/patent-workflow-run.ts'
export { createPatentPlanTaskTool } from './tool/patent-plan-task.ts'
export {
  createWorkbenchLinkPatentCaseTool,
  parseMatterLogStages,
  PATENT_TYPE_DICTIONARIES,
  STAGE_NAME,
  STAGE_TYPE_CODE,
  WORKBENCH_STAGES,
} from './tool/workbench-link-patent-case.ts'
export type {
  WorkbenchLinkPatentCaseDeps,
  WorkbenchLinkPatentCaseInput,
  WorkbenchLinkPatentCaseOutput,
  WorkbenchStage,
  WorkbenchTaskStatusCode,
} from './tool/workbench-link-patent-case.ts'
export type { PatentPlanTaskInput, PatentPlanTaskOutput, PatentPlanTaskAction } from './tool/patent-plan-task.ts'
export { createPatentWorkerValidateTool } from './tool/patent-worker-validate.ts'
export type { PatentWorkerValidateInput, PatentWorkerValidateOutput } from './tool/patent-worker-validate.ts'
export { createKnowledgeNoteSaveTool } from './tool/knowledge-note-save.ts'
export type { KnowledgeNoteSaveInput, KnowledgeNoteSaveOutput, KnowledgeNoteSaveDeps, KnowledgeNote } from './tool/knowledge-note-save.ts'
export { createNoteFileWriter } from './tool/knowledge-note-file-writer.ts'
export { slopGateAtom, SlopGateHandler, SLOP_GATE_PASS_THRESHOLD } from './atoms/slop-gate.ts'
export { buildSlopRevisionHint } from './internal/retry-hints.ts'
export type { EvaluatedText } from './internal/evaluated-input.ts'

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
  /** Graphviz dot 可执行路径覆盖；默认自动探测（候选路径 + PATH）。 */
  graphvizExecutable?: string
  /** dot CLI 单次渲染超时（毫秒）；默认 60000（慢机/大图可上调）。 */
  graphvizRenderTimeoutMs?: number
  /** 附图渲染引擎：wasm=内置 @viz-js/viz（默认，SVG 零系统依赖）；cli=系统 dot 子进程。png/pdf 在 wasm 模式下自动回退 CLI。 */
  figureRenderer?: FigureRendererMode
  /** 附图分析模式：single=单步（默认，一次模型调用）；two-step=结构抽取+说明生成两次模型调用（成本翻倍，准确率可能更高）。 */
  figureAnalysisMode?: 'single' | 'two-step'
  /** 附图页面尺寸（提交规格）；缺省不输出页面属性。 */
  figurePageSize?: 'a4' | 'letter'
  /** 附图页面方向；缺省 portrait。 */
  figureOrientation?: 'portrait' | 'landscape'
  /** 附图渲染 DPI（png 栅格生效）；缺省不输出 dpi 属性。 */
  figureDpi?: number
  /** 附图页边距（厘米，四边同值）；与 figurePageSize 同给时收缩绘图区 size。 */
  figureMargin?: number
  /** 附图输出目录（相对或绝对路径）；默认 <cwd>/patent/figures/。 */
  figureOutputDir?: string
  /** 附图导出时把图面文字转成轮廓路径；默认 false。开启后 SVG 不再依赖阅读器字体（需要 Inkscape，两个附图生成工具、仅 SVG 生效）。 */
  figureTextToPath?: boolean
  /**
   * 剖视图是否必须给出剖切位置符号（`sections.cutting_marks`）；默认 false。
   * 为 true 时模型未给该参数也按「必须给」处理，缺省即报错（GB/T 4458.6 只在剖切平面
   * 与对称面重合且视图在标准位置时允许省略；本所要求一律标注时设 true）。
   */
  figureRequireCuttingMarks?: boolean
  /**
   * 图面文字字号的部署默认（毫米）：直绘图型的图面字号、DOT 图型的 fontsize 与落版核算
   * 的字高都由它定（小四 = 4.23 毫米、四号 = 4.94 毫米）；模型显式给的字号优先。
   * 必须为正数：0 会让图面文字失去字高，故在加载时由 schema 拒绝。
   */
  figureFontMm?: number
  /**
   * 图面字高内控下限（毫米）；缺省不判。法条只要求「缩小到三分之二时仍能清晰地分辨」
   * （审查指南第一部分第一章 4.3），毫米数由本所按缩印可读性定；给出后
   * verify_patent_figure 在模型未传 min_font_mm 时按它判定。必须为正数：非正值会让
   * 每次判定都失败，故在加载时由 schema 拒绝。
   */
  figureMinFontMm?: number
  /** Inkscape 可执行路径覆盖；默认自动探测（候选路径 + PATH）。仅 figureTextToPath 使用（两个附图生成工具共用同一端口）。 */
  inkscapeExecutable?: string
  /** Inkscape 单次文字转路径超时（毫秒）；默认 30000。仅 figureTextToPath 使用。 */
  inkscapeRenderTimeoutMs?: number
  /** 个人工作台 API 基址覆盖；缺省在 web 组合内自动取本进程 webServer 端口。 */
  workbenchBaseUrl?: string
  /** 案件根目录（相对或绝对路径，其下每案一个 <案号>/ 目录）；默认 <cwd>/patent-workspace。 */
  workbenchCaseRoot?: string
  /** DOT 字体名覆盖；默认 Helvetica，含 CJK 文本时按平台候选（PingFang SC / Microsoft YaHei / Noto Sans CJK SC）。 */
  dotFont?: string
  /** FreeCAD freecadcmd 可执行路径覆盖；默认自动探测（候选路径 + PATH）。generate_structure_figure 与剖视图的 sections.source 共用。 */
  freecadExecutable?: string
  /** freecadcmd 单次渲染超时（毫秒）；默认 120000（FreeCAD 冷启动比 dot 慢）。generate_structure_figure 与剖视图的 sections.source 共用。 */
  freecadRenderTimeoutMs?: number
  /** 结构线稿门禁（generate_structure_figure）；默认 false（CAD 隔离、默认关闭，未开启即 fail-loud）。 */
  structureFigureEnabled?: boolean
  /** 结构线稿 TechDraw 投影比例默认；缺省 1。 */
  structureFigureScale?: number
  /** 结构线稿缺省视图集；缺省 iso/front/top/right。元素受限为受支持视图名（非法值在加载时被 schema 拒绝）。 */
  structureFigureViews?: StructureViewName[]
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
  graphvizExecutable: z.string(),
  graphvizRenderTimeoutMs: z.number().step(1).min(1).default(DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS),
  figureRenderer: z.union(['wasm', 'cli']),
  figureAnalysisMode: z.union(['single', 'two-step']),
  figurePageSize: z.union(['a4', 'letter']),
  figureOrientation: z.union(['portrait', 'landscape']),
  figureDpi: z.number(),
  figureMargin: z.number(),
  figureOutputDir: z.string(),
  figureTextToPath: z.boolean(),
  figureRequireCuttingMarks: z.boolean(),
  figureFontMm: z.number().min(Number.MIN_VALUE),
  figureMinFontMm: z.number().min(Number.MIN_VALUE),
  inkscapeExecutable: z.string(),
  inkscapeRenderTimeoutMs: z.number().step(1).min(1).default(DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS),
  workbenchBaseUrl: z.string(),
  workbenchCaseRoot: z.string(),
  dotFont: z.string(),
  freecadExecutable: z.string(),
  freecadRenderTimeoutMs: z.number().step(1).min(1).default(DEFAULT_FREECAD_RENDER_TIMEOUT_MS),
  structureFigureEnabled: z.boolean(),
  structureFigureScale: z.number(),
  structureFigureViews: z.array(z.union(STRUCTURE_VIEWS)),
})

/**
 * 解析附图渲染预算：Config 覆盖优先，缺省取渲染器模块导出的默认值（默认值的唯一真源）。
 * @param config - 插件配置。
 * @returns dot 与 freecadcmd 的单次渲染超时（毫秒）。
 */
function resolveRenderBudgets(config: Config): {
  graphvizRenderTimeoutMs: number
  freecadRenderTimeoutMs: number
  inkscapeRenderTimeoutMs: number
} {
  return {
    graphvizRenderTimeoutMs: config.graphvizRenderTimeoutMs ?? DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS,
    freecadRenderTimeoutMs: config.freecadRenderTimeoutMs ?? DEFAULT_FREECAD_RENDER_TIMEOUT_MS,
    inkscapeRenderTimeoutMs: config.inkscapeRenderTimeoutMs ?? DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS,
  }
}

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

/** The harness llm streaming service, when mounted. */
function resolveLlm(ctx: Context): { stream: (o: GenerateOptions) => AsyncIterable<StreamChunk> } | undefined {
  return ctx.get('llm')
}

/** Build a ModelPort from Config + ctx.llm, or a fail-loud stub when not configured. */
function buildModelPort(ctx: Context, config: Config): PatentModelPort {
  const route = resolveModelRoute(ctx, config)
  const llm = resolveLlm(ctx)
  if (route !== undefined && llm !== undefined) {
    return createLlmModelPort(o => llm.stream(o), {
      provider: route.provider,
      model: route.model,
      ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    })
  }
  return {
    // oxlint-disable-next-line typescript/require-await -- PatentModelPort.stream contract returns AsyncIterable
    stream: async function* () {
      throw new PatentToolError('setup_required', '未配置 LLM provider/model（Config.provider/model 或部署默认路由不可用），无法执行 LLM 工具。', {})
    },
  }
}

/**
 * Build the figure-model port the image analysis is sent on: same route the
 * image gate checks ({@link figureRoute}), so the gate verdict and the wire
 * route can never diverge. Undefined when the route or the llm service is
 * absent — the tool fails loud with setup guidance at execute.
 */
function buildFigureModelPort(ctx: Context, config: Config): PatentModelPort | undefined {
  const route = figureRoute(ctx, config)
  const llm = resolveLlm(ctx)
  if (route === undefined || llm === undefined) return undefined
  return createLlmModelPort(o => llm.stream(o), {
    provider: route.provider,
    model: route.model,
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
  })
}

/** The harness attachment store (ctx 'attachments'), when mounted. */
function resolveAttachments(ctx: Context): { saveImage: (input: SaveImageAttachment) => Promise<ImageAttachmentRef> } | undefined {
  return ctx.get('attachments')
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
  const llm = ctx.get('llm') as { resolveModelInfo?: (provider: string, model: string) => Promise<LlmResolvedModelInfo> } | undefined
  const resolveModelInfo = llm?.resolveModelInfo
  if (resolveModelInfo === undefined) return undefined
  return (provider, model) => resolveImageInputModalities(resolveModelInfo.bind(llm), provider, model)
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

/** Resolve the figure output directory: Config.figureOutputDir (absolute or relative to cwd), else <cwd>/patent/figures. */
function resolveFigureOutputDir(config: Config): string {
  return config.figureOutputDir !== undefined ? resolve(config.figureOutputDir) : resolve(process.cwd(), 'patent/figures')
}

/** CJK 文本检测（决定平台字体）。 */
function hasCjk(labels: readonly string[]): boolean {
  return labels.some(label => /[\u3400-\u9fff]/.test(label))
}

/** DOT 字体：Config.dotFont 覆盖；否则 CJK 时按平台候选，非 CJK 默认 Helvetica。 */
function resolveDotFont(config: Config, labels: readonly string[]): string {
  if (config.dotFont !== undefined && config.dotFont !== '') return config.dotFont
  if (!hasCjk(labels)) return 'Helvetica'
  switch (process.platform) {
    case 'darwin':
      return 'PingFang SC'
    case 'win32':
      return 'Microsoft YaHei'
    default:
      return 'Noto Sans CJK SC'
  }
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
 * Register the 31 patent tools.
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
  const imageModel = buildFigureModelPort(ctx, config)
  const attachments = resolveAttachments(ctx)
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
    // 规范原文检索：法规条文与《专利审查指南》全文同出一库（知识库 documents 的两类文档）。
    ctx.tools.register(createLawSearchTool({
      searchLaw: (q, o) => knowledge.legalSearch(q, o),
      searchGuideline: (q, o) => knowledge.guidelineSearch(q, o),
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
    ctx.tools.register(createLawSearchTool({}))
    ctx.tools.register(createPatentWikiSearchTool({}))
    ctx.tools.register(createPatentKgQueryTool({}))
  }

  // Pure deterministic tools.
  ctx.tools.register(createPatentEvalTool())
  ctx.tools.register(createDraftClaimsTool())
  ctx.tools.register(createDraftSpecificationTool())
  ctx.tools.register(createValidateSpecificationTool())
  ctx.tools.register(createRuleCheckTool())
  ctx.tools.register(createParseOfficeActionTool())
  ctx.tools.register(createPatentWorkerValidateTool())
  ctx.tools.register(createPatentPlanTaskTool())
  // Workbench case bridge: talk to the personal-workbench plugin's loopback
  // HTTP API. Base URL: explicit config wins; otherwise the in-process
  // webServer port (web profile); absent → the tool fails loud at execute.
  // The service is read dynamically: this package's tsconfig does not
  // reference the host-webserver project, so no declaration merge is pulled in.
  const workbenchWebServer = ctx.get('webServer') as { port: number } | undefined
  const workbenchWebServerPort = workbenchWebServer?.port
  ctx.tools.register(createWorkbenchLinkPatentCaseTool({
    ...(config.workbenchBaseUrl === undefined && workbenchWebServerPort === undefined
      ? {}
      : { baseUrl: config.workbenchBaseUrl ?? `http://127.0.0.1:${workbenchWebServerPort}` }),
    caseRoot: config.workbenchCaseRoot ?? './patent-workspace',
  }))
  ctx.tools.register(createRecognizeChemicalStructureTool({
    // 识别引擎不可用（RDKit 未安装）时 usable 恒 false，该写入闭包不可达；
    // RDKit 接入并产出 usable 结果后移除 ignore（与 recognize 工具内注释呼应）。
    /* v8 ignore next -- dead until the chemistry engine produces a usable result. */
    upsertIndex: entry => chemistryIndexStore.upsert(chemistryIndexFile, entry),
  }))

  // LLM-consuming tools.
  ctx.tools.register(createPatentAnalysisReportTool({ model }))
  ctx.tools.register(createClaimChartBuildTool({ model }))
  ctx.tools.register(createTrizContradictionAnalysisTool({ model }))
  ctx.tools.register(createPatentWorkflowRunTool({ model }))
  ctx.tools.register(createFlexiblePlanTool({ model }))
  ctx.tools.register(createAnalyzePatentFigureTool({
    ...(imageModel === undefined ? {} : { imageModel }),
    ...(gateModel === undefined ? {} : { gateModel }),
    ...(attachments === undefined ? {} : { saveImage: input => attachments.saveImage(input) }),
    ...(resolveImageInputModalitiesFor === undefined ? {} : { resolveImageInputModalities: resolveImageInputModalitiesFor }),
    upsertIndex: entry => figureIndexStore.upsert(figureIndexFile, entry),
    // 两步分析引擎在组合点按 Config 选择注入；缺省 single 由工具内部构造默认单步引擎。
    // 引擎按调用接收模型端口，故这里不需要（也不应）在组合点捕获模型。
    ...(config.figureAnalysisMode === 'two-step'
      ? { analysisEngine: createTwoStepAnalysisEngine() }
      : {}),
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

  // Figure generation: default renderer is the bundled WASM engine (SVG with no
  // system dependency); PNG/PDF and figureRenderer="cli" go through the dot CLI
  // via ctx.subprocess, failing loud with install guidance when absent.
  const subprocess = ctx.get('subprocess')
  const renderBudgets = resolveRenderBudgets(config)
  const renderDot = pickRenderer(config.figureRenderer, {
    ...(subprocess === undefined ? {} : { subprocess }),
    ...(config.graphvizExecutable === undefined ? {} : { graphvizExecutable: config.graphvizExecutable }),
    graphvizRenderTimeoutMs: renderBudgets.graphvizRenderTimeoutMs,
  })
  // 文字转路径（Config.figureTextToPath）是可选的导出加固：开启时注入端口，关闭时
  // 完全不接线。缺 subprocess 或 Inkscape 时 fail loud（setup_required），不静默
  // 交出仍有字体依赖的图。
  const outlineText: OutlineTextPort | undefined = config.figureTextToPath === true
    ? spec => (subprocess === undefined
      ? Promise.resolve({ ok: false as const, code: 'not_installed' as const, error: '文字转路径需要 subprocess 服务（宿主未挂载 @deepseek-ai/dsh-subprocess）。' })
      : outlineSvgText(subprocess, spec, {
        ...(config.inkscapeExecutable === undefined ? {} : { executable: config.inkscapeExecutable }),
        renderTimeoutMs: renderBudgets.inkscapeRenderTimeoutMs,
      }))
    : undefined
  // 格式导出端口：png/pdf 要落版就必须先出 SVG 再导出，故这一段取决于「本机有没有
  // Inkscape」。可用性在装载时解析一次（与 findFreeCadCmd 同序），工具层据此决定是走
  // 全链还是渲染器直接出图；没有端口时工具层给出「落版与复核未生效」的警告，不静默。
  const exportFigure: ExportFigurePort | undefined = subprocess !== undefined && findInkscape(config.inkscapeExecutable) !== undefined
    ? spec => exportWithInkscape(subprocess, spec, {
      ...(config.inkscapeExecutable === undefined ? {} : { executable: config.inkscapeExecutable }),
      renderTimeoutMs: renderBudgets.inkscapeRenderTimeoutMs,
    })
    : undefined
  // 剖切来源（剖视图的 sections.source）：与结构线稿共用同一段 FreeCAD 通道。宿主未挂载
  // subprocess 时不注入端口，工具层对 source 报 setup_required —— 需要 CAD 就 fail loud，
  // 不静默降级成手写轮廓的示意图。
  const sectionSource: SectionSourcePorts | undefined = subprocess === undefined
    ? undefined
    : {
      sectionGeometry: spec => renderSectionGeometry(subprocess, spec, {
        ...(config.freecadExecutable === undefined ? {} : { executable: config.freecadExecutable }),
        renderTimeoutMs: renderBudgets.freecadRenderTimeoutMs,
      }),
      sectionHatch: spec => renderSectionHatch(subprocess, spec, {
        ...(config.freecadExecutable === undefined ? {} : { executable: config.freecadExecutable }),
        renderTimeoutMs: renderBudgets.freecadRenderTimeoutMs,
      }),
    }
  ctx.tools.register(createGeneratePatentFigureTool({
    render: renderDot,
    ...(outlineText === undefined ? {} : { outlineText }),
    ...(exportFigure === undefined ? {} : { exportFigure }),
    ...(sectionSource === undefined ? {} : { sectionSource }),
    outputDir: resolveFigureOutputDir(config),
    upsertIndex: entry => figureIndexStore.upsert(figureIndexFile, entry),
    loadIndex: async () => (await figureIndexStore.load(figureIndexFile)).entries,
    resolveFont: labels => resolveDotFont(config, labels),
    ...(config.figureRequireCuttingMarks === undefined ? {} : { requireCuttingMarks: config.figureRequireCuttingMarks }),
    ...(config.figureFontMm === undefined ? {} : { figureFontMm: config.figureFontMm }),
    ...(config.figurePageSize === undefined ? {} : { pageSize: config.figurePageSize }),
    ...(config.figureOrientation === undefined ? {} : { orientation: config.figureOrientation }),
    ...(config.figureDpi === undefined ? {} : { dpi: config.figureDpi }),
    ...(config.figureMargin === undefined ? {} : { marginCm: config.figureMargin }),
  }))
  ctx.tools.register(createAddPatentFigureReferencesTool({}))
  // 渲染复核:量测已生成的 SVG 附图(标号是否被线条贯穿、点划线是否被实线覆盖、相邻
  // 零件剖面线是否可区分、内容是否越出画布)。生成后的自动复核在生成工具内部完成,
  // 本工具供已交付/外部生成的 SVG 做交付前自检。
  ctx.tools.register(createVerifyPatentFigureTool(
    config.figureMinFontMm === undefined ? {} : { minFontMm: config.figureMinFontMm },
  ))

  // Structure line-art figure: an independent tool parallel to generate_patent_figure,
  // projecting STEP/IGES/BREP models through the host FreeCAD (TechDraw) via
  // ctx.subprocess. CAD-isolated and off by default (Config.structureFigureEnabled);
  // when the gate is closed or freecadcmd is missing it fails loud with setup
  // guidance at execute — it never silently degrades to a schematic.
  const structureSubprocess = subprocess
  // 注：返回对象字面量的 async 箭头不能直接作三元分支（TS 解析器缺陷），故先提升为具名常量。
  const structureNoSubprocess: GenerateStructureFigureDeps['render'] = () => Promise.resolve({
    ok: false,
    code: 'not_installed',
    error: 'generate_structure_figure 需要 subprocess 服务（宿主未挂载），无法调用 FreeCAD。',
  })
  const structureRender: GenerateStructureFigureDeps['render'] = structureSubprocess === undefined
    ? structureNoSubprocess
    : spec => renderStructureViews(structureSubprocess, spec, {
      ...(config.freecadExecutable === undefined ? {} : { executable: config.freecadExecutable }),
      renderTimeoutMs: renderBudgets.freecadRenderTimeoutMs,
    })
  const structureViews = config.structureFigureViews
  ctx.tools.register(createGenerateStructureFigureTool({
    render: structureRender,
    ...(outlineText === undefined ? {} : { outlineText }),
    ...(config.structureFigureEnabled === undefined ? {} : { enabled: config.structureFigureEnabled }),
    outputDir: resolveFigureOutputDir(config),
    upsertIndex: entry => figureIndexStore.upsert(figureIndexFile, entry),
    ...(config.structureFigureScale === undefined ? {} : { defaultScale: config.structureFigureScale }),
    ...(structureViews === undefined ? {} : { defaultViews: structureViews }),
  }))

  // PDF download: the runner resolves ctx.patentData per call, because
  // patent-data declares inject:['subprocess'] and therefore activates after
  // this plugin (which injects ['tools'] only) — reading the service here would
  // freeze it as undefined in the shipped ordering. The unified ego stack routes
  // the download to ego-browser only; browseros-neo / playwright / browser-use
  // stay out of the download path, and a host without a usable browser falls
  // back to a browser-free scrape of the CDN link.
  const runEgo = createDownloadChannelRunner(() => ctx.get('patentData'))
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
