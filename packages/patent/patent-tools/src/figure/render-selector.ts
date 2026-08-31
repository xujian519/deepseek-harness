/**
 * 附图渲染器选择器（`figureRenderer: 'wasm' | 'cli'`，默认 wasm）。
 *
 * wasm 路径走内置 @viz-js/viz 渲染器（无系统依赖）。WASM 构建仅含文本
 * 格式插件，png/pdf 由本选择器路由到 CLI 兜底（显式 cli 亦
 * 走同一 CLI 函数）。CLI 路径需要 subprocess 服务与 dot 可执行文件，未
 * 挂载/未安装时返回 `not_installed`，由工具层归并为 setup_required。
 *
 * @module @deepseek-ai/dsh-patent-tools/figure/render-selector
 */

import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { renderWithGraphviz } from './graphviz-renderer.ts'
import type { GraphvizRenderOutcome, GraphvizRenderSpec } from './graphviz-renderer.ts'
import { renderWithVizWasm } from './viz-wasm-renderer.ts'

/** 渲染器模式：wasm=内置引擎（默认，SVG 零系统依赖）；cli=系统 dot 子进程。 */
export type FigureRendererMode = 'wasm' | 'cli'

/** 选择器依赖（仅 cli 与 png/pdf 回退路径需要）。 */
export type FigureRendererSelectorDeps = {
  /** Cordis subprocess 服务；未挂载时 cli 路径返回 not_installed。 */
  subprocess?: SubprocessRuntime
  /** dot 可执行路径覆盖（与 Config.graphvizExecutable 同源）。 */
  graphvizExecutable?: string
}

/** WASM 引擎无法产出的格式（png/pdf 无插件），一律走 CLI 兜底。 */
const CLI_FALLBACK_FORMATS: readonly string[] = ['png', 'pdf']

/**
 * 按配置选择渲染函数。
 * @param mode - 配置的渲染器模式；undefined 视为 'wasm'（默认）。
 * @param deps - subprocess 服务与 dot 路径覆盖。
 * @returns 与 renderWithGraphviz 同契约的渲染函数。
 */
export function pickRenderer(
  mode: FigureRendererMode | undefined,
  deps: FigureRendererSelectorDeps,
): (spec: GraphvizRenderSpec) => Promise<GraphvizRenderOutcome> {
  const renderCli = (spec: GraphvizRenderSpec): Promise<GraphvizRenderOutcome> =>
    deps.subprocess === undefined
      ? Promise.resolve({ ok: false, code: 'not_installed', error: 'subprocess 服务不可用（未挂载 @deepseek-ai/dsh-subprocess）' })
      : renderWithGraphviz(deps.subprocess, spec, deps.graphvizExecutable)
  if (mode === 'cli') return renderCli
  return spec => (CLI_FALLBACK_FORMATS.includes(spec.format) ? renderCli(spec) : renderWithVizWasm(spec))
}
