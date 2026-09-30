import { describe, expect, it } from 'vitest'
import { applyStructureLineStyle, STRUCTURE_LINE_WIDTH_SERIES } from '../src/figure/structure-svg-postprocess.ts'
import { measureInkBounds } from '../src/figure/render-check.ts'
import { SvgAnnotateError } from '../src/figure/svg-annotate.ts'

/**
 * 结构线稿线宽/线型后处理：FreeCAD 1.1.3 的 `viewPartAsSvg` 片段结构（本机实测）——
 * 可见线一组 `stroke-width="0.7"`、隐藏线一组 `stroke-width="0.35"`，全篇无
 * `stroke-dasharray`；开隐藏线时两组，否则一组。
 */

const GROUP = 'fill="none" stroke="#000000" stroke-opacity="1" stroke-width="W" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4"'

/** 按实测形态拼一个视图 SVG（可见线 + 可选隐藏线 + 一条件号引线）。 */
function viewSvg(options: { hidden?: boolean; visibleWidth?: number; hiddenWidth?: number } = {}): string {
  const visible = GROUP.replace('W', String(options.visibleWidth ?? 0.7))
  const hidden = GROUP.replace('W', String(options.hiddenWidth ?? 0.35))
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-30 -30 60 60" width="60mm" height="60mm">',
    '<g transform="scale(1,-1)">',
    `<g ${visible}><path id= "1" d=" M -20 12 L 20 12 " /><circle cx ="0" cy ="0" r ="6" /></g>`,
    ...(options.hidden === false ? [] : [`<g ${hidden}><path id= "1" d=" M -20 -12 L 20 -12 " /></g>`]),
    '</g>',
    '<line x1="0" y1="0" x2="20" y2="20" stroke="#000000" stroke-width="0.5" fill="none"/>',
    '<text x="20" y="22" font-size="5" font-family="sans-serif" text-anchor="middle" fill="#000000" stroke="none">100</text>',
    '</svg>',
  ].join('')
}

/** 取出各描边分组的线宽与虚线取值。 */
function groups(svg: string): { width: string; dash?: string }[] {
  return [...svg.matchAll(/<g\b[^>]*stroke-width="([^"]*)"[^>]*>/g)].map((match) => {
    const tag = match[0]
    return {
      width: match[1] as string,
      ...(/stroke-dasharray="([^"]*)"/.exec(tag) === null ? {} : { dash: /stroke-dasharray="([^"]*)"/.exec(tag)?.[1] as string }),
    }
  })
}

describe('applyStructureLineStyle', () => {
  it('缺省参数不改写：逐字节一致且无提示', () => {
    const svg = viewSvg()
    expect(applyStructureLineStyle(svg, {})).toEqual({ svg, warnings: [] })
    expect(applyStructureLineStyle(svg, { hiddenLineStyle: 'solid' })).toEqual({ svg, warnings: [] })
  })

  it('line_width_mm 只改可见线一组，隐藏线、引线与文字原样保留', () => {
    const svg = viewSvg()
    const { svg: out, warnings } = applyStructureLineStyle(svg, { lineWidthMm: 0.5 })
    expect(warnings).toEqual([])
    expect(groups(out)).toEqual([{ width: '0.5' }, { width: '0.35' }])
    expect(out).toContain('<line x1="0" y1="0" x2="20" y2="20" stroke="#000000" stroke-width="0.5" fill="none"/>')
    expect(out).toContain('>100</text>')
    // 顶点未动：墨迹包围盒逐值相同。
    expect(measureInkBounds(out)).toEqual(measureInkBounds(svg))
  })

  it('hidden_line_style=dashed 只给隐藏线加虚线，画长/间隔随该组线宽等比', () => {
    const svg = viewSvg()
    const { svg: out, warnings } = applyStructureLineStyle(svg, { hiddenLineStyle: 'dashed' })
    expect(warnings).toEqual([])
    // 0.35 组：画长 12×0.35=4.2、间隔 3×0.35=1.05。
    expect(groups(out)).toEqual([{ width: '0.7' }, { width: '0.35', dash: '4.2 1.05' }])
    expect(out).toContain('stroke-dasharray')
    // 引线未变虚（它不在几何分组里）。
    expect(out).toMatch(/<line [^>]*stroke-width="0.5"[^>]*\/>/)
    expect(out).not.toMatch(/<line [^>]*stroke-dasharray/)
  })

  it('线宽与线型可同用：可见线改宽、隐藏线变虚', () => {
    const { svg: out } = applyStructureLineStyle(viewSvg(), { lineWidthMm: 1, hiddenLineStyle: 'dashed' })
    expect(groups(out)).toEqual([{ width: '1' }, { width: '0.35', dash: '4.2 1.05' }])
  })

  it('按测试的实测形态：自由档位（0.25/0.13）同样识别为可见/隐藏', () => {
    const { svg: out } = applyStructureLineStyle(
      viewSvg({ visibleWidth: 0.25, hiddenWidth: 0.13 }),
      { lineWidthMm: 0.7, hiddenLineStyle: 'dashed' },
    )
    expect(groups(out)).toEqual([{ width: '0.7' }, { width: '0.13', dash: '1.56 0.39' }])
  })

  it('没有带 stroke-width 的分组时告警且原样返回', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g fill="none"><path d="M0 0 L10 10"/></g></svg>'
    const result = applyStructureLineStyle(svg, { lineWidthMm: 0.5 })
    expect(result.svg).toBe(svg)
    expect(result.warnings.join('\n')).toContain('未找到带可用 stroke-width 的几何分组')
  })

  it('stroke-width 不是数时跳过该组并告警', () => {
    const svg = viewSvg().replace('stroke-width="0.35"', 'stroke-width="auto"')
    const { svg: out, warnings } = applyStructureLineStyle(svg, { hiddenLineStyle: 'dashed' })
    expect(warnings.join('\n')).toContain('stroke-width 不是数')
    expect(out).toContain('stroke-width="auto"')
  })

  it('只有一组线时请求虚线：告警且不加 dasharray', () => {
    const svg = viewSvg({ hidden: false })
    const { svg: out, warnings } = applyStructureLineStyle(svg, { hiddenLineStyle: 'dashed' })
    expect(warnings.join('\n')).toContain('未发现比可见线更细的线组')
    expect(out).not.toContain('stroke-dasharray')
  })

  it('可见线宽不大于隐藏线宽时告警粗细层级倒置', () => {
    const { warnings } = applyStructureLineStyle(viewSvg(), { lineWidthMm: 0.25 })
    expect(warnings.join('\n')).toContain('线宽的粗细层级已倒置')
    expect(applyStructureLineStyle(viewSvg(), { lineWidthMm: 0.7 }).warnings).toEqual([])
  })

  it('输入不安全结构时抛 SvgAnnotateError', () => {
    expect(() => applyStructureLineStyle('<svg xmlns="http://www.w3.org/2000/svg"><!ENTITY x "y"></svg>', { lineWidthMm: 0.5 }))
      .toThrow(SvgAnnotateError)
  })

  it('线宽系列与 FreeCAD LineGroup.csv 的档位一致', () => {
    expect([...STRUCTURE_LINE_WIDTH_SERIES]).toEqual([0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2])
  })
})
