/**
 * `generate_patent_figure` tool: 从结构化描述生成专利风格附图。
 *
 * 组合链：dot-builder（DOT 构建，默认黑白线条、semantic 可选彩色）→
 * graphviz-renderer（dot CLI 子进程渲染）→ 返回标号映射表与「图N是…；
 * 图中：…」附图说明文字，并按 persist_index 写入既有附图索引
 * （figureIndexStore），使生成图可被 search_patent_figure 检索、被
 * analyze_patent_figure 回读核验。
 *
 * 移植自 Claude-Patent-Creator 的 diagram_generator / add_references
 * 思路（MIT，见包 README 归属）。风格依据《专利审查指南》第一部分第一章
 * 4.3（2023 修订）：「附图一般使用黑色墨水绘制，必要时可以提交彩色附图」。
 * @module @deepseek-ai/dsh-patent-tools/tool/generate-patent-figure
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { PatentToolError } from '../error.ts'
import { FIGURE_TYPES, FIGURE_TYPE_NAMES } from './analyze-patent-figure.ts'
import type { FigureComponent, FigureAnalysisResult, FigureConnection, FigureType } from './analyze-patent-figure.ts'
import type { FigureIndexEntry } from '../figure/index-store.ts'
import type { GraphvizRenderOutcome, GraphvizRenderSpec } from '../figure/graphviz-renderer.ts'
import {
  DIAGRAM_TEMPLATE_NAMES,
  DOT_ENGINES,
  DOT_FORMATS,
  DotBuildError,
  assignNumerals,
  buildBlockDiagramDOT,
  buildComponentHierarchyDOT,
  buildFlowchartDOT,
  buildStateDiagramDOT,
  getDiagramTemplate,
  sanitizeId,
} from '../figure/dot-builder.ts'
import type {
  BlockDiagramBlock,
  BlockDiagramConnection,
  DiagramTemplateName,
  DotEngine,
  DotFormat,
  DotOrientation,
  DotPageSize,
  FlowchartStep,
  HierarchyNode,
  StateNode,
  StateTransition,
} from '../figure/dot-builder.ts'
import { resolvePageBundle } from '../figure/dot-builder.ts'
import { annotateSvgWithLeaderLines } from '../figure/leader-line.ts'
import { figureWordingWarnings } from '../figure/wording-rules.ts'
import { SvgAnnotateError } from '../figure/svg-annotate.ts'
import { TARGET_OFFICES, figureCaption, officeProfile, sheetNumberText } from '../figure/office-profile.ts'
import type { OfficeProfile, TargetOffice } from '../figure/office-profile.ts'
import { buildSubmissionPage } from '../figure/submission-page.ts'
import type { SubmissionLayout, SubmissionPageMetrics } from '../figure/submission-page.ts'
import { drawingComplianceWarnings } from '../figure/compliance.ts'
import { APPEARANCE_VIEW_NAMES_ALL, CIRCUIT_SYMBOL_KIND_NAMES, buildVectorFigure, isVectorFigureType } from '../figure/vector-figure-build.ts'
import type { AppearanceFigureJson, CircuitFigureJson, PlotFigureJson, SectionFigureJson, SequenceFigureJson } from '../figure/vector-figure-build.ts'
import { VectorFigureError, vectorFigureSvg } from '../figure/vector-figure.ts'
import { figureDescription as buildFigureDescription, figureSentence } from '../figure/figure-description.ts'
import { sanitizeDotFilename } from '../figure/graphviz-renderer.ts'
import { COMPONENT_SCHEMA, NUMERAL_MAP_SCHEMA } from './internal/figure-schemas.ts'

/** 原始 DOT 输入大小上限（字节）。 */
const RAW_DOT_MAX_BYTES = 200_000

/** 生成图在索引中的模型标识（确定性生成，无 LLM 参与）。 */
export const FIGURE_GENERATOR_MODEL_USED = 'graphviz-generator'

/** 输入图型。 */
export type GenerateFigureType =
  | DotFigureType
  | 'circuit'
  | 'plot'
  | 'cross_section'
  | 'sequence_diagram'
  | 'appearance_view'

/** Graphviz 节点连线图型（其余图型由 vector-figure-build 直接绘制 SVG）。 */
export type DotFigureType = 'flowchart' | 'state_diagram' | 'block_diagram' | 'component_hierarchy' | 'raw_dot' | 'template'

/** 索引条目类型（供 apply 接线复用）。 */
export type GeneratePatentFigureIndexEntry = FigureIndexEntry

/** 依赖注入。render 为 DOT 渲染；outputDir 为已解析输出目录；upsertIndex 可选持久化。 */
export type GeneratePatentFigureDeps = {
  /** DOT 渲染（graphviz-renderer 的 renderWithGraphviz 或测试注入）。 */
  render: (spec: GraphvizRenderSpec) => Promise<GraphvizRenderOutcome>
  /** 输出目录（绝对路径），默认 <cwd>/patent/figures。 */
  outputDir?: string
  /** 可选 upsert 进附图索引（写入失败静默降级）。 */
  upsertIndex?: (entry: GeneratePatentFigureIndexEntry) => Promise<void>
  /** 可选读取附图索引（figure_family 跨图续号用；声明家族而缺省时调用报错）。 */
  loadIndex?: () => Promise<GeneratePatentFigureIndexEntry[]>
  /** 工作目录（相对路径基准），默认 process.cwd()。 */
  cwd?: string
  /** 平台字体解析（含 CJK 时选平台字体），默认 Helvetica。 */
  resolveFont?: (labels: readonly string[]) => string
  /** 提交规格页面尺寸默认（Config.figurePageSize）。 */
  pageSize?: DotPageSize
  /** 提交规格方向默认（Config.figureOrientation）。 */
  orientation?: DotOrientation
  /** 提交规格 DPI 默认（Config.figureDpi）。 */
  dpi?: number
  /** 提交规格页边距默认，厘米（Config.figureMargin）。 */
  marginCm?: number
}

/** 顶层输入与多面板子图共用的字段：图型选择与结构/矢量输入（各自的 JSON schema 声明同名字段）。 */
type SharedFigureInputFields = {
  /** 图型；缺省时从唯一结构输入推断（steps→flowchart、blocks→block_diagram、tree→component_hierarchy、dot→raw_dot、template→template），多输入或无输入须显式指定。 */
  figure_type?: GenerateFigureType
  steps?: FlowchartStep[]
  states?: StateNode[]
  transitions?: StateTransition[]
  /** 电路图输入（figure_type=circuit）。 */
  circuit?: CircuitFigureJson
  /** 曲线图/坐标图输入（figure_type=plot）。 */
  plot?: PlotFigureJson
  /** 剖视图输入（figure_type=cross_section）。 */
  sections?: SectionFigureJson
  /** 时序图输入（figure_type=sequence_diagram）。 */
  sequence?: SequenceFigureJson
  /** 外观设计视图排布输入（figure_type=appearance_view）。 */
  appearance_views?: AppearanceFigureJson
  blocks?: BlockDiagramBlock[]
  connections?: BlockDiagramConnection[]
  tree?: HierarchyNode[]
  template?: DiagramTemplateName
  dot?: string
}

/** 多面板子图输入（panels 模式；全部面板组件并入一次标号分配，面板后缀拼进文件名 figN<suffix>；figure_type 缺省时按本面板唯一结构输入推断）。 */
export type GeneratePatentFigurePanelInput = SharedFigureInputFields & {
  /** 面板后缀（字母/数字/下划线/连字符，如 A → fig1A.svg）。 */
  suffix: string
  /** 面板显式标号（组件 id → 标号；优先于顶层 numerals 与家族种子）。 */
  numerals?: Record<string, string>
}

/** 生成图输入（与 schema 保持一致）。 */
export type GeneratePatentFigureInput = SharedFigureInputFields & {
  /** 多面板模式（与顶层结构输入互斥）：一次生成多张共享标号系列的面板。 */
  panels?: GeneratePatentFigurePanelInput[]
  figure_number?: number
  invention_name?: string
  /** 显式标号（组件 id → 标号；跨图同件同号续接）。 */
  numerals?: Record<string, string>
  numeral_start?: number
  numeral_step?: number
  /** 发明家族标识（跨图续号）：声明后同名组件沿用既有标号、新组件续接空闲号；缺省每图独立编号。 */
  figure_family?: string
  style?: 'grayscale' | 'semantic'
  filename?: string
  format?: DotFormat
  engine?: DotEngine
  /** 提交规格页面尺寸（覆盖 Config.figurePageSize）。 */
  page_size?: DotPageSize
  /** 提交规格方向（覆盖 Config.figureOrientation）。 */
  orient?: DotOrientation
  /** 渲染分辨率（覆盖 Config.figureDpi；png 栅格生效）。 */
  dpi?: number
  /** 页边距厘米，四边同值（覆盖 Config.figureMargin）。 */
  margin?: number
  /** 引线标号（数字置于部件外侧并以引线相连，仅 SVG 生效）；默认框图/层级图开启、流程图关闭。 */
  leader_lines?: boolean
  /** 目标法域（cnipa/pct/uspto）：给定时按该法域的幅面、页边距、图号写法落版为固定幅面附图页，并核算字高等合规项。 */
  target_office?: TargetOffice
  /** 本案附图总数（≥ figure_number；默认 1）：两幅以上才需逐幅标注图号。 */
  figure_count?: number
  /** 附图页序号（默认 1）。 */
  sheet_index?: number
  /** 附图页总数（默认 1）。 */
  sheet_total?: number
  /** 图号文字覆盖（缺省按目标法域生成「图1」/「Fig. 1」/「FIG. 1」；panels 模式自动追加面板后缀）。 */
  caption?: string
  /** 是否把图形落版到固定幅面（仅 SVG 且给定 target_office 时生效）；false 时只核算尺寸、不改写画布。 */
  fit_to_page?: boolean
  persist_index?: boolean
}

