/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-browser-backend`.
 * @module @deepseek-ai/dsh-browser-backend/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-browser-backend'

/** Cordis companion plugin name. */
export const name = 'browser-backend-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: browser-backend probes and routing are stateless
 * read-only operations with no package-owned durable state; the download tools
 * that consume the routed backend own their execution relations.
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
