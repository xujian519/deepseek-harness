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
 * 4.3（2023 修订）：「附图一般使用墨色墨水绘制，必要时可以提交彩色附图」。
 * @module @deepseek-ai/dsh-patent-tools/tool/generate-patent-figure
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../error.ts'
import { FIGURE_TYPE_NAMES } from './analyze-patent-figure.ts'
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
} from '../figure/dot-builder.ts'
import { resolvePageBundle } from '../figure/dot-builder.ts'
import { annotateSvgWithLeaderLines } from '../figure/leader-line.ts'
import { SvgAnnotateError } from '../figure/svg-annotate.ts'

/** 原始 DOT 输入大小上限（字节）。 */
const RAW_DOT_MAX_BYTES = 200_000

/** 生成图在索引中的模型标识（确定性生成，无 LLM 参与）。 */
export const FIGURE_GENERATOR_MODEL_USED = 'graphviz-generator'

/** 输入图型。 */
export type GenerateFigureType = 'flowchart' | 'block_diagram' | 'component_hierarchy' | 'raw_dot' | 'template'

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

/** 多面板子图输入（panels 模式；全部面板组件并入一次标号分配，面板后缀拼进文件名 figN<suffix>）。 */
export type GeneratePatentFigurePanelInput = {
  /** 面板后缀（字母/数字/下划线/连字符，如 A → fig1A.svg）。 */
  suffix: string
  /** 面板图型；缺省从该面板唯一结构输入推断（规则与顶层一致）。 */
  figure_type?: GenerateFigureType
  steps?: FlowchartStep[]
  blocks?: BlockDiagramBlock[]
  connections?: BlockDiagramConnection[]
  tree?: HierarchyNode[]
  template?: DiagramTemplateName
  dot?: string
  /** 面板显式标号（组件 id → 标号；优先于顶层 numerals 与家族种子）。 */
  numerals?: Record<string, string>
}

/** 生成图输入（与 schema 保持一致）。 */
export type GeneratePatentFigureInput = {
  /** 图型；缺省时从唯一结构输入推断（steps→flowchart、blocks→block_diagram、tree→component_hierarchy、dot→raw_dot、template→template），多输入或无输入须显式指定。 */
  figure_type?: GenerateFigureType
  steps?: FlowchartStep[]
  blocks?: BlockDiagramBlock[]
  connections?: BlockDiagramConnection[]
  tree?: HierarchyNode[]
  template?: DiagramTemplateName
  dot?: string
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
  persist_index?: boolean
}

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
}

/** normalized 视图：结构化字段在 schema 校验 + ?? 归一后恒为数组，figure_type 恒已解析。 */
type NormalizedFigureInput = StructuralFigureInput &
  Omit<GeneratePatentFigureInput, keyof StructuralFigureInput>

/** 单图构建输入（主路径与面板路径共用；数组字段由 normalize 保证恒为数组）。 */
type StructuralFigureInput = {
  figure_type: GenerateFigureType
  steps: FlowchartStep[]
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
    case 'block_diagram':
      return 'block_diagram'
    case 'component_hierarchy':
      return 'structure'
    case 'template':
      return 'schematic'
    case 'raw_dot':
      return 'unknown'
  }
}

