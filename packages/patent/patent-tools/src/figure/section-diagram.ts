/**
 * 剖视图与剖面线（纯函数，无 IO）：把被剖切零件的闭合轮廓与剖面线参数生成为
 * 毫米画布上的黑色描边片段与图面词语。
 *
 * 依据（现行条文与标准）：
 * - 《专利审查指南》第一部分第一章 4.3：「剖面图中的剖面线不得妨碍附图标记线
 *   和主线条的清楚识别。」——剖面线一律用细实线，轮廓与剖切位置线用粗实线，
 *   线宽相差一倍；文字元素在全部线条之后绘制。
 * - GB/T 4457.5《机械制图 剖面区域的表示法》：剖面线为与水平线成 45° 的细实线，
 *   同一零件间距相等、方向一致；相邻零件的剖面线方向相反或间距不等，以免把
 *   相邻零件读成一个整体。
 *
 * 剖面线裁剪按 even-odd 求交：取平行线族的法向距离 c，对多边形的每条边按「两端
 * 点是否落在 c 的同一侧」（严格小于判定的异或）判交；交点沿线向排序后两两配对，
 * 只绘制落在多边形内部的线段。恰落在采样线上的顶点按「线上方」计，与相邻边不
 * 重复计数。
 * @module @deepseek-ai/dsh-patent-tools/figure/section-diagram
 */

import { escapeXmlAttribute, fmt, VectorFigureError, type VectorFigureSpec } from './vector-figure.ts'

/** 剖面线参数：45° 细实线；相邻零件方向相反或间距不等以区分（GB/T 4457.5 实践）。 */
export type HatchSpec = {
  /** 与水平线夹角（度），默认 45。 */
  angleDeg?: number
  /** 剖面线间距（毫米），默认 3。 */
  spacingMm?: number
  /** 方向：'forward'（左上→右下）或 'backward'（左下→右上），默认 forward。 */
  direction?: 'forward' | 'backward'
}

/** 被剖切的零件：闭合轮廓 + 剖面线。 */
export type SectionPart = {
  /** 零件名（写入图面，简短）。 */
  label?: string
  /** 闭合多边形顶点（毫米，至少 3 个，自动闭合）。 */
  outline: readonly (readonly [number, number])[]
  hatch?: HatchSpec
}

/** 剖切位置符号（剖切位置线 + 投射方向箭头 + 字母）。 */
export type CuttingMark = {
  /** 剖切标记字母（如 'A'）。 */
  id: string
  /** 剖切位置线起点/终点（毫米）。 */
  from: readonly [number, number]
  to: readonly [number, number]
  /** 箭头（投射方向）指向：屏幕坐标的绝对方向（x 向右、y 向下，'up' 即 -y）。 */
  arrow: 'left' | 'right' | 'up' | 'down'
}

/** 剖视图输入。 */
export type SectionDiagramInput = {
  /** 外轮廓（毫米，自动闭合）；缺省或空数组表示只画零件。 */
  outline?: readonly (readonly [number, number])[]
  /** 被剖切零件（至少一个）。 */
  parts: readonly SectionPart[]
  /** 剖切位置符号（0 个或多个）。 */
  cuttingMarks?: readonly CuttingMark[]
  /** 画布留白（毫米），默认 4。 */
  paddingMm?: number
}

/** 二维点（毫米）。 */
type Point = readonly [number, number]

/** 线段（毫米）。 */
type Segment = { readonly from: Point; readonly to: Point }

/** 文本锚点水平对齐方式。 */
type TextAnchor = 'start' | 'middle' | 'end'

/** 已解析的剖面线参数（缺省值已填入）。 */
type ResolvedHatch = {
  readonly angleDeg: number
  readonly spacingMm: number
  readonly direction: 'forward' | 'backward'
}

/** 平行线族的单位法向与单位线向。 */
type HatchAxes = { readonly normal: Point; readonly along: Point }