/** 落版结果（target_office 给定时返回；形状与结构线稿工具共用）。 */
export type GeneratePatentFigureLayout = SubmissionLayout

/** 生成图输出（与 schema 保持一致）。 */
export type GeneratePatentFigureOutput = {
  /** 生成的图片路径（工作区相对）。 */
  path: string
  format: DotFormat
  engine: DotEngine
  figureNumber: number
  figureType: FigureType
  /** 附图说明文字（「图N是…示意图；图中：100-名称，102-名称。」），可直接落说明书「附图说明」。 */
  figureDescription: string
  /** 标号映射表（组件 → 标号 → 图号）。 */
  numeralMap: { componentId: string; label: string; numeral: string; figure: number }[]
  /** 组件列表（与 analyze_patent_figure 输出同构）。 */
  components: FigureComponent[]
  /** 连接列表（source/target 为标号）。 */
  connections: FigureConnection[]
  /** 警告（无标号组件等）。 */
  warnings: string[]
  /** 是否已写入附图索引。 */
  indexed: boolean
  /** 落版与合规核算结果（给定 target_office 时）。 */
  layout?: GeneratePatentFigureLayout
  /** 多面板摘要（panels 模式；单图省略）。 */
  panels?: GeneratePatentFigurePanelOutput[]
}

/** 多面板结果的单面板摘要。 */
export type GeneratePatentFigurePanelOutput = {
  /** 面板后缀。 */
  suffix: string
  /** 面板文件路径（工作区相对）。 */
  path: string
  /** 面板图型。 */
  figureType: FigureType
  /** 面板落版与合规核算结果（给定 target_office 时）。 */
  layout?: GeneratePatentFigureLayout
}

/** normalized 视图：结构化字段在 schema 校验 + ?? 归一后恒为数组，figure_type 恒已解析。 */
type NormalizedFigureInput = StructuralFigureInput &
  Omit<GeneratePatentFigureInput, keyof StructuralFigureInput>

/** 单图构建输入（主路径与面板路径共用；数组字段由 normalize 保证恒为数组）。 */
type StructuralFigureInput = {
  figure_type: GenerateFigureType
  steps: FlowchartStep[]
  states: StateNode[]
  transitions: StateTransition[]
  blocks: BlockDiagramBlock[]
  connections: BlockDiagramConnection[]
  tree: HierarchyNode[]
  template?: DiagramTemplateName | undefined
  dot?: string | undefined
  invention_name?: string | undefined
}

/** 图型 → 分析侧 figureType（索引条目与 analyze 输出兼容）。 */
function toFigureType(figureType: GenerateFigureType): FigureType {
  switch (figureType) {
    case 'flowchart':
      return 'flowchart'
    case 'state_diagram':
      return 'state_diagram'
    case 'block_diagram':
      return 'block_diagram'
    case 'component_hierarchy':
      return 'structure'
    case 'template':
      return 'schematic'
    case 'circuit':
      return 'circuit'
    case 'plot':
      return 'plot'
    case 'cross_section':
      return 'cross_section'
    case 'sequence_diagram':
      return 'sequence_diagram'
    case 'appearance_view':
      return 'appearance_view'
    case 'raw_dot':
      return 'unknown'
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new figure type here. */
    default:
      return assertNever(figureType, 'figure type')
  }
}

/** 折叠 label 换行为空格（单行组件名）。 */
function singleLine(label: string): string {
  return label.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 检测存在的结构输入（字段名 + 对应图型；connections 是 blocks 的伴随字段，不计入）。 */
function presentStructuralFields(input: {
  steps?: FlowchartStep[]
  states?: StateNode[]
  blocks?: BlockDiagramBlock[]
  tree?: HierarchyNode[]
  dot?: string | undefined
  template?: DiagramTemplateName | undefined
}): { field: string; figureType: GenerateFigureType }[] {
  const present: { field: string; figureType: GenerateFigureType }[] = []
  if ((input.steps?.length ?? 0) > 0) present.push({ field: 'steps', figureType: 'flowchart' })
  if ((input.states?.length ?? 0) > 0) present.push({ field: 'states', figureType: 'state_diagram' })
  if ((input.blocks?.length ?? 0) > 0) present.push({ field: 'blocks', figureType: 'block_diagram' })
  if ((input.tree?.length ?? 0) > 0) present.push({ field: 'tree', figureType: 'component_hierarchy' })
  if (input.dot !== undefined && input.dot.trim() !== '') present.push({ field: 'dot', figureType: 'raw_dot' })
  if (input.template !== undefined) present.push({ field: 'template', figureType: 'template' })
  return present
}

/** 矢量图型输入字段（字段名 → 图型；与 presentStructuralFields 同形）。 */
const VECTOR_INPUT_FIELDS: readonly { field: keyof GeneratePatentFigureInput; figureType: GenerateFigureType }[] = [
  { field: 'circuit', figureType: 'circuit' },
  { field: 'plot', figureType: 'plot' },
  { field: 'sections', figureType: 'cross_section' },
  { field: 'sequence', figureType: 'sequence_diagram' },
  { field: 'appearance_views', figureType: 'appearance_view' },
]

/** 矢量图型输入的存在性（用于图型推断与互斥校验）。 */
function presentVectorFields(input: GeneratePatentFigureInput): { field: string; figureType: GenerateFigureType }[] {
  return VECTOR_INPUT_FIELDS
    .filter(entry => input[entry.field] !== undefined)
    .map(entry => ({ field: entry.field, figureType: entry.figureType }))
}

/** 图型推断：唯一结构输入决定图型；无输入或多输入报 invalid_tool_input（contextLabel 标注来源，如「面板 B」）。 */
function inferFigureType(input: GeneratePatentFigureInput, contextLabel?: string): GenerateFigureType {
  const present = [...presentStructuralFields(input), ...presentVectorFields(input)]
  const prefix = contextLabel === undefined ? '' : `${contextLabel}：`
  const [single] = present
  if (present.length === 1 && single !== undefined) return single.figureType
  if (present.length === 0) {
    throw new PatentToolError('invalid_tool_input', `${prefix}无法推断图型：未提供结构输入，请显式传入 figure_type 或提供 steps/blocks/tree/dot/template 之一`, { tool: 'generate_patent_figure' })
  }
  throw new PatentToolError('invalid_tool_input', `${prefix}无法推断图型：检测到多个结构输入（${present.map(p => p.field).join('、')}），请显式传入 figure_type`, { tool: 'generate_patent_figure' })
}

/** 收集本图组件（清洗后 id + label，构建顺序；template/raw_dot 无结构还原数据）。 */
function collectComponents(input: StructuralFigureInput): { id: string; label: string }[] {
  switch (input.figure_type) {
    case 'flowchart':
      return input.steps.map(step => ({ id: sanitizeId(step.id), label: step.label }))
    case 'state_diagram':
      // initial 伪状态（label 为空）只画实心小圆，不参与标号分配。
      return input.states
        .filter(state => state.label.trim() !== '')
        .map(state => ({ id: sanitizeId(state.id), label: state.label }))
    case 'block_diagram':
      return input.blocks.map(block => ({ id: sanitizeId(block.id), label: block.label }))
    case 'component_hierarchy': {
      const components: { id: string; label: string }[] = []
      const visit = (node: HierarchyNode): void => {
        components.push({ id: sanitizeId(node.id), label: node.label })
        for (const child of node.children ?? []) visit(child)
      }
      for (const root of input.tree) visit(root)
      return components
    }
    case 'template':
      return []
    case 'raw_dot':
      return []
    case 'circuit':
    case 'plot':
    case 'cross_section':
    case 'sequence_diagram':
    case 'appearance_view':
      // 矢量图型的图面词语由各模块的 labels 给出，这里没有结构化组件可还原。
      return []
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new figure type here. */
    default:
      return assertNever(input.figure_type, 'structural figure input')
  }
}

/** 从 DOT 文本提取双引号 label 属性值（`\n` 还原为换行）；HTML 形式标签不提取。 */
function dotLabels(dot: string): string[] {
  const labels: string[] = []
  const pattern = /\blabel\s*=\s*"((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(dot)) !== null) {
    labels.push((match[1] as string).replace(/\\(.)/g, (_all, char: string) => (char === 'n' ? '\n' : char)))
  }
  return labels
}

