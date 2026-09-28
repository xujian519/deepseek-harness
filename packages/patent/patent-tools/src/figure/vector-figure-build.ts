/**
 * 矢量图型的输入映射与构建（工具层 snake_case JSON → 各图型模块的领域输入）。
 *
 * 五个直接绘制 SVG 的图型（电路图、曲线图、剖视图、时序图、外观设计视图）
 * 与 dot-builder 的节点连线图型平行：这里把模型的 JSON 输入映射为各模块
 * 的输入类型，并统一返回 {@link VectorFigureSpec} 与需要随结果返回的提示。
 * @module @deepseek-ai/dsh-patent-tools/figure/vector-figure-build
 */

import { VectorFigureError } from './vector-figure.ts'
import type { VectorFigureSpec } from './vector-figure.ts'
import { CIRCUIT_SYMBOL_KINDS, buildCircuitDiagram } from './circuit-diagram.ts'
import type { CircuitSymbolKind } from './circuit-diagram.ts'
import { buildPlotDiagram } from './plot-diagram.ts'
import { buildSectionDiagram } from './section-diagram.ts'
import { buildSequenceDiagram } from './sequence-diagram.ts'
import { APPEARANCE_VIEW_NAMES, buildAppearanceViewSheet } from './appearance-view-sheet.ts'
import type { AppearanceViewName } from './appearance-view-sheet.ts'

/** 直接绘制 SVG 的图型（不经 Graphviz）。 */
export const VECTOR_FIGURE_TYPES = ['circuit', 'plot', 'cross_section', 'sequence_diagram', 'appearance_view'] as const

/** 矢量图型名。 */
export type VectorFigureType = (typeof VECTOR_FIGURE_TYPES)[number]

/**
 * 是否为矢量图型。
 * @param figureType - 工具解析后的图型。
 * @returns 属于直接绘制 SVG 的图型时 true。
 */
export function isVectorFigureType(figureType: string): figureType is VectorFigureType {
  return (VECTOR_FIGURE_TYPES as readonly string[]).includes(figureType)
}

/** 电路图输入（与工具 schema 同形）。 */
export type CircuitFigureJson = {
  components: readonly {
    id: string
    kind: CircuitSymbolKind
    label?: string
    col: number
    row: number
  }[]
  connections: readonly { from: string; to: string; label?: string }[]
  cell_width_mm?: number
  cell_height_mm?: number
}

/** 曲线图输入（与工具 schema 同形）。 */
export type PlotFigureJson = {
  series: readonly { name?: string; points: readonly (readonly [number, number])[]; marker?: 'none' | 'circle' | 'square' | 'triangle' }[]
  x_label: string
  y_label: string
  x_unit?: string
  y_unit?: string
  x_range?: readonly [number, number]
  y_range?: readonly [number, number]
  tick_count?: number
  show_grid?: boolean
  width_mm?: number
  height_mm?: number
}

/** 剖视图输入（与工具 schema 同形）。 */
export type SectionFigureJson = {
  outline?: readonly (readonly [number, number])[]
  parts: readonly {
    label?: string
    outline: readonly (readonly [number, number])[]
    /** `'none'` 表示该轮廓不是被剖切实体（轴线、引出线、非剖切件），只画轮廓。 */
    hatch?: { angle_deg?: number; spacing_mm?: number; direction?: 'forward' | 'backward' } | 'none'
  }[]
  labels?: readonly {
    text: string
    at: readonly [number, number]
    from?: readonly [number, number]
  }[]
  centerlines?: readonly {
    from: readonly [number, number]
    to: readonly [number, number]
  }[]
  cutting_marks?: readonly {
    id: string
    from: readonly [number, number]
    to: readonly [number, number]
    arrow: 'left' | 'right' | 'up' | 'down'
  }[]
  label_font_size_mm?: number
  padding_mm?: number
}

/** 时序图输入（与工具 schema 同形）。 */
export type SequenceFigureJson = {
  participants: readonly { id: string; label: string }[]
  messages: readonly { from: string; to: string; label: string; kind?: 'sync' | 'return' | 'async'; activate?: boolean }[]
  box_width_mm?: number
  message_spacing_mm?: number
  padding_mm?: number
}

/** 外观设计视图排布输入（与工具 schema 同形）。 */
export type AppearanceFigureJson = {
  views: readonly { name: AppearanceViewName; body: string; width_mm: number; height_mm: number; note?: string }[]
  extras?: readonly { name: string; body: string; width_mm: number; height_mm: number }[]
  cell_mm?: number
  caption_gap_mm?: number
  caption_font_mm?: number
  padding_mm?: number
  first_angle?: boolean
}

