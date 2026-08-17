/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-knowledge`.
 * @module @deepseek-ai/dsh-patent-knowledge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-knowledge'

/** Cordis companion plugin name. */
export const name = 'patent-knowledge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the knowledge seam serves read-only queries over an
 * external knowledge.db and owns no durable package-local session event stream;
 * model-visible and session-log relations belong to the tool layer that
 * consumes these queries.
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
