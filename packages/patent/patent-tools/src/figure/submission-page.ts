/**
 * 附图落版：把一张图形（Graphviz 输出或矢量图型输出）按目标法域规格放到
 * 固定幅面的附图页上，并给出可核算的物理尺寸（纯函数，无 IO）。
 *
 * 为什么需要单独一步：Graphviz 的 `page`/`size`/`margin` 属性只影响图形自身
 * 的画布（本机实测 Graphviz 15.1.1：`page` 对 svg/png/pdf 不产生幅面，`size`
 * 只在超出时按比例缩小，`margin` 只加空白），因此渲染结果不是 A4 幅面，也
 * 无法据此核算字高与线宽。《专利审查指南》第五部分第一章 4.2/4.3 要求附图
 * 用 A4 并给出四边页边距，PCT Rule 11.6(c) 与 37 CFR 1.84(g) 给出各自的最小
 * 页边距与可用绘图区——这些都要在落版阶段落实。
 *
 * 图号（中国「图1」、PCT「Fig. 1」、USPTO「FIG. 1」）由本模块画在图形正下方，
 * 依据《专利审查指南》第一部分第一章 4.3「该编号应当标注在相应附图的正下方」、
 * PCT 申请人指南 IP 5.141 与 37 CFR 1.84(u)。
 * @module @deepseek-ai/dsh-patent-tools/figure/submission-page
 */

import { assertSafeSvg, DEFAULT_SVG_MAX_BYTES, SvgAnnotateError } from './svg-annotate.ts'
import { escapeXmlAttribute } from './vector-figure.ts'
import type { OfficeProfile, TargetOffice } from './office-profile.ts'

/** 像素/英寸（未声明单位的 SVG 长度按 CSS 像素处理）。 */
const PX_PER_INCH = 96

/** 毫米/英寸。 */
const MM_PER_INCH = 25.4

/** 点/英寸（pt 长度单位）。 */
const PT_PER_INCH = 72

/** 落版放大的上限，避免极小的图形被放大到失真的尺寸。 */
const MAX_PAGE_SCALE = 4

/** 数字与字母高度相对字号的折算比（大写字母高度约为字号的 0.7）。 */
const CHAR_HEIGHT_RATIO = 0.7

/** 落版页输入的图形尺寸（毫米）与用户单位映射。 */
type SvgGeometry = {
  /** 图形声明宽（毫米）。 */
  widthMm: number
  /** 图形声明高（毫米）。 */
  heightMm: number
  /** viewBox 原点 X（用户单位）。 */
  viewBoxX: number
  /** viewBox 原点 Y（用户单位）。 */
  viewBoxY: number
  /** 用户单位 → 毫米的换算比（纵向，与横向一致时同一值）。 */
  userUnitToMmY: number
  /** 用户单位 → 毫米的换算比（横向）。 */
  userUnitToMmX: number
  /** 根元素内部内容（不含 `<svg>` 根与文档声明）。 */
  inner: string
}

/** 落版页输入。 */
export type SubmissionPageInput = {
  /** 图形 SVG 文本（Graphviz 输出或 vectorFigureSvg 输出）。 */
  drawingSvg: string
  /** 目标法域规格。 */
  profile: OfficeProfile
  /** 图号文字（如「图1」）；undefined 表示本幅不标图号（单幅图）。 */
  caption?: string | undefined
  /** 附图页页码文字（如「2」「2/3」）；undefined 表示不标页码。 */
  sheetNumber?: string | undefined
  /** 图形正文的数字与字母字号（用户单位，如 DOT 的 fontsize=10），用于核算字高。 */
  bodyFontSize?: number | undefined
  /** 图号与图形之间的间距（毫米），默认 3。 */
  captionGapMm?: number
  /** 图号字高（毫米），默认 4。 */
  captionFontMm?: number
  /** 页码字高（毫米），默认 3。 */
  sheetFontMm?: number
}

/** 落版后的物理尺寸（可依此核算法域的最小字高等要求）。 */
export type SubmissionPageMetrics = {
  /** 图形落版缩放比（1 表示原尺寸）。 */
  pageScale: number
  /** 图形落版前的声明尺寸（毫米）。 */
  drawingWidthMm: number
  /** 图形落版前的声明尺寸（毫米）。 */
  drawingHeightMm: number
  /** 落版后图形占用的宽（毫米）。 */
  placedWidthMm: number
  /** 落版后图形占用的高（毫米）。 */
  placedHeightMm: number
  /** 落版后正文数字/字母的字高（毫米）；未提供 bodyFontSize 时缺省。 */
  charHeightMm?: number
  /** 图形再缩小到法域规定比例时的字高（毫米）；未提供 bodyFontSize 时缺省。 */
  reducedCharHeightMm?: number
}

/**
 * 落版摘要：工具输出 `layout` 字段的形状（各附图生成工具共用）。
 */
