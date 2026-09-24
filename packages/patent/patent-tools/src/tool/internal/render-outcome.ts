/**
 * 附图渲染失败的统一映射：把两个渲染器的失败结果按同一张表翻成专利工具错误。
 *
 * `generate_patent_figure`（Graphviz）与 `generate_structure_figure`（FreeCAD）
 * 的渲染结果同形，失败语义也必须是同一条：`not_installed` 是环境缺失（可修复的
 * 前置条件），`aborted` 是调用方取消，其余归 `tool_execution_failed`。两份各自
 * 维护的映射会先在这张表上漂移，再让同一类失败在两个工具里报出不同错误码。
 *
 * `src/figure/` 只做渲染与失败归因（`describeRenderFailure` 返回原因短语），
 * 工具协议面（错误码与 `tool` 元数据）留在工具层，因此本模块位于 `tool/internal/`。
 *
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/render-outcome
 */

import { PatentToolError } from '../../error.ts'

/** 两个附图渲染工具的工具名（同时是错误 `details.tool` 与 `aborted` 文案的主语）。 */
export type FigureToolName = 'generate_patent_figure' | 'generate_structure_figure'

/** 两类渲染结果共有的判定形态：成功，或按码分类的失败。 */
export type RenderOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_installed' | 'render_failed' | 'aborted'; readonly error: string }

/**
 * 渲染失败统一映射：not_installed→setup_required / aborted→tool_aborted / 其余→tool_execution_failed。
 * @param outcome - 渲染结果；成功时直接返回。
 * @param tool - 抛出错误携带的工具名。
 * @returns 无；成功时把 `outcome` 收窄为成功分支。
 */
export function assertRendered<T extends RenderOutcome>(
  outcome: T,
  tool: FigureToolName,
): asserts outcome is Extract<T, { ok: true }> {
  if (outcome.ok) return
  if (outcome.code === 'not_installed') {
    throw new PatentToolError('setup_required', outcome.error, { tool })
  }
  if (outcome.code === 'aborted') {
    throw new PatentToolError('tool_aborted', `${tool} aborted`, { tool })
  }
  throw new PatentToolError('tool_execution_failed', outcome.error, { tool })
}
