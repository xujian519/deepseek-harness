/**
 * SVG 引线标号后处理（纯函数，无 IO）。
 *
 * 解析 Graphviz SVG 的节点组（结构经 Graphviz 输出采样确认：`<g
 * class="node">` + `<title>`=DOT 节点 id + `<polygon>`/`<ellipse>` 轮廓
 * + `<text>` 标签；节点组内不嵌套 `<g>`——若出现则组解析在首个 `</g>`
 * 截断，退化为内嵌标号告警，不会越界），把参考标号绘制在节点轮廓之外
 * 并用 `<line>` 引线
 * 指向节点。候选锚点按右/左/上/下尝试，取第一个与任何节点轮廓或已
 * 放置标号都不相交的位置；无可用位置或节点缺轮廓时退化为在匹配文本
 * 尾部内嵌标号并输出警告，绝不画出压盖图面的引线。
 * 输入安全检查复用 svg-annotate 的 assertSafeSvg。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/leader-line
 */

import { DEFAULT_SVG_MAX_BYTES, SvgAnnotateError, assertSafeSvg, escapeXmlText, textElementContent } from './svg-annotate.ts'
import type { SvgAnnotateReference } from './svg-annotate.ts'

/** 引线标号选项。 */
export type LeaderLineOptions = {
  /** 输入大小上限（字节），默认 {@link DEFAULT_SVG_MAX_BYTES}。 */
  maxBytes?: number
}

/** 引线标注结果：新 SVG 文本 + 警告（未命中参考、退化内嵌的节点）。 */
export type LeaderLineResult = {
  svg: string
  warnings: string[]
}

/** SVG 用户单位下的矩形（min < max）。 */
type Rect = { minX: number; minY: number; maxX: number; maxY: number }

/** 引线候选锚点：线段两端、标号文本位置与占用区（线段细条 + 文本框）。 */
type AnchorPlacement = {
  line: { x1: number; y1: number; x2: number; y2: number }
  text: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }
  occupied: Rect[]
}

/** 解析后的节点组。 */
type ParsedNodeGroup = {
  /** 组片段在 SVG 中的起始偏移。 */
  offset: number
  /** 组片段原文。 */
  raw: string
  /** `<title>` 文本（DOT 节点 id；缺省为空串）。 */
  title: string
  /** 组内全部文本元素的可见拼接（小写，用于参考匹配）。 */
  text: string
  /** 轮廓 bbox；组内无 polygon/ellipse 时 undefined。 */
  bbox: Rect | undefined
  /** 命中的参考序号；未命中 -1。 */
  referenceIndex: number
}

/** 引线长度（SVG 用户单位）。 */
const LEADER_GAP = 10

/** 标号文本行高（font-size 10 的估算值，用于占位与碰撞判定）。 */
const NUMERAL_TEXT_HEIGHT = 12

/** 标号每字符估算宽度（font-size 10）。 */
const NUMERAL_CHAR_WIDTH = 6

