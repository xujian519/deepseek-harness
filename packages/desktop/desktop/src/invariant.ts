/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-desktop`.
 * @module @deepseek-ai/dsh-desktop/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop'

/** Cordis companion plugin name. */
export const name = 'desktop-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package declares the `ctx.desktop` Service
 * Definition as pure types plus a closed error vocabulary and owns no runtime
 * state to observe. Providers assert their own bridge state through typed
 * `DesktopError` failures at the call boundary.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
