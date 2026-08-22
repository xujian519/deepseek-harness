/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-synapse`.
 * @module @deepseek-ai/dsh-host-synapse/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-synapse'

/** Cordis companion plugin name. */
export const name = 'synapse-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the canvas graph is derived, reconstructable UI state
 * whose truth lives in the DSH SessionStore; the store itself enforces its
 * only owned relationships (unique-by-session nodes, acyclic fork anchors) at
 * mutation time, and the projection replays committed logs rather than
 * publishing an independent raw-event stream.
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
