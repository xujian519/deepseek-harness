/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-self-evolve-basic`.
 *
 * No runtime invariant: this provider is the sole producer of the
 * `self-evolve/*` durable bracket, whose start→end pairing and
 * proposed/validated/commit ordering the `@deepseek-ai/dsh-self-evolve`
 * seam invariant already validates. Its package-owned state
 * (`$DSH_HOME/self-evolve/*.jsonl`, `l2-archive/`) is a derived side-effect of
 * that lifecycle, read back via `readJsonlRows` rather than forming a sequence
 * an invariant can observe without scanning the filesystem.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-self-evolve-basic'

export const name = 'self-evolve-basic-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's durable lifecycle is the `self-evolve/*`
 * bracket the seam validates; its `$DSH_HOME/self-evolve/*` files are derived
 * side-effects, not an observable sequence.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
