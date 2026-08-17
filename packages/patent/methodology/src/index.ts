/**
 * Function plugin porting the Sati reasoning-methodology layer: the TRIZ 40
 * principles and 39x39 contradiction matrix as the model-facing triz tool plus
 * a concise tool:triz system-prompt section, and the methodology registry as a
 * library API. Named exports preserve loader injection metadata.
 * @module @deepseek-ai/dsh-methodology
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createTrizTool } from './tool/triz.ts'
import { TRIZ_PROMPT_TEXT } from './prompt.ts'

// Public library API: the methodology registry and every ported component.
export { MethodologyRegistry, DEFAULT_METHODOLOGY_COMPONENTS, extractMethodologyKeywords } from './runtime/MethodologyRegistry.ts'
export { injectMethodology } from './runtime/MethodologyInjector.ts'
export type { MethodologyInjectionResult, MethodologyInjectorOptions } from './runtime/MethodologyInjector.ts'
export { fiveWhys } from './runtime/components/five-whys.ts'
export { mece } from './runtime/components/mece.ts'
export { swot } from './runtime/components/swot.ts'
export { pdca } from './runtime/components/pdca.ts'
export { fishbone } from './runtime/components/fishbone.ts'
export { firstPrinciples } from './runtime/components/first-principles.ts'
export { sixHats } from './runtime/components/six-hats.ts'
export { triz } from './runtime/components/triz.ts'
export {
  loadMatrix,
  lookupMatrixCell,
  loadPrinciples,
  ENGINEERING_PARAMS,
  detectParamNumbers,
  paramLabel,
  principleNames,
} from './data.ts'
export { createTrizTool } from './tool/triz.ts'
export type { TrizInput, TrizOutput, TrizParameterView, TrizPrincipleView } from './tool/triz.ts'
export type {
  MethodologyCategory,
  MethodologyDomain,
  MethodologyContext,
  MethodologyExecutionResult,
  MethodologyComponent,
  MethodologyMatch,
  TrizPrinciple,
  TrizParameter,
} from './types.ts'

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
  if (config.registerSection !== false) {
    ctx.systemPrompt.section({ name: 'tool:triz', order: 111, text: TRIZ_PROMPT_TEXT })
  }
  ctx.tools.register(createTrizTool())
}
