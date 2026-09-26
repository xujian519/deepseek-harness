import { describe, expect, it } from 'vitest'
import { applyPercent, formatFen, parseYuan, sumFen } from '../src/money.ts'

describe('money', () => {
  it('parses decimal yuan into 分', () => {
    expect(parseYuan('900')).toBe(90000)
    expect(parseYuan('94.5')).toBe(9450)
    expect(parseYuan('94.50')).toBe(9450)
    expect(parseYuan('0')).toBe(0)
    expect(parseYuan('0.01')).toBe(1)
  })

  it('rejects text that is not a decimal yuan amount', () => {
    for (const rejected of ['', '01', '1.234', '.5', '1e3', '-5', '1,000', '一元']) {
      expect(parseYuan(rejected)).toBeNull()
    }
  })

  it('rejects an amount too large for exact integer arithmetic', () => {
    expect(parseYuan('99999999999999999')).toBeNull()
  })

  it('formats 分 as yuan', () => {
    expect(formatFen(0)).toBe('0.00')
    expect(formatFen(5)).toBe('0.05')
    expect(formatFen(9450)).toBe('94.50')
    expect(formatFen(90000)).toBe('900.00')
    expect(formatFen(-150)).toBe('-1.50')
  })

  it('applies a percentage, rounding half up to the 分', () => {
    expect(applyPercent(90000, 15)).toBe(13500)
    expect(applyPercent(123, 5)).toBe(6)
    expect(applyPercent(123, 50)).toBe(62)
    expect(applyPercent(100, 100)).toBe(100)
  })

  it('sums 分', () => {
    expect(sumFen([])).toBe(0)
    expect(sumFen([1, 2, 300])).toBe(303)
  })
})
