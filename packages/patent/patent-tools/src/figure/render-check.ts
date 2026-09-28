/**
 * 附图渲染复核（纯函数，无 IO）：在**已生成的 SVG 源**上量测图面事实，报告只有
 * 看渲染结果才看得见的问题。
 *
 * 为什么量测矢量源而不是位图：矢量源是渲染的唯一输入，线段位置、线宽与字号都在
 * 其中；位图量测要引入栅格化器（rsvg/ImageMagick），而本包的两条渲染通路都不
 * 依赖它们。凡「画出来是什么样」取决于矢量源的地方，本模块都按同一条遍历量测。
 *
 * 覆盖四类只在渲染结果上显现的缺陷（前三类来自实测案例）：
 * - **文字被线条贯穿**：引线或轮廓线穿过文字占位框，标号或元件名读不出（引线的
 *   终点落在文字上、或标号落在被剖面线的零件内都会触发）。
 * - **点划线被实线覆盖**：同一行既有「长划+点」的点划段、又有一整段连续实线，
 *   点划线的间隔在图面上不可见（上下半剖的两半公共边正好落在轴线位置时如此）。
 * - **相邻零件剖面线取向过近**：两件轮廓相邻而剖面线取向差不超过
 *   {@link ADJACENT_ORIENTATION_LIMIT_DEG}，读成一个零件（GB/T 4457.5 要求相邻
 *   零件的剖面线方向相反或间距不等）。
 * - **内容越出画布**：线段、轮廓或标号落在根元素声明的画布之外，越界部分不会被
 *   渲染出来（后处理放大字号或落版改写画布时最易发生）。
 *
 * 量测范围：根元素的画布尺寸与 `viewBox`/`preserveAspectRatio`（`svg-viewport` 解析成
 * 用户单位 → 毫米的映射，故 px 级用户单位的导出文件与落版页同一口径）；`line`/`polyline`/
 * `polygon`/`rect`/`circle`/`ellipse`/`path`（M/L/H/V/Z，含相对形式）的几何；`text` 的内容、
 * 字号与 `text-anchor`（含自 `<g>` 继承与行内 `style`；未声明字号按 CSS 初值 16 用户单位）；
 * 线段的取向与线宽；`stroke-dasharray` 只用于点划线判定（按虚线段展开）。元素按嵌套逐层
 * 继承 `transform`（translate/scale/rotate/matrix）与线宽/描边/字号，故落版页与拼版页的
 * 缩放、纵排文字都能换算到根坐标系量测。`defs`/`clipPath`/`marker` 等定义容器的子元素与
 * `display: none` 的子树不在图面上渲染，整段跳过。
 *
 * 不在量测范围内的结构各记一条 `not-measured` 发现（同一原因只记一条）：CSS 类样式
 * （`<style>`，含 `<defs>` 内的样式表）、`<use>`/`<image>` 引用、嵌套 `<svg>` 的内层视口、
 * 端头标记（`marker-*`）、`<tspan>` 的 x/y/dx/dy 偏移、`dominant-baseline`/
 * `alignment-baseline`、相对视口的百分比长度、无法解析的 `transform`/路径 `d`/`viewBox`，
 * 以及按端点弦近似的曲线段；视口两轴缩放不等或 `slice` 裁剪时另记一条近似说明。
 * **报告里没有 `not-measured` 时，「未发现问题」才等于逐类量测过。**
 *
 * 输入安全检查复用 svg-annotate 的 assertSafeSvg（拒绝实体/CDATA、超限体量与
 * 非 SVG 根元素）；本模块只读文本，不解析实体也不执行内容。
 * @module @deepseek-ai/dsh-patent-tools/figure/render-check
 */

import { glyphBox, quadCrossedBySegment } from './glyph-box.ts'
import type { GlyphTextAnchor } from './glyph-box.ts'
import { DEFAULT_SVG_MAX_BYTES, assertSafeSvg } from './svg-annotate.ts'
import { MM_PER_USER_UNIT, parseLengthMm, resolveSvgViewport } from './svg-viewport.ts'

/** 复核发现的问题类别（稳定标识，供调用方分类）。 */
export type RenderCheckKind =
  | 'text-crossed-by-line'
  | 'centerline-covered'
  | 'hatch-orientation-collision'
  | 'ink-outside-canvas'
  | 'not-measured'

/** 图面墨迹的包围盒（毫米，根坐标系）。 */
export type InkBounds = {
  /** 最小 X。 */
  readonly minX: number
  /** 最小 Y。 */
  readonly minY: number
  /** 最大 X。 */
  readonly maxX: number
  /** 最大 Y。 */
  readonly maxY: number
}

/** 一条复核发现。 */
export type RenderCheckFinding = {
  /** 问题类别。 */
  readonly check: RenderCheckKind
  /** 模型可见的一句话结论。 */
  readonly message: string
}

/** 复核报告：量测值 + 发现的问题。 */
export type RenderCheckReport = {
  /** 画布宽（毫米或用户单位）；根元素未声明时为 undefined。 */
  readonly widthMm?: number
  /** 画布高（毫米或用户单位）；根元素未声明时为 undefined。 */
  readonly heightMm?: number
  /** 文字元素数。 */
  readonly textCount: number
  /** 描边图形的线宽分布（毫米 → 元素数，跳过 `stroke: none` 的填充图元），升序。 */
  readonly strokeWidthMm: readonly { readonly widthMm: number; readonly count: number }[]
  /** 线段取向分布（0–180°，点划线/引线/剖面线一并统计），按线段数降序。 */
  readonly orientationDeg: readonly { readonly orientationDeg: number; readonly count: number }[]
  /** 发现的问题（无问题为空数组）。 */
  readonly findings: readonly RenderCheckFinding[]
}

/** 相邻判定：两轮廓包围盒间隙不超过此值（毫米）视为相邻零件。 */
const ADJACENT_GAP_MM = 1
/** 相邻零件剖面线取向差下限（度）：小于它则两件难以区分。 */
const ADJACENT_ORIENTATION_LIMIT_DEG = 30
/** 点划线签名：短于此值的线段是「点」（毫米）。 */
const DOT_MAX_LENGTH_MM = 1
/** 点划线签名：长于此值的线段是「长划」（毫米）。 */
const DASH_MIN_LENGTH_MM = 3
/** 点划线签名下限：同一行至少这么多个「点」与「长划」才按点划线判定。 */
const DASH_DOT_MIN_DOTS = 3
const DASH_DOT_MIN_DASHES = 2
/** 点划线签名下限：整行跨度不得小于此值（毫米），排除零件轮廓的零碎短边。 */
const DASH_DOT_MIN_SPAN_MM = 20
/**
 * 点划线长划的长度上界（毫米）：标准中心线的长划约 8 毫米（本包 `dashDotSegments`
 * 即 8 毫米）。同一行合并后若出现更长的连续墨迹，说明该行另有压在点划线上的实线
 * ——这是「点划线被实线覆盖」的判据，而不是把点划线自己的间隔当成实线。
 */