/** 剖切位置符号的几何（原始坐标）。 */
type CuttingMarkGeometry = {
  /** 剖切位置线（两端各外延 {@link MARK_EXTEND_MM} 后落箭头）。 */
  readonly positionLine: Segment
  /** 两端箭头折线（尖端指向投射方向）。 */
  readonly arrowHeads: readonly (readonly Point[])[]
  /** 两端字母锚点。 */
  readonly labelAnchors: readonly Point[]
  /** 字母水平对齐。 */
  readonly labelAnchor: TextAnchor
}

/** 待绘制文字（基线锚点与对齐方式）。 */
type DiagramText = { readonly text: string; readonly at: Point; readonly anchor: TextAnchor }

/** 包围盒（原始坐标，毫米）。 */
type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/** 轮廓与剖切位置线的粗实线线宽（毫米，GB/T 4457.4 线宽系列）。 */
const THICK_STROKE_MM = 0.5
/** 剖面线的细实线线宽（毫米）。 */
const THIN_STROKE_MM = 0.25
/** 默认剖面线角度（度）。 */
const DEFAULT_HATCH_ANGLE_DEG = 45
/** 默认剖面线间距（毫米）。 */
const DEFAULT_HATCH_SPACING_MM = 3
/** 默认画布留白（毫米）。 */
const DEFAULT_PADDING_MM = 4
/** 剖切位置线两端外延长度（毫米）：箭头落在外延段上，不压零件轮廓。 */
const MARK_EXTEND_MM = 3
/** 箭头长度（毫米）。 */
const ARROW_LENGTH_MM = 2.5
/** 箭头半宽（毫米）。 */
const ARROW_HALF_WIDTH_MM = 1
/** 字母到箭头尖端的间隙（毫米）。 */
const MARK_LABEL_GAP_MM = 1.5
/** 图面字号（毫米）。 */
const LABEL_FONT_SIZE_MM = 3.5
/** 文本基线相对锚点的下沉量（毫米，约 0.35 字号，使文字视觉垂直居中）。 */
const TEXT_BASELINE_DROP_MM = 1.2
/** 退化线段阈值（毫米）：两交点距离不超过它时不画。 */
const MIN_SEGMENT_MM = 1e-9

/** 允许的剖面线方向。 */
const HATCH_DIRECTIONS: readonly ('forward' | 'backward')[] = ['forward', 'backward']

/** 投射方向箭头的单位向量（屏幕坐标）。 */
const ARROW_VECTORS: Record<CuttingMark['arrow'], Point> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

/** 投射方向对应的字母水平对齐（左右向让位给箭头，上下向居中）。 */
const ARROW_LABEL_ANCHORS: Record<CuttingMark['arrow'], TextAnchor> = {
  left: 'end',
  right: 'start',
  up: 'middle',
  down: 'middle',
}

/**
 * 校验坐标有限。
 * @param point - 待校验点。
 * @param subject - 报错用主体名（如「零件 #1 轮廓」）。
 * @throws VectorFigureError('invalid_input') 任一坐标非有限数时。
 */
function assertFinitePoint(point: Point, subject: string): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new VectorFigureError('invalid_input', `${subject}坐标必须是有限数：(${String(point[0])}, ${String(point[1])})`)
  }
}

/**
 * 校验闭合多边形顶点：不少于 3 个且坐标有限。
 * @param points - 多边形顶点（隐式闭合）。
 * @param subject - 报错用主体名。
 * @throws VectorFigureError('invalid_input') 顶点不足或坐标非有限数时。
 */
function assertPolygon(points: readonly Point[], subject: string): void {
  if (points.length < 3) {
    throw new VectorFigureError('invalid_input', `${subject}至少需要 3 个顶点，实际 ${points.length} 个`)
  }
  for (const point of points) assertFinitePoint(point, subject)
}

/**
 * 校验剖切位置符号：字母非空、两端点坐标有限且不重合。
 * @param mark - 待校验符号。
 * @throws VectorFigureError('invalid_input') 校验不通过时。
 */
