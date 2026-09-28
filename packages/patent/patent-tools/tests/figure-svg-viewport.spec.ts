import { describe, expect, it } from 'vitest'
import { MM_PER_USER_UNIT, parseLengthMm, resolveSvgViewport } from '../src/figure/svg-viewport.ts'

/** 由属性串构造 `<svg …>` 开始标签。 */
function tag(attributes: string): string {
  return `<svg ${attributes}>`
}

describe('parseLengthMm', () => {
  it('支持物理单位、像素与无单位，拒绝相对值与非法文本', () => {
    expect(parseLengthMm('210mm')).toBe(210)
    expect(parseLengthMm('21cm')).toBe(210)
    expect(parseLengthMm('8.27in')).toBeCloseTo(210.058)
    expect(parseLengthMm('72pt')).toBeCloseTo(25.4)
    expect(parseLengthMm('96px')).toBeCloseTo(25.4)
    expect(parseLengthMm('96')).toBeCloseTo(25.4)
    expect(parseLengthMm(' 12.5 mm ')).toBe(12.5)
    expect(parseLengthMm('50%')).toBeUndefined()
    expect(parseLengthMm('auto')).toBeUndefined()
  })
})

describe('resolveSvgViewport', () => {
  it('无 viewBox：用户单位按 96 dpi 像素换算，原点不动', () => {
    const viewport = resolveSvgViewport(tag('width="800" height="600"'))
    expect(viewport.widthMm).toBeCloseTo(800 * MM_PER_USER_UNIT, 10)
    expect(viewport.heightMm).toBeCloseTo(600 * MM_PER_USER_UNIT, 10)
    expect(viewport.scaleX).toBeCloseTo(MM_PER_USER_UNIT, 12)
    expect(viewport.scaleY).toBeCloseTo(MM_PER_USER_UNIT, 12)
    expect(viewport.originX).toBe(0)
    expect(viewport.originY).toBe(0)
    expect(viewport.note).toBeUndefined()
  })

  it('viewBox 与画布尺寸等比：1 用户单位 1 毫米，原点不动', () => {
    const viewport = resolveSvgViewport(tag('width="210mm" height="297mm" viewBox="0 0 210 297"'))
    expect(viewport.scaleX).toBe(1)
    expect(viewport.scaleY).toBe(1)
    expect(viewport.originX).toBe(0)
    expect(viewport.originY).toBe(0)
    expect(viewport.note).toBeUndefined()
  })

  it('viewBox 用 px 级用户单位（Inkscape 形态）：按 viewBox 换算而不是把 width 数值当毫米', () => {
    const viewport = resolveSvgViewport(tag('width="210mm" height="297mm" viewBox="0 0 744.09 1052.36"'))
    expect(viewport.widthMm).toBe(210)
    // 两轴比例差 4e-6（写出者四舍五入），按 meet 取小值后等比。
    expect(viewport.scaleX).toBeCloseTo(297 / 1052.36, 10)
    expect(viewport.scaleY).toBe(viewport.scaleX)
    // 100 用户单位只占 28.2 毫米，按 width 数值当毫米会算成 100 毫米。
    expect(100 * viewport.scaleX).toBeCloseTo(28.22, 2)
  })

  it('两轴比例不一致时按 preserveAspectRatio 等比对齐（默认 xMidYMid meet）', () => {
    const viewport = resolveSvgViewport(tag('width="100mm" height="50mm" viewBox="0 0 100 100"'))
    // 取小值 0.5 毫米/单位，内容 50×50 毫米居中：x 从 25 毫米起。
    expect(viewport.scaleX).toBe(0.5)
    expect(viewport.scaleY).toBe(0.5)
    expect(viewport.originX).toBe(-50)
    // 内容 x∈[0,100] 映射到 25–75 毫米。
    expect((0 - viewport.originX) * viewport.scaleX).toBeCloseTo(25, 10)
    expect((100 - viewport.originX) * viewport.scaleX).toBeCloseTo(75, 10)
    expect(viewport.note).toBeUndefined()
  })

  it('preserveAspectRatio="xMinYMin meet" 时不居中', () => {
    const viewport = resolveSvgViewport(tag('width="100mm" height="50mm" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin meet"'))
    expect(viewport.scaleX).toBe(0.5)
    expect(viewport.originX).toBe(0)
    expect(viewport.originY).toBe(0)
  })

  it('preserveAspectRatio="none" 两轴各自拉伸并给出近似说明', () => {
    const viewport = resolveSvgViewport(tag('width="100mm" height="50mm" viewBox="0 0 100 100" preserveAspectRatio="none"'))
    expect(viewport.scaleX).toBe(1)
    expect(viewport.scaleY).toBe(0.5)
    expect(viewport.originX).toBe(0)
    expect(viewport.note).toContain('none')
  })

  it('slice 取大值并说明超出视口的内容被裁掉', () => {
    const viewport = resolveSvgViewport(tag('width="100mm" height="50mm" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"'))
    expect(viewport.scaleX).toBe(1)
    expect(viewport.originY).toBe(25)
    expect(viewport.note).toContain('slice')
  })

  it('只声明一边的画布尺寸时给出对齐偏移的假设说明', () => {
    const viewport = resolveSvgViewport(tag('width="96mm" viewBox="0 0 96 192"'))
    expect(viewport.heightMm).toBeUndefined()
    expect(viewport.viewportHeightMm).toBeCloseTo(192 * MM_PER_USER_UNIT, 10)
    expect(viewport.note).toContain('96 dpi')
  })

  it('画布尺寸与 viewBox 都缺时可解析尺寸，viewBox 非法时给出说明', () => {
    const bare = resolveSvgViewport(tag('viewBox="0 0 96 192"'))
    expect(bare.viewportWidthMm).toBeCloseTo(25.4, 10)
    const broken = resolveSvgViewport(tag('width="10mm" height="10mm" viewBox="0 0 x y"'))
    expect(broken.viewBox).toBeUndefined()
    expect(broken.scaleX).toBeCloseTo(MM_PER_USER_UNIT, 12)
    expect(broken.note).toContain('viewBox 无法解析')
    const degenerate = resolveSvgViewport(tag('width="10mm" height="10mm" viewBox="0 0 0 10"'))
    expect(degenerate.viewBox).toBeUndefined()
  })

  it('百分比画布尺寸按未声明处理', () => {
    const viewport = resolveSvgViewport(tag('width="100%" height="100%" viewBox="0 0 40 20"'))
    expect(viewport.widthMm).toBeUndefined()
    expect(viewport.viewportWidthMm).toBeCloseTo(40 * MM_PER_USER_UNIT, 10)
  })
})
