/**
 * 专利附图 DOT 构建器（纯函数，无 IO）。
 *
 * 从结构化输入（流程图步骤 / 系统框图 / 组件层级 / 内置模板）构建
 * Graphviz DOT 文本，固化专利附图风格规范：
 *
 * - 默认 `grayscale`：黑白线条、零填充色——按《专利审查指南》第一部分
 *   第一章 4.3（2023 修订，2024-01-20 施行，下同），附图一般使用墨色
 *   墨水绘制；`semantic` 可选模式允许填充色/边色，但仅当色彩承载技术
 *   内容（色彩即发明信息，如热力图、图像处理阶段图）时使用，依据同条
 *   「必要时可以提交彩色附图」。
 * - 参考标号内嵌节点 label：框图/层级图追加 ` (20)`，流程图以 `101. `
 *   前缀——与该域的附图说明惯例（analyze_patent_figure 的 refNumber、
 *   figure-description 的 100 系列）一致，标号经 assignNumerals 分配；
 *   `embedNumerals: false` 时标签不含标号，供 SVG 引线标号通路
 *   （leader-line）改为图外标注。
 * - 决策菱形（diamond）分支必须携带边标签，否则图面歧义（移植自
 *   Claude-Patent-Creator issue #60 的教训，MIT 许可，见 README 归属）。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/dot-builder
 */

/** 附图色彩策略：grayscale=黑白线条（默认，指南 4.3 一般情形）；semantic=必要时彩色（色彩承载技术内容）。 */
export type DotStyle = 'grayscale' | 'semantic'

/** Graphviz 布局引擎白名单。 */
export type DotEngine = 'dot' | 'neato' | 'fdp' | 'circo' | 'twopi' | 'sfdp'

/** 输出格式白名单。 */
export type DotFormat = 'svg' | 'png' | 'pdf'

/** 内置模板名（getDiagramTemplate 索引；对应远程 get_diagram_templates 的四个模板）。 */
export type DiagramTemplateName = 'simple_flowchart' | 'system_block' | 'method_steps' | 'component_hierarchy'

/** 允许的布局引擎。 */
export const DOT_ENGINES: readonly DotEngine[] = ['dot', 'neato', 'fdp', 'circo', 'twopi', 'sfdp']

/** 允许的输出格式。 */
export const DOT_FORMATS: readonly DotFormat[] = ['svg', 'png', 'pdf']

/** 内置模板名列表。 */
export const DIAGRAM_TEMPLATE_NAMES: readonly DiagramTemplateName[] = [
  'simple_flowchart',
  'system_block',
  'method_steps',
  'component_hierarchy',
]

/** 每图标号系列起点基线：FIG.N 系列从 `100 + 100 * (N - 1)` 开始（FIG.1=100-199、FIG.2=200-299）。 */
const NUMERAL_SERIES_BASE = 100

/** 每图系列跨度（100 个号码），与 NUMERAL_SERIES_BASE 构成 100 系列约定。 */
const NUMERAL_SERIES_STRIDE = 100

/** 同图内连续标号默认步进（对应 figure-description 示例 100/102/104）。 */
export const DEFAULT_NUMERAL_STEP = 2

/** DOT 构建错误码。 */
export type DotBuildErrorCode =
  | 'empty_input'
  | 'unknown_id'
  | 'missing_edge_label'
  | 'conflicting_numeral'
  | 'invalid_label'
  | 'invalid_id'
  | 'invalid_shape'
  | 'invalid_template'
  | 'invalid_page'

/** DOT 构建错误（引擎层受检查错误；工具层映射为 PatentToolError('invalid_input', ...)）。 */
export class DotBuildError extends Error {
  /** 构建错误码（工具层映射为 invalid_tool_input）。 */
  readonly code: DotBuildErrorCode

  constructor(code: DotBuildErrorCode, message: string) {
    super(message)
    this.name = 'DotBuildError'
    this.code = code
  }
}

/** 节点形状白名单（流程图用）。 */
export type FlowchartShape = 'box' | 'ellipse' | 'diamond' | 'parallelogram' | 'cylinder'