const DASH_DOT_MAX_DASH_MM = 10
/** 行内可见间隙下限（毫米）：整行合并后无此宽度的空隙即视为「间隔不可见」。 */
const VISIBLE_GAP_MM = 1
/** 同一直线上的坐标容差（毫米）。 */
const AXIS_TOLERANCE_MM = 0.05
/** 判定两条轮廓互为镜像的顶点坐标容差（毫米）。 */
const MIRROR_TOLERANCE_MM = 0.01
/**
 * 剖面线判定的最少平行线段数：零件内至少要这么多条同取向的线才算打了剖面线。
 * 取这些线是为了把「零件内的偶发线条」（电气符号的笔画、穿过零件的走线）排除在取向
 * 比较之外——它们的取向由符号画法决定，与剖面线无关。
 */
const HATCH_MIN_LINES = 3
/** SVG 未声明 `stroke-width` 时的初值（用户单位）。 */
const DEFAULT_STROKE_WIDTH = 1
/**
 * SVG 未声明 `font-size` 时的初值（用户单位，即 CSS 的 `medium` = 16 px）。
 * 本机 Inkscape 1.4.4 对缺省字号实测约 12 用户单位，取 16（规范初值）偏保守：
 * 估出的占位框更大，漏报少、误报多，而漏报的代价是交付了读不出的图。
 */
const DEFAULT_FONT_SIZE_USER = 16
/** 圆与椭圆的折线近似边数：内接多边形的最大径向误差约 0.9%，足以量测描边与包围盒。 */
const CIRCLE_GON_SEGMENTS = 24
/** 定义容器：其子元素只被引用而不直接渲染，整段跳过（`<use>` 引用单独报未量测）。 */
const DEFINITION_CONTAINERS = new Set([
  'defs', 'clippath', 'mask', 'marker', 'pattern', 'symbol', 'filter', 'lineargradient', 'radialgradient',
])

/** 二维点（用户单位）。 */
type Point = readonly [number, number]
/** 线段（用户单位）。 */
type Segment = { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }
/** 顶点表（用户单位）。 */
type Poly = readonly Point[]
/** 子路径：顶点序列与是否闭合（闭合子路径隐含最后一点回到首点）。 */
type SubPath = { readonly points: Poly; readonly closed: boolean }
/** 仿射矩阵 `[a b c d e f]`：`x' = a·x + c·y + e`、`y' = b·x + d·y + f`（SVG `matrix()` 同序）。 */
type Matrix = readonly [number, number, number, number, number, number]
/** 文字占位框经变换后的像：`O`、`O+e1`、`O+e1+e2`、`O+e2`。 */
type Quad = readonly [Point, Point, Point, Point]

/** 一个描边图形（元素可能含多条子路径）。 */
type Shape = {
  readonly subpaths: readonly SubPath[]
  /** 线宽（毫米，已按元素的累计缩放换算）。 */
  readonly strokeWidthMm: number
  /** 是否描边：`stroke: none` 的填充图元不计入线宽分布，但其几何仍参与贯穿与越界判定。 */
  readonly stroked: boolean
  /** `stroke-dasharray` 的虚线段长（毫米，已按累计缩放换算）；实线元素为 undefined。 */
  readonly dashPatternMm?: readonly number[]
}

/** 一个文字元素：内容与文字占位框四角（根坐标系）。 */
type ScannedText = { readonly content: string; readonly corners: Quad }

/** 元素按文档序应用后的帧：变换与继承来的样式取值。 */
type Frame = {
  readonly matrix: Matrix
  readonly strokeWidthMm: number
  readonly stroked: boolean
  /** 字号（用户单位；绘制时按帧矩阵换算到毫米）。 */
  readonly fontSizeUser: number
  /** `text-anchor`（自祖先继承，取值经白名单校验）。 */
  readonly textAnchor: GlyphTextAnchor
  /** 位于不直接渲染的定义容器内、或 `display: none`：子树整体跳过。 */
  readonly skip: boolean
}

/** 一张 SVG 的图面事实。 */
type Scan = {
  readonly widthMm: number | undefined
  readonly heightMm: number | undefined
  readonly shapes: readonly Shape[]
  readonly texts: readonly ScannedText[]
  /** 未量测原因（去重，按首次出现顺序）。 */
  readonly unmeasured: readonly string[]
}

/** 图元的几何：认识的图形给出子路径，其余元素无几何。 */
type ElementGeometry =
  | { readonly kind: 'paths'; readonly subpaths: readonly SubPath[] }
  | { readonly kind: 'none' }

/** 无几何的图元（自闭合标记与解析失败共用）。 */
const NO_GEOMETRY: ElementGeometry = { kind: 'none' }

/** 单位矩阵。 */
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** 匹配任意元素起止标签：组 1 = `/` 关闭标记，组 2 = 元素名，组 3 = 属性原文，组 4 = `/` 自闭合。 */
const TAG_PATTERN = /<(\/?)([A-Za-z][\w:.-]*)((?:"[^"]*"|[^>])*?)(\/?)>/g

/** 端头标记（`marker-start/mid/end`）：端头画出的箭头墨迹不在量测范围。 */
const MARKER_PATTERN = /\bmarker-(?:start|mid|end)\s*=/

/** `<tspan>` 的位置或位移（`x`/`y`/`dx`/`dy`）：逐行偏移不在量测范围。 */
const TSPAN_OFFSET_PATTERN = /\b(?:x|y|dx|dy)\s*=/

/** 文字基线属性：基线位置不在量测范围。 */
const BASELINE_PATTERN = /\b(?:dominant|alignment)-baseline\s*=/

/** 相对视口的百分比长度：矢量源上无法解析成绝对长度。 */
const PERCENT_LENGTH_PATTERN = /\b(?:x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|stroke-width|stroke-dasharray|font-size)\s*=\s*"[^"]*%/

/** 读取标签属性（第一个匹配的 `name="…"`）。 */
function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)
  return match?.[1]
}

/**
 * 读取行内 `style` 里的声明值（`style="fill:none;stroke-width:0.5"`）。
 * 行内样式优先于表现属性（CSS 层叠），故取值一律经本函数再回落属性。
 * @param tag - 标签原文。
 * @param property - CSS 属性名（不区分大小写）。
 * @returns 声明值；未声明时 undefined。
 */
function styleValue(tag: string, property: string): string | undefined {
  const style = attr(tag, 'style')
  if (style === undefined) return undefined
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    if (declaration.slice(0, colon).trim().toLowerCase() === property) return declaration.slice(colon + 1).trim()
  }
  return undefined
}

/** 读取表现属性或行内 `style` 声明（样式优先）。 */
function styled(tag: string, name: string): string | undefined {
  return styleValue(tag, name) ?? attr(tag, name)
}

/** 解析长度（或数值）属性值：百分比与非法文本返回 undefined。 */
function numValue(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.includes('%')) return undefined
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : undefined
}

