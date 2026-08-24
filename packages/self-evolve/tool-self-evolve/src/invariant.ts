/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-self-evolve`.
 *
 * No runtime invariant: the tool consumer contributes a prompt section and two
 * tools but owns no durable event sequence or mutable data; its model-visible
 * contract is enforced by the `tools`/`systemPrompt` services and the
 * `@deepseek-ai/dsh-self-evolve` seam, which owns the loop bracket.
 *
 * @module @deepseek-ai/dsh-tool-self-evolve/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-self-evolve'

export const name = 'tool-self-evolve-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the tool consumer adds a prompt section and two tools,
 * owning no event sequence or mutable data; the seam owns the loop bracket.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