/** 折叠 label 换行为空格（单行组件名）。 */
function singleLine(label: string): string {
  return label.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 检测存在的结构输入（字段名 + 对应图型；connections 是 blocks 的伴随字段，不计入）。 */
function presentStructuralFields(input: {
  steps?: FlowchartStep[]
  blocks?: BlockDiagramBlock[]
  tree?: HierarchyNode[]
  dot?: string | undefined
  template?: DiagramTemplateName | undefined
}): { field: string; figureType: GenerateFigureType }[] {
  const present: { field: string; figureType: GenerateFigureType }[] = []
  if ((input.steps?.length ?? 0) > 0) present.push({ field: 'steps', figureType: 'flowchart' })
  if ((input.blocks?.length ?? 0) > 0) present.push({ field: 'blocks', figureType: 'block_diagram' })
  if ((input.tree?.length ?? 0) > 0) present.push({ field: 'tree', figureType: 'component_hierarchy' })
  if (input.dot !== undefined && input.dot.trim() !== '') present.push({ field: 'dot', figureType: 'raw_dot' })
  if (input.template !== undefined) present.push({ field: 'template', figureType: 'template' })
  return present
}

/** 图型推断：唯一结构输入决定图型；无输入或多输入报 invalid_tool_input（contextLabel 标注来源，如「面板 B」）。 */
function inferFigureType(input: Parameters<typeof presentStructuralFields>[0], contextLabel?: string): GenerateFigureType {
  const present = presentStructuralFields(input)
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

/** 发明名称缺省兜底（附图说明模板句）。 */
function resolveInvention(name: string | undefined): string {
  return name === undefined || name.trim() === '' ? '本申请' : name.trim()
}

/** 附图说明句（图N<suffix>是…的…）。 */
function figureSentence(figureNumber: number, suffix: string, invention: string, figureType: FigureType): string {
  return `图${figureNumber}${suffix}是${invention}的${FIGURE_TYPE_NAMES[figureType]}`
}

/** 简单文本渲染：标号表 + 附图说明 + 路径。 */
function renderGenerateFigureResult(value: GeneratePatentFigureOutput): { type: 'text'; text: string }[] {
  const pathLabel = value.panels === undefined
    ? value.path
    : value.panels.map(p => p.path).join('、')
  const lines = [
    `已生成专利附图（图${value.figureNumber}，${value.format}）：${pathLabel}`,
    '',
    value.figureDescription,
    '',
    '## 参考标号',
    ...value.numeralMap.map(m => `- ${m.numeral} ${m.label}`),
    ...(value.warnings.length > 0 ? ['', '## 警告', ...value.warnings.map(w => `- ${w}`)] : []),
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

const DESCRIPTION = [
  '生成专利风格附图：流程图（方法步骤）、系统框图（组件+连接）、组件层级图、内置模板或原始 DOT，输出 SVG/PNG/PDF 到工作区 patent/figures/，返回参考标号映射表与「图N是…；图中：…」格式的附图说明文字。撰写权利要求/说明书需要配图时使用。',
  '',
  '标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号，或声明 figure_family 自动续号（同名组件沿用既有标号、新组件取空闲号；缺省每图独立编号）。',
  '',
  '图型推断：figure_type 缺省时从唯一结构输入推断（steps→流程图、blocks→框图、tree→层级图、dot→原始 DOT、template→模板）；同时提供多个结构输入或全空时须显式指定 figure_type。',
  '',
  '多面板：panels 一次生成 FIG.1A/1B 等多张面板（每面板独立文件 figN+后缀，如 A → fig1A.svg），全部面板组件共享一条连续标号系列，附图说明合并输出。',
  '',
  '色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用墨色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用。',
  '',
  '引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；非 SVG 格式不支持引线，返回警告并保持内嵌标号。',
  '',
  '本机未安装 Graphviz 时返回 setup_required 与安装引导。',
].join('\n')

const STEP_SCHEMA = {
  type: 'object',
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
    figure_type: { type: 'string', enum: ['flowchart', 'block_diagram', 'component_hierarchy', 'raw_dot', 'template'], description: '面板图型；缺省从该面板唯一结构输入推断' },
    steps: { type: 'array', items: STEP_SCHEMA, description: '面板流程步骤' },
    blocks: { type: 'array', items: BLOCK_SCHEMA, description: '面板框图块' },
    connections: { type: 'array', items: CONNECTION_SCHEMA, description: '面板框图连接（blocks 面板）' },
    tree: { type: 'array', items: TREE_SCHEMA, description: '面板组件层级树' },
    template: { type: 'string', enum: DIAGRAM_TEMPLATE_NAMES, description: '面板内置模板' },
    dot: { type: 'string', description: '面板原始 DOT' },
    numerals: { type: 'object', additionalProperties: true, description: '面板显式标号（组件 id → 标号；优先于顶层 numerals）' },
  },
} as const

const NUMERAL_MAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    componentId: { type: 'string', required: true },
    label: { type: 'string', required: true },
    numeral: { type: 'string', required: true },
    figure: { type: 'integer', required: true },
  },
} as const

const COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refNumber: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: ['mechanical', 'electrical', 'software', 'interface', 'sensor', 'actuator', 'controller', 'unknown'] },
    description: { type: 'string', required: true },
  },
} as const

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

