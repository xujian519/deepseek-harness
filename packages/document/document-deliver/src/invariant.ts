/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-document-deliver`.
 * @module @deepseek-ai/dsh-document-deliver/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-document-deliver'

/** Cordis companion plugin name. */
export const name = 'document-deliver-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the tool writes no package-owned durable session
 * events beyond the normal tool/call and tool/result log; the tool/result
 * log is owned by the tool registry, and nothing outside this package reads
 * the registered files.
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
