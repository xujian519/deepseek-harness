import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NEGATION_WINDOW,
  DEFAULT_NEGATION_WORDS,
  hasNegationContext,
  parseCnNumber,
} from '@deepseek-ai/dsh-patent-core'

describe('hasNegationContext', () => {
  it('否定词命中（默认窗口与词表）', () => {
    expect(hasNegationContext('本方案避免侵权', 5)).toBe(true)
    expect(hasNegationContext('该方案防止侵权', 5)).toBe(true)
    expect(hasNegationContext('本方案不构成侵权', 6)).toBe(true)
    expect(hasNegationContext('该方法避免了对现有技术的侵权', 12)).toBe(true)
  })

  it('句界分隔否定不跨句', () => {
    expect(hasNegationContext('本方案避免侵权。但需注意侵权风险', 15)).toBe(false)
    expect(hasNegationContext('本方案避免侵权！仍需注意侵权风险', 15)).toBe(false)
    expect(hasNegationContext('本方案避免侵权？仍需注意侵权风险', 15)).toBe(false)
    expect(hasNegationContext('本方案避免侵权\n但需注意侵权风险', 15)).toBe(false)
  })

  it('窗口外否定不算', () => {
    const far = '避免'.padEnd(DEFAULT_NEGATION_WINDOW + 10, '字') + '侵权'
    expect(hasNegationContext(far, far.length - 2)).toBe(false)
  })

  it('复合词吞入的否定词不算（无可避免的侵权仍是侵权陈述）', () => {
    expect(hasNegationContext('使用无可避免的侵权风险', 7)).toBe(false)
    expect(hasNegationContext('存在不可避免的侵权风险', 7)).toBe(false)
  })

  it('自定义词表与窗口（synonym-engine 场景）', () => {
    const custom = ['无法证明', '不具有']
    expect(hasNegationContext('本方案无法证明新颖性', 7, { window: 60, negationWords: custom })).toBe(true)
    expect(hasNegationContext('本方案避免侵权', 5, { window: 60, negationWords: custom })).toBe(false)
  })

  it('默认导出词表与既有镜像一致', () => {
    expect([...DEFAULT_NEGATION_WORDS]).toEqual([
      '防止', '避免', '不用于', '排除', '禁止', '不为', '非用于', '不构成', '区别于', '不属于',
    ])
  })
})

describe('parseCnNumber', () => {
  it('阿拉伯数字直接解析', () => {
    expect(parseCnNumber('82')).toBe(82)
    expect(parseCnNumber('0')).toBe(0)
  })

  it('X十Y 组合', () => {
    expect(parseCnNumber('二十二')).toBe(22)
    expect(parseCnNumber('十')).toBe(10)
    expect(parseCnNumber('一十')).toBe(10)
    expect(parseCnNumber('四十五')).toBe(45)
    expect(parseCnNumber('七十八')).toBe(78)
  })

  it('百位组合（含零占位）', () => {
    expect(parseCnNumber('一百零二')).toBe(102)
    expect(parseCnNumber('二百零五')).toBe(205)
    expect(parseCnNumber('一百二十')).toBe(120)
    expect(parseCnNumber('一百二十六')).toBe(126)
    expect(parseCnNumber('三百四十五')).toBe(345)
    expect(parseCnNumber('一百')).toBe(100)
  })

  it('千位组合', () => {
    expect(parseCnNumber('一千二百三十四')).toBe(1234)
    expect(parseCnNumber('一千零一')).toBe(1001)
  })

  it('非法输入返回 null', () => {
    expect(parseCnNumber('abc')).toBeNull()
    expect(parseCnNumber('十二abc')).toBeNull()
    expect(parseCnNumber('')).toBeNull()
  })
})