function assertCuttingMark(mark: CuttingMark): void {
  if (mark.id.trim() === '') {
    throw new VectorFigureError('invalid_input', '剖切标记字母不能为空')
  }
  assertFinitePoint(mark.from, '剖切位置线起点')
  assertFinitePoint(mark.to, '剖切位置线终点')
  if (mark.from[0] === mark.to[0] && mark.from[1] === mark.to[1]) {
    throw new VectorFigureError('invalid_input', `剖切位置线两端点不能重合：(${String(mark.from[0])}, ${String(mark.from[1])})`)
  }
}

/**
 * 解析剖面线参数并校验取值域（缺省 45°、3 毫米、forward）。
 * @param hatch - 传入的剖面线参数。
 * @param subject - 报错用主体名前缀。
 * @returns 缺省值已填入的参数。
 * @throws VectorFigureError('invalid_input') 角度、间距或方向非法时。
 */
function resolveHatch(hatch: HatchSpec | undefined, subject: string): ResolvedHatch {
  const angleDeg = hatch?.angleDeg ?? DEFAULT_HATCH_ANGLE_DEG
  const spacingMm = hatch?.spacingMm ?? DEFAULT_HATCH_SPACING_MM
  const direction = hatch?.direction ?? 'forward'
  if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg > 90) {
    throw new VectorFigureError('invalid_input', `${subject}剖面线角度必须在 (0, 90] 度内：${String(angleDeg)}`)
  }
  if (!Number.isFinite(spacingMm) || spacingMm <= 0) {
    throw new VectorFigureError('invalid_input', `${subject}剖面线间距必须为正有限数：${String(spacingMm)}`)
  }
  if (!HATCH_DIRECTIONS.includes(direction)) {
    throw new VectorFigureError('invalid_input', `${subject}剖面线方向只能是 forward 或 backward：${direction}`)
  }
  return { angleDeg, spacingMm, direction }
}

/**
 * 点在给定方向向量上的投影（法向投影即平行线族的参数 c）。
 * @param point - 待投影点。
 * @param axis - 方向向量。
 * @returns 投影长度（毫米）。
 */
function project(point: Point, axis: Point): number {
  return point[0] * axis[0] + point[1] * axis[1]
}

/**
 * 平行线族的单位法向与单位线向。
 * @param hatch - 已解析的剖面线参数。
 * @returns forward 为左上→右下、backward 为左下→右上的一组正交单位向量。
 */
function hatchAxes(hatch: ResolvedHatch): HatchAxes {
  const radians = (hatch.angleDeg * Math.PI) / 180
  const sign = hatch.direction === 'forward' ? 1 : -1
  const along: Point = [Math.cos(radians), sign * Math.sin(radians)]
  const normal: Point = [-sign * Math.sin(radians), Math.cos(radians)]
  return { normal, along }
}

/**
 * 由族参数 c 与线向投影 u 还原线上的点。
 * @param c - 法向距离。
 * @param u - 线向投影。
 * @param axes - 平行线族的两组单位向量。
 * @returns 线段端点坐标。
 */
function linePoint(c: number, u: number, axes: HatchAxes): Point {
  return [c * axes.normal[0] + u * axes.along[0], c * axes.normal[1] + u * axes.along[1]]
}

/**
 * 计算多边形的剖面线线段（even-odd 求交后配对，只保留多边形内部的线段）。
 * @param points - 闭合多边形顶点（隐式闭合）。
 * @param hatch - 已解析的剖面线参数。
 * @returns 剖面线线段，按族参数 c 递增排列。
 */
