/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-synapse`.
 * @module @deepseek-ai/dsh-client-synapse/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-synapse'

/** Cordis companion plugin name. */
export const name = 'synapse-client-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser half only renders a view switch and an
 * iframe host, owns no registry or observation stream of its own, and every
 * session relationship it reads comes through the client sessions/workspaces
 * services (which enforce their own contracts).
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
