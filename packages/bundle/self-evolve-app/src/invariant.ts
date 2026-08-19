/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-self-evolve-app`.
 * @module @deepseek-ai/dsh-self-evolve-app/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-self-evolve-app'

/** Cordis companion plugin name. */
export const name = 'self-evolve-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle patch and glue plugin hold no mutable state
 * of their own, and every contribution lands in an owning registry.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
