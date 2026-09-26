/**
 * Money arithmetic in 分 (fen, one hundredth of a yuan).
 *
 * Every amount is carried as an integer number of 分 so additions and
 * percentages stay exact; amounts enter as decimal yuan strings, which is how a
 * fee standard is written down. Percentages round half up to the nearest 分 —
 * an arithmetic convention of this package, stated once here rather than
 * reproduced at each call site.
 * @module @deepseek-ai/dsh-patent-fees/money
 */

/** Decimal yuan: digits with at most two decimal places, no sign, no exponent. */
const YUAN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/

/**
 * Parse a decimal yuan amount into 分.
 * @param value - the amount as written, e.g. `900` or `94.5`.
 * @returns the amount in 分, or null when the text is not a decimal yuan amount.
 */
export function parseYuan(value: string): number | null {
  if (!YUAN.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(fen) ? fen : null
}

/**
 * Format 分 as decimal yuan with two decimal places.
 * @param fen - the amount in 分.
 * @returns the amount in yuan, e.g. `94.50`.
 */
export function formatFen(fen: number): string {
  const sign = fen < 0 ? '-' : ''
  const absolute = Math.abs(fen)
  return `${sign}${String(Math.floor(absolute / 100))}.${String(absolute % 100).padStart(2, '0')}`
}

/**
 * Apply a percentage to an amount in 分.
 * @param fen - the base amount in 分.
 * @param percent - the percentage to take; `100` returns the base.
 * @returns the rounded result in 分.
 */
export function applyPercent(fen: number, percent: number): number {
  return Math.round((fen * percent) / 100)
}

/**
 * Add amounts in 分.
 * @param values - the amounts to add.
 * @returns the sum in 分.
 */
export function sumFen(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