function hatchSegments(points: readonly Point[], hatch: ResolvedHatch): Segment[] {
  const axes = hatchAxes(hatch)
  let cMin = Infinity
  let cMax = -Infinity
  for (const point of points) {
    const c = project(point, axes.normal)
    if (c < cMin) cMin = c
    if (c > cMax) cMax = c
  }

  const segments: Segment[] = []
  for (let index = Math.ceil(cMin / hatch.spacingMm); index * hatch.spacingMm <= cMax; index += 1) {
    const c = index * hatch.spacingMm
    const crossings: number[] = []
    for (let i = 0; i < points.length; i += 1) {
      const from = points[i] as Point
      const to = points[(i + 1) % points.length] as Point
      const cFrom = project(from, axes.normal)
      const cTo = project(to, axes.normal)
      // 半开区间判交：恰落在线上的顶点记作「线上方」，与相邻边不重复计数。
      if ((cFrom < c) === (cTo < c)) continue
      const t = (c - cFrom) / (cTo - cFrom)
      const hit: Point = [from[0] + t * (to[0] - from[0]), from[1] + t * (to[1] - from[1])]
      crossings.push(project(hit, axes.along))
    }
    crossings.sort((a, b) => a - b)
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const uFrom = crossings[i] as number
      const uTo = crossings[i + 1] as number
      // 线与多边形相切于顶点时两端点重合：零长线段不属于多边形内部。
      if (uTo - uFrom <= MIN_SEGMENT_MM) continue
      segments.push({ from: linePoint(c, uFrom, axes), to: linePoint(c, uTo, axes) })
    }
  }
  return segments
}

/**
 * 多边形面积重心（零件名的落点）。
 * @param points - 闭合多边形顶点。
 * @returns 重心；顶点共线（零面积）时退化为顶点平均位置。
 */
function polygonCentroid(points: readonly Point[]): Point {
  let twiceArea = 0
  let xSum = 0
  let ySum = 0
  for (let i = 0; i < points.length; i += 1) {
    const from = points[i] as Point
    const to = points[(i + 1) % points.length] as Point
    const cross = from[0] * to[1] - to[0] * from[1]
    twiceArea += cross
    xSum += (from[0] + to[0]) * cross
    ySum += (from[1] + to[1]) * cross
  }
  if (twiceArea === 0) return averagePoint(points)
  return [xSum / (3 * twiceArea), ySum / (3 * twiceArea)]
}

/**
 * 顶点平均位置（零面积多边形的重心退化值）。
 * @param points - 多边形顶点。
 * @returns 顶点坐标的平均值。
 */
function averagePoint(points: readonly Point[]): Point {
  let xSum = 0
  let ySum = 0
  for (const point of points) {
    xSum += point[0]
    ySum += point[1]
  }
  return [xSum / points.length, ySum / points.length]
}

/**
 * 文字的估算占位框（以锚点为中心、边长 2 倍字号的正方形），用于画布包围盒。
 * @param anchor - 文字基线锚点。
 * @returns 方框的两个对角顶点。
 */
function textBox(anchor: Point): Point[] {
  return [
    [anchor[0] - LABEL_FONT_SIZE_MM, anchor[1] - LABEL_FONT_SIZE_MM],
    [anchor[0] + LABEL_FONT_SIZE_MM, anchor[1] + LABEL_FONT_SIZE_MM],
  ]
}

/**
 * 剖切位置符号的几何：位置线两端外延后落箭头，字母写在箭头尖端外侧。
 * @param mark - 已校验的剖切位置符号。
 * @returns 位置线、两支箭头折线、两端字母锚点与字母对齐方式。
 */
