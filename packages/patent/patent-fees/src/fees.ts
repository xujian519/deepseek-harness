/**
 * Load and validate the shipped fee index.
 *
 * The index carries what a case can be priced against: which fee items exist,
 * the step each is owed at, how its quantity is counted, and the transcription
 * record of its amount (`amount`, `sourceDoc`, `effectiveFrom`, `verifiedOn`). A
 * missing or malformed file fails the plugin load, because a tool that silently
 * ran with no fee index would report every case as priced.
 * @module @deepseek-ai/dsh-patent-fees/fees
 */

import { readFileSync } from 'node:fs'
import {
  IndexAssetError,
  parseYamlMapping,
  readCount,
  readEnum,
  readMapping,
  readOptionalBoolean,
  readOptionalCount,
  readOptionalDate,
  readOptionalString,
  readRecordedSource,
  readString,
  type AssetFail,
} from '@deepseek-ai/dsh-patent-index-asset'
import { feeTablePath } from './asset-location.ts'
import { parseYuan } from './money.ts'
import type {
  AnnuityTier,
  FeeBasis,
  FeeItem,
  FeeTable,
  FeeTrigger,
  LatePaymentRule,
  PatentType,
  FeeValueSource,
  ReductionKind,
  ReductionRule,
} from './types.ts'

/** Thrown when the fee index is missing, unreadable, or malformed. */
export class FeeTableError extends IndexAssetError {
  /**
   * @param message - what is wrong with the asset.
   * @param origin - the file the error came from.
   */
  constructor(message: string, origin: string | null) {
    super(message, origin)
    this.name = 'FeeTableError'
  }
}

/** Steps a fee item may be owed at. */
export const FEE_TRIGGERS: readonly FeeTrigger[] = [
  'filing',
  'substantive-examination',
  'grant-registration',
  'annual-fee',
  'reexamination',
  'invalidation',
  'evaluation-report',
  'restoration',
  'extension',
  'record-change',
  'pct-grace',
]

/** Ways a quantity may be counted. */
export const FEE_BASES: readonly FeeBasis[] = [
  'per-case',
  'per-claim-beyond',
  'per-page-beyond',
  'per-priority',
  'per-annuity-year',
  'per-month',
]

/** Patent types an item may apply to. */
export const PATENT_TYPES: readonly PatentType[] = ['invention', 'utility-model', 'design']

/** Reduction programmes the index may carry. */
export const REDUCTION_KINDS: readonly ReductionKind[] = ['individual', 'enterprise']

/** Bases that count units beyond the item's free base. */
const BEYOND_BASES: readonly FeeBasis[] = ['per-claim-beyond', 'per-page-beyond']

/**
 * Load the fee index.
 * @param tablePath - path override; defaults to the packaged file.
 * @returns the parsed table.
 * @throws FeeTableError when the file is unreadable or malformed.
 */
export function loadFeeTable(tablePath?: string): FeeTable {
  const path = feeTablePath(tablePath)
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    throw new FeeTableError(`费用索引不可读：${path}（${(error as Error).message}）`, path)
  }
  return parseFeeTable(source, path)
}

/**
 * Parse one fee-index file.
 * @param source - the file's text.
 * @param origin - the file path, used in error messages.
 * @returns the parsed table.
 * @throws FeeTableError when a required field is missing or malformed.
 */
export function parseFeeTable(source: string, origin: string): FeeTable {
  const fail: AssetFail = message => new FeeTableError(message, origin)
  const root = parseYamlMapping(source, '费用索引', fail)
  return {
    document: readString(root, 'document', fail),
    revision: readOptionalString(root, 'revision', fail),
    currency: readString(root, 'currency', fail),
    ...readValueSource(root, fail),
    reductions: readReductions(root['reductions'], fail),
    items: readItems(root['items'], fail),
  }
}

/** Read a mapping's recorded source plus the date the standard took effect. */
function readValueSource(mapping: Record<string, unknown>, fail: AssetFail): FeeValueSource {
  return { ...readRecordedSource(mapping, fail), effectiveFrom: readOptionalDate(mapping, 'effectiveFrom', fail) }
}

/** Read an amount field: null while untranscribed, otherwise a decimal yuan amount. */
function readOptionalAmount(root: Record<string, unknown>, field: string, fail: AssetFail): string | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || parseYuan(text) === null) {
    throw fail(`字段 ${field} 必须是 null 或元金额（最多两位小数），得到：${JSON.stringify(value)}`)
  }
  return text
}

/** Read a percentage in (0, 100]. */
function readPercent(value: unknown, where: string, fail: AssetFail): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
    throw fail(`${where} 必须是 (0, 100] 之间的百分数，得到：${JSON.stringify(value)}`)
  }
  return value
}

/** Read the optional patent-type list. */
function readPatentTypes(value: unknown, fail: AssetFail): PatentType[] | null {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || value.length === 0) {
    throw fail('patentTypes 必须是 null 或非空数组')
  }
  const types = value.map(item => readEnum(item, PATENT_TYPES, 'patentTypes 的取值', fail))
  if (new Set(types).size !== types.length) throw fail('patentTypes 有重复取值')
  return types
}

