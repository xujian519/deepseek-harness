/**
 * Package-owned invariant companion for
 * `@deepseek-ai/dsh-desktop-directory-picker`.
 * @module @deepseek-ai/dsh-desktop-directory-picker/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-desktop-directory-picker'

/** Cordis companion plugin name. */
export const name = 'desktop-directory-picker-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider owns no state; it delegates every pick to
 * `ctx.desktop.showOpenDialog` and converts the response to the directory
 * picker's `string | null` contract at the call boundary.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