/** 收集本图将出现在图面上的词语（节点名 + 边标签；raw_dot 取 DOT 的 label 属性）。 */
function collectFigureWording(input: StructuralFigureInput): string[] {
  switch (input.figure_type) {
    case 'flowchart':
      return input.steps.flatMap(step => [
        step.label,
        ...step.next.flatMap(next => (typeof next === 'string' ? [] : [next.label])),
      ])
    case 'state_diagram':
      return [
        ...input.states.map(state => state.label),
        ...input.transitions.flatMap(transition => (transition.label === undefined ? [] : [transition.label])),
      ]
    case 'block_diagram':
      return [
        ...input.blocks.map(block => block.label),
        ...input.connections.flatMap(connection => (connection.label === undefined ? [] : [connection.label])),
      ]
    case 'component_hierarchy': {
      const labels: string[] = []
      const visit = (node: HierarchyNode): void => {
        labels.push(node.label)
        for (const child of node.children ?? []) visit(child)
      }
      for (const root of input.tree) visit(root)
      return labels
    }
    case 'template':
      return []
    case 'raw_dot':
      /* v8 ignore next -- apply() only routes raw_dot here with dot set; the guard serves standalone library callers */
      return input.dot === undefined ? [] : dotLabels(input.dot)
    case 'circuit':
    case 'plot':
    case 'cross_section':
    case 'sequence_diagram':
    case 'appearance_view':
      return []
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new figure type here. */
    default:
      return assertNever(input.figure_type, 'structural figure input')
  }
}

/** 构造索引用 analysis（确定性生成：组件/连接由输入还原，置信度 1；figureFamily 供跨图续号检索）。 */
function indexAnalysis(
  output: GeneratePatentFigureOutput,
  style: 'grayscale' | 'semantic',
  figureFamily?: string,
): FigureAnalysisResult {
  return {
    imagePath: output.path,
    figureNumber: output.figureNumber,
    figureType: output.figureType,
    overallDescription: `由 generate_patent_figure 生成（${style}）。${output.numeralMap.map(m => `${m.numeral}-${m.label}`).join('，')}`,
    components: output.components,
    connections: output.connections,
    figureDescription: output.figureDescription,
    confidence: 1,
    warnings: output.warnings,
    usable: output.components.length > 0,
    modelUsed: FIGURE_GENERATOR_MODEL_USED,
    ...(figureFamily === undefined ? {} : { figureFamily }),
  }
}

/** 矢量图 SVG 的 `<title>`（不落图面像素）：发明名称缺省时只写图型。 */
function vectorTitle(inventionName: string | undefined, figureType: FigureType): string {
  const title = inventionName === undefined || inventionName.trim() === '' ? '' : `${inventionName.trim()}的`
  return `${title}${FIGURE_TYPE_NAMES[figureType]}`
}

/** 简单文本渲染：标号表 + 附图说明 + 落版信息 + 路径。 */
function renderGenerateFigureResult(value: GeneratePatentFigureOutput): { type: 'text'; text: string }[] {
  const pathLabel = value.panels === undefined
    ? value.path
    : value.panels.map(p => p.path).join('、')
  const layout = value.layout
  const lines = [
    `已生成专利附图（图${value.figureNumber}，${value.format}）：${pathLabel}`,
    '',
    value.figureDescription,
    ...(layout === undefined
      ? []
      : [
        '',
        `## 落版（${layout.office}）`,
        `- 缩放 ${layout.pageScale}，图形 ${layout.placedWidthMm}×${layout.placedHeightMm} 毫米`,
        ...(layout.charHeightMm === undefined ? [] : [`- 字高 ${layout.charHeightMm} 毫米（缩小至三分之二后 ${layout.reducedCharHeightMm} 毫米）`]),
        ...(layout.caption === undefined ? [] : [`- 图号 ${layout.caption}`]),
        `- 页码 ${layout.sheetNumber}`,
      ]),
    '',
    '## 参考标号',
    ...value.numeralMap.map(m => `- ${m.numeral} ${m.label}`),
    ...(value.warnings.length > 0 ? ['', '## 警告', ...value.warnings.map(w => `- ${w}`)] : []),
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

const DESCRIPTION = [
  '生成专利风格附图：流程图（方法步骤）、状态图（状态+转移条件）、系统框图（组件+连接）、组件层级图，以及直接绘制 SVG 的电路图、曲线图/坐标图、剖视图（含剖面线与剖切符号）、时序图、外观设计六面视图排布；另有内置模板与原始 DOT，输出 SVG/PNG/PDF 到工作区 patent/figures/，返回参考标号映射表与「图N是…；图中：…」格式的附图说明文字。撰写权利要求/说明书需要配图时使用。',
  '',
  '标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号，或声明 figure_family 自动续号（同名组件沿用既有标号、新组件取空闲号；缺省每图独立编号）。',
  '',
  '图型推断：figure_type 缺省时从唯一结构输入推断（steps→流程图、states→状态图、blocks→框图、tree→层级图、dot→原始 DOT、template→模板）；同时提供多个结构输入或全空时须显式指定 figure_type。',
  '',
  '多面板：panels 一次生成 FIG.1A/1B 等多张面板（每面板独立文件 figN+后缀，如 A → fig1A.svg），全部面板组件共享一条连续标号系列，附图说明合并输出。',
  '',
  '色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用黑色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用；target_office="pct" 时 semantic 被拒绝（PCT 实施细则 11.13(a) 规定附图不得着色）。',
  '',
  '落版：给定 target_office（cnipa/pct/uspto）时，按该法域的 A4 幅面与页边距把图形落版为固定幅面附图页——图号按法域写法（图1 / Fig. 1 / FIG. 1）画在图形正下方（附图两幅以上才编号，单幅不编号），页码按法域写法（中国「2」、PCT/USPTO「2/3」）画在版心底部；同时返回落版缩放比、落版尺寸与字高（含缩小至三分之二后的字高）并核算合规项。仅 SVG 输出支持落版；fit_to_page=false 时只核算尺寸、不改写画布。',
  '',
  '引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；非 SVG 格式不支持引线，返回警告并保持内嵌标号。引线与标号随图面一起落在画布内，并避开图内已绘的边线与箭头；无引线空间时退化为内嵌标号。',
  '',
  '图面用语检查：生成后按《专利法实施细则》第二十一条与《专利审查指南》第一部分第一章 4.3 检查图面词语与标号——非必需注释（注释前缀/正文引用/尺寸标注/句末标点）、非中文词语（缩写与数字符号除外）、非阿拉伯数字标号各出一条警告；只提示，不改写输入。',
  '',
  '本机未安装 Graphviz 时返回 setup_required 与安装引导。',
].join('\n')

/** 落版结果 schema（单图与 panels 共用）。 */
const LAYOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    office: { type: 'string', required: true, enum: TARGET_OFFICES, description: '目标法域' },
    pageScale: { type: 'number', required: true, description: '落版缩放比' },
    placedWidthMm: { type: 'number', required: true, description: '落版后图形宽（毫米）' },
    placedHeightMm: { type: 'number', required: true, description: '落版后图形高（毫米）' },
    charHeightMm: { type: 'number', description: '落版后图中数字与字母字高（毫米）' },
    reducedCharHeightMm: { type: 'number', description: '再缩小到三分之二后的字高（毫米）' },
    caption: { type: 'string', description: '落版页上的图号' },
    sheetNumber: { type: 'string', required: true, description: '落版页上的页码' },
  },
} as const


/** 电路图元件条目 schema。 */
const CIRCUIT_COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: CIRCUIT_SYMBOL_KIND_NAMES, description: '电气符号种类' },
    label: { type: 'string', description: '元件名（简短词）' },
    col: { type: 'integer', required: true, description: '网格列（0 起）' },
    row: { type: 'integer', required: true, description: '网格行（0 起）' },
  },
} as const

/** 电路图输入 schema。 */
const CIRCUIT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    components: { type: 'array', required: true, items: CIRCUIT_COMPONENT_SCHEMA },
    connections: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { from: { type: 'string', required: true }, to: { type: 'string', required: true }, label: { type: 'string' } },
      },
    },
    cell_width_mm: { type: 'number', description: '单元格宽（毫米），默认 18' },
    cell_height_mm: { type: 'number', description: '单元格高（毫米），默认 14' },
  },
} as const

/** 曲线图数据序列 schema。 */
const PLOT_SERIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    points: { type: 'array', required: true, items: { type: 'array', items: { type: 'number' } } },
    marker: { type: 'string', enum: ['none', 'circle', 'square', 'triangle'] },
  },
} as const

/** 曲线图输入 schema。 */
const PLOT_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    series: { type: 'array', required: true, items: PLOT_SERIES_SCHEMA },
    x_label: { type: 'string', required: true },
    y_label: { type: 'string', required: true },
    x_unit: { type: 'string' },
    y_unit: { type: 'string' },
    x_range: { type: 'array', items: { type: 'number' } },
    y_range: { type: 'array', items: { type: 'number' } },
    tick_count: { type: 'integer', description: '每轴刻度数（2..11），默认 5' },
    show_grid: { type: 'boolean', description: '是否画网格线，默认 false' },
    width_mm: { type: 'number', description: '画布宽（毫米），默认 120' },
    height_mm: { type: 'number', description: '画布高（毫米），默认 80' },
  },
} as const

/** 二维点 schema（[x, y]，毫米）。 */
const POINT_SCHEMA = { type: 'array', required: true, items: { type: 'number' } } as const