/** 读取数值属性（行内 `style` 优先）。 */
function num(tag: string, name: string): number | undefined {
  return numValue(styled(tag, name))
}

/**
 * `font-size` 取值 → 用户单位长度。
 *
 * 无单位与 `px` 即用户单位（SVG 1.1 起 1 px = 1 用户单位）；`em` 与 `%` 相对父级字号；
 * `mm`/`cm`/`in`/`pt`/`pc` 按 CSS 的 96 dpi 折算成用户单位（本机 Inkscape 1.4.4 实测：
 * 1:1 毫米文档里 `font-size="3.5mm"` 与 `font-size="13.23px"` 量出同一字高，两者都是
 * 13.23 用户单位）；`ex`/`ch`/`rem` 与视口单位需要字体度量或视口尺寸，无法在矢量源上解析。
 * @param raw - `font-size` 属性原文。
 * @param parentUser - 父级字号（用户单位），供 `em`/`%` 解析。
 * @returns 字号（用户单位）；无法解析时 undefined（调用方按父级字号估算并记未量测）。
 */
function fontSizeUser(raw: string, parentUser: number): number | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i.exec(raw)
  if (match === null) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  switch ((match[2] ?? '').toLowerCase()) {
    case '':
    case 'px':
      return value
    case 'em':
      return value * parentUser
    case '%':
      return (value / 100) * parentUser
    default: {
      const mm = parseLengthMm(raw)
      return mm === undefined ? undefined : mm / MM_PER_USER_UNIT
    }
  }
}

/** `text-anchor` 取值 → 对齐方式；白名单之外的取值按未声明处理（沿用父级）。 */
function textAnchorValue(raw: string | undefined): GlyphTextAnchor | undefined {
  switch (raw) {
    case 'start':
    case 'middle':
    case 'end':
      return raw
    default:
      return undefined
  }
}

/**
 * `stroke-dasharray` 取值 → 虚线段长（用户单位）。
 * @param raw - 属性原文。
 * @returns 段长序列；未声明、`none`、取值非法或全为 0（等于实线）时 undefined。
 */
function dashPatternUser(raw: string | undefined): readonly number[] | undefined {
  if (raw === undefined || raw.trim().toLowerCase() === 'none') return undefined
  const parts = raw.trim().split(/[\s,]+/).map(Number)
  if (parts.length === 0 || parts.some(value => !Number.isFinite(value) || value < 0)) return undefined
  if (parts.every(value => value === 0)) return undefined
  // 奇数个取值按 SVG 规则重复一遍：8 2 0.4 等价于 8 2 0.4 8 2 0.4。
  return parts.length % 2 === 1 ? [...parts, ...parts] : parts
}

/** 矩阵复合：先 `inner` 后 `outer`。 */
function multiply(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ]
}

/** 点经矩阵变换到根坐标系。 */
function mapPoint(matrix: Matrix, point: Point): Point {
  return [
    matrix[0] * point[0] + matrix[2] * point[1] + matrix[4],
    matrix[1] * point[0] + matrix[3] * point[1] + matrix[5],
  ]
}

/** 矩阵的平均缩放 `√|det|`：长度（线宽）按它换算到根坐标系。 */
function scaleOf(matrix: Matrix): number {
  return Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]))
}

/**
 * 单个变换函数的矩阵；函数名未知或参数个数非法时 undefined。
 * @param name - 函数名（区分大小写，SVG 变换函数恒为大写敏感的字面名）。
 * @param args - 已解析的数值参数。
 * @returns 该函数的矩阵；不可识别时 undefined。
 */
function transformStep(name: string, args: readonly number[]): Matrix | undefined {
  const value = (index: number): number => args[index] as number
  switch (name) {
    case 'translate':
      if (args.length !== 1 && args.length !== 2) return undefined
      return [1, 0, 0, 1, value(0), args[1] ?? 0]
    case 'scale':
      if (args.length !== 1 && args.length !== 2) return undefined
      return [value(0), 0, 0, args[1] ?? value(0), 0, 0]
    case 'rotate': {
      if (args.length !== 1 && args.length !== 3) return undefined
      const radians = (value(0) * Math.PI) / 180
      const rotation: Matrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0]
      if (args.length === 1) return rotation
      const centre: Matrix = [1, 0, 0, 1, value(1), value(2)]
      const back: Matrix = [1, 0, 0, 1, -value(1), -value(2)]
      return multiply(multiply(centre, rotation), back)
    }
    case 'matrix':
      if (args.length !== 6) return undefined
      return [value(0), value(1), value(2), value(3), value(4), value(5)]
    default:
      return undefined
  }
}

/**
 * 解析 `transform` 属性：`translate`/`scale`/`rotate`/`matrix` 的函数序列复合。
 * @param text - 属性原文；未声明时为 undefined。
 * @returns 矩阵；含未知函数、参数个数或数值非法时为 undefined（该元素未量测）。
 */
function parseTransform(text: string | undefined): Matrix | undefined {
  if (text === undefined) return IDENTITY
  let matrix = IDENTITY
  for (const match of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const args = (match[2] ?? '').split(/[\s,]+/).filter(part => part !== '').map(Number)
    if (args.some(value => !Number.isFinite(value))) return undefined
    const step = transformStep(match[1] as string, args)
    if (step === undefined) return undefined
    matrix = multiply(matrix, step)
  }
  return matrix
}

/** 路径命令与其参数（`d` 中显式写出的命令各成一组）。 */
type PathGroup = { readonly name: string; readonly args: readonly number[] }

/** 各路径命令的参数个数（小写名）。 */
const PATH_ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

/** 路径解析结果：子路径与是否含曲线（曲线按端点弦近似）。 */
type PathData = { readonly subpaths: readonly SubPath[]; readonly approximate: boolean }

/**
 * 把 `d` 切成命令组：每个命令字母带其后的数值，命令前出现裸数值或参数非数值时 undefined。
 * @param source - 已去首尾空白的 `d` 原文。
 * @returns 命令组；无法切分时 undefined。
 */
function pathGroups(source: string): PathGroup[] | undefined {
  const groups: PathGroup[] = []
  let consumed = 0
  for (const match of source.matchAll(/([a-zA-Z])([^a-zA-Z]*)/g)) {
    if (match.index !== consumed) return undefined
    consumed = match.index + match[0].length
    const raw = (match[2] ?? '').trim()
    const args = raw === '' ? [] : raw.split(/[\s,]+/).map(Number)
    if (args.some(value => !Number.isFinite(value))) return undefined
    groups.push({ name: match[1] as string, args })
  }
  return groups
}

/**
 * 解析 `<path>` 的 `d`：支持 M/L/H/V/Z（含相对形式与隐式重复）；曲线命令 C/S/Q/T/A 一律取其
 * 末点连弦并置 `approximate`；未知命令返回 undefined。
 * @param d - `d` 属性原文。
 * @returns 子路径与近似标记；无法解析时 undefined。
 */
