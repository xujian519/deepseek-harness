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

import { mkdir } from 'node:fs/promises'
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
  FlowchartStep,
  HierarchyNode,
} from '../figure/dot-builder.ts'

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
  /** 工作目录（相对路径基准），默认 process.cwd()。 */
  cwd?: string
  /** 平台字体解析（含 CJK 时选平台字体），默认 Helvetica。 */
  resolveFont?: (labels: readonly string[]) => string
}

/** 生成图输入（与 schema 保持一致）。 */
export type GeneratePatentFigureInput = {
  figure_type: GenerateFigureType
  steps?: FlowchartStep[]
  blocks?: BlockDiagramBlock[]
  connections?: BlockDiagramConnection[]
  tree?: HierarchyNode[]
  template?: DiagramTemplateName
  dot?: string
  figure_number?: number
  invention_name?: string
  /** 显式标号（组件 id → 标号；跨图同件同号续接）。 */
  numerals?: Record<string, string>
  numeral_start?: number
  numeral_step?: number
  style?: 'grayscale' | 'semantic'
  filename?: string
  format?: DotFormat
  engine?: DotEngine
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

/** 收集本图组件的清洗后 id（构建顺序）。 */
function collectIds(input: GeneratePatentFigureInput): string[] {
  switch (input.figure_type) {
    case 'flowchart':
      return (input.steps ?? []).map(step => sanitizeId(step.id))
    case 'block_diagram':
      return (input.blocks ?? []).map(block => sanitizeId(block.id))
    case 'component_hierarchy': {
      const ids: string[] = []
      const visit = (node: HierarchyNode): void => {
        ids.push(sanitizeId(node.id))
        for (const child of node.children ?? []) visit(child)
      }
      for (const root of input.tree ?? []) visit(root)
      return ids
    }
    case 'template':
      return []
    case 'raw_dot':
      return []
  }
}

/** 收集本图全部 label（用于字体解析）。 */
function collectLabels(input: GeneratePatentFigureInput): string[] {
  return [
    ...(input.steps ?? []).map(step => step.label),
    ...(input.blocks ?? []).map(block => block.label),
    ...(input.tree ?? []).map(node => node.label),
  ]
}

/** 构造索引用 analysis（确定性生成：组件/连接由输入还原，置信度 1）。 */
function indexAnalysis(
  output: GeneratePatentFigureOutput,
  style: 'grayscale' | 'semantic',
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
  }
}

