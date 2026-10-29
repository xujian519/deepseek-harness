/**
 * 撰写域原子：figure-analysis（附图分析结果收口）。
 *
 * `analyze_patent_figure` 由 sub_agent 阶段逐图调用，阶段输出是文本。本原子把该文本
 * 解析成 `validate_specification` 接受的 `figure_analysis` 数组；无附图、视觉能力
 * 不可用或未产出结果时写 `figure_analysis_skipped` 说明原因，而不是静默放行。
 *
 * 输入键可由阶段参数覆盖：`source_key`（默认 `figure_analysis`）指向 sub_agent
 * 阶段落在 `state[stage.id]` 的原始文本；`figure_files` 为空时直接跳过。
 */

import {
  degraded,
  getStateArray,
  getStateString,
  type Atom,
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
} from '@deepseek-ai/dsh-patent-core'
import type { FigureAnalysisResult } from '../tool/spec-types.ts'

/** figure-analysis 原子：把 sub_agent 的附图分析文本收口为结构化数组。 */
export const figureAnalysisAtom: Atom = {
  name: 'figure-analysis',
  description: '附图分析结果收口（确定性）：把 analyze_patent_figure 的文本输出解析为 figure_analysis 数组；无附图/视觉能力不可用时写 figure_analysis_skipped',
  category: 'extract',
  inputSchema: ['figure_files', 'figure_analysis', 'source_key'],
  outputSchema: ['figure_analysis', 'figure_analysis_skipped', 'figure_analysis_report'],
}

/** 原始文本可能带的跳过标记；sub_agent 无图或无视觉能力时按约定输出它。 */
const SKIP_MARKER = /^\s*\[SKIP\]\s*(.*)$/s

/** 解析失败的原因：返回 undefined 表示形状合法。 */
function invalidReason(entry: unknown, index: number): string | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return `figure_analysis[${index}] 必须是对象`
  }
  const record = entry as Record<string, unknown>
  if (typeof record.usable !== 'boolean') return `figure_analysis[${index}].usable 必须是布尔值`
  if (record.figureNumber !== undefined
    && (typeof record.figureNumber !== 'number' || !Number.isInteger(record.figureNumber) || record.figureNumber < 1)) {
    return `figure_analysis[${index}].figureNumber 必须是正整数`
  }
  if (!Array.isArray(record.components)) return `figure_analysis[${index}].components 必须是数组`
  for (const [componentIndex, component] of record.components.entries()) {
    if (component === null || typeof component !== 'object' || Array.isArray(component)) {
      return `figure_analysis[${index}].components[${componentIndex}] 必须是对象`
    }
    if (typeof (component as Record<string, unknown>).refNumber !== 'string') {
      return `figure_analysis[${index}].components[${componentIndex}].refNumber 必须是字符串`
    }
  }
  return undefined
}

/**
 * 把原始输出窄化为结构化结果。
 * @param raw - sub_agent 输出（JSON 文本或已解析数组）。
 * @returns 结构化数组，或解析失败原因。
 */
function parseAnalysis(raw: unknown): { entries: FigureAnalysisResult[] } | { error: string } {
  let value = raw
  if (typeof value === 'string') {
    const text = value.trim()
    try {
      value = JSON.parse(text)
    } catch {
      return { error: '附图分析输出不是合法 JSON' }
    }
  }
  if (!Array.isArray(value)) return { error: '附图分析输出必须是数组' }
  for (const [index, entry] of value.entries()) {
    const reason = invalidReason(entry, index)
    if (reason !== undefined) return { error: reason }
  }
  return { entries: value as FigureAnalysisResult[] }
}

/** figure-analysis 执行器：读取 sub_agent 输出并写入 `figure_analysis`。 */
export class FigureAnalysisHandler implements StageHandler {
  readonly name = 'figure-analysis'
  readonly category = 'extract' as const

  /**
   * 执行附图分析结果收口。
   * @param input - 阶段执行输入（共享状态含 figure_files 与 sub_agent 输出）。
   * @returns 下一管线状态：结构化附图分析数组与可选的跳过原因。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const figures = getStateArray(state, 'figure_files').filter((file): file is string => typeof file === 'string' && file.trim().length > 0)
    if (figures.length === 0) {
      return {
        figure_analysis: [],
        figure_analysis_skipped: '无附图（figure_files 为空），未执行附图分析',
        figure_analysis_report: '附图分析已跳过：无附图。',
      }
    }

    const sourceKey = getStateString(state, 'source_key', 'figure_analysis')
    const raw = state[sourceKey]
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim().length === 0)) {
      return {
        figure_analysis: [],
        figure_analysis_skipped: '未产出附图分析结果（sub_agent 未调用 analyze_patent_figure）',
        figure_analysis_report: '附图分析已跳过：未产出结果。',
      }
    }
    if (typeof raw === 'string') {
      const skip = SKIP_MARKER.exec(raw)
      if (skip !== null) {
        /* v8 ignore next -- the optional reason group is empty when the sub_agent omits it. */
        const reason = (skip[1] ?? '').trim() || 'sub_agent 声明跳过'
        return {
          figure_analysis: [],
          figure_analysis_skipped: reason,
          figure_analysis_report: `附图分析已跳过：${reason}。`,
        }
      }
    }

    const parsed = parseAnalysis(raw)
    if ('error' in parsed) return degraded('figure-analysis', parsed.error)
    return {
      figure_analysis: parsed.entries,
      figure_analysis_report: `附图分析结果：${parsed.entries.length} 张图（可用 ${parsed.entries.filter(entry => entry.usable).length} 张）。`,
    }
  }
}
