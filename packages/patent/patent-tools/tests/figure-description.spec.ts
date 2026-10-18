import { describe, expect, it } from 'vitest'
import { figureDescription, figureSentence } from '../src/figure/figure-description.ts'

describe('figureSentence', () => {
  it('有发明名称时写入「……的」限定语，缺省或空白时省略', () => {
    expect(figureSentence(1, '流程图', '温控装置')).toBe('图1是本发明实施例提供的温控装置的流程图')
    expect(figureSentence(2, '结构示意图', '  ')).toBe('图2是本发明实施例提供的结构示意图')
    expect(figureSentence(3, '电路原理图')).toBe('图3是本发明实施例提供的电路原理图')
  })

  it('面板后缀写在图号之后', () => {
    expect(figureSentence(1, '主视图', '装置', 'A')).toBe('图1A是本发明实施例提供的装置的主视图')
  })
})

describe('figureDescription', () => {
  it('无标号清单时只写句子并以句号收束', () => {
    expect(figureDescription({ figureNumber: 1, figureTypeName: '流程图' })).toBe('图1是本发明实施例提供的流程图。')
    expect(figureDescription({
      figureNumber: 2,
      figureTypeName: '结构示意图',
      inventionName: '装置',
      numerals: [],
    })).toBe('图2是本发明实施例提供的装置的结构示意图。')
  })

  it('有标号清单时按「编号-名称」列出', () => {
    expect(figureDescription({
      figureNumber: 1,
      figureTypeName: '剖视图',
      inventionName: '减速器',
      suffix: 'B',
      numerals: [{ numeral: '100', label: '壳体' }, { numeral: '102', label: '端盖' }],
    })).toBe('图1B是本发明实施例提供的减速器的剖视图；图中：100-壳体，102-端盖。')
  })
})
