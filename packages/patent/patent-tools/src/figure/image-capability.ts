/**
 * Image-input capability preflight for the patent figure tools, ported from
 * Sati's model/protocol/multimodal.ts + resolveModelInfo.ts semantics.
 *
 * The rule is NEGATIVE capability: image input requires the model to declare
 * the 'image' modality in its input list. An absent modality list, an empty
 * list, or a list without 'image' all deny — an explicit omission is never
 * guessed into a positive capability, and unknown models default to text-only.
 * @module @deepseek-ai/dsh-patent-tools/figure/image-capability
 */

import type { LlmResolvedModelInfo, ModelModality } from '@deepseek-ai/dsh-llm'

/** Allow/deny decision for image input, with a model-visible reason on deny. */
export type ImageCapabilityDecision =
  | { allowed: true }
  | { allowed: false; reason: string }

/** Minimal capability query the preflight needs (structurally the harness resolveModelInfo). */
export type ModelInfoQuery = (
  provider: string,
  model: string,
) => Promise<Pick<LlmResolvedModelInfo, 'inputModalities'>>

/** Human phrase for the declared modalities carried in a deny reason. */
function declaredPhrase(inputModalities: readonly ModelModality[] | undefined): string {
  if (inputModalities === undefined) return 'no input modalities (unknown; defaults to text-only)'
  if (inputModalities.length === 0) return 'an empty input-modality list'
  return inputModalities.map(modality => '"' + modality + '"').join(', ')
}

/**
 * Decide whether a model may receive image input from its declared modalities.
 *
 * @param inputModalities - the resolved model's input modalities; undefined
 *   means the model disclosed no modalities, treated as text-only.
 * @param modelLabel - optional model label named in the deny reason.
 * @returns allow when 'image' is declared, otherwise deny with the reason.
 */
export function checkImageCapability(
  inputModalities: readonly ModelModality[] | undefined,
  modelLabel?: string,
): ImageCapabilityDecision {
  if (inputModalities?.includes('image') === true) return { allowed: true }
  const who = modelLabel === undefined ? 'the current model' : 'model "' + modelLabel + '"'
  return {
    allowed: false,
    reason:
      who + ' does not accept image input (declares ' + declaredPhrase(inputModalities) + '); ' +
      'switch to a model that declares image input',
  }
}

/**
 * Resolve one provider/model route's input modalities for the image gate.
 * A resolution failure (unregistered route or malformed metadata) is unknown
 * capability, surfaced as undefined so the gate denies text-only.
 *
 * @param resolveModelInfo - the capability query (the harness's ctx.llm).
 * @param provider - provider route to resolve.
 * @param model - exact model id to resolve.
 * @returns the declared input modalities, or undefined when unresolvable.
 */
export function resolveImageInputModalities(
  resolveModelInfo: ModelInfoQuery,
  provider: string,
  model: string,
): Promise<readonly ModelModality[] | undefined> {
  return resolveModelInfo(provider, model)
    .then(info => info.inputModalities)
    .catch(() => {
      // resolveModelInfo rejects NO_ADAPTER for an unregistered route and
      // INVALID_* for malformed metadata: an unresolvable model is unknown
      // capability, which the gate denies as text-only (negative capability).
      return undefined
    })
}