export type SubmissionLayout = {
  /** 目标法域。 */
  office: TargetOffice
  /** 图形落版缩放比。 */
  pageScale: number
  /** 落版后图形占用的宽（毫米）。 */
  placedWidthMm: number
  /** 落版后图形占用的高（毫米）。 */
  placedHeightMm: number
  /** 落版后图中数字与字母的字高（毫米）；未提供源字号时缺省。 */
  charHeightMm?: number
  /** 再缩小到法域规定比例（三分之二）后的字高（毫米）；未提供源字号时缺省。 */
  reducedCharHeightMm?: number
  /** 落版页上的图号；未标注时缺省。 */
  caption?: string
  /** 落版页上的页码。 */
  sheetNumber: string
}

/** 落版结果。 */
export type SubmissionPageResult = {
  /** 落版后的附图页 SVG。 */
  svg: string
  /** 落版尺寸。 */
  metrics: SubmissionPageMetrics
  /** 落版提示（尺寸声明缺失、放大被截断等）。 */
  warnings: string[]
}

/**
 * 解析 SVG 长度值为毫米（支持 mm/cm/in/pt/px 与无单位，无单位按 CSS 像素）。
 * @param raw - 长度属性原文。
 * @returns 毫米值；无法解析时 undefined。
 */
export function parseLengthMm(raw: string): number | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%]*)\s*$/i.exec(raw)
  if (match === null) return undefined
  const value = Number(match[1])
  switch ((match[2] ?? '').toLowerCase()) {
    case '':
    case 'px':
      return (value / PX_PER_INCH) * MM_PER_INCH
    case 'mm':
      return value
    case 'cm':
      return value * 10
    case 'in':
      return value * MM_PER_INCH
    case 'pt':
      return (value / PT_PER_INCH) * MM_PER_INCH
    default:
      return undefined
  }
}

/**
 * 读取根元素的指定属性值。
 * @param openTag - 根元素的起始标签文本。
 * @param name - 属性名。
 * @returns 属性值；缺省时 undefined。
 */
function attribute(openTag: string, name: string): string | undefined {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')
  return pattern.exec(openTag)?.[1]
}

/**
 * 解析图形 SVG 的物理尺寸、viewBox 与内部内容。
 * @param svgText - 图形 SVG 文本。
 * @returns 尺寸与内部内容。
 * @throws SvgAnnotateError 非 SVG、含不安全结构或尺寸不可解析时。
 */
export function parseDrawingSvg(svgText: string): { geometry: SvgGeometry; warnings: string[] } {
  assertSafeSvg(svgText, DEFAULT_SVG_MAX_BYTES)
  const openTag = /<svg\b[^>]*>/i.exec(svgText)?.[0]
  const closeIndex = svgText.toLowerCase().lastIndexOf('</svg>')
  if (openTag === undefined || closeIndex < 0) {
    throw new SvgAnnotateError('invalid_svg', '非 SVG 文档：缺少 <svg> 根元素')
  }
  const warnings: string[] = []
  const viewBox = /viewBox\s*=\s*"([^"]*)"/i.exec(openTag)?.[1]
  const viewBoxParts = viewBox === undefined ? [] : viewBox.trim().split(/[\s,]+/).map(Number)
  const hasViewBox = viewBoxParts.length === 4 && viewBoxParts.every(Number.isFinite)
  const rawWidth = attribute(openTag, 'width')
  const rawHeight = attribute(openTag, 'height')
  const declaredWidth = rawWidth === undefined ? undefined : parseLengthMm(rawWidth)
  const declaredHeight = rawHeight === undefined ? undefined : parseLengthMm(rawHeight)

  let widthMm = declaredWidth
  let heightMm = declaredHeight
  if (widthMm === undefined && hasViewBox) {
    widthMm = ((viewBoxParts[2] as number) / PX_PER_INCH) * MM_PER_INCH
  }
  if (heightMm === undefined && hasViewBox) {
    heightMm = ((viewBoxParts[3] as number) / PX_PER_INCH) * MM_PER_INCH
  }
  if (widthMm === undefined || heightMm === undefined) {
    throw new SvgAnnotateError('invalid_svg', 'SVG 缺少可解析的 width/height 或 viewBox')
  }
  if (declaredWidth === undefined || declaredHeight === undefined) {
    warnings.push('图形未同时声明 width/height，缺失的一边按 viewBox 的 96 dpi 用户单位换算')
  }
  const userUnitToMmX = hasViewBox ? widthMm / (viewBoxParts[2] as number) : MM_PER_INCH / PX_PER_INCH
  const userUnitToMmY = hasViewBox ? heightMm / (viewBoxParts[3] as number) : MM_PER_INCH / PX_PER_INCH
  return {
    geometry: {
      widthMm,
      heightMm,
      viewBoxX: hasViewBox ? (viewBoxParts[0] as number) : 0,
      viewBoxY: hasViewBox ? (viewBoxParts[1] as number) : 0,
      userUnitToMmX,
      userUnitToMmY,
      inner: svgText.slice(svgText.indexOf(openTag) + openTag.length, closeIndex),
    },
    warnings,
  }
}