function parsePathData(d: string): PathData | undefined {
  const groups = pathGroups(d.trim())
  if (groups === undefined) return undefined
  const subpaths: SubPath[] = []
  let points: Point[] = []
  let start: Point = [0, 0]
  let current: Point = [0, 0]
  let approximate = false

  /** 收束当前子路径（顶点不足两个时丢弃）。 */
  const flush = (closed: boolean): void => {
    if (points.length >= 2) subpaths.push({ points, closed })
    points = []
  }
  /** 数值参数取绝对或相对坐标下的目标点（`x`/`y` 为该命令的坐标分量）。 */
  const target = (relative: boolean, x: number, y: number): Point =>
    relative ? [current[0] + x, current[1] + y] : [x, y]
  const value = (group: PathGroup, index: number): number => group.args[index] as number

  for (const group of groups) {
    const lower = group.name.toLowerCase()
    const arity = PATH_ARITY[lower]
    if (arity === undefined) return undefined
    // 命令字母小写 = 相对坐标；同时也决定 M 的后续坐标对按 L 处理。
    const relative = group.name === lower
    if (arity === 0) {
      if (group.args.length !== 0) return undefined
      flush(true)
      current = start
      continue
    }
    if (group.args.length === 0 || group.args.length % arity !== 0) return undefined
    for (let offset = 0; offset < group.args.length; offset += arity) {
      // M 的后续坐标对按 L 处理（SVG 的隐式重复规则）。
      const command = lower === 'm' && offset > 0 ? 'l' : lower
      const chunk = { name: group.name, args: group.args.slice(offset, offset + arity) }
      if (command === 'm') {
        flush(false)
        start = target(relative, value(chunk, 0), value(chunk, 1))
        current = start
        points = [start]
        continue
      }
      if (points.length === 0) points = [current]
      if (command === 'l') current = target(relative, value(chunk, 0), value(chunk, 1))
      // H/V 只给一个坐标，另一个分量必须保持不动——走 target 会在绝对形式下把
      // 另一个分量当成 0，之后的相对命令全部从错误的位置累加（Inkscape 的文字
      // 轮廓路径里就混着单个绝对 H/V，量出来的墨迹框会跑到画布外）。
      else if (command === 'h') current = [relative ? current[0] + value(chunk, 0) : value(chunk, 0), current[1]]
      else if (command === 'v') current = [current[0], relative ? current[1] + value(chunk, 0) : value(chunk, 0)]
      else {
        // 曲线命令：只取末点，曲率本身不量测。
        approximate = true
        const last = arity - 1
        const previous = command === 'c' || command === 'q' ? last - 2 : last - 1
        current = target(relative, value(chunk, previous), value(chunk, last))
      }
      points.push(current)
    }
  }
  flush(false)
  return { subpaths, approximate }
}

/** 解析 `points` 属性：坐标为成对数值且不少于 `minimum` 个顶点。 */
function parsePoints(raw: string | undefined, minimum: number): Poly | undefined {
  if (raw === undefined) return undefined
  const numbers = raw.trim().split(/[\s,]+/).filter(part => part !== '').map(Number)
  if (numbers.length % 2 !== 0) return undefined
  const points: Point[] = []
  for (let index = 0; index < numbers.length; index += 2) {
    points.push([numbers[index] as number, numbers[index + 1] as number])
  }
  if (points.length < minimum) return undefined
  return points.every(point => Number.isFinite(point[0]) && Number.isFinite(point[1])) ? points : undefined
}

/**
 * 圆/椭圆的折线近似（{@link CIRCLE_GON_SEGMENTS} 个顶点，首顶点在 +x 轴上）。
 * @param cx - 圆心 x。
 * @param cy - 圆心 y。
 * @param rx - 横向半径。
 * @param ry - 纵向半径。
 * @returns 顶点表。
 */
function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Point[] {
  const points: Point[] = []
  for (let index = 0; index < CIRCLE_GON_SEGMENTS; index += 1) {
    const radians = (index * 2 * Math.PI) / CIRCLE_GON_SEGMENTS
    points.push([cx + rx * Math.cos(radians), cy + ry * Math.sin(radians)])
  }
  return points
}

/**
 * 元素的几何：认识的图形元素给出子路径（坐标原始，未变换）。
 * @param name - 元素名（小写）。
 * @param tag - 标签原文。
 * @param note - 记录未量测原因的收集器。
 * @returns 子路径或「无几何」。
 */
function geometryOf(name: string, tag: string, note: (reason: string) => void): ElementGeometry {
  switch (name) {
    case 'line': {
      const x1 = num(tag, 'x1')
      const y1 = num(tag, 'y1')
      const x2 = num(tag, 'x2')
      const y2 = num(tag, 'y2')
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return NO_GEOMETRY
      return { kind: 'paths', subpaths: [{ points: [[x1, y1], [x2, y2]], closed: false }] }
    }
    case 'polyline':
    case 'polygon': {
      const points = parsePoints(attr(tag, 'points'), name === 'polygon' ? 3 : 2)
      if (points === undefined) return NO_GEOMETRY
      return { kind: 'paths', subpaths: [{ points, closed: name === 'polygon' }] }
    }
    case 'rect': {
      const width = num(tag, 'width')
      const height = num(tag, 'height')
      if (width === undefined || height === undefined || width <= 0 || height <= 0) return NO_GEOMETRY
      const x = num(tag, 'x') ?? 0
      const y = num(tag, 'y') ?? 0
      return { kind: 'paths', subpaths: [{ points: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], closed: true }] }
    }
    case 'circle': {
      const radius = num(tag, 'r')
      if (radius === undefined || radius <= 0) return NO_GEOMETRY
      const points = ellipsePoints(num(tag, 'cx') ?? 0, num(tag, 'cy') ?? 0, radius, radius)
      return { kind: 'paths', subpaths: [{ points, closed: true }] }
    }
    case 'ellipse': {
      const rx = num(tag, 'rx')
      const ry = num(tag, 'ry')
      if (rx === undefined || ry === undefined || rx <= 0 || ry <= 0) return NO_GEOMETRY
      const points = ellipsePoints(num(tag, 'cx') ?? 0, num(tag, 'cy') ?? 0, rx, ry)
      return { kind: 'paths', subpaths: [{ points, closed: true }] }
    }
    case 'path': {
      const d = attr(tag, 'd')
      if (d === undefined) return NO_GEOMETRY
      const parsed = parsePathData(d)
      if (parsed === undefined) {
        note('路径 `d` 含无法解析的命令，该路径的几何未量测')
        return NO_GEOMETRY
      }
      if (parsed.approximate) note('路径含曲线命令（C/S/Q/T/A），曲线段按端点弦近似量测')
      return parsed.subpaths.length === 0 ? NO_GEOMETRY : { kind: 'paths', subpaths: parsed.subpaths }
    }
    default:
      return NO_GEOMETRY
  }
}

