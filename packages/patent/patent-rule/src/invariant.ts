/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-rule`.
 * @module @deepseek-ai/dsh-patent-rule/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-rule'

/** Cordis companion plugin name. */
export const name = 'patent-rule-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no durable package-local event stream.
 * Its effects (the monotonic EVI-011 guards and the tools/post-execute output
 * gate) are enforced and audited by the dsh-tools runtime's own invariant
 * companion, so there is no package-owned event/data relationship to assert.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