/** 坐标格式化（最多 1 位小数）。 */
function fmtCoord(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/** 两矩形是否相交（共享边界不算）。 */
function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/** 从 `<polygon>` 的 points 属性解析轮廓 bbox；点对非法时 undefined。 */
function polygonBBox(pointsAttr: string): Rect | undefined {
  const pairs = pointsAttr.trim().split(/\s+/).filter(pair => pair !== '')
  if (pairs.length === 0) return undefined
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const pair of pairs) {
    const parts = pair.split(',')
    const x = Number(parts[0])
    const y = Number(parts[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

/** 从 `<ellipse ...>` 标签解析轮廓 bbox；属性缺失/非法时 undefined。 */
function ellipseBBox(ellipseTag: string): Rect | undefined {
  const num = (name: string): number | undefined => {
    const match = new RegExp(`\\b${name}="([^"]+)"`).exec(ellipseTag)
    if (match === null) return undefined
    const value = Number(match[1])
    return Number.isFinite(value) ? value : undefined
  }
  const cx = num('cx')
  const cy = num('cy')
  const rx = num('rx')
  const ry = num('ry')
  if (cx === undefined || cy === undefined || rx === undefined || ry === undefined) return undefined
  return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry }
}

/**
 * 为节点 bbox 生成右/左/上/下四个候选锚点（引线从轮廓边缘出发，标号在线端外侧）。
 * @param bbox - 节点轮廓。
 * @param numeral - 标号文本（决定文本框宽度）。
 * @returns 按尝试顺序排列的候选。
 */
function candidatePlacements(bbox: Rect, numeral: string): AnchorPlacement[] {
  const width = numeral.length * NUMERAL_CHAR_WIDTH + 2
  const cx = (bbox.minX + bbox.maxX) / 2
  const cy = (bbox.minY + bbox.maxY) / 2
  const halfH = NUMERAL_TEXT_HEIGHT / 2
  const right: AnchorPlacement = {
    line: { x1: bbox.maxX, y1: cy, x2: bbox.maxX + LEADER_GAP, y2: cy },
    text: { x: bbox.maxX + LEADER_GAP + 3, y: cy + 3.5, anchor: 'start' },
    occupied: [
      { minX: bbox.maxX, minY: cy - 1, maxX: bbox.maxX + LEADER_GAP, maxY: cy + 1 },
      { minX: bbox.maxX + LEADER_GAP, minY: cy - halfH, maxX: bbox.maxX + LEADER_GAP + 3 + width, maxY: cy + halfH },
    ],
  }
  const left: AnchorPlacement = {
    line: { x1: bbox.minX, y1: cy, x2: bbox.minX - LEADER_GAP, y2: cy },
    text: { x: bbox.minX - LEADER_GAP - 3, y: cy + 3.5, anchor: 'end' },
    occupied: [
      { minX: bbox.minX - LEADER_GAP, minY: cy - 1, maxX: bbox.minX, maxY: cy + 1 },
      { minX: bbox.minX - LEADER_GAP - 3 - width, minY: cy - halfH, maxX: bbox.minX - LEADER_GAP, maxY: cy + halfH },
    ],
  }
  const top: AnchorPlacement = {
    line: { x1: cx, y1: bbox.minY, x2: cx, y2: bbox.minY - LEADER_GAP },
    text: { x: cx, y: bbox.minY - LEADER_GAP - 3, anchor: 'middle' },
    occupied: [
      { minX: cx - 1, minY: bbox.minY - LEADER_GAP, maxX: cx + 1, maxY: bbox.minY },
      {
        minX: cx - width / 2,
        minY: bbox.minY - LEADER_GAP - 3 - NUMERAL_TEXT_HEIGHT,
        maxX: cx + width / 2,
        maxY: bbox.minY - LEADER_GAP - 3,
      },
    ],
  }
  const bottom: AnchorPlacement = {
    line: { x1: cx, y1: bbox.maxY, x2: cx, y2: bbox.maxY + LEADER_GAP },
    text: { x: cx, y: bbox.maxY + LEADER_GAP + 9, anchor: 'middle' },
    occupied: [
      { minX: cx - 1, minY: bbox.maxY, maxX: cx + 1, maxY: bbox.maxY + LEADER_GAP },
      { minX: cx - width / 2, minY: bbox.maxY + LEADER_GAP, maxX: cx + width / 2, maxY: bbox.maxY + LEADER_GAP + NUMERAL_TEXT_HEIGHT },
    ],
  }
  return [right, left, top, bottom]
}

/** 渲染一条引线 + 标号文本的 SVG 片段。 */
function leaderLineFragment(placement: AnchorPlacement, numeral: string): string {
  const line = placement.line
  const text = placement.text
  return [
    `<line x1="${fmtCoord(line.x1)}" y1="${fmtCoord(line.y1)}" x2="${fmtCoord(line.x2)}" y2="${fmtCoord(line.y2)}" stroke="black" stroke-width="1"/>`,
    `<text x="${fmtCoord(text.x)}" y="${fmtCoord(text.y)}" font-size="10" text-anchor="${text.anchor}" xml:space="preserve">${escapeXmlText(numeral)}</text>`,
  ].join('\n')
}

/**
 * 引线无放置空间时的退化路径：在组内最后一个文本元素尾部内嵌 ` (numeral)`
 * （插位规则与 annotateSvg 一致：优先最后一个 `</tspan>` 前）。
 * @param groupRaw - 节点组片段原文。
 * @param numeral - 标号文本。
 * @returns 内嵌标号后的组片段。
 */
function embedNumeralInGroup(groupRaw: string, numeral: string): string {
  const escaped = ` (${escapeXmlText(numeral)})`
  const textPattern = /<text\b[^>]*>[\s\S]*?<\/text>/gi
  let last: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = textPattern.exec(groupRaw)) !== null) last = match
  /* v8 ignore start -- the caller only invokes this on a group that matched via its text elements */
  if (last === null) return groupRaw
  /* v8 ignore stop */
  const whole = last[0]
  const lastTspan = whole.lastIndexOf('</tspan>')
  const insertAt = lastTspan >= 0 ? lastTspan : whole.length - '</text>'.length
  const tail = groupRaw.slice(last.index + whole.length)
  return groupRaw.slice(0, last.index) + whole.slice(0, insertAt) + escaped + whole.slice(insertAt) + tail
}

/**
 * 在 Graphviz SVG 的节点组外侧绘制引线标号。
 *
 * 匹配语义与 annotateSvg 一致：按参考传入顺序取首个文本命中，每个节点
 * 组至多命中一个参考，同一参考可命中多个组（同号多处标注）。命中组缺
 * 轮廓或四向候选均冲突时退化为内嵌标号并告警。
 * @param svgText - Graphviz 渲染的 SVG 文本（WASM 与 CLI 输出同构）。
 * @param references - 参考标号列表（label 匹配组内可见文本）。
 * @param options - 大小上限等选项。
 * @returns 标注后的 SVG 文本与警告。
 * @throws SvgAnnotateError 输入不安全/非 SVG/过大或参考字段为空。
 */
export function annotateSvgWithLeaderLines(
  svgText: string,
  references: readonly SvgAnnotateReference[],
  options: LeaderLineOptions = {},
): LeaderLineResult {
  const maxBytes = options.maxBytes ?? DEFAULT_SVG_MAX_BYTES
  assertSafeSvg(svgText, maxBytes)
  for (const ref of references) {
    if (ref.label.trim() === '') {
      throw new SvgAnnotateError('invalid_reference', '参考 label 不能为空')
    }
    if (ref.numeral.trim() === '') {
      throw new SvgAnnotateError('invalid_reference', `参考 "${ref.label}" 的 numeral 不能为空`)
    }
  }
  if (references.length === 0) return { svg: svgText, warnings: [] }

  const groups: ParsedNodeGroup[] = []
  const groupPattern = /<g\b[^>]*\bclass="node"[^>]*>[\s\S]*?<\/g>/g
  let groupMatch: RegExpExecArray | null
  while ((groupMatch = groupPattern.exec(svgText)) !== null) {
    const raw = groupMatch[0]
    const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(raw)
    const textParts: string[] = []
    const textPattern = /<text\b[^>]*>[\s\S]*?<\/text>/gi
    let textMatch: RegExpExecArray | null
    while ((textMatch = textPattern.exec(raw)) !== null) textParts.push(textElementContent(textMatch[0]))
    const polygonMatch = /<polygon\b[^>]*\bpoints="([^"]*)"/.exec(raw)
    const ellipseMatch = /<ellipse\b[^>]*>/.exec(raw)
    let bbox: Rect | undefined
    if (polygonMatch !== null) {
      bbox = polygonBBox(polygonMatch[1] as string)
    } else if (ellipseMatch !== null) {
      bbox = ellipseBBox(ellipseMatch[0])
    }
    const text = textParts.join('').toLowerCase()
    const referenceIndex = references.findIndex(ref => text.includes(ref.label.trim().toLowerCase()))
    groups.push({
      offset: groupMatch.index,
      raw,
      title: titleMatch === null ? '' : titleMatch[1] as string,
      text,
      bbox,
      referenceIndex,
    })
  }

  const warnings: string[] = []
  const bboxes: Rect[] = groups.map(group => group.bbox).filter((bbox): bbox is Rect => bbox !== undefined)
  const embedded = new Map<number, string>()
  const fragments: string[] = []
  const placed: Rect[] = []
  for (const [index, group] of groups.entries()) {
    if (group.referenceIndex < 0) continue
    const numeral = (references[group.referenceIndex] as SvgAnnotateReference).numeral.trim()
    if (group.bbox === undefined) {
      embedded.set(index, embedNumeralInGroup(group.raw, numeral))
      warnings.push(`节点 "${group.title}" 缺少形状轮廓，标号 ${numeral} 已内嵌`)
      continue
    }
    const chosen = candidatePlacements(group.bbox, numeral).find(candidate =>
      candidate.occupied.every(rect => [...bboxes, ...placed].every(other => !overlaps(rect, other))))
    if (chosen === undefined) {
      embedded.set(index, embedNumeralInGroup(group.raw, numeral))
      warnings.push(`节点 "${group.title}" 周边无引线空间，标号 ${numeral} 已内嵌`)
      continue
    }
    placed.push(...chosen.occupied)
    fragments.push(leaderLineFragment(chosen, numeral))
  }
  references.forEach((ref, index) => {
    if (!groups.some(group => group.referenceIndex === index)) {
      warnings.push(`参考 "${ref.label.trim()}" 未命中任何节点`)
    }
  })

  let result = ''
  let cursor = 0
  for (const [index, group] of groups.entries()) {
    const end = group.offset + group.raw.length
    result += svgText.slice(cursor, group.offset) + (embedded.get(index) ?? group.raw)
    cursor = end
  }
  result += svgText.slice(cursor)
  if (fragments.length > 0) {
    const closeIndex = result.toLowerCase().lastIndexOf('</svg>')
    const fragment = `<g id="leader-lines">\n${fragments.join('\n')}\n</g>\n`
    result = result.slice(0, closeIndex) + fragment + result.slice(closeIndex)
  }
  return { svg: result, warnings }
}