/**
 * 子元素的帧：变换与继承来的样式属性覆盖父帧（行内 `style` 优先于表现属性）；
 * 不可识别的 `transform` 返回 undefined（该子树整体未量测）。
 * @param parent - 父元素的帧。
 * @param name - 元素名（小写）。
 * @param tag - 标签原文。
 * @param note - 记录未量测原因的收集器。
 * @returns 该元素的帧；变换不可识别时 undefined。
 */
function childFrame(parent: Frame, name: string, tag: string, note: (reason: string) => void): Frame | undefined {
  const transform = parseTransform(styled(tag, 'transform'))
  if (transform === undefined) return undefined
  const stroke = styled(tag, 'stroke')
  const rawFontSize = styled(tag, 'font-size')
  let fontSize = parent.fontSizeUser
  if (rawFontSize !== undefined) {
    const resolved = fontSizeUser(rawFontSize, parent.fontSizeUser)
    if (resolved === undefined) {
      note('`font-size` 用了需要字体度量或视口的单位（ex/ch/rem/视口单位等），该文字按父级字号估算')
    } else {
      fontSize = resolved
    }
  }
  return {
    matrix: multiply(parent.matrix, transform),
    strokeWidthMm: numValue(styled(tag, 'stroke-width')) ?? parent.strokeWidthMm,
    stroked: stroke === undefined ? parent.stroked : stroke !== 'none',
    fontSizeUser: fontSize,
    textAnchor: textAnchorValue(styled(tag, 'text-anchor')) ?? parent.textAnchor,
    // `display: none` 的子树不渲染：既不算墨迹，也不再逐元素记为未量测。
    skip: parent.skip || styled(tag, 'display') === 'none' || DEFINITION_CONTAINERS.has(name),
  }
}

/**
 * 文字元素记录：内容与经该元素变换后的文字占位框四角。
 * @param content - 文本节点内容（已去标签与首尾空白）。
 * @param tag - `<text>` 标签原文。
 * @param frame - 该元素的帧。
 * @returns 文字记录。
 */
function textEntry(content: string, tag: string, frame: Frame): ScannedText {
  const box = glyphBox(
    content,
    [num(tag, 'x') ?? 0, num(tag, 'y') ?? 0],
    frame.fontSizeUser,
    frame.textAnchor,
  )
  return {
    content,
    corners: [
      mapPoint(frame.matrix, [box.minX, box.minY]),
      mapPoint(frame.matrix, [box.maxX, box.minY]),
      mapPoint(frame.matrix, [box.maxX, box.maxY]),
      mapPoint(frame.matrix, [box.minX, box.maxY]),
    ],
  }
}

/**
 * 遍历 SVG：按文档序把每个元素变换到根坐标系，收集描边图形与文字，并记录未量测的原因。
 *
 * 根元素的视口（画布尺寸、viewBox、preserveAspectRatio）由 svg-viewport 解析后作为根帧
 * 的矩阵，故此后所有坐标与长度都是毫米：落版页、拼版页、px 级用户单位的导出文件都换算
 * 到同一口径。
 * @param svg - 完整 SVG 文本。
 * @returns 画布尺寸、图形、文字与未量测原因。
 */
function scanSvg(svg: string): Scan {
  // 注释里的 `<line …>` 不是图元：先整段去掉，避免把注释当成元素量测。
  const source = svg.replace(/<!--[\s\S]*?-->/g, '')
  const viewport = resolveSvgViewport(/<svg\b[^>]*>/i.exec(source)?.[0] ?? '')
  const root: Frame = {
    matrix: [
      viewport.scaleX,
      0,
      0,
      viewport.scaleY,
      -viewport.originX * viewport.scaleX,
      -viewport.originY * viewport.scaleY,
    ],
    strokeWidthMm: DEFAULT_STROKE_WIDTH,
    stroked: false,
    fontSizeUser: DEFAULT_FONT_SIZE_USER,
    textAnchor: 'start',
    skip: false,
  }
  const stack: Frame[] = [root]
  const shapes: Shape[] = []
  const texts: ScannedText[] = []
  const unmeasured: string[] = []
  const note = (reason: string): void => {
    if (!unmeasured.includes(reason)) unmeasured.push(reason)
  }
  if (viewport.note !== undefined) note(viewport.note)
  let rootSvgSeen = false
  let pending: { readonly contentStart: number; readonly tag: string; readonly frame: Frame } | undefined

  for (const match of source.matchAll(TAG_PATTERN)) {
    const name = (match[2] ?? '').toLowerCase()
    const tag = match[0]
    if ((match[1] ?? '') === '/') {
      if (name === 'text' && pending !== undefined) {
        const content = source.slice(pending.contentStart, match.index).replace(/<[^>]*>/g, '').trim()
        if (content !== '') texts.push(textEntry(content, pending.tag, pending.frame))
        pending = undefined
      }
      if (stack.length > 1) stack.pop()
      continue
    }
    const parent = stack[stack.length - 1] as Frame
    const selfClosing = (match[4] ?? '') === '/'
    const own = childFrame(parent, name, tag, note)
    if (own === undefined) {
      note('含 `translate`/`scale`/`rotate`/`matrix` 之外的变换（或参数非法），相关图元的几何未量测')
      if (!selfClosing) stack.push({ ...parent, skip: true })
      continue
    }
    // 嵌套 `<svg>` 另有内层视口、viewBox 与裁剪，本模块按未量测处理并跳过其子树：
    // 把内层元素按外层画布量测会得出错的越界结论。
    const nestedViewport = name === 'svg' && rootSvgSeen
    if (nestedViewport) note('文档含嵌套 `<svg>`（内层视口与裁剪），其子元素未量测')
    const frame = nestedViewport ? { ...own, skip: true } : own
    if (!selfClosing) stack.push(frame)
    if (name === 'style') {
      note('文档含 `<style>` 样式表，CSS 类规则决定的外观（线宽、描边、字号）未量测')
      continue
    }
    if (frame.skip) continue
    if (name === 'svg') {
      rootSvgSeen = true
      continue
    }
    // 不在量测范围的结构逐类记账：报告里没有 not-measured 才等于逐类量测过。
    if (MARKER_PATTERN.test(tag)) note('`marker-start/mid/end` 端头（箭头）的墨迹未量测')
    if (name === 'tspan' && TSPAN_OFFSET_PATTERN.test(tag)) note('`<tspan>` 的 x/y/dx/dy 偏移未量测，多行文字的实际位置可能与占位框不同')
    if (BASELINE_PATTERN.test(tag)) note('`dominant-baseline`/`alignment-baseline` 未量测，文字基线可能与占位框不同')
    if (PERCENT_LENGTH_PATTERN.test(tag)) note('长度属性用了相对视口的百分比（如 width="50%"），未量测')
    if (name === 'text') {
      if (!selfClosing) pending = { contentStart: match.index + tag.length, tag, frame }
      continue
    }
    if (name === 'g') continue
    if (name === 'use' || name === 'image') {
      note(`\`<${name}>\` 引用的内容未展开，其几何未量测`)
      continue
    }
    const geometry = geometryOf(name, tag, note)
    if (geometry.kind === 'none') continue
    const scale = scaleOf(frame.matrix)
    const dashPattern = dashPatternUser(styled(tag, 'stroke-dasharray'))
    shapes.push({
      subpaths: geometry.subpaths.map(subpath => ({
        points: subpath.points.map(point => mapPoint(frame.matrix, point)),
        closed: subpath.closed,
      })),
      strokeWidthMm: frame.strokeWidthMm * scale,
      stroked: frame.stroked,
      ...(dashPattern === undefined ? {} : { dashPatternMm: dashPattern.map(value => value * scale) }),
    })
  }
  return {
    widthMm: viewport.widthMm,
    heightMm: viewport.heightMm,
    shapes,
    texts,
    unmeasured,
  }
}

