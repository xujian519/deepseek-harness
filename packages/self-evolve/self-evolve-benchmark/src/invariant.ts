/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-self-evolve-benchmark`.
 *
 * No runtime invariant: this provider owns no session-event lifecycle or other
 * observable event bracket. Its durable state — the benchmark store
 * (`scoreboard.yaml`, per-case `statement`/`rubric` files) and versioned
 * snapshots — carries its invariants in the storage layout itself: a case's
 * statement and rubric are physically distinct files, and snapshot versions
 * only ever increase because every round mints a fresh number and a rejected
 * round's archive stays on disk. Nothing here forms a sequence an invariant
 * could observe without scanning the filesystem.
 *
 * @module @deepseek-ai/dsh-self-evolve-benchmark/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-self-evolve-benchmark'

export const name = 'self-evolve-benchmark-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the provider's invariants live in its on-disk storage
 * layout (statement/rubric separation, monotonic snapshot versions), not in an
 * observable event sequence.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
