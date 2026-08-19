/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-self-evolve-basic`.
 *
 * No independent event sequence or mutable-data relation beyond contracts
 * already enforced by the `@deepseek-ai/dsh-self-evolve` seam.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-self-evolve-basic'

export const name = 'self-evolve-basic-invariant'
export const inject = ['invariants']

/** No runtime invariant: the base provider's contracts are already enforced by the `@deepseek-ai/dsh-self-evolve` seam. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