/**
 * 把图形落版到目标法域的固定幅面附图页。
 * @param input - 图形、法域规格、图号与页码。
 * @returns 落版页 SVG、物理尺寸与提示。
 * @throws SvgAnnotateError 图形不是可解析的 SVG 时；RangeError 尺寸/字号参数非正时。
 */
export function buildSubmissionPage(input: SubmissionPageInput): SubmissionPageResult {
  const { profile, caption, sheetNumber, bodyFontSize } = input
  const captionFontMm = input.captionFontMm ?? 4
  const captionGapMm = input.captionGapMm ?? 3
  const sheetFontMm = input.sheetFontMm ?? 3
  for (const value of [captionFontMm, captionGapMm, sheetFontMm]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`图号/页码尺寸必须为正：${String(value)}`)
    }
  }
  const { geometry, warnings } = parseDrawingSvg(input.drawingSvg)
  if (bodyFontSize !== undefined && (!Number.isFinite(bodyFontSize) || bodyFontSize <= 0)) {
    throw new RangeError(`正文字号必须为正：${String(bodyFontSize)}`)
  }

  const areaWidthMm = profile.paper.widthMm - profile.margins.leftMm - profile.margins.rightMm
  const areaHeightMm = profile.paper.heightMm - profile.margins.topMm - profile.margins.bottomMm
  if (areaWidthMm <= 0 || areaHeightMm <= 0) {
    throw new RangeError('页边距之和超过了纸张尺寸')
  }
  const captionBlockMm = caption === undefined ? 0 : captionGapMm + captionFontMm
  const figureAreaHeightMm = areaHeightMm - captionBlockMm

  const rawScale = Math.min(areaWidthMm / geometry.widthMm, figureAreaHeightMm / geometry.heightMm)
  const pageScale = Math.min(rawScale, MAX_PAGE_SCALE)
  if (rawScale > MAX_PAGE_SCALE) {
    warnings.push(`图形相对幅面过小，落版放大被限制在 ${MAX_PAGE_SCALE} 倍；请核对图面细节是否仍可辨`)
  }
  const placedWidthMm = geometry.widthMm * pageScale
  const placedHeightMm = geometry.heightMm * pageScale

  const placeX = profile.margins.leftMm + (areaWidthMm - placedWidthMm) / 2
  const placeY = profile.margins.topMm + (figureAreaHeightMm - placedHeightMm) / 2
  const centerX = profile.margins.leftMm + areaWidthMm / 2
  const scaleX = geometry.userUnitToMmX
  const scaleY = geometry.userUnitToMmY

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmtMm(profile.paper.widthMm)}mm" height="${fmtMm(profile.paper.heightMm)}mm" viewBox="0 0 ${fmtMm(profile.paper.widthMm)} ${fmtMm(profile.paper.heightMm)}">`,
    '  <!-- 附图落版页：幅面与页边距按目标法域规格 -->',
    `  <g transform="translate(${fmtMm(placeX)},${fmtMm(placeY)}) scale(${fmtMm(pageScale)})">`,
    `    <g transform="translate(${fmtMm(-geometry.viewBoxX)},${fmtMm(-geometry.viewBoxY)}) scale(${fmtMm(scaleX)},${fmtMm(scaleY)})">`,
    indent(geometry.inner.trim()),
    '    </g>',
    '  </g>',
  ]
  if (caption !== undefined) {
    const captionY = placeY + placedHeightMm + captionGapMm + captionFontMm * 0.8
    lines.push(textElement(centerX, captionY, captionFontMm, caption))
  }
  if (sheetNumber !== undefined) {
    const sheetY = profile.margins.topMm + areaHeightMm - sheetFontMm * 0.3
    lines.push(textElement(centerX, sheetY, sheetFontMm, sheetNumber))
  }
  lines.push('</svg>', '')

  const metrics: SubmissionPageMetrics = {
    pageScale,
    drawingWidthMm: geometry.widthMm,
    drawingHeightMm: geometry.heightMm,
    placedWidthMm,
    placedHeightMm,
    ...(bodyFontSize === undefined
      ? {}
      : {
        charHeightMm: bodyFontSize * geometry.userUnitToMmY * CHAR_HEIGHT_RATIO * pageScale,
        reducedCharHeightMm: bodyFontSize * geometry.userUnitToMmY * CHAR_HEIGHT_RATIO * pageScale * profile.reductionRatio,
      }),
  }
  return { svg: lines.join('\n'), metrics, warnings }
}

/** 毫米数值格式化（至多 3 位小数）。 */
function fmtMm(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

/** 片段缩进（每行前加 6 个空格；空行保持空）。 */
function indent(body: string): string {
  return body
    .split('\n')
    .map(line => (line.trim() === '' ? '' : `      ${line.trim()}`))
    .join('\n')
}

/** 页面上的一行居中文本（图号或页码）。 */
function textElement(centerX: number, baselineY: number, fontMm: number, text: string): string {
  return `  <text x="${fmtMm(centerX)}" y="${fmtMm(baselineY)}" text-anchor="middle" font-family="sans-serif" font-size="${fmtMm(fontMm)}" fill="#000000" stroke="none">${escapeXmlAttribute(text)}</text>`
}
