/**
 * 文字占位框（纯函数，无 IO）：图面把文字画成 `<text>`，其可见范围按字号估算。
 *
 * 绘图侧（引线止点、元件名落位）与复核侧（文字是否被线条穿过）共用本模型的唯一原因：
 * 两侧对「字占多大」的判断必须一致，否则一侧按较松的框躲避、另一侧按较紧的框判定，
 * 会把正确的图报成缺陷。框以基线锚点定位：上方 {@link GLYPH_ASCENT_RATIO} 倍字号、
 * 下方 {@link GLYPH_DESCENT_RATIO} 倍字号；宽度逐码点累加，全角字符按
 * {@link FULL_WIDTH_RATIO}、其余按 {@link GLYPH_WIDTH_RATIO}。
 * @module @deepseek-ai/dsh-patent-tools/figure/glyph-box
 */

/** 西文小写字母与数字的宽度与字号之比。 */
export const GLYPH_WIDTH_RATIO = 0.6
/** 西文大写字母的宽度与字号之比。 */
export const UPPER_WIDTH_RATIO = 0.75
/** 全角字符（中日韩文字、谚文、全角标点）宽度与字号之比。 */
export const FULL_WIDTH_RATIO = 1
/** 基线以上的高度与字号之比。 */
export const GLYPH_ASCENT_RATIO = 0.75
/** 基线以下的深度与字号之比。 */
export const GLYPH_DESCENT_RATIO = 0.12
/**
 * 占位框的「已在框内」容差（毫米）：引线止点按占位框边界求解，而 SVG 坐标保留三位小数，
 * 止点可能落在边界上或落进 0.0005 毫米；贴着框边不算穿过（字身离框边还有余量），只有
 * 真正进入框内才报。
 */
export const GLYPH_BOX_TOLERANCE_MM = 0.01

/**
 * 全角码点区间（含首尾）：Unicode East Asian Width 取 W 与 F 的常用范围。逐码点
 * 查表而非用正则：ECMAScript 只支持 General_Category 与 Script 属性，没有
 * East_Asian_Width。
 */
const FULL_WIDTH_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // 谚文字母
  [0x2e80, 0x303e], // 中日韩部首扩展、中日韩符号与标点
  [0x3041, 0x33ff], // 平假名、片假名、注音、中日韩兼容
  [0x3400, 0x4dbf], // 中日韩统一表意文字扩展 A
  [0x4e00, 0x9fff], // 中日韩统一表意文字
  [0xa000, 0xa4cf], // 彝文
  [0xac00, 0xd7a3], // 谚文音节
  [0xf900, 0xfaff], // 中日韩兼容表意文字
  [0xfe30, 0xfe6f], // 中日韩兼容形式
  [0xff00, 0xff60], // 全角形式
  [0xffe0, 0xffe6], // 全角符号
  [0x20000, 0x3fffd], // 中日韩统一表意文字扩展 B 及以后
]

/** 文字水平对齐方式（与 SVG `text-anchor` 同义）。 */
export type GlyphTextAnchor = 'start' | 'middle' | 'end'