/** 剖视图输入 schema。 */
const SECTION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outline: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: '外轮廓顶点对数组（[[x,y],…]）' },
    parts: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          outline: { type: 'array', required: true, items: { type: 'array', items: { type: 'number' } }, description: '零件闭合轮廓（[[x,y],…]，至少 3 点）' },
          hatch: {
            type: 'object',
            additionalProperties: false,
            properties: {
              angle_deg: { type: 'number', description: '剖面线倾角（度），默认 45' },
              spacing_mm: { type: 'number', description: '剖面线间距（毫米），默认 3' },
              direction: { type: 'string', enum: ['forward', 'backward'], description: '相邻零件取相反方向或不同间距以区分' },
            },
          },
        },
      },
    },
    cutting_marks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: '剖切标记字母（如 A）' },
          from: POINT_SCHEMA,
          to: POINT_SCHEMA,
          arrow: { type: 'string', required: true, enum: ['left', 'right', 'up', 'down'], description: '投射方向' },
        },
      },
    },
    padding_mm: { type: 'number', description: '画布留白（毫米），默认 4' },
  },
} as const

/** 时序图输入 schema。 */
const SEQUENCE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    participants: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string', required: true }, label: { type: 'string', required: true } },
      },
    },
    messages: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from: { type: 'string', required: true },
          to: { type: 'string', required: true },
          label: { type: 'string', required: true },
          kind: { type: 'string', enum: ['sync', 'return', 'async'], description: '默认 sync' },
          activate: { type: 'boolean', description: '是否在目标生命线上画激活条，默认 false' },
        },
      },
    },
    box_width_mm: { type: 'number', description: '参与者盒宽（毫米），默认 30' },
    message_spacing_mm: { type: 'number', description: '消息垂直间距（毫米），默认 10' },
    padding_mm: { type: 'number', description: '画布留白（毫米），默认 5' },
  },
} as const

/** 外观设计视图排布输入 schema。 */
const APPEARANCE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    views: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true, enum: APPEARANCE_VIEW_NAMES_ALL, description: '视图名（六面正投影视图）' },
          body: { type: 'string', required: true, description: '调用方提供的视图片段（毫米坐标 SVG 片段）' },
          width_mm: { type: 'number', required: true },
          height_mm: { type: 'number', required: true },
          note: { type: 'string', description: '备注（写入结果 warnings，不落图面；如省略视图的原因）' },
        },
      },
    },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          body: { type: 'string', required: true },
          width_mm: { type: 'number', required: true },
          height_mm: { type: 'number', required: true },
        },
      },
      description: '额外单元格（立体图/使用状态参考图）',
    },
    cell_mm: { type: 'number', description: '单元格最大边长（毫米），默认 60' },
    caption_gap_mm: { type: 'number', description: '视图名与图形的间距（毫米），默认 3' },
    caption_font_mm: { type: 'number', description: '视图名字高（毫米），默认 3.5' },
    padding_mm: { type: 'number', description: '画布留白（毫米），默认 8' },
    first_angle: { type: 'boolean', description: '默认 true：按中国第一角投影排布；false 为第三角' },
  },
} as const

const STEP_SCHEMA = {  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '步骤标识（[A-Za-z0-9_-]，自动清洗）' },
    label: { type: 'string', required: true, description: '步骤显示文本' },
    shape: { type: 'string', enum: ['box', 'ellipse', 'diamond', 'parallelogram', 'cylinder'], description: 'box（默认）/ellipse/diamond/parallelogram/cylinder' },
    next: {
      type: 'array',
      required: true,
      description: '后继：字符串 id，或 {id,label}（判断分支必须带边标签）',
      items: {
        oneOf: [
          { type: 'string' },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              label: { type: 'string', required: true },
            },
          },
        ],
      },
    },
  },
} as const

const STATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: '状态标识（[A-Za-z0-9_-]，自动清洗）' },
    label: { type: 'string', required: true, description: '状态名（initial 伪状态填空串）' },
    kind: { type: 'string', enum: ['normal', 'initial', 'final'], description: 'normal（默认，圆角框）/initial（实心小圆，无标号）/final（双圆框）' },
  },
} as const

const TRANSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
    label: { type: 'string', description: '转移条件（简短词语，可选）' },
  },
} as const

const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true, description: '块名（\\n 换行）' },
    type: { type: 'string', enum: ['input', 'output', 'process', 'storage', 'decision', 'default'], description: 'input/output/process/storage/decision/default' },
  },
} as const

const CONNECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', required: true },
    to: { type: 'string', required: true },
    label: { type: 'string', description: '数据流说明（可选）' },
  },
} as const

const TREE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    label: { type: 'string', required: true },
    children: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
} as const

const PANEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    suffix: { type: 'string', required: true, description: '面板后缀（字母/数字/下划线/连字符；写入 figN+后缀，如 A → fig1A.svg）' },
    figure_type: { type: 'string', enum: ['flowchart', 'state_diagram', 'block_diagram', 'component_hierarchy', 'raw_dot', 'template'], description: '面板图型；缺省从该面板唯一结构输入推断' },
    steps: { type: 'array', items: STEP_SCHEMA, description: '面板流程步骤' },
    states: { type: 'array', items: STATE_SCHEMA, description: '面板状态图状态' },
    transitions: { type: 'array', items: TRANSITION_SCHEMA, description: '面板状态转移' },
    blocks: { type: 'array', items: BLOCK_SCHEMA, description: '面板框图块' },
    connections: { type: 'array', items: CONNECTION_SCHEMA, description: '面板框图连接（blocks 面板）' },
    tree: { type: 'array', items: TREE_SCHEMA, description: '面板组件层级树' },
    template: { type: 'string', enum: DIAGRAM_TEMPLATE_NAMES, description: '面板内置模板' },
    dot: { type: 'string', description: '面板原始 DOT' },
    numerals: { type: 'object', additionalProperties: true, description: '面板显式标号（组件 id → 标号；标号可为字符串或数字，其他类型会被拒绝；优先于顶层 numerals）' },
  },
} as const

/**
 * 把模型传入的 numerals 映射窄化为 dot builder 接受的字符串值映射。
 * schema 对值保持开放（模型常传数字），因此非标量值在此按字段名报错，
 * 而不是让 builder 抛出裸 `TypeError`。
 * @param raw - 工具输入里的 numerals 映射。
 * @param label - 归属说明（顶层或面板后缀），用于错误定位。
 * @returns 组件 id → 标号字符串（id 已清洗）。
 */
function readNumerals(raw: unknown, label: string): Record<string, string> {
  const numerals: Record<string, string> = {}
  for (const [id, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new PatentToolError('invalid_tool_input', `${label} numerals["${id}"] 必须是标号字符串或数字，收到 ${JSON.stringify(value)}`, {
        tool: 'generate_patent_figure',
      })
    }
    numerals[sanitizeId(id)] = String(value)
  }
  return numerals
}

/** 渲染失败统一映射：not_installed→setup_required / aborted→tool_aborted / 其余→tool_execution_failed。 */
function assertRendered(outcome: GraphvizRenderOutcome): asserts outcome is Extract<GraphvizRenderOutcome, { ok: true }> {
  if (outcome.ok) return
  if (outcome.code === 'not_installed') {
    throw new PatentToolError('setup_required', outcome.error, { tool: 'generate_patent_figure' })
  }
  if (outcome.code === 'aborted') {
    throw new PatentToolError('tool_aborted', 'generate_patent_figure aborted', { tool: 'generate_patent_figure' })
  }
  throw new PatentToolError('tool_execution_failed', outcome.error, { tool: 'generate_patent_figure' })
}

/** 读回渲染 SVG 做引线标注并写回；安全校验失败降级为警告（图已生成，不吞工件）。 */
async function annotateRenderedSvg(
  outcomePath: string,
  references: readonly { label: string; numeral: string }[],
  warnings: string[],
): Promise<void> {
  try {
    const rendered = await readFile(outcomePath, 'utf8')
    const annotated = annotateSvgWithLeaderLines(rendered, references)
    if (annotated.svg !== rendered) await writeFile(outcomePath, annotated.svg, 'utf8')
    warnings.push(...annotated.warnings.map(w => `引线标注：${w}`))
  } catch (error) {
    if (error instanceof SvgAnnotateError) {
      warnings.push(`引线标注被跳过：${error.message}`)
    } else {
      throw error
    }
  }
}

/** DOT 正文字号（与 buildDotHeader 的 node fontsize 一致），用于落版后的字高核算。 */
const FIGURE_BODY_FONT_SIZE = 10

/** 落版参数（target_office 给定时解析）。 */
type SubmissionPlan = {
  profile: OfficeProfile
  caption?: string | undefined
  sheetNumber: string
  bodyFontSize: number
  fitToPage: boolean
}

/** 落版执行结果（指标 + 实际写上图面的图号与页码）。 */
type AppliedSubmission = {
  metrics: SubmissionPageMetrics
  caption?: string | undefined
  sheetNumber: string
}

/** 解析落版参数所需的输入字段（结构化输入在 exactOptionalPropertyTypes 下不能直接当作完整工具输入传入）。 */
export type SubmissionPlanInput = {
  target_office?: TargetOffice | undefined
  figure_number?: number | undefined
  figure_count?: number | undefined
  sheet_index?: number | undefined
  sheet_total?: number | undefined
  caption?: string | undefined
  fit_to_page?: boolean | undefined
}