function cuttingMarkGeometry(mark: CuttingMark): CuttingMarkGeometry {
  const dx = mark.to[0] - mark.from[0]
  const dy = mark.to[1] - mark.from[1]
  const length = Math.hypot(dx, dy)
  const axis: Point = [dx / length, dy / length]
  const ends: Point[] = [
    [mark.from[0] - axis[0] * MARK_EXTEND_MM, mark.from[1] - axis[1] * MARK_EXTEND_MM],
    [mark.to[0] + axis[0] * MARK_EXTEND_MM, mark.to[1] + axis[1] * MARK_EXTEND_MM],
  ]
  const arrow = ARROW_VECTORS[mark.arrow]
  const side: Point = [-arrow[1], arrow[0]]
  const arrowHeads: Point[][] = []
  const labelAnchors: Point[] = []
  for (const end of ends) {
    const tip: Point = [end[0] + arrow[0] * ARROW_LENGTH_MM, end[1] + arrow[1] * ARROW_LENGTH_MM]
    arrowHeads.push([
      [end[0] + side[0] * ARROW_HALF_WIDTH_MM, end[1] + side[1] * ARROW_HALF_WIDTH_MM],
      tip,
      [end[0] - side[0] * ARROW_HALF_WIDTH_MM, end[1] - side[1] * ARROW_HALF_WIDTH_MM],
    ])
    labelAnchors.push([tip[0] + arrow[0] * MARK_LABEL_GAP_MM, tip[1] + arrow[1] * MARK_LABEL_GAP_MM])
  }
  return {
    positionLine: { from: ends[0] as Point, to: ends[1] as Point },
    arrowHeads,
    labelAnchors,
    labelAnchor: ARROW_LABEL_ANCHORS[mark.arrow],
  }
}

/**
 * 一组点的包围盒。
 * @param points - 参与包围盒的点（调用方保证非空）。
 * @returns 最小/最大坐标。
 */
function boundsOf(points: readonly Point[]): Bounds {
  // 调用方保证非空：parts 非空且每个零件轮廓至少 3 个顶点。
  const first = points[0] as Point
  const bounds: Bounds = { minX: first[0], minY: first[1], maxX: first[0], maxY: first[1] }
  for (const point of points) {
    if (point[0] < bounds.minX) bounds.minX = point[0]
    if (point[0] > bounds.maxX) bounds.maxX = point[0]
    if (point[1] < bounds.minY) bounds.minY = point[1]
    if (point[1] > bounds.maxY) bounds.maxY = point[1]
  }
  return bounds
}

/**
 * SVG 坐标点文本（平移后）。
 * @param point - 原始坐标点。
 * @param offset - 画布平移量。
 * @returns `x,y` 文本。
 */
function coordPair(point: Point, offset: Point): string {
  return `${fmt(point[0] + offset[0])},${fmt(point[1] + offset[1])}`
}

/**
 * 多边形元素（粗实线）。
 * @param points - 多边形顶点。
 * @param offset - 画布平移量。
 * @returns `<polygon>` 元素文本。
 */
function polygonElement(points: readonly Point[], offset: Point): string {
  const list = points.map(point => coordPair(point, offset)).join(' ')
  return `<polygon points="${list}" stroke-width="${fmt(THICK_STROKE_MM)}"/>`
}

/**
 * 折线元素（粗实线，箭头用）。
 * @param points - 折线顶点。
 * @param offset - 画布平移量。
 * @returns `<polyline>` 元素文本。
 */
function polylineElement(points: readonly Point[], offset: Point): string {
  const list = points.map(point => coordPair(point, offset)).join(' ')
  return `<polyline points="${list}" stroke-width="${fmt(THICK_STROKE_MM)}"/>`
}

/**
 * 线段元素。
 * @param segment - 线段。
 * @param offset - 画布平移量。
 * @param strokeMm - 线宽（毫米）。
 * @returns `<line>` 元素文本。
 */
function segmentElement(segment: Segment, offset: Point, strokeMm: number): string {
  const x1 = fmt(segment.from[0] + offset[0])
  const y1 = fmt(segment.from[1] + offset[1])
  const x2 = fmt(segment.to[0] + offset[0])
  const y2 = fmt(segment.to[1] + offset[1])
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${fmt(strokeMm)}"/>`
}

/**
 * 文本元素（自带 fill/stroke，避免继承外壳的 `fill="none"`）。
 * @param item - 文字、锚点与对齐方式。
 * @param offset - 画布平移量。
 * @returns `<text>` 元素文本。
 */
function textElement(item: DiagramText, offset: Point): string {
  const x = fmt(item.at[0] + offset[0])
  const y = fmt(item.at[1] + offset[1] + TEXT_BASELINE_DROP_MM)
  const size = fmt(LABEL_FONT_SIZE_MM)
  return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${item.anchor}" fill="#000000" stroke="none">${escapeXmlAttribute(item.text)}</text>`
}

