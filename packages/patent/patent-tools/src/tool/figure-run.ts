/**
 * 附图生成的共享运行参数与标号分配。
 *
 * 单图与多面板两条路径都从同一个 `FigureContext` 读取依赖、输出目录、格式、
 * 引擎、色彩策略与取消信号；标号分配也共用一条报错路径，避免两条路径对显式
 * 标号冲突给出不同的错误。
 * @module @deepseek-ai/dsh-patent-tools/tool/figure-run
 */

import { PatentToolError } from '../error.ts'
import { DotBuildError, assignNumerals } from '../figure/dot-builder.ts'
import type { DotEngine, DotFormat, NumeralAssignment } from '../figure/dot-builder.ts'
import type { GeneratePatentFigureDeps } from './figure-input.ts'

/** 一次生成调用的运行参数：输出目录基准、格式、引擎、色彩策略与取消信号。 */
export type FigureContext = {
  deps: GeneratePatentFigureDeps
  cwd: string
  format: DotFormat
  engine: DotEngine
  style: 'grayscale' | 'semantic'
  signal: AbortSignal
}

/** 毫米 → pt（1pt = 25.4/72 毫米）：图面字号以毫米表述，DOT 与落版核算用 pt。 */
const MM_PER_PT = 25.4 / 72

/**
 * 部署图面字号（毫米）换算成 DOT 的 pt 值；未配置时 undefined（DOT 保持历史默认）。
 * @param figureFontMm - 部署配置的图面字号（毫米）。
 * @returns DOT 的 fontsize（pt）；未配置时 undefined。
 */
export function resolveFontPt(figureFontMm: number | undefined): number | undefined {
  return figureFontMm === undefined ? undefined : Math.round((figureFontMm / MM_PER_PT) * 100) / 100
}

/**
 * 分配标号系列。显式标号重复、系列起止非法都在这里译成 invalid_tool_input：
 * 单图与多面板两条路径共用同一条分配与报错路径。
 * @param args - ids in figure order, the figure number, explicit numerals, and optional start/step/reserved.
 * @returns the assignments in id order; empty when the figure has no components.
 * @throws PatentToolError when the series bounds or an explicit numeral is invalid.
 */
export function assignFigureNumerals(args: {
  ids: readonly string[]
  figureNumber: number
  explicit: Record<string, string>
  numeralStart?: number | undefined
  numeralStep?: number | undefined
  reserved?: readonly string[] | undefined
}): NumeralAssignment[] {
  if (args.ids.length === 0) return []
  try {
    return assignNumerals(args.ids, {
      figureNumber: args.figureNumber,
      ...(args.numeralStart === undefined ? {} : { start: args.numeralStart }),
      ...(args.numeralStep === undefined ? {} : { step: args.numeralStep }),
      explicit: args.explicit,
      ...(args.reserved === undefined || args.reserved.length === 0 ? {} : { reserved: args.reserved }),
    })
  } catch (error) {
    /* v8 ignore start -- assignNumerals only throws DotBuildError; keep the rethrow loud for invariant drift */
    if (error instanceof DotBuildError) {
      throw new PatentToolError('invalid_tool_input', `标号分配失败：${error.message}`, { tool: 'generate_patent_figure' })
    }
    throw error
    /* v8 ignore stop */
  }
}
