/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-patent-core`.
 * @module @deepseek-ai/dsh-patent-core/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-patent-core'

/** Cordis companion plugin name. */
export const name = 'patent-core-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the library is pure computation over caller-owned inputs
 * and owns no durable package-local state; every contribution (atoms, ModelPort
 * adapter, rule protocol types, checker, problem, evidence, reasoning,
 * claim-chart engine, graph engine + checkpoint, IPC lookup) is stateless or
 * writes only caller-owned on-disk artifacts.
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