/**
 * 构建剖面图：外轮廓与零件轮廓用粗实线、剖面线用细实线裁剪到零件内部、剖切位置
 * 符号用粗实线箭头加字母。
 *
 * 画布为轮廓、零件、剖切符号与留白的包围盒；输出坐标已整体平移，恒为非负。
 * @param input - 剖视图输入（外轮廓、被剖切零件、剖切位置符号、画布留白）。
 * @returns 毫米画布规格与黑色描边片段。
 * @throws VectorFigureError('empty_input') `parts` 为空时。
 * @throws VectorFigureError('invalid_input') 顶点不足、坐标非有限数、剖面线参数、
 * 剖切位置符号或画布留白非法时。
 */
export function buildSectionDiagram(input: SectionDiagramInput): VectorFigureSpec {
  const paddingMm = input.paddingMm ?? DEFAULT_PADDING_MM
  if (!Number.isFinite(paddingMm) || paddingMm < 0) {
    throw new VectorFigureError('invalid_input', `画布留白必须是非负有限数：${String(paddingMm)}`)
  }
  if (input.parts.length === 0) {
    throw new VectorFigureError('empty_input', '剖视图至少需要一个被剖切零件')
  }

  const polygons: (readonly Point[])[] = []
  const hatches: Segment[] = []
  const positionLines: Segment[] = []
  const arrowHeads: (readonly Point[])[] = []
  const texts: DiagramText[] = []
  const labels: string[] = []
  const extents: Point[] = []

  const outline = input.outline !== undefined && input.outline.length > 0 ? input.outline : undefined
  if (outline !== undefined) {
    assertPolygon(outline, '外轮廓')
    polygons.push(outline)
    extents.push(...outline)
  }

  input.parts.forEach((part, index) => {
    const subject = `零件 #${index + 1} `
    assertPolygon(part.outline, `${subject}轮廓`)
    const hatch = resolveHatch(part.hatch, subject)
    polygons.push(part.outline)
    extents.push(...part.outline)
    hatches.push(...hatchSegments(part.outline, hatch))
    const labelText = part.label === undefined ? '' : part.label.trim()
    if (labelText !== '') {
      const at = polygonCentroid(part.outline)
      texts.push({ text: labelText, at, anchor: 'middle' })
      extents.push(...textBox(at))
      labels.push(labelText)
    }
  })

  for (const mark of input.cuttingMarks ?? []) {
    assertCuttingMark(mark)
    const geometry = cuttingMarkGeometry(mark)
    positionLines.push(geometry.positionLine)
    arrowHeads.push(...geometry.arrowHeads)
    extents.push(geometry.positionLine.from, geometry.positionLine.to, ...geometry.arrowHeads.flat())
    for (const at of geometry.labelAnchors) {
      texts.push({ text: mark.id.trim(), at, anchor: geometry.labelAnchor })
      extents.push(...textBox(at))
    }
    labels.push(mark.id.trim())
  }

  const bounds = boundsOf(extents)
  const offset: Point = [paddingMm - bounds.minX, paddingMm - bounds.minY]
  // 文字在全部线条之后绘制：剖面线不得妨碍附图标记线和主线条的识别。
  const body = [
    ...polygons.map(points => polygonElement(points, offset)),
    ...hatches.map(segment => segmentElement(segment, offset, THIN_STROKE_MM)),
    ...positionLines.map(segment => segmentElement(segment, offset, THICK_STROKE_MM)),
    ...arrowHeads.map(points => polylineElement(points, offset)),
    ...texts.map(item => textElement(item, offset)),
  ].join('\n')

  return {
    widthMm: bounds.maxX - bounds.minX + paddingMm * 2,
    heightMm: bounds.maxY - bounds.minY + paddingMm * 2,
    body,
    labels,
  }
}