/** 从既有家族条目收集 组件名 → 标号（索引按图号升序，首个出现优先）。 */
function familyNumeralsByLabel(entries: readonly GeneratePatentFigureIndexEntry[], family: string): Map<string, string> {
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
function buildFigureDot(input: StructuralFigureInput, params: FigureDotParams): string {
  const { figureNumber, style, fontName, pageBundle, leaderLinesActive } = params
  switch (input.figure_type) {
    case 'flowchart': {
      if (input.steps.length === 0) {
        throw new DotBuildError('empty_input', 'flowchart 需要 steps')
      }
      return buildFlowchartDOT(input.steps, buildDotOptions(params))
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
    const figureType = panel.figure_type ?? inferFigureType(panel, `面板 ${panel.suffix}`)
    return {
      suffix: panel.suffix,
      figureType,
      // 顶层 leader_lines 强制全部面板；缺省按面板图型取默认（框图/层级图开）。
      leaderLines: input.leader_lines ?? (figureType === 'block_diagram' || figureType === 'component_hierarchy'),
      structural: {
        figure_type: figureType,
        steps: panel.steps ?? [],
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
  const explicit = {
    ...familySeeds.explicit,
    ...Object.fromEntries(Object.entries(input.numerals ?? {}).map(([id, value]) => [sanitizeId(id), value])),
    ...Object.fromEntries(panels.flatMap(panel => Object.entries(panel.numerals ?? {}).map(([id, value]) => [sanitizeId(id), value]))),
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
    panelOutputs.push({ suffix: ps.suffix, output })
  }

  // 合并输出：面板句各一句 + 全部面板共用一条「图中」标号表。
  const mergedNumerals = panelOutputs.flatMap(po => po.output.numeralMap)
  const invention = resolveInvention(input.invention_name)
  const sentences = panelOutputs.map(po => figureSentence(figureNumber, po.suffix, invention, po.output.figureType))
  const sharedNumerals = mergedNumerals.map(m => `${m.numeral}-${m.label}`).join('，')
  const figureDescription = sharedNumerals === ''
    ? `${sentences.join('；')}。`
    : `${sentences.join('；')}；图中：${sharedNumerals}。`
  const warnings = panelOutputs.flatMap(po => po.output.warnings)
  if (panelStructurals.some(ps => ps.leaderLines) && format !== 'svg') {
    warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
  }
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
      } catch {
        // 索引写入是可选增强：任一面板写入失败静默降级，不阻断生成结果返回。
        indexed = false
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
    panels: panelOutputs.map(po => ({ suffix: po.suffix, path: po.output.path, figureType: po.output.figureType })),
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
        enum: ['flowchart', 'block_diagram', 'component_hierarchy', 'raw_dot', 'template'],
        description: '图型；缺省时从唯一结构输入推断（steps→flowchart、blocks→block_diagram、tree→component_hierarchy、dot→raw_dot、template→template），多输入或无输入须显式指定',
      },
      steps: { type: 'array', items: STEP_SCHEMA, description: '流程图步骤（figure_type=flowchart 时必填）' },
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
      numerals: { type: 'object', additionalProperties: true, description: '显式标号（组件 id → 标号；跨图同件同号续接）' },
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
          figureType: {
            type: 'string',
            required: true,
            enum: ['structure', 'flowchart', 'circuit', 'block_diagram', 'schematic', 'exploded_view', 'cross_section', 'unknown'],
          },
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
          panels: {
            type: 'array',
            description: '多面板摘要（panels 模式）',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                suffix: { type: 'string', required: true },
                path: { type: 'string', required: true },
                figureType: {
                  type: 'string',
                  required: true,
                  enum: ['structure', 'flowchart', 'circuit', 'block_diagram', 'schematic', 'exploded_view', 'cross_section', 'unknown'],
                },
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
      if (input.panels !== undefined) {
        return generatePanels(input, { deps, cwd, format, engine, style, signal: exec.signal })
      }
      // 树/嵌套结构在 schema 层只做了形状约束，此处窄化为领域类型后统一下传；
      // 图型显式优先，缺省从唯一结构输入推断（歧义/为空报 invalid_tool_input）。
      const normalized: NormalizedFigureInput = {
        ...input,
        figure_type: input.figure_type ?? inferFigureType(input),
        steps: input.steps ?? [],
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
          ...Object.fromEntries(
            Object.entries(normalized.numerals ?? {}).map(([id, value]) => [sanitizeId(id), value]),
          ),
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

      let dot: string
      try {
        // per-call 覆盖部署默认；四项全缺省时不输出任何布局属性（零回归）。
        const pageBundle = resolvePageBundle({
          pageSize: normalized.page_size ?? deps.pageSize,
          orientation: normalized.orient ?? deps.orientation,
          dpi: normalized.dpi ?? deps.dpi,
          marginCm: normalized.margin ?? deps.marginCm,
        })
        dot = buildFigureDot(normalized, {
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

      /* v8 ignore next -- apply() always injects outputDir; the cwd-relative default stays for standalone library callers */
      const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
      await mkdir(outputDir, { recursive: true })
      const outcome = await deps.render({
        dot,
        filename: normalized.filename ?? `fig${figureNumber}`,
        format,
        engine,
        outputDir,
        signal: exec.signal,
      })
      assertRendered(outcome)

      const result = buildOutput(normalized, {
        cwd,
        outcomePath: outcome.path,
        figureNumber,
        format,
        engine,
        figureType: toFigureType(normalized.figure_type),
        numeralBy,
      })
      if (leaderLines && !leaderLinesActive) {
        result.warnings.push(`引线标号仅支持 SVG 矢量输出；本次 ${format} 保持内嵌标号`)
      } else if (leaderLinesActive) {
        await annotateRenderedSvg(outcome.path, result.numeralMap, result.warnings)
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
        } catch {
          // 索引写入是可选增强：写入失败静默降级，不阻断生成结果返回。
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

  const invention = resolveInvention(input.invention_name)
  const numeralText = numeralMap.map(m => `${m.numeral}-${m.label}`).join('，')
  const sentence = figureSentence(figureNumber, params.suffix ?? '', invention, figureType)
  const figureDescription = numeralText === ''
    ? `${sentence}。`
    : `${sentence}；图中：${numeralText}。`

  const result: GeneratePatentFigureOutput = {
    path,
    format,
    engine,
    figureNumber,
    figureType,
    figureDescription,
    numeralMap,
    components,
    connections,
    warnings,
    indexed: false,
  }
  return result
}
