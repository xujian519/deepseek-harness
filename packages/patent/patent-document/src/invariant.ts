/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-document`.
 * @module @deepseek-ai/dsh-patent-document/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-document'

/** Cordis companion plugin name. */
export const name = 'patent-document-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the render_patent_document tool writes deliverable files to the working tree
 * but emits no package-owned durable session events beyond the normal tools/result log; shipped
 * template assets are validated fail-loud at resolution time by templateResolver.ts.
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
