import { describe, expect, it } from 'vitest'
import { DeliveryInputError, resolveDeliveryDate, resolveDeliveryMode } from '../src/delivery.ts'

describe('delivery dates (专利法实施细则第4条)', () => {
  it('defaults to electronic delivery, so the period is counted from the dispatch date', () => {
    expect(resolveDeliveryMode({})).toBe('electronic')
    expect(resolveDeliveryMode({ mode: 'postal' })).toBe('postal')
    const result = resolveDeliveryDate({ dispatchDate: { year: 2026, month: 3, day: 2 } })
    expect(result.date).toEqual({ year: 2026, month: 3, day: 2 })
    expect(result.basis).toContain('发文日为送达日')
    expect(result.basis).toContain('不再加15日')
  })

  it('takes an evidenced entry date over the dispatch date', () => {
    const result = resolveDeliveryDate({
      mode: 'electronic',
      dispatchDate: { year: 2026, month: 3, day: 2 },
      enteredDate: { year: 2026, month: 3, day: 9 },
    })
    expect(result.date).toEqual({ year: 2026, month: 3, day: 9 })
    expect(result.basis).toContain('进入当事人认可的电子系统')
  })

  it('adds 15 days for postal delivery', () => {
    // 审查指南第五部分第七章第2.3节 worked example.
    const result = resolveDeliveryDate({ mode: 'postal', dispatchDate: { year: 2008, month: 6, day: 6 } })
    expect(result.date).toEqual({ year: 2008, month: 6, day: 21 })
    expect(result.basis).toContain('满15日')
  })

  it('prefers an evidenced actual receipt date for postal delivery', () => {
    const result = resolveDeliveryDate({
      mode: 'postal',
      dispatchDate: { year: 2026, month: 3, day: 2 },
      actualReceiptDate: { year: 2026, month: 3, day: 20 },
    })
    expect(result.date).toEqual({ year: 2026, month: 3, day: 20 })
    expect(result.basis).toContain('实际收到日为准')
  })

  it('takes the hand-over date for direct delivery', () => {
    const result = resolveDeliveryDate({ mode: 'personal', handedOverDate: { year: 2026, month: 5, day: 4 } })
    expect(result.date).toEqual({ year: 2026, month: 5, day: 4 })
    expect(result.basis).toContain('交付日')
  })

  it('adds one month for service by publication, clamped to the month end', () => {
    const result = resolveDeliveryDate({ mode: 'publication', publicationDate: { year: 2026, month: 1, day: 31 } })
    expect(result.date).toEqual({ year: 2026, month: 2, day: 28 })
    expect(result.basis).toContain('公告')
  })

  it('fails loud when the mode is missing its date', () => {
    expect(() => resolveDeliveryDate({ mode: 'electronic' })).toThrow(DeliveryInputError)
    expect(() => resolveDeliveryDate({ mode: 'postal' })).toThrow(/邮寄送达需要/)
    expect(() => resolveDeliveryDate({ mode: 'personal' })).toThrow(/直接送交需要/)
    expect(() => resolveDeliveryDate({ mode: 'publication' })).toThrow(/公告送达需要/)
  })
})
