/**
 * Legal regulation validity determination (pure functions, no DB dependency).
 *
 * Determines whether a legal regulation, judicial interpretation, or similar
 * normative document is in force at a given point in time, based on its
 * effective date, expiry date, and expired flag.
 * @module @deepseek-ai/dsh-legal-knowledge/shared/validity
 */

import type { LegalRegulationValidity } from '../types.ts'

/** Validity determination input columns. */
export type ValidityInput = {
  /** Effective date (YYYY-MM-DD). */
  effectiveDate?: string | null | undefined
  /** Expiry date (YYYY-MM-DD). */
  expiryDate?: string | null | undefined
  /** Expired flag: 0=in force, 1=expired; undefined means unverified. */
  expired?: number | null | undefined
}

/** Whether a date string is a valid YYYY-MM-DD date. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Valid ISO date passthrough; missing/invalid dates become undefined. */
function isoDateOrUndefined(value: string | null | undefined): string | undefined {
  return value !== null && value !== undefined && isIsoDate(value) ? value : undefined
}

/** Today's UTC date as YYYY-MM-DD. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Resolve the as-of date; throws on invalid input.
 * @param value - caller-supplied date (YYYY-MM-DD); undefined defaults to today.
 * @returns the resolved date string.
 */
export function resolveAsOf(value: string | undefined): string {
  if (value === undefined) return todayIsoDate()
  const trimmed = value.trim()
  if (!isIsoDate(trimmed)) {
    throw new Error(`asOf must be a valid YYYY-MM-DD date (received ${JSON.stringify(value)})`)
  }
  return trimmed
}

/**
 * Determine the validity status of a regulation at a given point in time.
 *
 * Rules (strongest to weakest):
 * 1. expired=1 or expiryDate < asOf → expired
 * 2. effectiveDate > asOf → not yet effective
 * 3. any valid date column present and not matched above → in force
 * 4. all columns missing → unverified
 * @param input - validity columns.
 * @param asOf - point-in-time date (YYYY-MM-DD).
 * @returns the validity status.
 */
export function resolveValidity(input: ValidityInput, asOf: string): LegalRegulationValidity {
  if (input.expired === 1) return 'expired'
  const effective = isoDateOrUndefined(input.effectiveDate)
  const expiry = isoDateOrUndefined(input.expiryDate)
  if (expiry !== undefined && asOf > expiry) return 'expired'
  if (effective !== undefined && asOf < effective) return 'not-yet-effective'
  if (effective !== undefined || expiry !== undefined || input.expired === 0) return 'in-force'
  return 'unverified'
}

/**
 * Whether a record with the given validity should be visible in search results.
 * Expired and not-yet-effective records are hidden; unverified records are
 * visible only when includeUnverified is true.
 * @param validity - the validity status.
 * @param includeUnverified - whether to include unverified records.
 * @returns whether the record is visible.
 */
export function isVisible(validity: LegalRegulationValidity, includeUnverified: boolean): boolean {
  if (validity === 'expired' || validity === 'not-yet-effective') return false
  if (validity === 'unverified') return includeUnverified
  return true
}
