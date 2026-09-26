/**
 * Function plugin registering `patent_fees`: pricing a case's official fees
 * against the fee index shipped with this package.
 *
 * The index is loaded at plugin load, so a missing or malformed asset fails the
 * deployment instead of silently turning the tool into one that reports every
 * case as priced.
 * @module @deepseek-ai/dsh-patent-fees
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadFeeTable } from './fees.ts'
import { createPatentFeesTool } from './tool/patent-fees.ts'
import { DEFAULT_FEE_POLICY } from './compute.ts'

// Public library API: the index loader, the money arithmetic, the pricing engine,
// and the tool factory.
export { feeTablePath, FEE_FILE_NAME } from './asset-location.ts'
export { DEFAULT_FEE_POLICY, computeFees, type ComputeOptions, type FeePolicy } from './compute.ts'
export { FEE_BASES, FEE_TRIGGERS, FeeTableError, loadFeeTable, parseFeeTable, PATENT_TYPES, REDUCTION_KINDS } from './fees.ts'
export { applyPercent, formatFen, parseYuan, sumFen } from './money.ts'
export {
  createPatentFeesTool,
  PatentFeesToolError,
  type FeeLineValue,
  type PatentFeesInput,
  type PatentFeesOutput,
  type PatentFeesToolOptions,
  type PendingFeeValue,
} from './tool/patent-fees.ts'
export type {
  AmountStatus,
  AnnuityTier,
  FeeBasis,
  FeeItem,
  FeeLine,
  FeeValueSource,
  FeeQuery,
  FeeReport,
  FeeTable,
  FeeTotal,
  FeeTrigger,
  LatePaymentRule,
  PatentType,
  PendingFee,
  ReductionKind,
  ReductionOutcome,
  ReductionRequest,
  ReductionRule,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'patent-fees'

/** Services the plugin requires before registration. */
export const inject = ['tools']

/** Model-facing patent-fees plugin configuration. */
export interface Config {
  /** Path of the fee-index YAML file; defaults to the packaged index. */
  feeTablePath?: string
  /**
   * Withhold a total while any applicable line lacks a verified amount. Turning
   * it off reports a partial sum over the verified lines only, labelled as such.
   */
  failOnUnverified: boolean
}

/** Schemastery configuration: index override and the total policy. */
export const Config: z<Config> = z.object({
  feeTablePath: z.string(),
  failOnUnverified: z.boolean().default(DEFAULT_FEE_POLICY.failOnUnverified),
})

/**
 * Register the patent_fees tool over the configured fee index.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - index override and the total policy.
 */
export function apply(ctx: Context, config: Config): void {
  const table = loadFeeTable(config.feeTablePath)
  ctx.tools.register(createPatentFeesTool({ table, policy: { failOnUnverified: config.failOnUnverified } }))
}
