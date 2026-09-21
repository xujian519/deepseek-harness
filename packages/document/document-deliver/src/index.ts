/**
 * The document-deliver plugin: one model-facing `document_deliver` tool that
 * records the document agent's delivered files, formats, and quality-gate
 * state, and runs the deterministic document checks over the delivered bytes.
 * The tool registers into `ctx.tools`; the tool call is the session log's only
 * write path — no host RPC, no durable file outside the log.
 * @module @deepseek-ai/dsh-document-deliver
 */

import type { Context } from '@deepseek-ai/cordis'
import { findStyleByName, loadStyles, stylesDirectory, type DocumentStyle } from '@deepseek-ai/dsh-doc-style'
import z from '@deepseek-ai/schemastery'
import { createDocumentDeliverTool } from './tool.ts'

// Public library API: the deterministic checks, the tool factory, its argument
// pipeline, and the deliverable check vocabulary.
export {
  checkDocumentText,
  DOCUMENT_CHECK_IDS,
  type DocumentCheckFinding,
  type DocumentCheckId,
  type DocumentCheckLevel,
  type DocumentTextCheckOptions,
} from './checks.ts'
export {
  checkDeliverables,
  createDocumentDeliverTool,
  DELIVERABLE_FORMATS,
  MAX_CHECK_BYTES,
  missingDeliverableFiles,
  parseDocumentDeliverArgs,
  type DeliverableCheckReport,
  type DeliverableFormat,
  type DeliverFileInput,
  type DeliverGateInput,
  type DocumentDeliverDeps,
  type DocumentDeliverInput,
  type DocumentDeliverResult,
  type DocumentDeliverSpec,
} from './tool.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'document-deliver'

/** Services required to register the tool and resolve deliverable files. */
export const inject = ['tools', 'fs']

/** Style the deterministic checks use when a deployment configures none. */
export const DEFAULT_DOCUMENT_STYLE = 'assistant-neutral'

/** Document-delivery plugin configuration. */
export interface Config {
  /** Style directories layered over the packaged one, in ascending precedence. */
  styleDirs?: string[]
  /** Style name the checks use when a registration names no style. */
  defaultStyle?: string
}

/** Schemastery configuration: style roots and the default style. */
export const Config: z<Config> = z.object({
  styleDirs: z.array(z.string()).default([]),
  defaultStyle: z.string().default(DEFAULT_DOCUMENT_STYLE),
})

/**
 * Resolve the style a registration is checked against, failing the deployment
 * at load rather than per call: a configured name that no loaded style carries
 * is a misconfiguration, not a runtime condition.
 * @param styles - the loaded styles.
 * @param name - the configured default style name.
 * @returns the resolved default style.
 */
function requireDefaultStyle(styles: readonly DocumentStyle[], name: string): DocumentStyle {
  const style = findStyleByName(styles, name)
  if (style === undefined) {
    throw new Error(`document-deliver: 默认样式 ${JSON.stringify(name)} 未加载；已加载：${styles.map(entry => entry.name).join('、')}`)
  }
  return style
}

/**
 * Load the style assets and register the `document_deliver` tool.
 * @param ctx - plugin context carrying the tools registry and the fs service.
 * @param config - style root overrides and the default style name.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const styles = loadStyles([
    stylesDirectory(),
    ...(config.styleDirs ?? []),
  ])
  ctx.tools.register(createDocumentDeliverTool(ctx, {
    styles,
    defaultStyle: requireDefaultStyle(styles, config.defaultStyle ?? DEFAULT_DOCUMENT_STYLE),
  }))
}