/** 矢量图型的可选输入集合（与工具输入字段同名）。 */
export type VectorFigureJsonInput = {
  circuit?: CircuitFigureJson
  plot?: PlotFigureJson
  sections?: SectionFigureJson
  sequence?: SequenceFigureJson
  appearance_views?: AppearanceFigureJson
}

/** 矢量图构建结果：规格 + 随结果返回的检查提示。 */
export type VectorFigureBuild = {
  /** 图形规格（交给 vectorFigureSvg 封装）。 */
  spec: VectorFigureSpec
  /** 图型自身的检查提示（外观设计缺视图、比例不一致等）。 */
  warnings: string[]
}

/** 取必填图型输入，缺失时报 empty_input。 */
function required<T>(value: T | undefined, figureType: VectorFigureType, field: string): T {
  if (value === undefined) {
    throw new VectorFigureError('empty_input', `${figureType} 需要 ${field} 输入`)
  }
  return value
}

/** 零件序号列表（1 起，与调用方的 parts 顺序一致）。 */
function partNumbers(indexes: readonly number[]): string {
  return indexes.map(index => `#${index + 1}`).join('、')
}

/**
 * 剖视图输入的图面检查：把「静默套用默认剖面线」与「同一零件名被多个轮廓重复承载」
 * 变成模型可见的提示 —— 二者都是图面上看不出来的输入错误。
 *
 * 不检查「多件剖面线取向相同」：镜像成对的上下两半、同一零件的多段轮廓都必须取向
 * 相同，输入里没有「哪些轮廓属于同一零件」的信息，据此报警会把正确图面判成缺陷。
 * 相邻零件取向是否可区分由渲染复核（`figure/render-check`）量测后判定。
 * @param section - 剖视图输入。
 * @returns 提示列表（无问题时为空数组）。
 */
function sectionWarnings(section: SectionFigureJson): string[] {
  const warnings: string[] = []
  const unhatched = section.parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.hatch === undefined)
  if (unhatched.length > 0) {
    warnings.push(
      `零件 ${partNumbers(unhatched.map(entry => entry.index))} 未指定剖面线，已按默认 45°/3 毫米打剖面线；`
      + '若该轮廓不是被剖切的实体（轴线、引出线、非剖切件），请写 hatch: "none"；'
      + '若它们不是同一零件，相邻零件必须用相反方向或不同间距的剖面线（GB/T 4457.5）',
    )
  }
  const byLabel = new Map<string, number[]>()
  section.parts.forEach((part, index) => {
    const label = part.label?.trim() ?? ''
    if (label === '') return
    byLabel.set(label, [...(byLabel.get(label) ?? []), index])
  })
  for (const [label, indexes] of byLabel) {
    if (indexes.length < 2) continue
    warnings.push(
      `零件名「${label}」出现在 ${String(indexes.length)} 个轮廓上（${partNumbers(indexes)}）：`
      + '本字段按轮廓各画一处标号（数字在轮廓右侧之外）；同一零件的多个轮廓请改用 labels 指定唯一落点',
    )
  }
  return warnings
}

/**
 * 构建矢量图型。
 * @param figureType - 矢量图型名。
 * @param input - 工具输入的图型字段。
 * @returns 图形规格与提示。
 * @throws VectorFigureError 对应字段缺失或图型模块校验失败时。
 */