/** 子路径的线段：相邻顶点各一段，闭合子路径另加收口边。 */
function subpathSegments(subpath: SubPath): Segment[] {
  const segments: Segment[] = []
  for (let index = 0; index + 1 < subpath.points.length; index += 1) {
    const from = subpath.points[index] as Point
    const to = subpath.points[index + 1] as Point
    segments.push({ x1: from[0], y1: from[1], x2: to[0], y2: to[1] })
  }
  if (subpath.closed) {
    const first = subpath.points[0] as Point
    const last = subpath.points[subpath.points.length - 1] as Point
    segments.push({ x1: last[0], y1: last[1], x2: first[0], y2: first[1] })
  }
  return segments
}

/** 线段长度。 */
function length(segment: Segment): number {
  return Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)
}

/** 线段取向归一化到 [0, 180)。 */
function orientation(segment: Segment): number {
  const degrees = (Math.atan2(segment.y2 - segment.y1, segment.x2 - segment.x1) * 180) / Math.PI
  return ((degrees % 180) + 180) % 180
}

/** 包围盒。 */
function bounds(points: Poly): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** 点是否在多边形内（even-odd 射线法）。 */
function insidePolygon(point: Point, points: Poly): boolean {
  let inside = false
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index] as Point
    const b = points[previous] as Point
    if ((a[1] > point[1]) === (b[1] > point[1])) continue
    const x = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    if (point[0] < x) inside = !inside
  }
  return inside
}

/**
 * 线段是否穿过文字占位框：与绘图侧（引线避让、标号落位）共用同一判定
 * （{@link quadCrossedBySegment}），容差同为 glyph-box 的占位框容差。
 * @param segment - 待判线段（根坐标系）。
 * @param quad - 文字占位框四角。
 * @returns 穿过时 true。
 */
function crossesQuad(segment: Segment, quad: Quad): boolean {
  return quadCrossedBySegment(
    {
      origin: quad[0],
      edgeWidth: [quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]],
      edgeHeight: [quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]],
    },
    [segment.x1, segment.y1],
    [segment.x2, segment.y2],
  )
}

/**
 * 两多边形是否为镜像（关于某条水平线或竖直线对称，且尺寸相同）：同一零件的上下或
 * 左右两半用同一剖面线取向，不应被判成「相邻零件取向过近」。
 *
 * 对称轴必须落在两个包围盒的**外边界**上（两半沿轴相接），否则会把并排的两个相同
 * 矩形误认成镜像（矩形关于自身中线也是对称的）。
 * @param a - 多边形 A 的顶点。
 * @param b - 多边形 B 的顶点。
 * @returns 互为镜像时 true。
 */
function isMirrorPair(a: Poly, b: Poly): boolean {
  if (a.length !== b.length) return false
  const key = (points: Poly): string => points
    .map(point => `${String(Math.round(point[0] * 1000))}:${String(Math.round(point[1] * 1000))}`)
    .sort()
    .join('|')
  const boxA = bounds(a)
  const boxB = bounds(b)
  const sameSize = Math.abs((boxA.maxX - boxA.minX) - (boxB.maxX - boxB.minX)) <= MIRROR_TOLERANCE_MM
    && Math.abs((boxA.maxY - boxA.minY) - (boxB.maxY - boxB.minY)) <= MIRROR_TOLERANCE_MM
  if (!sameSize) return false
  /** 对称轴是否落在两盒之外（允许贴边）：落在盒内说明是同一侧的图形。 */
  const axisOutside = (axis: number, from: number, to: number): boolean =>
    axis <= from + MIRROR_TOLERANCE_MM || axis >= to - MIRROR_TOLERANCE_MM
  const horizontalAxis = (boxA.minY + boxA.maxY + boxB.minY + boxB.maxY) / 4
  if (axisOutside(horizontalAxis, boxA.minY, boxA.maxY) && axisOutside(horizontalAxis, boxB.minY, boxB.maxY)) {
    const reflected = b.map(point => [point[0], 2 * horizontalAxis - point[1]] as const)
    if (key(reflected) === key(a)) return true
  }
  const verticalAxis = (boxA.minX + boxA.maxX + boxB.minX + boxB.maxX) / 4
  if (axisOutside(verticalAxis, boxA.minX, boxA.maxX) && axisOutside(verticalAxis, boxB.minX, boxB.maxX)) {
    const reflected = b.map(point => [2 * verticalAxis - point[0], point[1]] as const)
    if (key(reflected) === key(a)) return true
  }
  return false
}

/**
 * 一个零件内的剖面线取向：落入零件内部的线段中，同一取向（0.1° 分桶）重复最多的一条
 * 的取向；没有任何取向达到 {@link HATCH_MIN_LINES} 条时 undefined（该零件没有剖面线）。
 * @param segments - 归入该零件的线段。
 * @returns 剖面线取向（度）；无剖面线时 undefined。
 */
function hatchOrientation(segments: readonly Segment[]): number | undefined {
  const counts = new Map<number, number>()
  for (const segment of segments) {
    const key = Math.round(orientation(segment) * 10) / 10
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best: number | undefined
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return bestCount >= HATCH_MIN_LINES ? best : undefined
}

/** 轴对齐分组：同一行/列的线段集合（用于点划线覆盖判定）。 */
type AxisGroup = { readonly axis: 'x' | 'y'; readonly line: number; readonly segments: readonly Segment[] }

/** 按轴分组：同一坐标（容差 {@link AXIS_TOLERANCE_MM}）上的水平或竖直线段归为一组。 */
function intervalsByAxis(segments: readonly Segment[]): AxisGroup[] {
  const groups = new Map<string, { axis: 'x' | 'y'; line: number; segments: Segment[] }>()
  for (const segment of segments) {
    const horizontal = Math.abs(segment.y2 - segment.y1) <= AXIS_TOLERANCE_MM
    const vertical = Math.abs(segment.x2 - segment.x1) <= AXIS_TOLERANCE_MM
    if (!horizontal && !vertical) continue
    const axis: 'x' | 'y' = horizontal ? 'x' : 'y'
    const line = horizontal ? (segment.y1 + segment.y2) / 2 : (segment.x1 + segment.x2) / 2
    const key = `${axis}@${String(Math.round(line * 20) / 20)}`
    const group = groups.get(key) ?? { axis, line, segments: [] }
    group.segments.push(segment)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/** 合并区间并按坐标排序。 */
function mergeRanges(ranges: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0])
  const merged: [number, number][] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range[0] <= last[1] + AXIS_TOLERANCE_MM) {
      last[1] = Math.max(last[1], range[1])
      continue
    }
    merged.push([range[0], range[1]])
  }
  return merged
}