/** 轴对齐矩形（用户单位）。 */
export type GlyphBox = {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** 西文大写字母的码点区间（含首尾）。 */
const UPPER_RANGE: readonly [number, number] = [0x41, 0x5a]

/**
 * 内容宽度（毫米）：逐码点累加，全角字符占一个字号、西文大写字母按
 * {@link UPPER_WIDTH_RATIO}、其余按 {@link GLYPH_WIDTH_RATIO}。
 *
 * 比例取自本机实测（Inkscape 1.4.4 的 `--query-all` 量测墨迹宽 / 字号 / 字数）：
 * 汉字 0.96、全角标点 0.65、数字 0.62、小写 0.51、大写混排 0.63–0.73、`MWWM` 0.87。
 * 电器件名常用全大写缩写，按小写的比例量测会把框算窄三成，故单列大写。
 * @param content - 文字内容。
 * @param fontSizeMm - 字号（毫米）。
 * @returns 估算的排版宽度（毫米）。
 */
export function textWidthMm(content: string, fontSizeMm: number): number {
  let ratio = 0
  for (const character of content) {
    const code = character.codePointAt(0) ?? 0
    if (FULL_WIDTH_RANGES.some(([from, to]) => code >= from && code <= to)) ratio += FULL_WIDTH_RATIO
    else if (code >= UPPER_RANGE[0] && code <= UPPER_RANGE[1]) ratio += UPPER_WIDTH_RATIO
    else ratio += GLYPH_WIDTH_RATIO
  }
  return ratio * fontSizeMm
}

/**
 * 文字占位框。
 * @param content - 文字内容（决定宽度）。
 * @param baseline - 基线锚点（SVG `<text>` 的 x/y）。
 * @param fontSizeMm - 字号（毫米）。
 * @param anchor - 水平对齐方式。
 * @returns 占位框。
 */
export function glyphBox(
  content: string,
  baseline: readonly [number, number],
  fontSizeMm: number,
  anchor: GlyphTextAnchor,
): GlyphBox {
  const width = textWidthMm(content, fontSizeMm)
  const left = anchor === 'middle' ? baseline[0] - width / 2 : anchor === 'end' ? baseline[0] - width : baseline[0]
  return {
    minX: left,
    maxX: left + width,
    minY: baseline[1] - fontSizeMm * GLYPH_ASCENT_RATIO,
    maxY: baseline[1] + fontSizeMm * GLYPH_DESCENT_RATIO,
  }
}

/** 点是否落在占位框内部（离每条边至少 {@link GLYPH_BOX_TOLERANCE_MM}）。 */
function boxContains(box: GlyphBox, point: readonly [number, number]): boolean {
  return point[0] > box.minX + GLYPH_BOX_TOLERANCE_MM && point[0] < box.maxX - GLYPH_BOX_TOLERANCE_MM
    && point[1] > box.minY + GLYPH_BOX_TOLERANCE_MM && point[1] < box.maxY - GLYPH_BOX_TOLERANCE_MM
}

/** 两线段是否真正相交（不含共线重叠；共线情形由端点包含判定覆盖）。 */
function segmentsCross(
  from1: readonly [number, number],
  to1: readonly [number, number],
  from2: readonly [number, number],
  to2: readonly [number, number],
): boolean {
  const side = (from: readonly [number, number], to: readonly [number, number], point: readonly [number, number]): number =>
    (to[0] - from[0]) * (point[1] - from[1]) - (to[1] - from[1]) * (point[0] - from[0])
  const d1 = side(from1, to1, from2)
  const d2 = side(from1, to1, to2)
  const d3 = side(from2, to2, from1)
  const d4 = side(from2, to2, to1)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/**
 * 线段是否穿过占位框：端点真正落在框内，或线段与框的边真正相交（贴边、共线不算）。
 *
 * 绘图侧据此避让文字、复核侧据此判定「文字被线条贯穿」（复核侧按四角判定，
 * 变换后的框同样成立），两侧判定必须一致。
 * @param box - 占位框。
 * @param from - 线段起点。
 * @param to - 线段终点。
 * @returns 穿过时 true。
 */
export function boxCrossedBySegment(
  box: GlyphBox,
  from: readonly [number, number],
  to: readonly [number, number],
): boolean {
  if (boxContains(box, from) || boxContains(box, to)) return true
  const corners: readonly (readonly [number, number])[] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
  ]
  for (let index = 0; index < 4; index += 1) {
    const edgeFrom = corners[index] as readonly [number, number]
    const edgeTo = corners[(index + 1) % 4] as readonly [number, number]
    if (segmentsCross(from, to, edgeFrom, edgeTo)) return true
  }
  return false
}

/**
 * 引线在文字占位框上的止点：自 `from` 指向文字基线锚点，止于占位框边界 —— 引线
 * 因此不进入占位框，文字不会被线条贯穿。
 * @param content - 文字内容（决定宽度）。
 * @param baseline - 基线锚点（SVG `<text>` 的 x/y）。
 * @param fontSizeMm - 字号（毫米）。
 * @param anchor - 水平对齐方式。
 * @param from - 引线起点（零件上的指称点）。
 * @returns 引线止点；起点与文字中心重合、或起点已落在占位框内时为 undefined。
 */
export function leaderEnd(
  content: string,
  baseline: readonly [number, number],
  fontSizeMm: number,
  anchor: GlyphTextAnchor,
  from: readonly [number, number],
): readonly [number, number] | undefined {
  const box = glyphBox(content, baseline, fontSizeMm, anchor)
  const center: readonly [number, number] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]
  const dx = center[0] - from[0]
  const dy = center[1] - from[1]
  const distance = Math.hypot(dx, dy)
  if (distance === 0) return undefined
  const unit: readonly [number, number] = [dx / distance, dy / distance]
  // 沿 -unit 自中心后退，各自先出框的那一步决定后退量。
  const stepX = unit[0] === 0 ? Number.POSITIVE_INFINITY : (unit[0] > 0 ? center[0] - box.minX : box.maxX - center[0]) / Math.abs(unit[0])
  const stepY = unit[1] === 0 ? Number.POSITIVE_INFINITY : (unit[1] > 0 ? center[1] - box.minY : box.maxY - center[1]) / Math.abs(unit[1])
  const back = Math.min(stepX, stepY)
  if (!(back < distance)) return undefined
  return [center[0] - back * unit[0], center[1] - back * unit[1]]
}
