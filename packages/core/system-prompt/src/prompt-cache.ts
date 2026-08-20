/**
 * Prompt-prefix cache contract: the assembly cache slot consumed by
 * `SystemPrompt.assemble()` and implemented by a prompt-cache plugin
 * (`@deepseek-ai/dsh-prompt-cache`). The interface lives here so
 * `dsh-system-prompt` never depends on the implementation package.
 *
 * The cached value is the **assembled text** of a session's contiguous stable
 * prefix sections (uninterpolated — variable interpolation still runs per
 * request). A hit lets `assemble()` skip evaluating the stable providers; the
 * `system-prompt/assemble` waterfall and per-request variable interpolation
 * still run, so listeners keep their semantics.
 *
 * @module @deepseek-ai/dsh-system-prompt/prompt-cache
 */

import { createHash } from 'node:crypto'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** One cached stable section: its resolved (uninterpolated) text. */
export interface CachedPromptSection {
  name: string
  text: string
}

/**
 * Identity of one cached assembly prefix. `signature` covers the stable
 * sections' ordered `(name, order, fingerprint)` only: the cached text is
 * uninterpolated, so current variable values never enter the identity —
 * interpolation runs at render time against the latest values on both hit
 * and miss. `configFingerprint` covers the deployment persona. Any change in
 * either recomputes and rewrites the entry.
 */
export interface PromptCacheKey {
  /** The agent scope the assembly was built for (`undefined` = global). */
  scope: ScopeKey | undefined
  /** Stable-prefix and variable-value fingerprint (see {@link PromptCacheKey}). */
  signature: string
  /** Deployment persona fingerprint. */
  configFingerprint: string
}

/**
 * The assembly-prefix cache surface. `system-prompt` reads it through
 * `ctx.reflect.get('promptCache', false)`; when no strategy is mounted the
 * cache slot is absent and assembly takes the pre-existing path byte-for-byte.
 */
export interface PromptCache {
  /**
   * Resolve one stable prefix.
   * @param key - the cache identity.
   * @returns the cached stable sections, or `undefined` on a miss.
   */
  get(key: PromptCacheKey): Promise<CachedPromptSection[] | undefined>
  /**
   * Persist one stable prefix.
   * @param key - the cache identity.
   * @param sections - the resolved stable sections, in prefix order.
   */
  set(key: PromptCacheKey, sections: readonly CachedPromptSection[]): Promise<void>
  /**
   * Drop every entry belonging to one scope (`undefined` = the global layer).
   * @param scope - the scope whose entries to clear.
   */
  invalidate(scope: ScopeKey | undefined): Promise<void>
}

/** One section's cache fingerprint input: identity plus resolved text. */
export interface SectionFingerprintInput {
  name: string
  order: number
  /** Static text, or the provider's stable identity. */
  fingerprint: string
}

/**
 * Stable identity of one function provider. Function references are assigned
 * a module-lifetime id so a re-registered provider (a new closure) produces a
 * new fingerprint while the same registered provider keeps one across
 * assemblies.
 */
const providerIds = new WeakMap<object, number>()
let nextProviderId = 0

/**
 * Assign or reuse the stable id of one provider function.
 * @param provider - the section text provider.
 * @returns the provider's module-lifetime id.
 */
export function providerIdOf(provider: (...args: never[]) => string): string {
  let id = providerIds.get(provider)
  if (id === undefined) {
    id = nextProviderId++
    providerIds.set(provider, id)
  }
  return `fn#${id}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * The cache signature of one assembly prefix: the ordered stable sections'
 * `(name, order, fingerprint)`. Variable values are deliberately excluded —
 * the cached text is uninterpolated, so any change in them must not
 * invalidate the prefix; the current values are applied at render time
 * regardless of a hit or a miss.
 * @param sections - the contiguous stable prefix sections, in order.
 * @returns the signature string.
 */
export function stablePrefixSignature(
  sections: readonly SectionFingerprintInput[],
): string {
  return sha256(
    sections
      .map(({ name, order, fingerprint }) => `${name}\u0000${order}\u0000${fingerprint}`)
      .join('\u0001'),
  )
}

/**
 * The deployment fingerprint of one assembly: the configured persona text.
 * Scoped persona overrides are already inside the stable-prefix signature as
 * sections; this covers the deployment-wide configuration the registry owns.
 * Today it duplicates the persona section's own fingerprint, and stays in the
 * key as the reserved slot for future non-section deployment configuration.
 * @param persona - the configured deployment persona.
 * @returns the persona fingerprint.
 */
export function configFingerprintOf(persona: string): string {
  return sha256(persona)
}