/** 流程图步骤。next 项为字符串或 {id,label}（带边标签，diamond 分支必须）。 */
export type FlowchartStep = {
  /** 节点 id（[A-Za-z0-9_-]，自动清洗）。 */
  id: string
  /** 节点显示文本（可含换行，自动转义）。 */
  label: string
  /** 节点形状，默认 box。 */
  shape?: FlowchartShape
  /** 后继：字符串 id 或带标签的 {id,label}。 */
  next: readonly (string | { id: string; label: string })[]
}

/** 框图块类型。 */
export type BlockKind = 'input' | 'output' | 'process' | 'storage' | 'decision' | 'default'

/** 框图块。 */
export type BlockDiagramBlock = {
  /** 块 id。 */
  id: string
  /** 块显示文本（`\n` 换行）。 */
  label: string
  /** 块类型，默认 default。 */
  type?: BlockKind
}

/** 框图连接。 */
export type BlockDiagramConnection = {
  /** 源块 id。 */
  from: string
  /** 目标块 id。 */
  to: string
  /** 边标签（数据流说明），可选。 */
  label?: string
}

/** 层级图节点（任意深度树）。 */
export type HierarchyNode = {
  /** 节点 id。 */
  id: string
  /** 节点显示文本。 */
  label: string
  /** 子节点。 */
  children?: readonly HierarchyNode[]
}

/** 参考标号映射输入：组件 id → 标号（字符串，如 "20"、"101"、"S101"）。 */
export type NumeralMap = Readonly<Record<string, string>>

/** 三个构建器共享的标号分配参数（figureNumber/step/explicit）。 */
type SharedNumeralOptions = {
  figureNumber?: number
  numeralStep?: number
  numerals?: NumeralMap
}

/** 以统一参数形式分配标号（三个构建器共用同一写段，避免参数展开漂移）。 */
function assignFor(ids: readonly string[], options: SharedNumeralOptions): NumeralAssignment[] {
  return assignNumerals(ids, {
    figureNumber: options.figureNumber ?? 1,
    ...(options.numeralStep === undefined ? {} : { step: options.numeralStep }),
    ...(options.numerals === undefined ? {} : { explicit: options.numerals }),
  })
}

/** 标号分配选项。 */
export type AssignNumeralsOptions = {
  /** 图号（1 开始），决定系列起点：100 + 100*(N-1)。默认 1。 */
  figureNumber?: number
  /** 系列起点覆盖（显式数值优先于推导）。 */
  start?: number
  /** 同图步进，默认 DEFAULT_NUMERAL_STEP。 */
  step?: number
  /** 显式标号（跨图同件同号续接）；与自动分配冲突时以显式为准并跳过占用号。 */
  explicit?: NumeralMap
  /** 既有占用号（家族中未出现在本图的组件标号）：不分配给任何组件，仅约束自动分配；与 explicit 同号时以 explicit 为准。 */
  reserved?: readonly string[]
}

/** 标号分配结果。 */
export type NumeralAssignment = {
  /** 组件 id。 */
  id: string
  /** 标号（字符串形式，直接进入 DOT 文本）。 */
  numeral: string
}

/**
 * 计算图号的标号系列起点（100 + 100*(图号-1)）。
 * @param figureNumber - 图号（1 起，负值与 0 按 1 处理）。
 * @returns 系列起点数值。
 */
export function numeralSeriesStart(figureNumber: number): number {
  return NUMERAL_SERIES_BASE + NUMERAL_SERIES_STRIDE * (Math.max(1, figureNumber) - 1)
}

/**
 * 为组件分配参考标号。
 *
 * 分配次序：按 ids 顺序；已有 explicit 的组件用显式标号（跨图同号），
 * 其余从系列起点起按 step 递增，并跳过已占用号码（显式占用与 reserved 占用）。
 * @param ids - 组件 id 列表（图内出现顺序）。
 * @param options - 图号 / 起点 / 步进 / 显式标号 / 保留占用号。
 * @returns 按 ids 顺序的标号分配。
 */
