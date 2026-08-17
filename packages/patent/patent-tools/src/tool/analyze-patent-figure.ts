/**
 * `analyze_patent_figure` tool: analyze one patent drawing image into a
 * structured figure description (figure type, components, connections,
 * reference numbers, and a patent-format figure description). Ported from
 * Sati's analyzePatentFigure.ts.
 *
 * The Sati figure ENGINE (src/patent/figure/*: two-step PatentVision/PatentLMM
 * analysis, multi-figure consistency, electrical netlist) was not ported into
 * any dsh package. This tool ports the wrapper (input/output schema,
 * description, render) and drives a minimal single-step analysis through the
 * injected PatentModelPort.
 *
 * The image-modal capability gate (P3.3) preflights the resolved figure-model
 * route's declared input modalities before the file is read: a model without
 * 'image' input is denied (PatentToolError code model_cannot_accept_image).
 * The PatentModelPort remains text-only, so image bytes are NOT sent to the
 * model in this build; execute runs a text-only figure-analysis prompt from
 * the figure number, claim context, and invention name.
 * @module @deepseek-ai/dsh-patent-tools/tool/analyze-patent-figure
 */

import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { collectPortText, tryParseJson } from '@deepseek-ai/dsh-patent-core'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import type { ModelModality } from '@deepseek-ai/dsh-llm'
import { checkImageCapability } from '../figure/image-capability.ts'
import { PatentToolError } from '../error.ts'

/** 附图类型（PatentVision 分类 + 专利实务常见图型）。 */
export const FIGURE_TYPES = [
  'structure',
  'flowchart',
  'circuit',
  'block_diagram',
  'schematic',
  'exploded_view',
  'cross_section',
  'unknown',
] as const

export type FigureType = (typeof FIGURE_TYPES)[number]

/** 附图类型中文名（附图说明模板用）。 */
export const FIGURE_TYPE_NAMES: Record<FigureType, string> = {
  structure: '结构示意图',
  flowchart: '流程图',
  circuit: '电路图',
  block_diagram: '方框图',
  schematic: '原理示意图',
  exploded_view: '分解示意图',
  cross_section: '剖视图',
  unknown: '示意图',
}

/** 组件类型（PatentVision ComponentType 对齐）。 */
export const FIGURE_COMPONENT_KINDS = [
  'mechanical',
  'electrical',
  'software',
  'interface',
  'sensor',
  'actuator',
  'controller',
  'unknown',
] as const

export type FigureComponentKind = (typeof FIGURE_COMPONENT_KINDS)[number]

/** 组件连接关系类型。 */
export const FIGURE_CONNECTION_KINDS = ['electrical', 'mechanical', 'data_flow', 'unknown'] as const

export type FigureConnectionKind = (typeof FIGURE_CONNECTION_KINDS)[number]

/** 附图中的技术组件（对应附图标记号）。 */
export type FigureComponent = {
  /** 附图标记号（与图面阿拉伯数字一致；无标号部件以 U1/U2… 表示）。 */
  refNumber: string
  /** 组件名称。 */
  name: string
  /** 组件类型。 */
  kind: FigureComponentKind
  /** 组件功能描述。 */
  description: string
}

/** 组件间连接关系。 */
export type FigureConnection = {
  /** 源组件标号。 */
  source: string
  /** 目标组件标号。 */
  target: string
  /** 连接类型。 */
  kind: FigureConnectionKind
  /** 连接关系描述。 */
  description: string
}

/**
 * 附图分析结果。
 *
 * `figureDescription` 为可直接落入说明书「附图说明」章节的文字（专利格式）；
 * `usable` 表示组件提取是否成功（组件数 > 0）。
 */
export type FigureAnalysisResult = {
  /** 分析图片路径（工作区相对路径，即输入的 image_path）。 */
  imagePath: string
  /** 附图编号。 */
  figureNumber: number
  /** 附图类型。 */
  figureType: FigureType
  /** 附图整体描述。 */
  overallDescription: string
  /** 识别出的组件列表。 */
  components: FigureComponent[]
  /** 组件间连接关系。 */
  connections: FigureConnection[]
  /** 附图说明文字（专利格式）。 */
  figureDescription: string
  /** 分类置信度 0-1。 */
  confidence: number
  /** 警告（标号不连续、降级原因等）。 */
  warnings: string[]
  /** 是否可直接用于撰写/校验（组件数 > 0）。 */
  usable: boolean
  /** 实际使用的模型标识。 */
  modelUsed: string
}