/**
 * 把一个线段按虚线段长切成「画」出的片段（间隔不产出线段）。
 *
 * 相位自线段起点起算：SVG 的虚线段沿子路径连续推进、由 `stroke-dashoffset` 起相，本模块
 * 对每段各自起算作近似——片段只用于点划线签名与覆盖判定，不用于坐标断言。
 * @param segment - 线段（毫米）。
 * @param patternMm - 虚线段长（毫米，画/空交替）。
 * @returns 画出的片段。
 */
function dashSegments(segment: Segment, patternMm: readonly number[]): Segment[] {
  const dx = segment.x2 - segment.x1
  const dy = segment.y2 - segment.y1
  const total = Math.hypot(dx, dy)
  if (total === 0) return []
  const unit: Point = [dx / total, dy / total]
  const at = (distance: number): Point => [segment.x1 + unit[0] * distance, segment.y1 + unit[1] * distance]
  const pieces: Segment[] = []
  let cursor = 0
  let index = 0
  while (cursor < total) {
    const end = Math.min(cursor + (patternMm[index % patternMm.length] as number), total)
    if (index % 2 === 0 && end > cursor) {
      const from = at(cursor)
      const to = at(end)
      pieces.push({ x1: from[0], y1: from[1], x2: to[0], y2: to[1] })
    }
    cursor = end
    index += 1
  }
  return pieces
}

/**
 * 点划线被实线覆盖：同一行（或列）既有点划签名（≥{@link DASH_DOT_MIN_DOTS} 个「点」与
 * ≥{@link DASH_DOT_MIN_DASHES} 个「长划」，整行跨度 ≥{@link DASH_DOT_MIN_SPAN_MM}），
 * 合并后没有 {@link VISIBLE_GAP_MM} 宽的可见空隙，且其中有一段长于
 * {@link DASH_DOT_MAX_DASH_MM} 的连续墨迹——点划线自己的长划不会那么长，故只可能来自
 * 压在同一位置的实线（上下两半剖的公共边正是如此）。
 *
 * 只按「间隔不可见」判定会把点划线自身间隔很小的图也报成实线覆盖，故必须有那段超长连续
 * 墨迹作依据；`stroke-dasharray` 画出的点划线已按虚线段展开（{@link dashSegments}），
 * 否则整条虚线只是一条长线段，签名与覆盖都看不出来。
 * @param pieces - 全部线段量测片段（虚线元素已展开成虚线段）。
 * @returns 发现的问题。
 */
function coveredCenterlines(pieces: readonly Segment[]): RenderCheckFinding[] {
  const findings: RenderCheckFinding[] = []
  for (const group of intervalsByAxis(pieces)) {
    const lengths = group.segments.map(length)
    const dots = lengths.filter(value => value <= DOT_MAX_LENGTH_MM).length
    const dashes = lengths.filter(value => value >= DASH_MIN_LENGTH_MM).length
    if (dots < DASH_DOT_MIN_DOTS || dashes < DASH_DOT_MIN_DASHES) continue
    const ranges = group.segments.map(segment => (group.axis === 'x'
      ? [Math.min(segment.x1, segment.x2), Math.max(segment.x1, segment.x2)] as const
      : [Math.min(segment.y1, segment.y2), Math.max(segment.y1, segment.y2)] as const))
    const merged = mergeRanges(ranges)
    const span = (merged[merged.length - 1] as [number, number])[1] - (merged[0] as [number, number])[0]
    if (span < DASH_DOT_MIN_SPAN_MM) continue
    const gaps = merged.slice(1).map((range, index) => range[0] - (merged[index] as [number, number])[1])
    // 合并后只剩一段 = 整行没有可见空隙：点与长划被实线连成一条线。
    const largestGap = gaps.length === 0 ? 0 : Math.max(...gaps)
    if (largestGap >= VISIBLE_GAP_MM) continue
    const longestRun = Math.max(...merged.map(range => range[1] - range[0]))
    if (longestRun < DASH_DOT_MAX_DASH_MM) continue
    findings.push({
      check: 'centerline-covered',
      message: `图面 ${group.axis === 'x' ? `y=${String(group.line)}` : `x=${String(group.line)}`} 处的点划线被同位置的实线覆盖`
        + `（该行有一段 ${String(Math.round(longestRun * 10) / 10)} 毫米的连续墨迹、间隔不可见）：`
        + '该行另有压在同一位置的实线边（例如上下两半剖的公共边），请改为一条闭合轮廓并只画中心线',
    })
  }
  return findings
}

/**
 * 相邻零件剖面线取向过近：按「线段中点落在哪个多边形内」把剖面线归到零件，再对
 * 相邻（间隙 ≤ {@link ADJACENT_GAP_MM}）且非镜像对的多边形比较取向差。只有两侧都
 * 真的带剖面线（{@link hatchOrientation} 判定）时才比较。
 * @param outlines - 闭合轮廓。
 * @param segments - 线段（开放子路径：剖面线、引线、中心线；轮廓边不入内）。
 * @returns 发现的问题。
 */
function hatchCollisions(outlines: readonly Poly[], segments: readonly Segment[]): RenderCheckFinding[] {
  const byPoly = new Map<number, Segment[]>()
  segments.forEach((segment) => {
    const midpoint: Point = [(segment.x1 + segment.x2) / 2, (segment.y1 + segment.y2) / 2]
    outlines.forEach((poly, index) => {
      if (!insidePolygon(midpoint, poly)) return
      const bucket = byPoly.get(index)
      if (bucket === undefined) byPoly.set(index, [segment])
      else bucket.push(segment)
    })
  })
  const findings: RenderCheckFinding[] = []
  for (let left = 0; left < outlines.length; left += 1) {
    for (let right = left + 1; right < outlines.length; right += 1) {
      const a = outlines[left] as Poly
      const b = outlines[right] as Poly
      const boxA = bounds(a)
      const boxB = bounds(b)
      const gap = Math.max(
        Math.max(boxA.minX, boxB.minX) - Math.min(boxA.maxX, boxB.maxX),
        Math.max(boxA.minY, boxB.minY) - Math.min(boxA.maxY, boxB.maxY),
      )
      if (gap > ADJACENT_GAP_MM) continue
      if (isMirrorPair(a, b)) continue
      const orientationA = hatchOrientation(byPoly.get(left) ?? [])
      const orientationB = hatchOrientation(byPoly.get(right) ?? [])
      if (orientationA === undefined || orientationB === undefined) continue
      const difference = Math.abs(orientationA - orientationB)
      const visual = Math.min(difference, 180 - difference)
      if (visual > ADJACENT_ORIENTATION_LIMIT_DEG) continue
      findings.push({
        check: 'hatch-orientation-collision',
        message: `相邻零件 #${String(left + 1)}（${String(orientationA)}°）与 #${String(right + 1)}（${String(orientationB)}°）的剖面线取向仅差 ${String(Math.round(visual * 10) / 10)}°：`
          + '相邻零件的剖面线应方向相反或间距不等（GB/T 4457.5），否则读成一个零件',
      })
    }
  }
  return findings
}

