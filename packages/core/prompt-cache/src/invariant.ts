/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-prompt-cache`.
 * @module @deepseek-ai/dsh-prompt-cache/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { PromptCache as PromptCacheIface } from '@deepseek-ai/dsh-system-prompt/prompt-cache'

const PACKAGE_NAME = '@deepseek-ai/dsh-prompt-cache'
const PROBE = { scope: undefined, signature: 'invariant-probe', configFingerprint: 'invariant-probe' }

/** Cordis companion plugin name. */
export const name = 'prompt-cache-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Round-trip check: a key set through the service reads back with the same
 * section names in the same order — the contract `SystemPrompt.assemble`
 * relies on when it splices a cached prefix into the assembly. The probe key
 * never collides with a real assembly key (fixed signature), and the probe is
 * invalidated afterwards.
 * @param cache - the mounted prompt-cache service.
 * @param fail - the invariant failure reporter.
 */
export async function verifyRoundTrip(cache: PromptCacheIface, fail: InvariantFailure): Promise<void> {
  const sections = [
    { name: 'a', text: 'A' },
    { name: 'b', text: 'B' },
  ]
  await cache.set(PROBE, sections)
  const served = await cache.get(PROBE)
  if (served === undefined || served.length !== sections.length
    || served.some((s, i) => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- index bounded by the length check above
      return s.name !== sections[i]!.name
    })) {
    fail('prompt-cache round-trip: a set key must read back its section names in order')
  }
  await cache.invalidate(undefined)
}

/**
 * Check the round-trip contract whenever the prompt-cache service is mounted.
 * @param ctx - Cordis context carrying the invariant service.
 * @param fail - reporter bound to the registering package name.
 */
const install: InvariantInstaller = async (ctx: Context, fail: InvariantFailure) => {
  const cache = ctx.reflect.get('promptCache', false) as PromptCacheIface | undefined
  if (cache === undefined) return
  await verifyRoundTrip(cache, fail)
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
