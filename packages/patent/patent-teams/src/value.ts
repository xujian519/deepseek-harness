/**
 * Shared predicates for values read from durable JSON records.
 *
 * The state and mailbox readers validate the same primitive shapes instead of
 * maintaining separate copies.
 * @module dsh-patent-teams/value
 */

/**
 * Whether a value is a finite number.
 * @param value - any value read from a durable record.
 * @returns true when the value is a finite number.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