export type AnalyzePatentFigureInput = {
  /** 附图图片路径（工作区相对或绝对路径，支持 jpg/png/gif/webp）。 */
  image_path: string
  /** 附图编号（默认 1，用于附图说明「图N」）。 */
  figure_number?: number
  /** 权利要求/技术方案上下文（图文对齐，提高识别准确率，可选）。 */
  claim_context?: string
  /** 发明名称（附图说明模板用，可选）。 */
  invention_name?: string
}

/** Injected figure-analysis dependencies (model is required; cwd defaults to process.cwd()). */
export type AnalyzePatentFigureDeps = {
  /** Text-only model port the single-step analysis prompt is sent to. */
  model: PatentModelPort
  /** Working directory used to resolve a relative image_path. */
  cwd?: string
  /** Label reported in the result's modelUsed field (default "patent-model-port"). */
  modelUsed?: string
  /**
   * Resolve one provider/model route's declared input modalities for the image
   * gate. Absent means the gate is not wired and the tool runs un-gated.
   */
  resolveImageInputModalities?: (provider: string, model: string) => Promise<readonly ModelModality[] | undefined>
  /** Config figure-model fallback gated when the calling agent's model is unreachable. */
  gateModel?: { provider: string; model: string }
}

/**
 * Resolve the model route the image gate checks: the calling agent's active
 * model when both provider and model are set, otherwise the Config figure-model
 * fallback. An empty active route (the agent loop fills the default model via
 * the request waterfall later) is not treated as an authoritative route.
 * @param agentModel - the calling agent's provider/model (both may be absent).
 * @param fallback - the Config figure-model route when the active model is unreachable.
 * @returns the route to gate, or undefined when neither source names one.
 */
export function resolveGateRoute(
  agentModel: { provider?: string; model?: string } | undefined,
  fallback: { provider: string; model: string } | undefined,
): { provider: string; model: string } | undefined {
  if (agentModel !== undefined && agentModel.provider !== undefined && agentModel.provider !== ''
    && agentModel.model !== undefined && agentModel.model !== '') {
    return { provider: agentModel.provider, model: agentModel.model }
  }
  return fallback
}

/** 专利附图规范要点（静态注入，与 Sati FIGURE_SPEC_GUIDE 一致）。 */
export const FIGURE_SPEC_GUIDE = [
  '专利附图是黑白线图，不要求也不允许彩色；虚线表示不可见/隐藏结构，剖面线表示剖切面。',
  '阿拉伯数字为附图标记（引用符号），指向对应部件；说明书正文引用必须与标号一一对应。',
  '箭头表示连接方向、运动方向或流程走向。',
  '同一部件在不同附图中共用同一标号；标号不得跳号或重复。',
  "附图说明句式：'图N是本发明实施例提供的{发明名称}的{附图类型}；图中：1-{部件}；2-{部件}；…'",
  '标号识别必须严格依据图面；图面可见但标号模糊、被遮挡或无法确认的部件，不得臆造编号，应注明"无法确认"；仅当部件确实无标号时，才使用 U1/U2… 占位符并注明。',
  '组件描述应包含图面可见的物理形态、空间相对位置与连接关系；图面未显示的信息（材料、参数等）不得补充。',
].join('\n')

/** 枚举值校验工厂：非合法值返回 fallback。 */
function makeNormalizer<T extends string>(values: readonly T[], fallback: T): (value: unknown) => T {
  return (value: unknown): T =>
    typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : fallback
}

/** 附图类型枚举值校验：非合法值返回 "unknown"。 */
export const normalizeFigureType = makeNormalizer(FIGURE_TYPES, 'unknown')

/** 组件类型枚举值校验：非合法值返回 "unknown"。 */
export const normalizeComponentKind = makeNormalizer(FIGURE_COMPONENT_KINDS, 'unknown')

/** 连接类型枚举值校验：非合法值返回 "unknown"。 */
export const normalizeConnectionKind = makeNormalizer(FIGURE_CONNECTION_KINDS, 'unknown')

/**
 * 附图说明兜底模板（模型未生成时确定性生成）。
 * @param figureNumber - 附图编号。
 * @param figureType - 附图类型。
 * @param inventionName - 发明名称（未知时用「装置」）。
 * @param components - 识别出的组件列表。
 * @returns 专利格式的附图说明文字。
 */
