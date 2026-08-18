/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-data`.
 * @module @deepseek-ai/dsh-patent-data/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-data'

/** Cordis companion plugin name. */
export const name = 'patent-data-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the data seam serves callers on demand and owns no durable package-local
 * event stream; search and ego-browser runs are consumed by the tool layer, which owns the
 * model-visible and session-log relations.
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
