import { describe, expect, it } from 'vitest'
import { describePeriod, periodEnd, PeriodError } from '../src/period.ts'

describe('period arithmetic (专利法实施细则第5条)', () => {
  it('ends a day period N days after the start, not counting the start day', () => {
    // 审查指南第五部分第七章第2.3节: 2008-06-06 发文, 邮寄推定收到日 2008-06-21.
    expect(periodEnd({ year: 2008, month: 6, day: 6 }, { unit: 'day', count: 15 }))
      .toEqual({ year: 2008, month: 6, day: 21 })
    expect(periodEnd({ year: 2026, month: 1, day: 1 }, { unit: 'day', count: 1 }))
      .toEqual({ year: 2026, month: 1, day: 2 })
  })

  it('ends a year period on the corresponding day', () => {
    // 审查指南第五部分第七章第2.3节: 申请日 1998-06-01, 实审请求期限届满日 2001-06-01.
    expect(periodEnd({ year: 1998, month: 6, day: 1 }, { unit: 'year', count: 3 }))
      .toEqual({ year: 2001, month: 6, day: 1 })
  })

  it('uses the last day of the month when there is no corresponding day', () => {
    // 审查指南第五部分第七章第2.3节: 推定收到日 1999-12-31, 指定期限2个月,
    // 届满日 2000-02-29. A plain month addition would produce 2000-03-02.
    expect(periodEnd({ year: 1999, month: 12, day: 31 }, { unit: 'month', count: 2 }))
      .toEqual({ year: 2000, month: 2, day: 29 })
    expect(periodEnd({ year: 2025, month: 1, day: 31 }, { unit: 'month', count: 1 }))
      .toEqual({ year: 2025, month: 2, day: 28 })
    expect(periodEnd({ year: 2026, month: 8, day: 31 }, { unit: 'month', count: 6 }))
      .toEqual({ year: 2027, month: 2, day: 28 })
  })

  it('ends a 20-year term on the filing anniversary', () => {
    expect(periodEnd({ year: 2023, month: 10, day: 1 }, { unit: 'year', count: 20 }))
      .toEqual({ year: 2043, month: 10, day: 1 })
  })

  it('rejects non-positive or fractional periods', () => {
    expect(() => periodEnd({ year: 2026, month: 1, day: 1 }, { unit: 'month', count: 0 })).toThrow(PeriodError)
    expect(() => periodEnd({ year: 2026, month: 1, day: 1 }, { unit: 'month', count: 1.5 })).toThrow(/正整数/)
  })

  it('describes periods for report labels', () => {
    expect(describePeriod({ unit: 'month', count: 2 })).toBe('2个月')
    expect(describePeriod({ unit: 'year', count: 3 })).toBe('3年')
    expect(describePeriod({ unit: 'day', count: 15 })).toBe('15日')
  })
})
