/**
 * Function plugin porting the TRIZ reasoning layer: the 40 inventive
 * principles, the 39x39 contradiction matrix, and the separation principles as
 * the model-facing triz tool plus a concise tool:triz system-prompt section.
 * Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-methodology
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createTrizTool } from './tool/triz.ts'
import { TRIZ_PROMPT_TEXT } from './prompt.ts'
import { validateTrizAssets } from './data.ts'

export {
  loadMatrix,
  lookupMatrixCell,
  loadPrinciples,
  loadSeparations,
  ENGINEERING_PARAMS,
  paramLabel,
  principleById,
  principleNames,
} from './data.ts'
export { createTrizTool } from './tool/triz.ts'
export type { TrizInput, TrizOutput, TrizParameterView, TrizPrincipleView, TrizSeparationView } from './tool/triz.ts'
export type { TrizPrinciple, TrizParameter, TrizSeparation } from './types.ts'

export const name = 'methodology'
export const inject = ['tools', 'systemPrompt']

/** Model-facing TRIZ plugin configuration. */
export interface Config {
  /** Register the always-on tool:triz system-prompt section. Defaults to true. */
  registerSection?: boolean
}

/** Schemastery configuration: whether to inject the TRIZ prompt section. */
export const Config: z<Config> = z.object({
  registerSection: z.boolean().default(true),
})

/**
 * Register the triz tool and, by default, the tool:triz system-prompt section.
 * @param ctx - registrant context carrying the tool registry and system prompt.
 * @param config - deployment's section toggle.
 */
export function apply(ctx: Context, config: Config): void {
  validateTrizAssets()
  if (config.registerSection !== false) {
    ctx.systemPrompt.section({ name: 'tool:triz', order: 111, text: TRIZ_PROMPT_TEXT })
  }
  ctx.tools.register(createTrizTool())
}
