/**
 * Shared keyword-matching helpers for methodology components.
 * Pure rule scoring, no LLM calls.
 * @module @deepseek-ai/dsh-methodology/runtime/keywordMatch
 */

import type { MethodologyComponent, MethodologyContext } from '../types.ts'

/**
 * Score in [0, 1] = matched trigger tokens / total trigger tokens.
 * Case-insensitive; multi-token triggers are substring matches against the goal.
 * @param context - the task context holding the goal text.
 * @param triggers - the trigger phrases this methodology recognizes.
 * @returns the fraction of triggers present in the goal.
 */
export function keywordScore(context: MethodologyContext, triggers: readonly string[]): number {
  if (triggers.length === 0) return 0
  const haystack = context.goal.toLowerCase()
  let matched = 0
  for (const trigger of triggers) {
    if (haystack.includes(trigger.toLowerCase())) matched += 1
  }
  return matched / triggers.length
}

/**
 * Build the `identify` implementation for a component that scores the goal by
 * its own trigger list. Every shipped component scored itself with the same
 * body, so the policy lives here rather than once per component.
 * @param triggers - the trigger phrases this methodology recognizes.
 * @returns an identify function scoring a context against those triggers.
 */
export function keywordIdentify(triggers: readonly string[]): MethodologyComponent['identify'] {
  return context => keywordScore(context, triggers)
}