export function buildFigureDescription(
  figureNumber: number,
  figureType: FigureType,
  inventionName: string | undefined,
  components: FigureComponent[],
): string {
  const typeName = FIGURE_TYPE_NAMES[figureType]
  const title = (inventionName ?? '装置').trim() || '装置'
  if (components.length === 0) {
    return `图${figureNumber}是本发明实施例提供的${title}的${typeName}。`
  }
  const lines = [`图${figureNumber}是本发明实施例提供的${title}的${typeName}；`, '图中：']
  for (const c of components) {
    lines.push(`${c.refNumber}-${c.name}；`)
  }
  return lines.join('\n')
}

/**
 * 检查标号连续性/异常，返回警告。
 * @param components - 识别出的组件列表。
 * @returns 标号不连续等警告（无则空数组）。
 */
export function checkReferenceNumbers(components: FigureComponent[]): string[] {
  const warnings: string[] = []
  const numbers = components
    .map(c => c.refNumber)
    .filter(n => /^\d+$/.test(n))
    .map(Number)
    .sort((a, b) => a - b)
  if (numbers.length === 0) return warnings
  let previous: number | undefined
  for (const current of numbers) {
    if (previous !== undefined && current !== previous + 1) {
      warnings.push(`附图标记可能不连续：${previous} 后为 ${current}`)
      break
    }
    previous = current
  }
  return warnings
}

/** 单步分析输出 JSON Schema（合并 Sati 的 Step1+Step2）。 */
const COMBINED_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    figure_type: { type: 'string', enum: FIGURE_TYPES, description: '附图类型' },
    overall_description: { type: 'string', description: '附图整体内容的一句话描述' },
    confidence: { type: 'number', description: '分类置信度 0-1' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref_number: { type: 'string', description: '附图标记号' },
          name: { type: 'string', description: '组件名称' },
          kind: { type: 'string', enum: FIGURE_COMPONENT_KINDS, description: '组件类型' },
          description: { type: 'string', description: '组件功能描述' },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string', description: '源组件标号' },
          target: { type: 'string', description: '目标组件标号' },
          kind: { type: 'string', enum: FIGURE_CONNECTION_KINDS, description: '连接类型' },
          description: { type: 'string', description: '连接关系描述' },
        },
      },
    },
    figure_description: { type: 'string', description: '附图说明文字（专利格式）' },
    warnings: { type: 'array', items: { type: 'string' }, description: '无法识别或标号异常的区域' },
  },
} as const

function formatContext(claimContext: string | undefined): string {
  return claimContext && claimContext.trim().length > 0
    ? `\n【权利要求/技术方案上下文】\n${claimContext.trim().slice(0, 4000)}`
    : '\n【权利要求/技术方案上下文】\n（未提供）'
}

