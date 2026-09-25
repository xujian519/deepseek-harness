/**
 * `generate_patent_figure` 的结果组装：把构建结果还原成标号表、组件与连接清单、
 * 「图N是…；图中：…」附图说明，渲染成模型可见文本，并投影为附图索引条目。
 * @module @deepseek-ai/dsh-patent-tools/tool/figure-output
 */

import { relative } from 'node:path'
import { sanitizeId } from '../figure/dot-builder.ts'
import type { DotEngine, DotFormat, HierarchyNode } from '../figure/dot-builder.ts'
import { figureDescription as buildFigureDescription } from '../figure/figure-description.ts'
import { FIGURE_TYPE_NAMES } from './analyze-patent-figure.ts'
import type { FigureAnalysisResult, FigureComponent, FigureConnection, FigureType } from './analyze-patent-figure.ts'
import { FIGURE_GENERATOR_MODEL_USED, singleLine } from './figure-input.ts'
import type { GeneratePatentFigureOutput, StructuralFigureInput } from './figure-input.ts'

/**
 * 构造索引用 analysis（确定性生成：组件/连接由输入还原，置信度 1）。
 * @param output - 已组装的本图输出。
 * @param style - 本次色彩策略，记入整体描述。
 * @param figureFamily - 发明家族标识，写入条目供跨图续号检索。
 * @returns 与 analyze_patent_figure 输出同构的分析结果。
 */
export function indexAnalysis(
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

/**
 * 简单文本渲染：标号表 + 附图说明 + 落版信息 + 路径。
 * @param value - 工具输出。
 * @returns 模型可见的文本内容块。
 */
export function renderGenerateFigureResult(value: GeneratePatentFigureOutput): { type: 'text'; text: string }[] {
  const pathLabel = value.panels === undefined
    ? value.path
    : value.panels.map(p => p.path).join('、')
  const layout = value.layout
  const lines = [
    `已生成专利附图（图${value.figureNumber}，${value.format}）：${pathLabel}`,
    '',
    value.figureDescription,
    ...(layout === undefined
      ? []
      : [
        '',
        `## 落版（${layout.office}）`,
        `- 缩放 ${layout.pageScale}，图形 ${layout.placedWidthMm}×${layout.placedHeightMm} 毫米`,
        ...(layout.charHeightMm === undefined ? [] : [`- 字高 ${layout.charHeightMm} 毫米（缩小至三分之二后 ${layout.reducedCharHeightMm} 毫米）`]),
        ...(layout.caption === undefined ? [] : [`- 图号 ${layout.caption}`]),
        `- 页码 ${layout.sheetNumber}`,
      ]),
    '',
    '## 参考标号',
    ...value.numeralMap.map(m => `- ${m.numeral} ${m.label}`),
    ...(value.warnings.length > 0 ? ['', '## 警告', ...value.warnings.map(w => `- ${w}`)] : []),
  ]
  return [{ type: 'text', text: lines.join('\n') }]
}

/**
 * 组装输出：组件/连接/标号表/附图说明（raw_dot 与 template 无结构化还原数据）。
 * @param input - 已归一的单图结构化输入。
 * @param params - 工作目录、产物路径、图号、格式、引擎与标号映射。
 * @returns 本图输出；`layout` 与 `indexed` 由调用方补齐。
 */
export function buildOutput(
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
  for (const state of input.states) {
    // initial 伪状态无文字标签，不进入标号表（与 collectComponents 同规则）。
    if (state.label.trim() !== '') descriptor(state.id, state.label)
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

  const description = buildFigureDescription({
    figureNumber,
    figureTypeName: FIGURE_TYPE_NAMES[figureType],
    inventionName: input.invention_name,
    ...(params.suffix === undefined ? {} : { suffix: params.suffix }),
    numerals: numeralMap,
  })

  const result: GeneratePatentFigureOutput = {
    path,
    format,
    engine,
    figureNumber,
    figureType,
    figureDescription: description,
    numeralMap,
    components,
    connections,
    warnings,
    indexed: false,
  }
  return result
}
