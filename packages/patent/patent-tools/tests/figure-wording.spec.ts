import { describe, expect, it } from 'vitest'
import { figureWordingWarnings } from '../src/figure/wording-rules.ts'

/**
 * 图面用语检查：依据《专利法实施细则》第二十一条与《专利审查指南》
 * 第一部分第一章 4.3，检查图面词语（非必需注释、中文要求）与参考标号
 * （阿拉伯数字）。
 */
describe('figureWordingWarnings', () => {
  it('合规词语与阿拉伯数字标号不产生警告', () => {
    expect(figureWordingWarnings(
      ['温度传感器', '开始', 'CPU', 'EPROM', 'GB', 'A/D', 'I2C', '5V', '±20', '100', '传感器（Sensor）', ''],
      ['100', '102', 1],
    )).toEqual([])
  })

  it('非必需注释的四类特征各出一条警告', () => {
    const warnings = figureWordingWarnings(['注：仅用于说明', '如图1所示', '外壳长 20mm', '数据校验完成。', 'A面；'], [])
    expect(warnings).toHaveLength(5)
    expect(warnings[0]).toContain('"注：仅用于说明" 疑似非必需注释（注释前缀）')
    expect(warnings[1]).toContain('正文引用')
    expect(warnings[2]).toContain('尺寸标注')
    expect(warnings[3]).toContain('句末标点')
    expect(warnings[4]).toContain('句末标点')
    expect(warnings.every(warning => warning.includes('第二十一条'))).toBe(true)
  })

  it('非中文词语出警告，缩写与非拉丁字母串放行', () => {
    const warnings = figureWordingWarnings(['Input Sensor', 'controller', 'Section A', '12345'], [])
    expect(warnings).toEqual([
      expect.stringContaining('"Input Sensor" 应当使用中文'),
      expect.stringContaining('"controller" 应当使用中文'),
      expect.stringContaining('"Section A" 应当使用中文'),
    ])
    expect(warnings[0]).toContain('括号里注明原文')
  })

  it('图号入图出警告（图号应标注在附图正下方）', () => {
    const warnings = figureWordingWarnings(['图1', 'FIG. 2', 'Fig. 3A', '图 4'], [])
    expect(warnings).toHaveLength(4)
    expect(warnings[0]).toContain('"图1" 是图号')
    expect(warnings[0]).toContain('正下方')
    expect(warnings[1]).toContain('11.13(k)')
  })

  it('比例标注出非必需注释警告', () => {
    const warnings = figureWordingWarnings(['比例 1:2', 'actual size', 'scale 1/2'], [])
    expect(warnings).toHaveLength(3)
    expect(warnings.every(w => w.includes('比例标注'))).toBe(true)
  })

  it('数字与括号引号连用出警告', () => {
    const warnings = figureWordingWarnings(['壳体（100）', '阀体(102)', '“104”'], [])
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('11.13(e)')
    expect(warnings[0]).toContain('1.84(p)(1)')
  })

  it('多行标签逐行判定，重复词语只提示一次', () => {
    const warnings = figureWordingWarnings(['温度传感器\nnote:', 'note:', '控制单元'], [])
    expect(warnings).toEqual([expect.stringContaining('"note:" 应当使用中文')])
  })

  it('非阿拉伯数字标号出警告并去重，空白标号忽略', () => {
    expect(figureWordingWarnings([], ['S101', 'S101', 'A1', ' 100 ', '  '])).toEqual([
      expect.stringContaining('"S101" 应当使用阿拉伯数字'),
      expect.stringContaining('"A1" 应当使用阿拉伯数字'),
    ])
  })
})