export function assignNumerals(ids: readonly string[], options: AssignNumeralsOptions = {}): NumeralAssignment[] {
  const start = options.start ?? numeralSeriesStart(options.figureNumber ?? 1)
  const step = options.step ?? DEFAULT_NUMERAL_STEP
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(step) || step < 1) {
    throw new DotBuildError('invalid_label', `标号起点/步进必须为正整数：start=${start}, step=${step}`)
  }
  const used = new Map<string, string>()
  const next = new Map<string, string>()
  for (const explicit of Object.entries(options.explicit ?? {})) {
    const value = explicit[1].trim()
    if (value === '') throw new DotBuildError('conflicting_numeral', `显式标号不能为空：${explicit[0]}`)
    const owner = used.get(value)
    if (owner !== undefined && owner !== explicit[0]) {
      throw new DotBuildError('conflicting_numeral', `标号 ${value} 被组件 ${owner} 与 ${explicit[0]} 重复占用`)
    }
    used.set(value, explicit[0])
    next.set(explicit[0], value)
  }
  const reserved = new Set(options.reserved ?? [])
  let candidate = start
  for (const id of ids) {
    if (next.has(id)) continue
    let numeral = String(candidate)
    while (used.has(numeral) || reserved.has(numeral)) {
      candidate += step
      numeral = String(candidate)
    }
    used.set(numeral, id)
    next.set(id, numeral)
    candidate += step
  }
  return ids.map(id => ({ id, numeral: next.get(id) as string }))
}

/**
 * 清洗 DOT 节点/边 id（允许 [A-Za-z0-9_-]，其余替换为下划线）。
 * @param id - 原始 id。
 * @returns 清洗后的 id（全非法时抛 DotBuildError）。
 */
export function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_')
  if (cleaned === '') throw new DotBuildError('invalid_id', `节点 id 为空或不合法：${JSON.stringify(id)}`)
  return cleaned
}

/** 提交规格页面尺寸白名单。 */
export type DotPageSize = 'a4' | 'letter'

/** 提交规格页面方向。 */
export type DotOrientation = 'portrait' | 'landscape'

/** 提交规格页面参数（字段全部可选；经 buildDotHeader 输出为 DOT graph 属性，WASM/CLI 渲染器同等生效）。 */
export type DotPageBundle = {
  /** 页面尺寸；缺省不输出 page/size 属性。 */
  pageSize?: DotPageSize
  /** 页面方向，缺省按 portrait（不输出 orientation 属性）。 */
  orientation?: DotOrientation
  /** 渲染分辨率（raster 输出生效）。 */
  dpi?: number
  /** 页边距（厘米，四边同值）；与 pageSize 同给时据此收缩 size。 */
  marginCm?: number
}

/** resolvePageBundle 输入：字段显式允许 undefined（exactOptionalPropertyTypes 下调用方以 `??` 合成 per-call 与部署默认）。 */
export type DotPageInput = {
  pageSize?: DotPageSize | undefined
  orientation?: DotOrientation | undefined
  dpi?: number | undefined
  marginCm?: number | undefined
}

/** 页面物理尺寸（英寸，portrait）。 */
const PAGE_SIZE_INCHES: Record<DotPageSize, { w: number; h: number }> = {
  a4: { w: 8.27, h: 11.69 },
  letter: { w: 8.5, h: 11 },
}

/** 英寸/厘米换算。 */
const CM_PER_INCH = 2.54

/**
 * 汇总配置默认与 per-call 覆盖后的页面参数。
 * @param input - 四项页面参数（全部缺省时不输出任何布局属性，行为与现状一致）。
 * @returns 传入 buildDotHeader 的 bundle；全部缺省时 undefined。
 * @throws DotBuildError('invalid_page') dpi/marginCm 非正或 dpi 非整数。
 */
export function resolvePageBundle(input: DotPageInput): DotPageBundle | undefined {
  const { pageSize, orientation, dpi, marginCm } = input
  if (pageSize === undefined && orientation === undefined && dpi === undefined && marginCm === undefined) return undefined
  if (dpi !== undefined && (!Number.isInteger(dpi) || dpi < 1)) {
    throw new DotBuildError('invalid_page', `dpi 必须为正整数：${String(dpi)}`)
  }
  if (marginCm !== undefined && marginCm <= 0) {
    throw new DotBuildError('invalid_page', `页边距必须为正（厘米）：${String(marginCm)}`)
  }
  return {
    ...(pageSize === undefined ? {} : { pageSize }),
    ...(orientation === undefined ? {} : { orientation }),
    ...(dpi === undefined ? {} : { dpi }),
    ...(marginCm === undefined ? {} : { marginCm }),
  }
}