export function buildVectorFigure(figureType: VectorFigureType, input: VectorFigureJsonInput): VectorFigureBuild {
  switch (figureType) {
    case 'circuit': {
      const circuit = required(input.circuit, figureType, 'circuit')
      return {
        spec: buildCircuitDiagram({
          components: circuit.components,
          connections: circuit.connections,
          ...(circuit.cell_width_mm === undefined ? {} : { cellWidthMm: circuit.cell_width_mm }),
          ...(circuit.cell_height_mm === undefined ? {} : { cellHeightMm: circuit.cell_height_mm }),
        }),
        warnings: [],
      }
    }
    case 'plot': {
      const plot = required(input.plot, figureType, 'plot')
      return {
        spec: buildPlotDiagram({
          series: plot.series,
          xLabel: plot.x_label,
          yLabel: plot.y_label,
          ...(plot.x_unit === undefined ? {} : { xUnit: plot.x_unit }),
          ...(plot.y_unit === undefined ? {} : { yUnit: plot.y_unit }),
          ...(plot.x_range === undefined ? {} : { xRange: plot.x_range }),
          ...(plot.y_range === undefined ? {} : { yRange: plot.y_range }),
          ...(plot.tick_count === undefined ? {} : { tickCount: plot.tick_count }),
          ...(plot.show_grid === undefined ? {} : { showGrid: plot.show_grid }),
          ...(plot.width_mm === undefined ? {} : { widthMm: plot.width_mm }),
          ...(plot.height_mm === undefined ? {} : { heightMm: plot.height_mm }),
        }),
        warnings: ['曲线图不得作为实用新型的唯一附图（《专利审查指南》第一部分第二章 7.3(10)：不得仅有表示产品效果、性能的附图）'],
      }
    }
    case 'cross_section': {
      const sections = required(input.sections, figureType, 'sections')
      return {
        spec: buildSectionDiagram({
          parts: sections.parts.map(part => ({
            ...(part.label === undefined ? {} : { label: part.label }),
            outline: part.outline,
            ...(part.hatch === undefined
              ? {}
              : part.hatch === 'none'
                ? { hatch: 'none' as const }
                : {
                  hatch: {
                    ...(part.hatch.angle_deg === undefined ? {} : { angleDeg: part.hatch.angle_deg }),
                    ...(part.hatch.spacing_mm === undefined ? {} : { spacingMm: part.hatch.spacing_mm }),
                    ...(part.hatch.direction === undefined ? {} : { direction: part.hatch.direction }),
                  },
                }),
          })),
          ...(sections.outline === undefined ? {} : { outline: sections.outline }),
          ...(sections.labels === undefined ? {} : { labels: sections.labels }),
          ...(sections.centerlines === undefined ? {} : { centerlines: sections.centerlines }),
          ...(sections.cutting_marks === undefined ? {} : { cuttingMarks: sections.cutting_marks }),
          ...(sections.label_font_size_mm === undefined ? {} : { labelFontSizeMm: sections.label_font_size_mm }),
          ...(sections.padding_mm === undefined ? {} : { paddingMm: sections.padding_mm }),
        }),
        warnings: sectionWarnings(sections),
      }
    }
    case 'sequence_diagram': {
      const sequence = required(input.sequence, figureType, 'sequence')
      return {
        spec: buildSequenceDiagram({
          participants: sequence.participants,
          messages: sequence.messages,
          ...(sequence.box_width_mm === undefined ? {} : { boxWidthMm: sequence.box_width_mm }),
          ...(sequence.message_spacing_mm === undefined ? {} : { messageSpacingMm: sequence.message_spacing_mm }),
          ...(sequence.padding_mm === undefined ? {} : { paddingMm: sequence.padding_mm }),
        }),
        warnings: [],
      }
    }
    case 'appearance_view': {
      const appearance = required(input.appearance_views, figureType, 'appearance_views')
      const sheet = buildAppearanceViewSheet({
        views: appearance.views.map(view => ({
          name: view.name,
          body: view.body,
          widthMm: view.width_mm,
          heightMm: view.height_mm,
          ...(view.note === undefined ? {} : { note: view.note }),
        })),
        ...(appearance.extras === undefined
          ? {}
          : {
            extras: appearance.extras.map(extra => ({
              name: extra.name,
              body: extra.body,
              widthMm: extra.width_mm,
              heightMm: extra.height_mm,
            })),
          }),
        ...(appearance.cell_mm === undefined ? {} : { cellMm: appearance.cell_mm }),
        ...(appearance.caption_gap_mm === undefined ? {} : { captionGapMm: appearance.caption_gap_mm }),
        ...(appearance.caption_font_mm === undefined ? {} : { captionFontMm: appearance.caption_font_mm }),
        ...(appearance.padding_mm === undefined ? {} : { paddingMm: appearance.padding_mm }),
        ...(appearance.first_angle === undefined ? {} : { firstAngle: appearance.first_angle }),
      })
      return { spec: sheet.spec, warnings: sheet.warnings }
    }
    /* v8 ignore next -- closed-union backstop; the compiler rejects a new vector figure type here. */
    default:
      return assertNeverVector(figureType)
  }
}

/** 闭合联合兜底（新增矢量图型时编译器在此报错）。 */
function assertNeverVector(value: never): never {
  throw new VectorFigureError('invalid_input', `未知矢量图型：${String(value)}`)
}

/** 外观设计视图名的运行时白名单（供工具枚举复用）。 */
export const APPEARANCE_VIEW_NAMES_ALL: readonly AppearanceViewName[] = APPEARANCE_VIEW_NAMES

/** 电路符号白名单（供工具枚举复用）。 */
export const CIRCUIT_SYMBOL_KIND_NAMES: readonly CircuitSymbolKind[] = CIRCUIT_SYMBOL_KINDS
