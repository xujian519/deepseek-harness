import { describe, expect, it } from 'vitest'
import { evaluateQuality } from '../src/quality-evaluator.ts'

describe('evaluateQuality', () => {
  it('reports the four dimensions of a plain paragraph and their mean', () => {
    expect(evaluateQuality('正文。')).toEqual({
      dimensions: { structure: 55, citation: 50, argument: 40, terminology: 60 },
      overall: 51.25,
    })
  })

  it('scores an empty passage at the dimension bases', () => {
    expect(evaluateQuality('')).toEqual({
      dimensions: { structure: 50, citation: 50, argument: 40, terminology: 60 },
      overall: 50,
    })
  })

  it('scores structure by heading levels and paragraph count', () => {
    expect(evaluateQuality('# 标题\n\n正文').dimensions.structure).toBe(70)
    expect(evaluateQuality('正文\n\n## 小标题').dimensions.structure).toBe(70)
    expect(evaluateQuality('甲\n\n乙').dimensions.structure).toBe(55)
    expect(evaluateQuality('# 标题\n\n## 小标题\n\n甲\n\n乙\n\n丙').dimensions.structure).toBe(90)
  })

  it('scores citation by statute, decision, and patent-document references', () => {
    expect(evaluateQuality('专利法第22条第3款').dimensions.citation).toBe(65)
    expect(evaluateQuality('第12345号决定').dimensions.citation).toBe(65)
    expect(evaluateQuality('对比文件CN1234567A').dimensions.citation).toBe(60)
    expect(evaluateQuality('专利法第22条、CN1、以及第9号决定').dimensions.citation).toBe(90)
  })

  it('penalizes citation only past three attributions', () => {
    expect(evaluateQuality('根据根据根据').dimensions.citation).toBe(50)
    expect(evaluateQuality('根据根据根据根据').dimensions.citation).toBe(45)
  })

  it('scores argument by connectors and evidence, less filler', () => {
    expect(evaluateQuality('因此因为然而但是虽然如果则').dimensions.argument).toBe(75)
    expect(evaluateQuality('对比文件、实施例、附图、实验、测试、数据').dimensions.argument).toBe(70)
    expect(evaluateQuality('进一步地此外').dimensions.argument).toBe(30)
    expect(evaluateQuality('进一步地此外值得一提的是显而易见地').dimensions.argument).toBe(20)
    expect(evaluateQuality('因此因为然而但是虽然如果则对比文件实施例附图实验测试数据').dimensions.argument).toBe(95)
  })

  it('scores terminology by domain terms, less commercial or absolute wording', () => {
    expect(evaluateQuality('技术特征本领域权利要求技术方案实施例').dimensions.terminology).toBe(85)
    expect(evaluateQuality('技术特征最好').dimensions.terminology).toBe(55)
    expect(evaluateQuality('最好最佳最先进绝对一定').dimensions.terminology).toBe(20)
  })

  it('separates a structured office-action reply from filler prose', () => {
    const reply = [
      '# 答复',
      '',
      '## 区别特征',
      '',
      '审查员认定对比文件1为最接近现有技术。因此，本申请实际解决的技术问题是热交换效率。根据审查指南，对比文件2未给出结合启示。',
      '',
      '## 结论',
      '',
      '综上，权利要求1具备创造性。',
    ].join('\n')
    expect(evaluateQuality(reply)).toEqual({
      dimensions: { structure: 85, citation: 50, argument: 50, terminology: 65 },
      overall: 62.5,
    })
    const filler = evaluateQuality('进一步地，此外，最好')
    expect(filler.overall).toBeLessThan(evaluateQuality(reply).overall)
    expect(filler.dimensions).toEqual({ structure: 55, citation: 50, argument: 30, terminology: 50 })
  })
})