/** Build the single-step figure-analysis prompt (text-only; image bytes are not sent — the figure engine is not ported). */
function buildFigureAnalysisPrompt(
  figureNumber: number,
  claimContext: string | undefined,
  inventionName: string | undefined,
  imagePath: string,
): string {
  return [
    '你是一位资深专利代理师与专利审查专家。请分析一张专利说明书附图（图' + figureNumber + '）。',
    '',
    `附图图片路径：${imagePath}`,
    `发明名称：${inventionName?.trim() || '（未提供）'}`,
    '',
    '当前环境尚未接入图片多模态分析引擎，图片像素未随本提示传递。请基于权利要求/技术方案上下文与附图编号，尽力推断附图类型、组件、连接关系与附图说明；无法从上下文确认的信息请在 warnings 中注明，不要臆造。',
    '',
    '【专利附图规范要点】',
    FIGURE_SPEC_GUIDE,
    formatContext(claimContext),
    '',
    '【输出要求】',
    '- 组件标号与图面阿拉伯数字一致；无标号部件用 U1/U2… 编号并在 warnings 注明"未标注"；',
    '- 附图说明使用专利格式：图N是本发明实施例提供的{发明名称}的{附图类型}；图中：1-…；2-…；',
    '- 发明名称未知时用「装置」代替。',
    '',
    '严格输出 JSON：只输出一个 JSON 对象；不要用 markdown 代码围栏；不要输出 JSON 以外的任何文字；所有键与字符串使用双引号。',
    JSON.stringify(COMBINED_SCHEMA, null, 2),
  ].join('\n')
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** 规范化组件（枚举校验、空标号过滤、按标号去重）。 */
function normalizeComponents(raw: unknown): FigureComponent[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const components: FigureComponent[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    const refNumber = typeof c.ref_number === 'string' ? c.ref_number.trim() : ''
    if (!refNumber || seen.has(refNumber)) continue
    seen.add(refNumber)
    components.push({
      refNumber,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : '未命名部件',
      kind: normalizeComponentKind(c.kind),
      description: typeof c.description === 'string' ? c.description.trim() : '',
    })
  }
  return components
}

/** 规范化连接（过滤空端点与未知组件引用）。 */
function normalizeConnections(raw: unknown, refNumbers: Set<string>): FigureConnection[] {
  if (!Array.isArray(raw)) return []
  const connections: FigureConnection[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Record<string, unknown>
    const source = typeof c.source === 'string' ? c.source.trim() : ''
    const target = typeof c.target === 'string' ? c.target.trim() : ''
    if (!source || !target || !refNumbers.has(source) || !refNumbers.has(target)) continue
    connections.push({
      source,
      target,
      kind: normalizeConnectionKind(c.kind),
      description: typeof c.description === 'string' ? c.description.trim() : '',
    })
  }
  return connections
}

/** Parse + normalize the model's raw text into a FigureAnalysisResult (degraded path never throws). */
function normalizeFigureAnalysis(
  raw: string,
  opts: { imagePath: string; figureNumber: number; inventionName: string | undefined; modelUsed: string },
): FigureAnalysisResult {
  const parsed = tryParseJson(raw)
  const warnings: string[] = ['图片多模态分析尚未接入，本次为文本态最小路径（仅基于上下文推断）']

  // Extract raw fields once so subsequent narrowing operates on locals, not
  // on a possibly-undefined record's property chain.
  const figureTypeRaw = parsed?.figure_type
  const overallRaw = parsed?.overall_description
  const confidenceRaw = parsed?.confidence
  const componentsRaw = parsed?.components
  const connectionsRaw = parsed?.connections
  const descriptionRaw = parsed?.figure_description
  const warningsRaw = parsed?.warnings

  if (parsed === undefined) {
    warnings.push('模型输出无法解析为 JSON，附图类型按 unknown、组件为空处理')
  }

  const figureType = normalizeFigureType(figureTypeRaw)
  const overallDescription = typeof overallRaw === 'string' ? overallRaw : ''
  const confidence = clamp01(typeof confidenceRaw === 'number' ? confidenceRaw : 0)
  const components = normalizeComponents(componentsRaw)
  const refNumbers = new Set(components.map(c => c.refNumber))
  const connections = normalizeConnections(connectionsRaw, refNumbers)
  const parsedDescription = typeof descriptionRaw === 'string' ? descriptionRaw.trim() : ''
  const figureDescription =
    parsedDescription.length > 0
      ? parsedDescription
      : buildFigureDescription(opts.figureNumber, figureType, opts.inventionName, components)
  if (Array.isArray(warningsRaw)) {
    for (const w of warningsRaw) {
      if (typeof w === 'string' && w.trim()) warnings.push(w)
    }
  }
  warnings.push(...checkReferenceNumbers(components))
  return {
    imagePath: opts.imagePath,
    figureNumber: opts.figureNumber,
    figureType,
    overallDescription,
    components,
    connections,
    figureDescription,
    confidence,
    warnings: [...new Set(warnings)],
    usable: components.length > 0,
    modelUsed: opts.modelUsed,
  }
}

/** Render the canonical figure analysis into model-facing Markdown. */
function renderFigureAnalysis(value: FigureAnalysisResult): string {
  const lines = [
    `附图分析（图${value.figureNumber} · ${FIGURE_TYPE_NAMES[value.figureType]} · 置信度 ${value.confidence.toFixed(2)}${value.usable ? '' : ' · 需人工确认'}）`,
    '',
    value.overallDescription || '（无整体描述）',
    '',
    value.figureDescription || '（无附图说明）',
  ]
  if (value.components.length > 0) {
    lines.push('', '## 组件', ...value.components.map(c => `- ${c.refNumber} ${c.name}（${c.kind}）：${c.description}`))
  }
  if (value.connections.length > 0) {
    lines.push('', '## 连接关系', ...value.connections.map(c => `- ${c.source} → ${c.target}（${c.kind}）：${c.description}`))
  }
  if (value.warnings.length > 0) {
    lines.push('', '## 警告', ...value.warnings.map(w => `- ${w}`))
  }
  return lines.join('\n')
}

const DESCRIPTION = [
  '分析专利说明书附图：识别附图类型（结构图/流程图/电路图/方框图/示意图/分解图/剖视图）、提取组件与连接关系、核对附图标记并生成专利格式的附图说明文字。当用户提供附图图片并要求撰写附图说明、理解附图内容、核对附图标记一致性时使用。可传入权利要求或技术方案文本作为上下文提升识别准确率。',
  '',
  '当前为文本态最小路径：图片多模态分析引擎尚未接入，分析基于附图编号与权利要求/技术方案上下文推断，结果置信度与可用性相应降低。',
].join('\n')
const COMPONENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    refNumber: { type: 'string', required: true },
    name: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: FIGURE_COMPONENT_KINDS },
    description: { type: 'string', required: true },
  },
} as const

const CONNECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', required: true },
    target: { type: 'string', required: true },
    kind: { type: 'string', required: true, enum: FIGURE_CONNECTION_KINDS },
    description: { type: 'string', required: true },
  },
} as const

/**
 * Build the `analyze_patent_figure` tool over an injected model port.
 * @param deps - the model port plus optional working directory and model label.
 * @returns a registry-ready tool definition.
 */
export function createAnalyzePatentFigureTool(deps: AnalyzePatentFigureDeps): ToolDefinition {
  const modelUsed = deps.modelUsed ?? 'patent-model-port'
  return defineTool({
    name: 'analyze_patent_figure',
    description: DESCRIPTION,
    parameters: {
      image_path: { type: 'string', required: true, description: '附图图片路径（工作区相对或绝对路径，支持 jpg/png/gif/webp）' },
      figure_number: { type: 'number', description: '附图编号（默认 1，用于附图说明「图N」）' },
      claim_context: { type: 'string', description: '权利要求或技术方案文本（图文对齐，可显著提高组件识别准确率）' },
      invention_name: { type: 'string', description: '发明名称（用于附图说明模板，如「一种供热管道电位采集装置」）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          imagePath: { type: 'string', required: true },
          figureNumber: { type: 'integer', required: true },
          figureType: { type: 'string', required: true, enum: FIGURE_TYPES },
          overallDescription: { type: 'string', required: true },
          components: { type: 'array', required: true, items: COMPONENT_SCHEMA },
          connections: { type: 'array', required: true, items: CONNECTION_SCHEMA },
          figureDescription: { type: 'string', required: true },
          confidence: { type: 'number', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          usable: { type: 'boolean', required: true },
          modelUsed: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFigureAnalysis(value as unknown as FigureAnalysisResult) }],
    },
    async execute(args, exec) {
      const route = resolveGateRoute(exec.agent?.options, deps.gateModel)
      if (route !== undefined && deps.resolveImageInputModalities !== undefined) {
        const inputModalities = await deps.resolveImageInputModalities(route.provider, route.model)
        const decision = checkImageCapability(inputModalities, `${route.provider}/${route.model}`)
        if (!decision.allowed) {
          throw new PatentToolError('model_cannot_accept_image', decision.reason, {
            tool: 'analyze_patent_figure',
            model: `${route.provider}/${route.model}`,
          })
        }
      }
      const cwd = deps.cwd ?? process.cwd()
      const absPath = resolve(cwd, args.image_path)
      try {
        await access(absPath)
      } catch {
        throw new PatentToolError('file_not_found', `附图图片不存在：${args.image_path}`, { tool: 'analyze_patent_figure' })
      }
      const figureNumber = args.figure_number ?? 1
      const prompt = buildFigureAnalysisPrompt(figureNumber, args.claim_context, args.invention_name, args.image_path)
      let raw: string
      try {
        raw = await collectPortText(deps.model, prompt, exec.signal)
      } catch (error) {
        if (exec.signal.aborted) {
          throw new PatentToolError('tool_aborted', 'analyze_patent_figure aborted', { tool: 'analyze_patent_figure' })
        }
        throw new PatentToolError(
          'tool_execution_failed',
          `附图分析失败：${error instanceof Error ? error.message : String(error)}`,
          { tool: 'analyze_patent_figure' },
        )
      }
      return normalizeFigureAnalysis(raw, {
        imagePath: args.image_path,
        figureNumber,
        inventionName: args.invention_name,
        modelUsed,
      })
    },
  })
}
