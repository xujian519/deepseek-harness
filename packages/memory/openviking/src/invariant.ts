/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-openviking`.
 * @module @deepseek-ai/dsh-openviking/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-openviking'

/** Cordis companion plugin name. */
export const name = 'openviking-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: recall/capture/commit are pure consumers of the
 * session event stream and the prompt registry — the agent/session layers
 * own durable context admission, and StateStore owns the only mutable data
 * plane (seq bookkeeping), whose monotonicity and atomic replacement are
 * enforced at its own boundary and asserted by its unit suite.
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
