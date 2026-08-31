/** Package-owned invariant companion. @module @deepseek-ai/dsh-api-plugin-market-controller/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-plugin-market-controller'

/** Cordis companion plugin name. */
export const name = 'api-plugin-market-controller-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin-market seam owns catalog sources, install
 * receipts, and their events, while this package only projects its read-only
 * methods onto the wire.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
