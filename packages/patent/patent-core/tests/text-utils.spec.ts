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

  it('adjacentWords 只豁免紧邻前缀（与 negationWords 的窗口语义相反）', () => {
    // 传空 negationWords 隔离两条通道：命中「窃听」（matchStart=8）时前缀「防」紧邻，
    // 命中的是「赌博」（matchStart=17）时前缀「检测」隔了十余字——前者豁免、后者不豁免。
    const adjacentOnly = { negationWords: [] as string[], adjacentWords: ['防', '检测'] }
    expect(hasNegationContext('本发明提供一种防窃听装置', 8, adjacentOnly)).toBe(true)
    // 中文逗号不在 SENTENCE_BOUNDARIES 内，故这条走的是「窗口内有前缀词但不紧邻」，
    // 而非被句界提前拦下——窗口路径才是本用例要证的区分点。
    expect(hasNegationContext('本系统通过检测用户行为，诱导其参与赌博', 17, adjacentOnly)).toBe(false)
    expect(hasNegationContext('本装置防范风险，可用于赌博', 11, adjacentOnly)).toBe(false)
  })

  it('adjacentWords 先于句界判定（复合词地位不依赖前文）', () => {
    // 「乙。本发明提供防窃听装置」的「防」紧邻命中词，前置句号不该取消「防窃听」的复合词
    // 地位；若把紧邻判定挪到句界检查之后，此用例转红。
    expect(hasNegationContext('乙。本发明提供防窃听装置', 8, { adjacentWords: ['防'] })).toBe(true)
  })

  it('adjacentWords 的空串前缀不豁免（endsWith 对空串恒真，须显式排除）', () => {
    expect(hasNegationContext('本发明涉及窃听', 5, { negationWords: [], adjacentWords: [''] })).toBe(false)
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