/**
 * 解析落版参数：图号按目标法域生成（panels 模式追加面板后缀），页码按法域写法生成。
 * @param input - 工具输入（或归一化后的结构化输入）。
 * @param suffix - 面板后缀（单图为空串）。
 * @returns 落版参数；未指定 target_office 时 undefined。
 * @throws PatentToolError('invalid_tool_input') 图号、附图总数或页序超出法域写法允许范围时。
 */
function resolveSubmission(input: SubmissionPlanInput, suffix: string): SubmissionPlan | undefined {
  const office = input.target_office
  if (office === undefined) return undefined
  const profile = officeProfile(office)
  let caption: string | undefined
  let sheetNumber: string
  try {
    const base = input.caption ?? figureCaption(profile, input.figure_number ?? 1, input.figure_count ?? 1)
    caption = base === undefined || base === '' ? undefined : `${base}${suffix}`
    sheetNumber = sheetNumberText(profile, input.sheet_index ?? 1, input.sheet_total ?? 1)
  } catch (error) {
    throw new PatentToolError('invalid_tool_input', `落版参数非法：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_patent_figure' })
  }
  return { profile, caption, sheetNumber, bodyFontSize: FIGURE_BODY_FONT_SIZE, fitToPage: input.fit_to_page ?? true }
}

/**
 * 把渲染产物落版到目标法域的固定幅面附图页并写回原文件。
 * @param outcomePath - 渲染产物路径（原地改写）。
 * @param plan - 落版参数。
 * @param format - 输出格式（仅 svg 支持落版）。
 * @param warnings - 收集提示的警告数组。
 * @returns 落版指标与实际图号/页码；格式不支持落版时 undefined。
 */
async function applySubmissionPage(
  outcomePath: string,
  plan: SubmissionPlan,
  format: DotFormat,
  warnings: string[],
): Promise<AppliedSubmission | undefined> {
  if (format !== 'svg') {
    warnings.push(`落版仅支持 SVG 输出；本次 ${format} 未落版到 ${plan.profile.office} 幅面，请改用 format="svg" 或自行拼版`)
    return undefined
  }
  const rendered = await readFile(outcomePath, 'utf8')
  const page = buildSubmissionPage({
    drawingSvg: rendered,
    profile: plan.profile,
    caption: plan.caption,
    sheetNumber: plan.sheetNumber,
    bodyFontSize: plan.bodyFontSize,
  })
  warnings.push(...page.warnings.map(w => `落版：${w}`))
  if (plan.fitToPage) await writeFile(outcomePath, page.svg, 'utf8')
  return { metrics: page.metrics, caption: plan.caption, sheetNumber: plan.sheetNumber }
}

/**
 * 组装落版输出并追加合规核算警告（单图与 panels 共用）。
 * @param plan - 落版参数。
 * @param applied - 落版执行结果。
 * @param style - 本次色彩策略。
 * @param figureCount - 本案附图总数。
 * @param warnings - 收集提示的警告数组。
 * @returns 工具输出的 layout 字段。
 */
function buildLayout(
  plan: SubmissionPlan,
  applied: AppliedSubmission,
  style: 'grayscale' | 'semantic',
  figureCount: number,
  warnings: string[],
): GeneratePatentFigureLayout {
  const { metrics } = applied
  warnings.push(...drawingComplianceWarnings({
    profile: plan.profile,
    style,
    figureCount,
    hasCaption: applied.caption !== undefined,
    metrics,
  }))
  return {
    office: plan.profile.office,
    pageScale: metrics.pageScale,
    placedWidthMm: metrics.placedWidthMm,
    placedHeightMm: metrics.placedHeightMm,
    ...(metrics.charHeightMm === undefined ? {} : { charHeightMm: metrics.charHeightMm }),
    ...(metrics.reducedCharHeightMm === undefined ? {} : { reducedCharHeightMm: metrics.reducedCharHeightMm }),
    ...(applied.caption === undefined ? {} : { caption: applied.caption }),
    sheetNumber: applied.sheetNumber,
  }
}

/** 从既有家族条目收集 组件名 → 标号（索引按图号升序，首个出现优先）。 */
function familyNumeralsByLabel(
  entries: readonly GeneratePatentFigureIndexEntry[],
  family: string,
): Map<string, string> {
  const byLabel = new Map<string, string>()
  for (const entry of entries) {
    if (entry.analysis.figureFamily !== family) continue
    for (const component of entry.analysis.components) {
      const label = singleLine(component.name).toLowerCase()
      if (label === '' || component.refNumber.trim() === '') continue
      if (!byLabel.has(label)) byLabel.set(label, component.refNumber)
    }
  }
  return byLabel
}

/** 把家族既有标号拆成本图种子：本图出现的组件 → explicit（沿用同号），其余 → reserved（占用号段）。 */
function familySeedAssignment(
  byLabel: ReadonlyMap<string, string>,
  components: readonly { id: string; label: string }[],
): { explicit: Record<string, string>; reserved: string[] } {
  const explicit: Record<string, string> = {}
  const reserved: string[] = []
  for (const [label, numeral] of byLabel) {
    const match = components.find(c => singleLine(c.label).toLowerCase() === label)
    if (match === undefined) {
      reserved.push(numeral)
    } else {
      explicit[match.id] = numeral
    }
  }
  return { explicit, reserved }
}

/** 解析跨图续号种子：未声明家族 → 空种子（零读盘）；声明家族 → 读索引并按组件名拆分沿用/占用。 */
async function resolveFamilySeeds(
  figureFamily: string | undefined,
  components: readonly { id: string; label: string }[],
  deps: GeneratePatentFigureDeps,
): Promise<{ explicit: Record<string, string>; reserved: string[] }> {
  if (figureFamily === undefined) return { explicit: {}, reserved: [] }
  if (deps.loadIndex === undefined) {
    throw new PatentToolError('invalid_tool_input', '声明 figure_family 需要宿主注入 loadIndex 依赖（附图索引读取）', { tool: 'generate_patent_figure' })
  }
  let entries: GeneratePatentFigureIndexEntry[]
  try {
    entries = await deps.loadIndex()
  } catch (error) {
    throw new PatentToolError('tool_execution_failed', `读取附图索引失败：${error instanceof Error ? error.message : String(error)}`, { tool: 'generate_patent_figure' })
  }
  return familySeedAssignment(familyNumeralsByLabel(entries, figureFamily), components)
}

/** 单图 DOT 构建参数（主路径与面板路径共用）。 */
type FigureDotParams = {
  figureNumber: number
  numeralsForBuilder: Record<string, string>
  numeralStep?: number | undefined
  style: 'grayscale' | 'semantic'
  fontName: string
  pageBundle: ReturnType<typeof resolvePageBundle>
  leaderLinesActive: boolean
}

/** 单图 DOT 构建共用选项（flowchart/block/hierarchy 共用数值/样式/页面/引线开关）。 */
function buildDotOptions(params: FigureDotParams) {
  const { figureNumber, numeralsForBuilder, numeralStep, style, fontName, pageBundle, leaderLinesActive } = params
  return {
    figureNumber,
    numerals: numeralsForBuilder,
    ...(numeralStep === undefined ? {} : { numeralStep }),
    style,
    fontName,
    ...(pageBundle === undefined ? {} : { page: pageBundle }),
    ...(leaderLinesActive ? { embedNumerals: false } : {}),
  }
}

/** 构建单图 DOT（单图与面板共用；DotBuildError 由调用方映射，面板路径追加面板后缀上下文）。 */
function buildFigureDot(input: StructuralFigureInput & { figure_type: DotFigureType }, params: FigureDotParams): string {
  const { figureNumber, style, fontName, pageBundle, leaderLinesActive } = params
  switch (input.figure_type) {
    case 'flowchart': {
      if (input.steps.length === 0) {
        throw new DotBuildError('empty_input', 'flowchart 需要 steps')
      }
      return buildFlowchartDOT(input.steps, buildDotOptions(params))
    }
    case 'state_diagram': {
      if (input.states.length === 0) {
        throw new DotBuildError('empty_input', 'state_diagram 需要 states')
      }
      return buildStateDiagramDOT(input.states, input.transitions, buildDotOptions(params))
    }
    case 'block_diagram': {
      if (input.blocks.length === 0) {
        throw new DotBuildError('empty_input', 'block_diagram 需要 blocks')
      }
      return buildBlockDiagramDOT(input.blocks, input.connections, buildDotOptions(params))
    }
    case 'component_hierarchy': {
      if (input.tree.length === 0) {
        throw new DotBuildError('empty_input', 'component_hierarchy 需要 tree')
      }
      return buildComponentHierarchyDOT(input.tree, buildDotOptions(params))
    }
    case 'template': {
      if (input.template === undefined) {
        throw new DotBuildError('invalid_template', 'template 模式需要 template 名')
      }
      return getDiagramTemplate(input.template, {
        figureNumber,
        style,
        fontName,
        ...(pageBundle === undefined ? {} : { page: pageBundle }),
        ...(leaderLinesActive ? { embedNumerals: false } : {}),
      })
    }
    case 'raw_dot': {
      if (input.dot === undefined || input.dot.trim() === '') {
        throw new DotBuildError('empty_input', 'raw_dot 需要 dot 内容')
      }
      if (input.dot.length > RAW_DOT_MAX_BYTES) {
        throw new DotBuildError('invalid_template', `raw_dot 输入过大（>${RAW_DOT_MAX_BYTES} 字节）`)
      }
      return input.dot
    }
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new figure type here. */
    default:
      return assertNever(input.figure_type, 'structural figure input')
  }
}

/** panels 模式：全部面板组件并入一次 assignNumerals（FIG.1A/1B 共享连续系列），逐面板构建/渲染/标注后合并输出。 */
async function generatePanels(
  input: GeneratePatentFigureInput,
  context: {
    deps: GeneratePatentFigureDeps
    cwd: string
    format: DotFormat
    engine: DotEngine
    style: 'grayscale' | 'semantic'
    signal: AbortSignal
  },
): Promise<GeneratePatentFigureOutput> {
  const { deps, cwd, format, engine, style, signal } = context
  /* v8 ignore next -- execute() only dispatches here with panels present; ?? guards standalone library callers */
  const panels = input.panels ?? []
  const topLevelFields = presentStructuralFields(input).map(p => p.field)
  if (topLevelFields.length > 0) {
    throw new PatentToolError('invalid_tool_input', `panels 不能与顶层结构输入（${topLevelFields.join('、')}）同时提供`, { tool: 'generate_patent_figure' })
  }
  if (panels.length === 0) {
    throw new PatentToolError('invalid_tool_input', 'panels 不能为空列表', { tool: 'generate_patent_figure' })
  }
  if (input.filename !== undefined) {
    throw new PatentToolError('invalid_tool_input', 'panels 模式按 figN<suffix> 命名输出文件，不接受 filename', { tool: 'generate_patent_figure' })
  }
  for (const panel of panels) {
    if (!/^[A-Za-z0-9_-]+$/.test(panel.suffix)) {
      throw new PatentToolError('invalid_tool_input', `面板后缀只能包含字母/数字/下划线/连字符：${panel.suffix}`, { tool: 'generate_patent_figure' })
    }
  }
  const figureNumber = input.figure_number ?? 1
  // 逐面板解析图型（缺省推断）并构造结构化输入；引线标号按面板图型取默认。
  const panelStructurals = panels.map((panel) => {
    // schema 层已把面板图型限制为 DOT 图型（矢量图型字段不在面板 schema 内），此处按该约束收窄。
    const figureType = (panel.figure_type ?? inferFigureType(panel, `面板 ${panel.suffix}`)) as DotFigureType
    return {
      suffix: panel.suffix,
      figureType,
      // 顶层 leader_lines 强制全部面板；缺省按面板图型取默认（框图/层级图开）。
      leaderLines: input.leader_lines ?? (figureType === 'block_diagram' || figureType === 'component_hierarchy'),
      structural: {
        figure_type: figureType,
        steps: panel.steps ?? [],
        states: panel.states ?? [],
        transitions: panel.transitions ?? [],
        blocks: panel.blocks ?? [],
        connections: panel.connections ?? [],
        tree: panel.tree ?? [],
        template: panel.template,
        dot: panel.dot,
        invention_name: input.invention_name,
      } satisfies StructuralFigureInput,
    }
  })
  const allComponents = panelStructurals.flatMap(ps => collectComponents(ps.structural))
  const fontName = (deps.resolveFont ?? ((): string => 'Helvetica'))(allComponents.map(c => c.label))
  const familySeeds = await resolveFamilySeeds(input.figure_family, allComponents, deps)
  // 显式标号优先级：面板 numerals > 顶层 numerals > 家族种子。
  const panelNumerals: Record<string, string> = {}
  for (const panel of panels) {
    for (const [id, numeral] of Object.entries(readNumerals(panel.numerals, `面板 ${panel.suffix}`))) {
      panelNumerals[id] = numeral
    }
  }
  const explicit: Record<string, string> = {
    ...familySeeds.explicit,
    ...readNumerals(input.numerals, '顶层'),
    ...panelNumerals,
  }
  const assignments = allComponents.length === 0
    ? []
    : assignNumerals(allComponents.map(c => c.id), {
      figureNumber,
      ...(input.numeral_start === undefined ? {} : { start: input.numeral_start }),
      ...(input.numeral_step === undefined ? {} : { step: input.numeral_step }),
      explicit,
      ...(familySeeds.reserved.length === 0 ? {} : { reserved: familySeeds.reserved }),
    })
  const pageBundle = resolvePageBundle({
    pageSize: input.page_size ?? deps.pageSize,
    orientation: input.orient ?? deps.orientation,
    dpi: input.dpi ?? deps.dpi,
    marginCm: input.margin ?? deps.marginCm,
  })

  /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
  const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
  await mkdir(outputDir, { recursive: true })
  const panelOutputs: { suffix: string; output: GeneratePatentFigureOutput }[] = []
  for (const ps of panelStructurals) {
    const panelIds = new Set(collectComponents(ps.structural).map(c => c.id))
    const panelAssignments = assignments.filter(a => panelIds.has(a.id))
    const numeralsForBuilder = Object.fromEntries(panelAssignments.map(a => [a.id, a.numeral]))
    const numeralBy = new Map(panelAssignments.map(a => [a.id, a.numeral]))
    const leaderLinesActive = ps.leaderLines && format === 'svg'
    let dot: string
    try {
      dot = buildFigureDot(ps.structural, {
        figureNumber,
        numeralsForBuilder,
        numeralStep: input.numeral_step,
        style,
        fontName,
        pageBundle,
        leaderLinesActive,
      })
    } catch (error) {
      /* v8 ignore start -- builders only throw DotBuildError; keep the rethrow loud for invariant drift */
      if (error instanceof DotBuildError) {
        throw new PatentToolError('invalid_tool_input', `附图内容校验失败（面板 ${ps.suffix}）：${error.message}`, { tool: 'generate_patent_figure' })
      }
      throw error
      /* v8 ignore stop */
    }
    const outcome = await deps.render({
      dot,
      filename: `fig${figureNumber}${ps.suffix}`,
      format,
      engine,
      outputDir,
      signal,
    })
    assertRendered(outcome)
    const output = buildOutput(ps.structural, {
      cwd,
      outcomePath: outcome.path,
      figureNumber,
      format,
      engine,
      figureType: toFigureType(ps.figureType),
      numeralBy,
      suffix: ps.suffix,
    })
    if (leaderLinesActive) {
      await annotateRenderedSvg(outcome.path, output.numeralMap, output.warnings)
    }
    const plan = resolveSubmission(input, ps.suffix)
    if (plan !== undefined) {
      const applied = await applySubmissionPage(outcome.path, plan, format, output.warnings)
      if (applied !== undefined) {
        output.layout = buildLayout(plan, applied, style, input.figure_count ?? 1, output.warnings)
      }
    }
    panelOutputs.push({ suffix: ps.suffix, output })
  }

  // 合并输出：面板句各一句 + 全部面板共用一条「图中」标号表。
  const mergedNumerals = panelOutputs.flatMap(po => po.output.numeralMap)
  const sentences = panelOutputs.map(po => figureSentence(
    figureNumber,
    FIGURE_TYPE_NAMES[po.output.figureType],
    input.invention_name,
    po.suffix,
  ))
  const sharedNumerals = mergedNumerals.map(m => `${m.numeral}-${m.label}`).join('，')
  const figureDescription = sharedNumerals === ''
    ? `${sentences.join('；')}。`
    : `${sentences.join('；')}；图中：${sharedNumerals}。`
  const warnings = panelOutputs.flatMap(po => po.output.warnings)
  if (panelStructurals.some(ps => ps.leaderLines) && format !== 'svg') {
    warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
  }
  warnings.push(...figureWordingWarnings(
    panelStructurals.flatMap(ps => collectFigureWording(ps.structural)),
    mergedNumerals.map(entry => entry.numeral),
  ))
  let indexed = false
  if ((input.persist_index ?? true) && deps.upsertIndex !== undefined) {
    indexed = true
    for (const po of panelOutputs) {
      try {
        await deps.upsertIndex({
          imagePath: po.output.path,
          analyzedAt: new Date().toISOString(),
          analysis: indexAnalysis(po.output, style, input.figure_family),
        })
      } catch (error) {
        // 索引写入是可选增强：任一面板写入失败降级为警告，不阻断生成结果返回；
        // 留痕失败原因——索引缺失会使 search_patent_figure 漏检、figure_family 续号漏号。
        indexed = false
        warnings.push(`面板 ${po.suffix} 附图索引写入失败（不阻断）：${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  /* v8 ignore start -- panels is validated non-empty above, so the first panel always exists */
  return {
    path: panelOutputs[0]?.output.path ?? '',
    format,
    engine,
    figureNumber,
    figureType: panelOutputs[0]?.output.figureType ?? 'unknown',
    figureDescription,
    numeralMap: mergedNumerals,
    components: panelOutputs.flatMap(po => po.output.components),
    connections: panelOutputs.flatMap(po => po.output.connections),
    warnings,
    indexed,
    panels: panelOutputs.map(po => ({
      suffix: po.suffix,
      path: po.output.path,
      figureType: po.output.figureType,
      ...(po.output.layout === undefined ? {} : { layout: po.output.layout }),
    })),
  }
  /* v8 ignore stop */
}

/**
 * Build the `generate_patent_figure` tool over injected renderer.
 * @param deps - renderer + optional output dir / index upsert / cwd / font resolver.
 * @returns a registry-ready tool definition.
 */
export function createGeneratePatentFigureTool(deps: GeneratePatentFigureDeps): ToolDefinition {
  return defineTool({
    name: 'generate_patent_figure',
    description: DESCRIPTION,
    parameters: {
      figure_type: {
        type: 'string',
        enum: ['flowchart', 'state_diagram', 'block_diagram', 'component_hierarchy', 'circuit', 'plot', 'cross_section', 'sequence_diagram', 'appearance_view', 'raw_dot', 'template'],
        description: '图型；缺省时从唯一结构输入推断（steps→flowchart、states→state_diagram、blocks→block_diagram、tree→component_hierarchy、circuit/plot/sections/sequence/appearance_views→同名图型、dot→raw_dot、template→template），多输入或无输入须显式指定',
      },
      steps: { type: 'array', items: STEP_SCHEMA, description: '流程图步骤（figure_type=flowchart 时必填）' },
      states: { type: 'array', items: STATE_SCHEMA, description: '状态图状态（figure_type=state_diagram 时必填）' },
      transitions: { type: 'array', items: TRANSITION_SCHEMA, description: '状态转移（state_diagram；端点必须存在于 states）' },
      circuit: { ...CIRCUIT_INPUT_SCHEMA, description: '电路图输入（figure_type=circuit 时必填）：元件按网格行列放置，连线正交走线，T 形结点画实心连接点' },
      plot: { ...PLOT_INPUT_SCHEMA, description: '曲线图/坐标图输入（figure_type=plot 时必填）：坐标轴 + 刻度 + 单位 + 多条序列（用标记形状区分，不用颜色）' },
      sections: { ...SECTION_INPUT_SCHEMA, description: '剖视图输入（figure_type=cross_section 时必填）：零件轮廓 + 45° 剖面线（相邻件方向相反或间距不等）+ 剖切位置符号' },
      sequence: { ...SEQUENCE_INPUT_SCHEMA, description: '时序图输入（figure_type=sequence_diagram 时必填）：参与者生命线 + 消息箭线' },
      appearance_views: { ...APPEARANCE_INPUT_SCHEMA, description: '外观设计视图排布输入（figure_type=appearance_view 时必填）：把调用方提供的六面视图片段按第一角投影排布并统一比例、逐视图标注视图名称' },
      blocks: { type: 'array', items: BLOCK_SCHEMA, description: '框图块（figure_type=block_diagram 时必填）' },
      connections: {
        type: 'array',
        items: CONNECTION_SCHEMA,
        description: '框图连接（block_diagram）',
      },
      tree: {
        type: 'array',
        items: TREE_SCHEMA,
        description: '组件层级树（component_hierarchy，任意深度）',
      },
      template: {
        type: 'string',
        enum: DIAGRAM_TEMPLATE_NAMES,
        description: '内置模板（figure_type=template 时必填）：simple_flowchart/system_block/method_steps/component_hierarchy',
      },
      dot: { type: 'string', description: '原始 Graphviz DOT（figure_type=raw_dot）' },
      panels: { type: 'array', items: PANEL_SCHEMA, description: '多面板模式：一次生成多张共享标号系列的面板（fig1A/fig1B…）；与顶层结构输入互斥，列表不可为空' },
      figure_number: { type: 'integer', description: '图号，默认 1（决定标号系列起点）' },
      invention_name: { type: 'string', description: '发明名称（附图说明模板句）' },
      numerals: { type: 'object', additionalProperties: true, description: '显式标号（组件 id → 标号；标号可为字符串或数字，其他类型会被拒绝；跨图同件同号续接）' },
      numeral_start: { type: 'integer', description: '自动标号系列起点覆盖' },
      numeral_step: { type: 'integer', description: '标号步进，默认 2' },
      figure_family: { type: 'string', description: '发明家族标识（跨图续号）：声明后同名组件沿用既有标号、新组件续接空闲号；缺省每图独立编号' },
      style: { type: 'string', enum: ['grayscale', 'semantic'], description: '色彩策略，默认 grayscale' },
      filename: { type: 'string', description: '输出文件名（不含扩展名）' },
      format: { type: 'string', enum: DOT_FORMATS, description: '输出格式，默认 svg' },
      engine: { type: 'string', enum: DOT_ENGINES, description: '布局引擎，默认 dot' },
      page_size: { type: 'string', enum: ['a4', 'letter'], description: '页面尺寸（提交规格）；默认取部署配置' },
      orient: { type: 'string', enum: ['portrait', 'landscape'], description: '页面方向；默认 portrait，取部署配置' },
      dpi: { type: 'integer', description: '渲染分辨率（png 栅格生效）；默认取部署配置' },
      margin: { type: 'number', description: '页边距（厘米，四边同值）；默认取部署配置' },
      leader_lines: { type: 'boolean', description: '引线标号（数字置于部件外侧并以引线相连，仅 SVG 生效）；默认框图/层级图开启、流程图关闭' },
      target_office: {
        type: 'string',
        enum: TARGET_OFFICES,
        description: '目标法域：给定时按该法域的 A4 幅面、页边距、图号写法（图1/Fig. 1/FIG. 1）把图形落版为固定幅面附图页，并核算落版字高与色彩合规；仅 SVG 生效',
      },
      figure_count: { type: 'integer', description: '本案附图总数（默认 1）：两幅以上才逐幅标注图号（中国指南 4.3、PCT 11.13(k)、37 CFR 1.84(u)）' },
      sheet_index: { type: 'integer', description: '附图页序号，默认 1' },
      sheet_total: { type: 'integer', description: '附图页总数，默认 1（PCT/USPTO 页码写作「序号/总数」）' },
      caption: { type: 'string', description: '图号文字覆盖（缺省按目标法域生成；panels 模式自动追加面板后缀，如 图1A / Fig. 1A）' },
      fit_to_page: { type: 'boolean', description: '默认 true：把图形落版到目标法域幅面（仅 SVG）；false 时只核算尺寸、不改写画布' },
      persist_index: { type: 'boolean', description: '默认 true：写入附图索引（供 search_patent_figure 检索）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          format: { type: 'string', required: true, enum: DOT_FORMATS },
          engine: { type: 'string', required: true, enum: DOT_ENGINES },
          figureNumber: { type: 'integer', required: true },
          figureType: { type: 'string', required: true, enum: FIGURE_TYPES },
          figureDescription: { type: 'string', required: true },
          numeralMap: { type: 'array', required: true, items: NUMERAL_MAP_SCHEMA },
          components: { type: 'array', required: true, items: COMPONENT_SCHEMA },
          connections: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                source: { type: 'string', required: true },
                target: { type: 'string', required: true },
                kind: { type: 'string', required: true, enum: ['electrical', 'mechanical', 'data_flow', 'unknown'] },
                description: { type: 'string', required: true },
              },
            },
          },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          indexed: { type: 'boolean', required: true },
          layout: { ...LAYOUT_SCHEMA, description: '落版与合规核算结果（给定 target_office 时）' },
          panels: {
            type: 'array',
            description: '多面板摘要（panels 模式）',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                suffix: { type: 'string', required: true },
                path: { type: 'string', required: true },
                figureType: { type: 'string', required: true, enum: FIGURE_TYPES },
                layout: { ...LAYOUT_SCHEMA, description: '面板落版与合规核算结果（给定 target_office 时）' },
              },
            },
          },
        },
      },
      render: (_args, value) => renderGenerateFigureResult(value),
    },
    async execute(args, exec) {
      // schema 校验后的模型 JSON 边界；深层结构（层次树递归）由 build 函数校验。
      const input = args as unknown as GeneratePatentFigureInput
      const cwd = deps.cwd ?? process.cwd()
      const format = input.format ?? 'svg'
      const engine = input.engine ?? 'dot'
      const style = input.style === 'semantic' ? 'semantic' : 'grayscale'
      if (input.target_office === 'pct' && style === 'semantic') {
        throw new PatentToolError('invalid_tool_input', 'PCT 附图不得着色（PCT 实施细则 11.13(a)）：target_office="pct" 时请使用 style="grayscale"', { tool: 'generate_patent_figure' })
      }
      if (input.panels !== undefined) {
        return generatePanels(input, { deps, cwd, format, engine, style, signal: exec.signal })
      }
      // 树/嵌套结构在 schema 层只做了形状约束，此处窄化为领域类型后统一下传；
      // 图型显式优先，缺省从唯一结构输入推断（歧义/为空报 invalid_tool_input）。
      const normalized: NormalizedFigureInput = {
        ...input,
        figure_type: input.figure_type ?? inferFigureType(input),
        steps: input.steps ?? [],
        states: input.states ?? [],
        transitions: input.transitions ?? [],
        blocks: input.blocks ?? [],
        connections: input.connections ?? [],
        tree: input.tree ?? [],
      }
      const figureNumber = normalized.figure_number ?? 1
      // 引线标号默认按图型：框图/层级图开、流程图关；仅 SVG 生效。
      const leaderLines = normalized.leader_lines ?? (normalized.figure_type === 'block_diagram' || normalized.figure_type === 'component_hierarchy')
      const leaderLinesActive = leaderLines && format === 'svg'
      const components = collectComponents(normalized)
      const fontName = (deps.resolveFont ?? ((): string => 'Helvetica'))(components.map(c => c.label))
      const ids = components.map(c => c.id)

      // 跨图续号种子 + 一次分配、双处使用：分配结果同时作为 builder 的显式标号（图面一致）与输出标号表。
      const familySeeds = await resolveFamilySeeds(normalized.figure_family, components, deps)
      let numeralsForBuilder: Record<string, string> = {}
      let numeralBy = new Map<string, string>()
      try {
        // 显式标号优先级：调用方 numerals > 家族种子。
        const explicit = {
          ...familySeeds.explicit,
          ...readNumerals(normalized.numerals, '顶层'),
        }
        const assignments = ids.length === 0
          ? []
          : assignNumerals(ids, {
            figureNumber,
            ...(normalized.numeral_start === undefined ? {} : { start: normalized.numeral_start }),
            ...(normalized.numeral_step === undefined ? {} : { step: normalized.numeral_step }),
            explicit,
            ...(familySeeds.reserved.length === 0 ? {} : { reserved: familySeeds.reserved }),
          })
        numeralsForBuilder = Object.fromEntries(assignments.map(a => [a.id, a.numeral]))
        numeralBy = new Map(assignments.map(a => [a.id, a.numeral]))
      } catch (error) {
        /* v8 ignore start -- assignNumerals only throws DotBuildError; keep the rethrow loud for invariant drift */
        if (error instanceof DotBuildError) {
          throw new PatentToolError('invalid_tool_input', `标号分配失败：${error.message}`, { tool: 'generate_patent_figure' })
        }
        throw error
        /* v8 ignore stop */
      }

      /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
      const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
      await mkdir(outputDir, { recursive: true })
      const filename = normalized.filename ?? `fig${figureNumber}`
      // 两条通路：矢量图型直接绘制 SVG（无 Graphviz 依赖）；其余图型构建 DOT 交渲染器。
      let outcomePath: string
      let vectorLabels: readonly string[] | undefined
      let vectorWarnings: readonly string[] = []
      if (isVectorFigureType(normalized.figure_type)) {
        if (format !== 'svg') {
          throw new PatentToolError('invalid_tool_input', `${normalized.figure_type} 是 SVG 直绘图型，仅支持 format="svg"`, { tool: 'generate_patent_figure' })
        }
        let build
        try {
          build = buildVectorFigure(normalized.figure_type, normalized)
        } catch (error) {
          if (error instanceof VectorFigureError) {
            throw new PatentToolError('invalid_tool_input', `${normalized.figure_type} 输入校验失败：${error.message}`, { tool: 'generate_patent_figure' })
          }
          throw error
        }
        outcomePath = join(outputDir, `${sanitizeDotFilename(filename)}.svg`)
        await writeFile(outcomePath, vectorFigureSvg(build.spec, vectorTitle(normalized.invention_name, toFigureType(normalized.figure_type))), 'utf8')
        vectorLabels = build.spec.labels
        vectorWarnings = build.warnings
      } else {
        const dotInput: StructuralFigureInput & { figure_type: DotFigureType } = { ...normalized, figure_type: normalized.figure_type }
        let dot: string
        try {
          // per-call 覆盖部署默认；四项全缺省时不输出任何布局属性（零回归）。
          const pageBundle = resolvePageBundle({
            pageSize: normalized.page_size ?? deps.pageSize,
            orientation: normalized.orient ?? deps.orientation,
            dpi: normalized.dpi ?? deps.dpi,
            marginCm: normalized.margin ?? deps.marginCm,
          })
          dot = buildFigureDot(dotInput, {
            figureNumber,
            numeralsForBuilder,
            numeralStep: normalized.numeral_step,
            style,
            fontName,
            pageBundle,
            leaderLinesActive,
          })
        } catch (error) {
          /* v8 ignore start -- builders only throw DotBuildError; keep the rethrow loud for invariant drift */
          if (error instanceof DotBuildError) {
            throw new PatentToolError('invalid_tool_input', `附图内容校验失败：${error.message}`, { tool: 'generate_patent_figure' })
          }
          throw error
          /* v8 ignore stop */
        }
        const outcome = await deps.render({
          dot,
          filename,
          format,
          engine,
          outputDir,
          signal: exec.signal,
        })
        assertRendered(outcome)
        outcomePath = outcome.path
      }

      const result = buildOutput(normalized, {
        cwd,
        outcomePath,
        figureNumber,
        format,
        engine,
        figureType: toFigureType(normalized.figure_type),
        numeralBy,
      })
      if (leaderLines && !leaderLinesActive) {
        result.warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
      } else if (leaderLinesActive) {
        await annotateRenderedSvg(outcomePath, result.numeralMap, result.warnings)
      }
      result.warnings.push(...vectorWarnings)
      result.warnings.push(...figureWordingWarnings(
        vectorLabels ?? collectFigureWording(normalized),
        result.numeralMap.map(entry => entry.numeral),
      ))
      const submissionPlan = resolveSubmission(normalized, '')
      if (submissionPlan !== undefined) {
        const applied = await applySubmissionPage(outcomePath, submissionPlan, format, result.warnings)
        if (applied !== undefined) {
          result.layout = buildLayout(submissionPlan, applied, style, normalized.figure_count ?? 1, result.warnings)
        }
      }
      let indexed = false
      if ((normalized.persist_index ?? true) && deps.upsertIndex !== undefined) {
        try {
          await deps.upsertIndex({
            imagePath: result.path,
            analyzedAt: new Date().toISOString(),
            analysis: indexAnalysis(result, style, normalized.figure_family),
          })
          indexed = true
        } catch (error) {
          // 索引写入是可选增强：写入失败降级为警告，不阻断生成结果返回；
          // 留痕失败原因——索引缺失会使 search_patent_figure 漏检、figure_family 续号漏号。
          result.warnings.push(`附图索引写入失败（不阻断）：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return { ...result, indexed }
    },
  })
}

/** 组装输出：组件/连接/标号表/附图说明（raw_dot 与 template 无结构化还原数据）。 */
function buildOutput(
  input: StructuralFigureInput,
  params: {
    cwd: string
    outcomePath: string
    figureNumber: number
    format: DotFormat
    engine: DotEngine
    figureType: FigureType
    numeralBy: Map<string, string>
    /** 面板后缀（panels 模式；进入「图N<suffix>」句式）。 */
    suffix?: string
  },
): GeneratePatentFigureOutput {
  const { cwd, outcomePath, figureNumber, format, engine, figureType } = params
  const path = relative(cwd, outcomePath)
  const numeralMap: GeneratePatentFigureOutput['numeralMap'] = []
  const components: FigureComponent[] = []
  const warnings: string[] = []
  const descriptor = (rawId: string, label: string): void => {
    const id = sanitizeId(rawId)
    /* v8 ignore start -- every structured component receives a numeral from the shared assignment; the empty branch is unreachable */
    const numeral = params.numeralBy.get(id) ?? ''
    if (numeral === '') {
      warnings.push(`组件 ${label} 未获得标号（raw_dot/template 无结构还原数据）`)
      return
    }
    /* v8 ignore stop */
    numeralMap.push({ componentId: id, label: singleLine(label), numeral, figure: figureNumber })
    components.push({ refNumber: numeral, name: singleLine(label), kind: 'unknown', description: singleLine(label) })
  }

  // 连接按输入还原（source/target 转标号；raw_dot 与 template 无结构数据）。
  const connections: FigureConnection[] = []
  for (const step of input.steps) {
    descriptor(step.id, step.label)
  }
  for (const state of input.states) {
    // initial 伪状态无文字标签，不进入标号表（与 collectComponents 同规则）。
    if (state.label.trim() !== '') descriptor(state.id, state.label)
  }
  for (const block of input.blocks) {
    descriptor(block.id, block.label)
  }
  const walk = (node: HierarchyNode): void => {
    descriptor(node.id, node.label)
    /* v8 ignore start -- normalized trees always carry arrays; ?? guards only the standalone callers */
    for (const child of node.children ?? []) walk(child)
    /* v8 ignore stop */
  }
  for (const root of input.tree) walk(root)
  for (const conn of input.connections) {
    /* v8 ignore start -- build validation guarantees from/to carry numerals; the skip branch is unreachable */
    const source = params.numeralBy.get(sanitizeId(conn.from))
    const target = params.numeralBy.get(sanitizeId(conn.to))
    if (source === undefined || target === undefined) continue
    /* v8 ignore stop */
    connections.push({ source, target, kind: 'data_flow', description: conn.label === undefined ? '' : singleLine(conn.label) })
  }

  const description = buildFigureDescription({
    figureNumber,
    figureTypeName: FIGURE_TYPE_NAMES[figureType],
    inventionName: input.invention_name,
    ...(params.suffix === undefined ? {} : { suffix: params.suffix }),
    numerals: numeralMap,
  })

  const result: GeneratePatentFigureOutput = {
    path,
    format,
    engine,
    figureNumber,
    figureType,
    figureDescription: description,
    numeralMap,
    components,
    connections,
    warnings,
    indexed: false,
  }
  return result
}
