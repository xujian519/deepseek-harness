import { describe, expect, it } from 'vitest'
import {
  SvgAnnotateError,
  annotateSvg,
  DEFAULT_SVG_MAX_BYTES,
} from '../src/figure/svg-annotate.ts'

/** Graphviz 风格的两文本元素 SVG（其一含 tspan 多行）。 */
const SVG = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
<g id="a">
<polygon points="0,0 100,0 100,40 0,40"/>
<text text-anchor="middle" x="50" y="25">Input Sensor</text>
</g>
<g id="b">
<text text-anchor="middle" x="100" y="70"><tspan x="100" dy="0">Central</tspan><tspan x="100" dy="12">Processor</tspan></text>
</g>
</svg>`

describe('annotateSvg', () => {
  it('在匹配文本末尾追加标号：tspan 尾插与 text 尾插', () => {
    const { svg, warnings } = annotateSvg(SVG, [
      { label: 'Input Sensor', numeral: '20' },
      { label: 'Processor', numeral: '100' },
    ])
    expect(svg).toContain('Input Sensor (20)')
    expect(svg).toContain('</tspan>')
    expect(svg).toContain('Processor (100)</tspan>')
    expect(warnings).toEqual([])
  })

  it('同一参考命中多个文本元素（同名组件同号）；未命中项进入 warnings', () => {
    const svgTwo = `${SVG}\n<text>Input Sensor</text>`
    const { svg, warnings } = annotateSvg(svgTwo, [
      { label: 'Input Sensor', numeral: '20' },
      { label: 'Ghost', numeral: '30' },
    ])
    expect(svg.match(/Input Sensor \(20\)/g)?.length).toBe(2)
    expect(warnings).toEqual(['Ghost'])
  })

  it('每个文本元素至多命中一个参考（按传入顺序取首个）', () => {
    const { svg, warnings } = annotateSvg(SVG, [
      { label: 'Sensor', numeral: '20' },
      { label: 'Input Sensor', numeral: '99' },
    ])
    expect(svg).toContain('Input Sensor (20)')
    expect(svg).not.toContain('(99)')
    expect(warnings).toEqual(['Input Sensor'])
  })

  it('无参考时原样返回', () => {
    expect(annotateSvg(SVG, [])).toEqual({ svg: SVG, warnings: [] })
  })

  it('拒绝 DOCTYPE / ENTITY / CDATA / 过大 / 非 SVG', () => {
    expect(() => annotateSvg('<!DOCTYPE svg><svg></svg>', [])).toThrow(SvgAnnotateError)
    expect(() => annotateSvg('<!ENTITY x "y"><svg></svg>', [])).toThrowError(/不安全/)
    expect(() => annotateSvg('<svg><![CDATA[x]]></svg>', [])).toThrowError(/不安全/)
    expect(() => annotateSvg('<svg>' + 'x'.repeat(DEFAULT_SVG_MAX_BYTES + 1) + '</svg>', [])).toThrowError(/过大/)
    expect(() => annotateSvg('<html></html>', [])).toThrowError(/非 SVG/)
  })

  it('数字实体解码后参与匹配（&#32; 空格）', () => {
    const { svg, warnings } = annotateSvg('<svg><text>Input&#32;Sensor</text></svg>', [
      { label: 'Input Sensor', numeral: '20' },
    ])
    expect(svg).toContain('Input&#32;Sensor (20)')
    expect(warnings).toEqual([])
  })

  it('拒绝空 label / 空 numeral；escape 插入字符', () => {
    expect(() => annotateSvg(SVG, [{ label: '  ', numeral: '1' }])).toThrowError(/label 不能为空/)
    expect(() => annotateSvg(SVG, [{ label: 'x', numeral: '  ' }])).toThrowError(/numeral 不能为空/)
    const { svg } = annotateSvg(SVG, [{ label: 'Input Sensor', numeral: 'a&b "c"' }])
    expect(svg).toContain('Input Sensor (a&amp;b &quot;c&quot;)')
  })
})
