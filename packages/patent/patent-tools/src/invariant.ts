/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-tools`.
 * @module @deepseek-ai/dsh-patent-tools/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-tools'

/** Cordis companion plugin name. */
export const name = 'patent-tools-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the patent tools write no package-owned durable session events beyond the
 * normal tools/result log; workflow-run and plantask events are owned by dsh-patent-workflow, and
 * execution relations are owned by the tool registry the tools register into.
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