/** 简单文本渲染：标号表 + 附图说明 + 路径。 */
function renderGenerateFigureResult(value: GeneratePatentFigureOutput): { type: 'text'; text: string }[] {
  const lines = [
    `已生成专利附图（图${value.figureNumber}，${value.format}）：${value.path}`,
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
  '标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号。',
  '',
  '色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用墨色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用。',
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
        required: true,
        enum: ['flowchart', 'block_diagram', 'component_hierarchy', 'raw_dot', 'template'],
        description: '图型。',
      },
      steps: { type: 'array', items: STEP_SCHEMA, description: '流程图步骤（figure_type=flowchart 时必填）' },
      blocks: { type: 'array', items: BLOCK_SCHEMA, description: '框图块（figure_type=block_diagram 时必填）' },
      connections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            from: { type: 'string', required: true },
            to: { type: 'string', required: true },
            label: { type: 'string', description: '数据流说明（可选）' },
          },
        },
        description: '框图连接（block_diagram）',
      },
      tree: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            label: { type: 'string', required: true },
            children: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
        description: '组件层级树（component_hierarchy，任意深度）',
      },
      template: {
        type: 'string',
        enum: DIAGRAM_TEMPLATE_NAMES,
        description: '内置模板（figure_type=template 时必填）：simple_flowchart/system_block/method_steps/component_hierarchy',
      },
      dot: { type: 'string', description: '原始 Graphviz DOT（figure_type=raw_dot）' },
      figure_number: { type: 'integer', description: '图号，默认 1（决定标号系列起点）' },
      invention_name: { type: 'string', description: '发明名称（附图说明模板句）' },
      numerals: { type: 'object', additionalProperties: true, description: '显式标号（组件 id → 标号；跨图同件同号续接）' },
      numeral_start: { type: 'integer', description: '自动标号系列起点覆盖' },
      numeral_step: { type: 'integer', description: '标号步进，默认 2' },
      style: { type: 'string', enum: ['grayscale', 'semantic'], description: '色彩策略，默认 grayscale' },
      filename: { type: 'string', description: '输出文件名（不含扩展名）' },
      format: { type: 'string', enum: DOT_FORMATS, description: '输出格式，默认 svg' },
      engine: { type: 'string', enum: DOT_ENGINES, description: '布局引擎，默认 dot' },
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
        },
      },
      render: (_args, value) => renderGenerateFigureResult(value),
    },
    async execute(args, exec) {
      // schema 校验后的模型 JSON 边界；深层结构（层次树递归）由 build 函数校验。
      const input = args as unknown as GeneratePatentFigureInput
      // 树/嵌套结构在 schema 层只做了形状约束，此处窄化为领域类型后统一下传。
      const normalized: GeneratePatentFigureInput = {
        ...input,
        steps: (input.steps ?? []) as FlowchartStep[],
        blocks: (input.blocks ?? []) as BlockDiagramBlock[],
        connections: (input.connections ?? []) as BlockDiagramConnection[],
        tree: (input.tree ?? []) as HierarchyNode[],
      }
      const cwd = deps.cwd ?? process.cwd()
      const figureNumber = normalized.figure_number ?? 1
      const format = (normalized.format ?? 'svg') as DotFormat
      const engine = (normalized.engine ?? 'dot') as DotEngine
      const style = normalized.style === 'semantic' ? 'semantic' : 'grayscale'
      const fontName = (deps.resolveFont ?? ((): string => 'Helvetica'))(collectLabels(normalized))
      const ids = collectIds(normalized)

      // 一次分配、双处使用：分配结果同时作为 builder 的显式标号（图面一致）与输出标号表。
      let numeralsForBuilder: Record<string, string> = {}
      let numeralBy = new Map<string, string>()
      try {
        const explicit = Object.fromEntries(
          Object.entries(normalized.numerals ?? {}).map(([id, value]) => [sanitizeId(id), String(value)]),
        )
        const assignments = ids.length === 0
          ? []
          : assignNumerals(ids, {
            figureNumber,
            ...(normalized.numeral_start === undefined ? {} : { start: normalized.numeral_start }),
            ...(normalized.numeral_step === undefined ? {} : { step: normalized.numeral_step }),
            explicit,
          })
        numeralsForBuilder = Object.fromEntries(assignments.map(a => [a.id, a.numeral]))
        numeralBy = new Map(assignments.map(a => [a.id, a.numeral]))
      } catch (error) {
        if (error instanceof DotBuildError) {
          throw new PatentToolError('invalid_tool_input', `标号分配失败：${error.message}`, { tool: 'generate_patent_figure' })
        }
        throw error
      }

      let dot: string
      try {
        if (normalized.figure_type === 'flowchart') {
          if (normalized.steps === undefined || normalized.steps.length === 0) {
            throw new DotBuildError('empty_input', 'flowchart 需要 steps')
          }
          dot = buildFlowchartDOT(normalized.steps, {
            figureNumber,
            numerals: numeralsForBuilder,
            ...(normalized.numeral_step === undefined ? {} : { numeralStep: normalized.numeral_step }),
            style,
            fontName,
          })
        } else if (normalized.figure_type === 'block_diagram') {
          if (normalized.blocks === undefined || normalized.blocks.length === 0) {
            throw new DotBuildError('empty_input', 'block_diagram 需要 blocks')
          }
          dot = buildBlockDiagramDOT(normalized.blocks, normalized.connections ?? [], {
            figureNumber,
            numerals: numeralsForBuilder,
            ...(normalized.numeral_step === undefined ? {} : { numeralStep: normalized.numeral_step }),
            style,
            fontName,
          })
        } else if (normalized.figure_type === 'component_hierarchy') {
          if (normalized.tree === undefined || normalized.tree.length === 0) {
            throw new DotBuildError('empty_input', 'component_hierarchy 需要 tree')
          }
          dot = buildComponentHierarchyDOT(normalized.tree, {
            figureNumber,
            numerals: numeralsForBuilder,
            ...(normalized.numeral_step === undefined ? {} : { numeralStep: normalized.numeral_step }),
            style,
            fontName,
          })
        } else if (normalized.figure_type === 'template') {
          if (normalized.template === undefined) {
            throw new DotBuildError('invalid_template', 'template 模式需要 template 名')
          }
          dot = getDiagramTemplate(normalized.template, { figureNumber, style, fontName })
        } else if (normalized.figure_type === 'raw_dot') {
          if (normalized.dot === undefined || normalized.dot.trim() === '') {
            throw new DotBuildError('empty_input', 'raw_dot 需要 dot 内容')
          }
          if (normalized.dot.length > RAW_DOT_MAX_BYTES) {
            throw new DotBuildError('invalid_template', `raw_dot 输入过大（>${RAW_DOT_MAX_BYTES} 字节）`)
          }
          dot = normalized.dot
        } else {
          throw new DotBuildError('invalid_template', `未知图型：${String(normalized.figure_type)}`)
        }
      } catch (error) {
        if (error instanceof DotBuildError) {
          throw new PatentToolError('invalid_tool_input', `附图内容校验失败：${error.message}`, { tool: 'generate_patent_figure' })
        }
        throw error
      }

      const outputDir = deps.outputDir ?? resolve(cwd, 'patent/figures')
      await mkdir(outputDir, { recursive: true })
      const outcome = await deps.render(
        exec.signal === undefined
          ? { dot, filename: normalized.filename ?? `fig${figureNumber}`, format, engine, outputDir }
          : { dot, filename: normalized.filename ?? `fig${figureNumber}`, format, engine, outputDir, signal: exec.signal },
      )
      if (!outcome.ok) {
        if (outcome.code === 'not_installed') {
          throw new PatentToolError('setup_required', outcome.error, { tool: 'generate_patent_figure' })
        }
        if (outcome.code === 'aborted') {
          throw new PatentToolError('tool_aborted', 'generate_patent_figure aborted', { tool: 'generate_patent_figure' })
        }
        throw new PatentToolError('tool_execution_failed', outcome.error, { tool: 'generate_patent_figure' })
      }

      const result = buildOutput(normalized, {
        cwd,
        outcomePath: outcome.path,
        figureNumber,
        format,
        engine,
        figureType: toFigureType(normalized.figure_type),
        numeralBy,
      })
      let indexed = false
      if ((normalized.persist_index ?? true) && deps.upsertIndex !== undefined) {
        try {
          await deps.upsertIndex({
            imagePath: result.path,
            analyzedAt: new Date().toISOString(),
            analysis: indexAnalysis(result, style),
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
  input: GeneratePatentFigureInput,
  params: {
    cwd: string
    outcomePath: string
    figureNumber: number
    format: DotFormat
    engine: DotEngine
    figureType: FigureType
    numeralBy: Map<string, string>
  },
): GeneratePatentFigureOutput {
  const { cwd, outcomePath, figureNumber, format, engine, figureType } = params
  const path = relative(cwd, outcomePath)
  const numeralMap: GeneratePatentFigureOutput['numeralMap'] = []
  const components: FigureComponent[] = []
  const warnings: string[] = []
  const descriptor = (rawId: string, label: string): void => {
    const id = sanitizeId(rawId)
    const numeral = params.numeralBy.get(id) ?? ''
    if (numeral === '') {
      warnings.push(`组件 ${label} 未获得标号（raw_dot/template 无结构还原数据）`)
      return
    }
    numeralMap.push({ componentId: id, label: singleLine(label), numeral, figure: figureNumber })
    components.push({ refNumber: numeral, name: singleLine(label), kind: 'unknown', description: singleLine(label) })
  }

  // 连接按输入还原（source/target 转标号；raw_dot 与 template 无结构数据）。
  const connections: FigureConnection[] = []
  const connectionInput = (input.connections ?? []) as BlockDiagramConnection[]
  for (const step of input.steps ?? []) {
    descriptor(step.id, step.label)
  }
  for (const block of input.blocks ?? []) {
    descriptor(block.id, block.label)
  }
  const walk = (node: HierarchyNode): void => {
    descriptor(node.id, node.label)
    for (const child of node.children ?? []) walk(child)
  }
  for (const root of input.tree ?? []) walk(root)
  for (const conn of connectionInput) {
    const source = params.numeralBy.get(sanitizeId(conn.from))
    const target = params.numeralBy.get(sanitizeId(conn.to))
    if (source === undefined || target === undefined) continue
    connections.push({ source, target, kind: 'data_flow', description: conn.label === undefined ? '' : singleLine(conn.label) })
  }

  const figureTypeName = FIGURE_TYPE_NAMES[figureType]
  const invention = input.invention_name === undefined || input.invention_name.trim() === '' ? '本申请' : input.invention_name.trim()
  const numeralText = numeralMap.map(m => `${m.numeral}-${m.label}`).join('，')
  const figureDescription = numeralText === ''
    ? `图${figureNumber}是${invention}的${figureTypeName}。`
    : `图${figureNumber}是${invention}的${figureTypeName}；图中：${numeralText}。`

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