/** Read the reduction programmes. */
function readReductions(value: unknown, fail: AssetFail): ReductionRule[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail('字段 reductions 必须是数组')
  const seen = new Set<ReductionKind>()
  return value.map((raw) => {
    const mapping = readMapping(raw, 'reductions 的每一项', fail)
    const kind = readEnum(mapping['kind'], REDUCTION_KINDS, 'reductions.kind', fail)
    if (seen.has(kind)) throw fail(`reductions 重复声明了 ${kind}`)
    seen.add(kind)
    const requiresFiling = mapping['requiresFiling']
    if (typeof requiresFiling !== 'boolean') throw fail('reductions.requiresFiling 必须是布尔值')
    const percent = mapping['reductionPercent']
    return {
      kind,
      label: readString(mapping, 'label', fail),
      reductionPercent: percent === undefined || percent === null
        ? null
        : readPercent(percent, `reductions.${kind}.reductionPercent`, fail),
      requiresFiling,
      ...readValueSource(mapping, fail),
    }
  })
}

/** Read the fee items, rejecting duplicate ids. */
function readItems(value: unknown, fail: AssetFail): FeeItem[] {
  if (value === undefined || value === null || !Array.isArray(value) || value.length === 0) {
    throw fail('字段 items 必须是非空数组')
  }
  const seen = new Set<string>()
  return value.map((raw) => {
    const mapping = readMapping(raw, 'items 的每一项', fail)
    const id = readString(mapping, 'id', fail)
    if (seen.has(id)) throw fail(`费用条目 id 重复：${id}`)
    seen.add(id)
    const basis = readEnum(mapping['basis'], FEE_BASES, `${id}.basis`, fail)
    const freeUnits = readOptionalCount(mapping, 'freeUnits', fail)
    if (BEYOND_BASES.includes(basis) && freeUnits === null) {
      throw fail(`${id} 的 basis 为 ${basis} 时必须给出 freeUnits`)
    }
    if (freeUnits !== null && !BEYOND_BASES.includes(basis)) {
      throw fail(`${id} 的 basis 为 ${basis} 时不得给出 freeUnits`)
    }
    return {
      id,
      name: readString(mapping, 'name', fail),
      trigger: readEnum(mapping['trigger'], FEE_TRIGGERS, `${id}.trigger`, fail),
      patentTypes: readPatentTypes(mapping['patentTypes'], fail),
      basis,
      ...(freeUnits === null ? {} : { freeUnits }),
      amount: readOptionalAmount(mapping, 'amount', fail),
      reducible: readOptionalBoolean(mapping, 'reducible', fail),
      ...readReductionYears(mapping, id, basis, fail),
      tiers: readTiers(mapping['tiers'], id, basis, fail),
      ...readLatePayment(mapping['latePayment'], id, basis, fail),
      legalBasis: readOptionalString(mapping, 'legalBasis', fail),
      ...readValueSource(mapping, fail),
    }
  })
}

/** Read the reduction year cap, which only a year-indexed item may carry. */
function readReductionYears(
  mapping: Record<string, unknown>,
  id: string,
  basis: FeeBasis,
  fail: AssetFail,
): { reductionMaxYears?: number } {
  const years = readOptionalCount(mapping, 'reductionMaxYears', fail)
  if (years === null) return {}
  if (basis !== 'per-annuity-year') {
    throw fail(`${id} 的 basis 为 ${basis} 时不得给出 reductionMaxYears`)
  }
  return { reductionMaxYears: years }
}

/** Read the annual-fee tiers, rejecting overlap. */
function readTiers(value: unknown, id: string, basis: FeeBasis, fail: AssetFail): AnnuityTier[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw fail(`${id}.tiers 必须是数组`)
  if (value.length > 0 && basis !== 'per-annuity-year') {
    throw fail(`${id} 的 basis 为 ${basis} 时不得给出 tiers`)
  }
  const tiers = value.map((raw) => {
    const mapping = readMapping(raw, `${id}.tiers 的每一项`, fail)
    const fromYear = readCount(mapping['fromYear'], `${id}.tiers.fromYear`, fail)
    const toYear = readCount(mapping['toYear'], `${id}.tiers.toYear`, fail)
    if (toYear < fromYear) {
      throw fail(`${id}.tiers 的 toYear 不得早于 fromYear（${String(fromYear)}–${String(toYear)}）`)
    }
    const amount = readOptionalAmount(mapping, 'amount', fail)
    if (amount === null) throw fail(`${id}.tiers 的 amount 必须是元金额`)
    return { fromYear, toYear, amount }
  })
  const sorted = [...tiers].sort((left, right) => left.fromYear - right.fromYear)
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const current = sorted[index]
    if (previous !== undefined && current !== undefined && current.fromYear <= previous.toYear) {
      throw fail(`${id}.tiers 的年度区间重叠：${String(previous.fromYear)}–${String(previous.toYear)} 与 ${String(current.fromYear)}–${String(current.toYear)}`)
    }
  }
  return tiers
}

/** Read the surcharge rule, which only a year-indexed item may carry. */
function readLatePayment(
  value: unknown,
  id: string,
  basis: FeeBasis,
  fail: AssetFail,
): { latePayment?: LatePaymentRule } {
  if (value === undefined || value === null) return {}
  if (basis !== 'per-annuity-year') {
    throw fail(`${id} 的 basis 为 ${basis} 时不得给出 latePayment`)
  }
  const mapping = readMapping(value, `${id}.latePayment`, fail)
  return {
    latePayment: {
      monthlyPercent: readPercent(mapping['monthlyPercent'], `${id}.latePayment.monthlyPercent`, fail),
      maxMonths: readCount(mapping['maxMonths'], `${id}.latePayment.maxMonths`, fail),
      legalBasis: readOptionalString(mapping, 'legalBasis', fail),
      ...readValueSource(mapping, fail),
    },
  }
}