/**
 * 图面墨迹的包围盒：全部子路径顶点与文字占位框四角的并集。
 * @param scan - 遍历结果。
 * @returns 墨迹包围盒；没有可量测图元时 undefined。
 */
function inkBounds(scan: Scan): InkBounds | undefined {
  const points: Point[] = [
    ...scan.shapes.flatMap(shape => shape.subpaths.flatMap(subpath => subpath.points)),
    ...scan.texts.flatMap(text => [...text.corners]),
  ]
  return points.length === 0 ? undefined : bounds(points)
}

/**
 * 墨迹越出画布：全部子路径顶点与文字占位框四角中，有落在 [0, 画布] 之外的（容差
 * {@link AXIS_TOLERANCE_MM}）。根元素未声明两个尺寸时不做此判定。
 * @param scan - 遍历结果。
 * @returns 发现的问题；无法判定时 undefined。
 */
function inkOutsideCanvas(scan: Scan): RenderCheckFinding | undefined {
  const { widthMm, heightMm } = scan
  if (widthMm === undefined || heightMm === undefined) return undefined
  const ink = inkBounds(scan)
  if (ink === undefined) return undefined
  if (ink.minX >= -AXIS_TOLERANCE_MM && ink.minY >= -AXIS_TOLERANCE_MM
    && ink.maxX <= widthMm + AXIS_TOLERANCE_MM && ink.maxY <= heightMm + AXIS_TOLERANCE_MM) return undefined
  return {
    check: 'ink-outside-canvas',
    message: `图面内容越出画布 ${String(widthMm)}×${String(heightMm)}：墨迹范围 (${String(ink.minX)}, ${String(ink.minY)})-(${String(ink.maxX)}, ${String(ink.maxY)})；越界部分不会渲染出来`,
  }
}

/**
 * 量测一张 SVG 的墨迹包围盒（毫米，根坐标系）：全部子路径顶点与文字占位框的并集。
 *
 * 供「转换/改写后几何是否走样」的护栏使用（文字转轮廓路径后墨迹必须仍落在原范围内）；
 * 与 {@link checkFigureRendering} 共用同一遍历，故两处口径一致。
 * @param svg - 完整 SVG 文本。
 * @param options - 安全校验上限（字节）；缺省沿用 {@link DEFAULT_SVG_MAX_BYTES}。
 * @returns 墨迹包围盒；没有可量测图元时 undefined。
 * @throws SvgAnnotateError 输入未通过 {@link assertSafeSvg} 时。
 */
export function measureInkBounds(svg: string, options: { maxBytes?: number } = {}): InkBounds | undefined {
  assertSafeSvg(svg, options.maxBytes ?? DEFAULT_SVG_MAX_BYTES)
  return inkBounds(scanSvg(svg))
}

/**
 * 量测一张已生成的附图并报告渲染层面才可见的问题。
 *
 * 元素按嵌套逐层继承变换与样式（见模块文档的量测范围）；凡不在范围内的结构，报告
 * `not-measured` 而不是略过。本模块只读文本、不解析实体也不执行任何内容，输入仍过
 * {@link assertSafeSvg} 的实体/CDATA、体量与根元素检查，被拒时抛出。
 * @param svg - 完整 SVG 文本。
 * @param options - 安全校验上限（字节）；缺省沿用 {@link DEFAULT_SVG_MAX_BYTES}。
 * @returns 量测值与发现的问题。
 * @throws SvgAnnotateError 输入未通过 {@link assertSafeSvg} 时。
 */
export function checkFigureRendering(svg: string, options: { maxBytes?: number } = {}): RenderCheckReport {
  assertSafeSvg(svg, options.maxBytes ?? DEFAULT_SVG_MAX_BYTES)
  const scan = scanSvg(svg)
  const outlines: Poly[] = []
  const openSegments: Segment[] = []
  const drawn: Segment[] = []
  // 点划线判定用的片段：虚线元素按虚线段展开，其余按整段——`stroke-dasharray` 画出的
  // 中心线不展开就只是一条长线段，点划签名与「被实线覆盖」都看不出来。
  const pieces: Segment[] = []
  for (const shape of scan.shapes) {
    for (const subpath of shape.subpaths) {
      const segments = subpathSegments(subpath)
      drawn.push(...segments)
      if (subpath.closed) outlines.push(subpath.points)
      else openSegments.push(...segments)
      for (const segment of segments) {
        if (shape.dashPatternMm === undefined) pieces.push(segment)
        else pieces.push(...dashSegments(segment, shape.dashPatternMm))
      }
    }
  }

  const findings: RenderCheckFinding[] = []
  if (scan.unmeasured.length > 0) {
    findings.push({
      check: 'not-measured',
      message: `以下事实未量测或只作近似：${scan.unmeasured.join('；')}。这些范围内的缺陷不会出现在本报告里，近似项为估计值`,
    })
  }
  for (const text of scan.texts) {
    if (drawn.some(segment => crossesQuad(segment, text.corners))) {
      findings.push({
        check: 'text-crossed-by-line',
        message: `图面文字「${text.content}」被线条贯穿：引线或轮廓线穿过了文字外框；文字应落在零件轮廓或元件符号之外，引线应止于文字外框之外`,
      })
    }
  }
  findings.push(...coveredCenterlines(pieces))
  const ink = inkOutsideCanvas(scan)
  if (ink !== undefined) findings.push(ink)
  findings.push(...hatchCollisions(outlines, openSegments))

  const strokeCounts = new Map<number, number>()
  for (const shape of scan.shapes) {
    if (!shape.stroked) continue
    const width = Math.round(shape.strokeWidthMm * 1000) / 1000
    strokeCounts.set(width, (strokeCounts.get(width) ?? 0) + 1)
  }
  const orientationCounts = new Map<number, number>()
  for (const segment of drawn) {
    const key = Math.round(orientation(segment) * 10) / 10
    orientationCounts.set(key, (orientationCounts.get(key) ?? 0) + 1)
  }

  return {
    ...(scan.widthMm === undefined ? {} : { widthMm: scan.widthMm }),
    ...(scan.heightMm === undefined ? {} : { heightMm: scan.heightMm }),
    textCount: scan.texts.length,
    strokeWidthMm: [...strokeCounts]
      .map(([stroke, count]) => ({ widthMm: stroke, count }))
      .sort((left, right) => left.widthMm - right.widthMm),
    orientationDeg: [...orientationCounts]
      .map(([value, count]) => ({ orientationDeg: value, count }))
      .sort((left, right) => right.count - left.count),
    findings,
  }
}