/** 英寸值格式化（2 位小数）。 */
function formatInches(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * 将页面 bundle 转为 DOT graph 属性行。
 * page 恒随 pageSize；margin 恒随 marginCm；size（可用绘图区）仅当二者同给；
 * orientation=landscape 仅在横向时输出（portrait 隐式）。
 * @param page - 页面 bundle。
 * @returns DOT 属性行（已缩进、带分号）。
 */
function pageAttributeLines(page: DotPageBundle): string[] {
  const lines: string[] = []
  if (page.pageSize !== undefined) {
    const { w, h } = PAGE_SIZE_INCHES[page.pageSize]
    const landscape = page.orientation === 'landscape'
    const pageW = landscape ? h : w
    const pageH = landscape ? w : h
    lines.push(`    page="${formatInches(pageW)},${formatInches(pageH)}";`)
    if (page.marginCm !== undefined) {
      const marginIn = page.marginCm / CM_PER_INCH
      lines.push(`    size="${formatInches(pageW - 2 * marginIn)},${formatInches(pageH - 2 * marginIn)}";`)
      lines.push(`    margin="${formatInches(marginIn)},${formatInches(marginIn)}";`)
    }
  } else if (page.marginCm !== undefined) {
    const marginIn = formatInches(page.marginCm / CM_PER_INCH)
    lines.push(`    margin="${marginIn},${marginIn}";`)
  }
  if (page.dpi !== undefined) lines.push(`    dpi=${String(page.dpi)};`)
  if (page.orientation === 'landscape') lines.push('    orientation=landscape;')
  return lines
}

/**
 * 转义 DOT 双引号 label 文本（换行保留为 \n；控制字符替换为空格）。
 * @param text - 原始 label。
 * @returns 可安全嵌入双引号字符串的 label。
 */
export function escapeDotLabel(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
}

/**
 * 构建 DOT 头（图形名、rankdir、页面属性、node/edge 默认属性）。
 * @param graphName - 图形名（自动清洗为合法 id）。
 * @param options - rankdir 方向、字体名、是否填充（semantic 模式）、可选提交规格页面 bundle。
 * @returns DOT 头行列表。
 */
export function buildDotHeader(
  graphName: string,
  options: { rankdir: string; fontName: string; filled: boolean; page?: DotPageBundle },
): string[] {
  const nodeAttrs = [`fontname="${escapeDotLabel(options.fontName)}"`, 'fontsize=10']
  if (options.filled) nodeAttrs.push('style=filled')
  return [
    `digraph ${sanitizeId(graphName)} {`,
    `    rankdir=${options.rankdir};`,
    ...(options.page === undefined ? [] : pageAttributeLines(options.page)),
    `    node [${nodeAttrs.join(', ')}];`,
    `    edge [fontname="${escapeDotLabel(options.fontName)}", fontsize=9];`,
    '',
  ]
}

/** 流程图构建选项。 */
export type BuildFlowchartOptions = {
  /** 图号（标号系列用）。 */
  figureNumber?: number
  /** 色彩策略，默认 grayscale。 */
  style?: DotStyle
  /** 字体名（默认 Helvetica；含 CJK 时由调用方传入平台字体）。 */
  fontName?: string
  /** 显式标号（跨图续接）。 */
  numerals?: NumeralMap
  /** 自动标号步进。 */
  numeralStep?: number
  /** 提交规格页面 bundle（缺省不输出布局属性）。 */
  page?: DotPageBundle
  /** 标号内嵌步骤 label（默认 true）；false 时供引线标号通路图外标注。 */
  embedNumerals?: boolean
}

/**
 * 构建流程图 DOT。
 * @param steps - 步骤列表（按顺序出现；diamond 分支必须带边标签）。
 * @param options - 图号 / 色彩 / 字体 / 标号。
 * @returns DOT 文本。
 */
export function buildFlowchartDOT(steps: readonly FlowchartStep[], options: BuildFlowchartOptions = {}): string {
  if (steps.length === 0) throw new DotBuildError('empty_input', '流程图至少需要一个步骤')
  const ids = steps.map(step => sanitizeId(step.id))
  const byId = new Map<string, FlowchartStep>()
  steps.forEach((step, index) => byId.set(ids[index] as string, step))
  const assignments = assignFor(ids, options)
  const numeralOf = new Map(assignments.map(a => [a.id, a.numeral]))
  const lines = buildDotHeader('Flowchart', {
    rankdir: 'TB',
    fontName: options.fontName ?? 'Helvetica',
    filled: false,
    ...(options.page === undefined ? {} : { page: options.page }),
  })
  const ALLOWED_SHAPES: readonly FlowchartShape[] = ['box', 'ellipse', 'diamond', 'parallelogram', 'cylinder']
  for (const step of steps) {
    const id = sanitizeId(step.id)
    const shape = step.shape ?? 'box'
    if (!ALLOWED_SHAPES.includes(shape)) {
      throw new DotBuildError('invalid_shape', `未知节点形状：${shape}`)
    }
    // 标号由 assignNumerals 对全部组件分配，id->numeral 恒存在。
    /* v8 ignore start -- assignNumerals guarantees every id has a numeral; the empty-numeral branch is unreachable */
    const numeral = numeralOf.get(id) ?? ''
    const label = numeral === '' || options.embedNumerals === false
      ? escapeDotLabel(step.label)
      : `${escapeDotLabel(numeral)}. ${escapeDotLabel(step.label)}`
    /* v8 ignore stop */
    lines.push(`    "${id}" [label="${label}", shape=${shape}];`)
  }
  lines.push('')
  for (const step of steps) {
    const id = sanitizeId(step.id)
    const isDecision = (step.shape ?? 'box') === 'diamond'
    for (const next of step.next) {
      const target = typeof next === 'string' ? sanitizeId(next) : sanitizeId(next.id)
      if (!byId.has(target)) {
        throw new DotBuildError('unknown_id', `步骤 "${id}" 的后继不存在：${target}`)
      }
      if (typeof next === 'string' && isDecision) {
        throw new DotBuildError('missing_edge_label', `决策节点 "${id}" 的分支必须带边标签（next：${JSON.stringify(next)}）`)
      }
      if (typeof next === 'object') {
        const label = escapeDotLabel(next.label)
        if (label.trim() === '') {
          throw new DotBuildError('missing_edge_label', `决策节点 "${id}" 的分支标签不能为空`)
        }
        lines.push(`    "${id}" -> "${target}" [label="${label}"];`)
      } else {
        lines.push(`    "${id}" -> "${target}";`)
      }
    }
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** 框图构建选项。 */
export type BuildBlockDiagramOptions = {
  /** 图号（标号系列用）。 */
  figureNumber?: number
  /** 色彩策略，默认 grayscale。semantic 模式按块类型填充（色彩需承载技术内容）。 */
  style?: DotStyle
  /** 字体名（默认 Helvetica）。 */
  fontName?: string
  /** 显式标号（跨图续接）。 */
  numerals?: NumeralMap
  /** 自动标号步进。 */
  numeralStep?: number
  /** 提交规格页面 bundle（缺省不输出布局属性）。 */
  page?: DotPageBundle
  /** 标号内嵌块 label（默认 true）；false 时供引线标号通路图外标注。 */
  embedNumerals?: boolean
}

/** semantic 模式的块类型填充色（移植自 Claude-Patent-Creator block_styles；grayscale 模式不输出）。 */
const BLOCK_FILLCOLOR: Record<BlockKind, string> = {
  input: 'lightblue',
  output: 'lightgreen',
  process: 'lightyellow',
  storage: 'lightgray',
  decision: 'lightcoral',
  default: 'white',
}

/** 框图块形状映射。 */
const BLOCK_SHAPE: Record<BlockKind, string> = {
  input: 'invhouse',
  output: 'house',
  process: 'box',
  storage: 'cylinder',
  decision: 'diamond',
  default: 'box',
}

/**
 * 构建系统框图 DOT。
 * @param blocks - 块列表（按出现顺序分配标号）。
 * @param connections - 连接列表（from/to 必须存在）。
 * @param options - 图号 / 色彩 / 字体 / 标号。
 * @returns DOT 文本。
 */
export function buildBlockDiagramDOT(
  blocks: readonly BlockDiagramBlock[],
  connections: readonly BlockDiagramConnection[],
  options: BuildBlockDiagramOptions = {},
): string {
  if (blocks.length === 0) throw new DotBuildError('empty_input', '框图至少需要一个块')
  const ids = blocks.map(block => sanitizeId(block.id))
  const byId = new Map<string, BlockDiagramBlock>()
  blocks.forEach((block, index) => byId.set(ids[index] as string, block))
  const assignments = assignFor(ids, options)
  const numeralOf = new Map(assignments.map(a => [a.id, a.numeral]))
  const semantic = options.style === 'semantic'
  const lines = buildDotHeader('BlockDiagram', {
    rankdir: 'LR',
    fontName: options.fontName ?? 'Helvetica',
    filled: semantic,
    ...(options.page === undefined ? {} : { page: options.page }),
  })
  for (const block of blocks) {
    const id = sanitizeId(block.id)
    const type = block.type ?? 'default'
    const shape = BLOCK_SHAPE[type]
    // 同 buildFlowchartDOT：标号恒存在。
    /* v8 ignore start -- assignNumerals guarantees every id has a numeral; the empty-numeral branch is unreachable */
    const numeral = numeralOf.get(id) ?? ''
    const labelText = numeral === '' || options.embedNumerals === false
      ? escapeDotLabel(block.label)
      : `${escapeDotLabel(block.label)} (${numeral})`
    /* v8 ignore stop */
    const stylePart = semantic ? `, shape=${shape}, fillcolor=${BLOCK_FILLCOLOR[type]}` : `, shape=${shape}`
    lines.push(`    "${id}" [label="${labelText}"${stylePart}];`)
  }
  lines.push('')
  for (const conn of connections) {
    const from = sanitizeId(conn.from)
    const to = sanitizeId(conn.to)
    if (!byId.has(from)) throw new DotBuildError('unknown_id', `连接源块不存在：${conn.from}`)
    if (!byId.has(to)) throw new DotBuildError('unknown_id', `连接目标块不存在：${conn.to}`)
    const label = conn.label === undefined || conn.label === '' ? '' : escapeDotLabel(conn.label)
    lines.push(label === '' ? `    "${from}" -> "${to}";` : `    "${from}" -> "${to}" [label="${label}"];`)
  }
  lines.push('}', '')
  return lines.join('\n')
}

/** 层级图构建选项。 */
export type BuildHierarchyOptions = {
  /** 图号（标号系列用）。 */
  figureNumber?: number
  /** 色彩策略，默认 grayscale。 */
  style?: DotStyle
  /** 字体名（默认 Helvetica）。 */
  fontName?: string
  /** 显式标号（跨图续接）。 */
  numerals?: NumeralMap
  /** 自动标号步进。 */
  numeralStep?: number
  /** 提交规格页面 bundle（缺省不输出布局属性）。 */
  page?: DotPageBundle
  /** 标号内嵌节点 label（默认 true）；false 时供引线标号通路图外标注。 */
  embedNumerals?: boolean
}

/**
 * 构建组件层级图 DOT（深度优先展平，标号按先序分配）。
 * @param tree - 根节点列表（任意深度）。
 * @param options - 图号 / 色彩 / 字体 / 标号。
 * @returns DOT 文本。
 */
export function buildComponentHierarchyDOT(
  tree: readonly HierarchyNode[],
  options: BuildHierarchyOptions = {},
): string {
  if (tree.length === 0) throw new DotBuildError('empty_input', '层级图至少需要一个根节点')
  const ids: string[] = []
  const labels = new Map<string, string>()
  const parents = new Map<string, string>()
  const visit = (node: HierarchyNode, parent: string | undefined): void => {
    const id = sanitizeId(node.id)
    if (ids.includes(id)) throw new DotBuildError('unknown_id', `节点 id 重复：${node.id}`)
    ids.push(id)
    labels.set(id, node.label)
    if (parent !== undefined) parents.set(id, parent)
    for (const child of node.children ?? []) visit(child, id)
  }
  for (const root of tree) visit(root, undefined)
  const assignments = assignFor(ids, options)
  const numeralOf = new Map(assignments.map(a => [a.id, a.numeral]))
  const lines = buildDotHeader('ComponentHierarchy', {
    rankdir: 'TB',
    fontName: options.fontName ?? 'Helvetica',
    filled: false,
    ...(options.page === undefined ? {} : { page: options.page }),
  })
  for (const id of ids) {
    // 同 buildFlowchartDOT：标号恒存在。
    /* v8 ignore start -- assignNumerals guarantees every id has a numeral; the empty-numeral branch is unreachable */
    const numeral = numeralOf.get(id) ?? ''
    const labelText = numeral === '' || options.embedNumerals === false
      ? escapeDotLabel(labels.get(id) ?? '')
      : `${escapeDotLabel(labels.get(id) ?? '')} (${numeral})`
    /* v8 ignore stop */
    lines.push(`    "${id}" [label="${labelText}"];`)
  }
  lines.push('')
  for (const [id, parent] of parents) lines.push(`    "${parent}" -> "${id}";`)
  lines.push('}', '')
  return lines.join('\n')
}

/** 内置模板（结构化数据；渲染后即远程 get_diagram_templates 的四个 DOT，标号/彩色按 style 参数）。 */
const TEMPLATE_BUILDERS: Record<DiagramTemplateName, (options: BuildFlowchartOptions | BuildBlockDiagramOptions) => string> = {
  simple_flowchart: options =>
    buildFlowchartDOT(
      [
        { id: 'start', label: '开始', shape: 'ellipse', next: ['step1'] },
        { id: 'step1', label: '初始化', next: ['decision'] },
        { id: 'decision', label: '成功？', shape: 'diamond', next: [{ id: 'step3', label: '是' }, { id: 'step1', label: '否' }] },
        { id: 'step3', label: '处理', next: ['end'] },
        { id: 'end', label: '结束', shape: 'ellipse', next: [] },
      ],
      { ...options },
    ),
  system_block: options =>
    buildBlockDiagramDOT(
      [
        { id: 'input', label: '输入设备', type: 'input' },
        { id: 'controller', label: '控制器', type: 'process' },
        { id: 'processor', label: '处理模块', type: 'process' },
        { id: 'memory', label: '存储', type: 'storage' },
        { id: 'output', label: '输出设备', type: 'output' },
      ],
      [
        { from: 'input', to: 'controller', label: '信号' },
        { from: 'controller', to: 'processor', label: '指令' },
        { from: 'processor', to: 'memory', label: '数据' },
        { from: 'memory', to: 'processor', label: '数据' },
        { from: 'processor', to: 'output', label: '结果' },
      ],
      { ...options },
    ),
  method_steps: options =>
    buildFlowchartDOT(
      [
        { id: 'step101', label: '接收输入数据', next: ['step102'] },
        { id: 'step102', label: '校验数据格式', next: ['step103'] },
        { id: 'step103', label: '处理数据', next: ['step104'] },
        { id: 'step104', label: '生成输出', next: ['step105'] },
        { id: 'step105', label: '发送结果', next: [] },
      ],
      // 与远程 method_steps 模板一致：步骤固定编号 101-105。
      { ...options, numerals: { step101: '101', step102: '102', step103: '103', step104: '104', step105: '105' } },
    ),
  component_hierarchy: options =>
    buildComponentHierarchyDOT(
      [
        {
          id: 'system',
          label: '系统',
          children: [
            {
              id: 'sub1',
              label: '子系统',
              children: [
                { id: 'c1', label: '组件A' },
                { id: 'c2', label: '组件B' },
              ],
            },
            { id: 'sub2', label: '子系统' },
          ],
        },
      ],
      { ...options },
    ),
}

/**
 * 构建内置模板 DOT。
 * @param name - 模板名。
 * @param options - 图号 / 色彩 / 字体 / 标号。
 * @returns DOT 文本。
 */
export function getDiagramTemplate(name: DiagramTemplateName, options: BuildFlowchartOptions | BuildBlockDiagramOptions = {}): string {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATE_BUILDERS, name)) {
    throw new DotBuildError('invalid_template', `未知模板：${name}`)
  }
  return TEMPLATE_BUILDERS[name](options)
}
