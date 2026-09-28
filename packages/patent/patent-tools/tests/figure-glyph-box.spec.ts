import { describe, expect, it } from 'vitest'
import {
  FULL_WIDTH_RATIO,
  GLYPH_ASCENT_RATIO,
  GLYPH_DESCENT_RATIO,
  GLYPH_WIDTH_RATIO,
  UPPER_WIDTH_RATIO,
  boxCrossedBySegment,
  glyphBox,
  leaderEnd,
  textWidthMm,
} from '../src/figure/glyph-box.ts'

describe('textWidthMm', () => {
  it('西文按 0.6 倍字号、全角按 1 倍字号逐字累加', () => {
    expect(textWidthMm('1', 4)).toBeCloseTo(4 * GLYPH_WIDTH_RATIO, 10)
    expect(textWidthMm('x1', 4)).toBeCloseTo(2 * 4 * GLYPH_WIDTH_RATIO, 10)
    expect(textWidthMm('接地', 4)).toBeCloseTo(2 * 4 * FULL_WIDTH_RATIO, 10)
    // 半角与全角混排逐字累加：汉字、全角标点各占一个字号，数字与字母按 0.6。
    expect(textWidthMm('接1', 4)).toBeCloseTo(4 * (FULL_WIDTH_RATIO + GLYPH_WIDTH_RATIO), 10)
    expect(textWidthMm('，', 4)).toBeCloseTo(4 * FULL_WIDTH_RATIO, 10)
    expect(textWidthMm('ア', 4)).toBeCloseTo(4 * FULL_WIDTH_RATIO, 10)
    expect(textWidthMm('가', 4)).toBeCloseTo(4 * FULL_WIDTH_RATIO, 10)
  })

  it('西文大写单独按 0.75 倍字号（实测缩写比小写宽三成）', () => {
    expect(textWidthMm('GND', 4)).toBeCloseTo(3 * 4 * UPPER_WIDTH_RATIO, 10)
    expect(textWidthMm('G1', 4)).toBeCloseTo(4 * (UPPER_WIDTH_RATIO + GLYPH_WIDTH_RATIO), 10)
  })

  it('空内容宽度为零', () => {
    expect(textWidthMm('', 4)).toBe(0)
  })
})

describe('glyphBox', () => {
  it('middle 对齐时以基线锚点为中心、按三种比例展开', () => {
    const box = glyphBox('1', [20, 10], 4, 'middle')
    const width = 4 * GLYPH_WIDTH_RATIO
    expect(box.maxX - box.minX).toBeCloseTo(width, 10)
    expect(box.minX).toBeCloseTo(20 - width / 2, 10)
    expect(box.maxX).toBeCloseTo(20 + width / 2, 10)
    expect(box.minY).toBeCloseTo(10 - 4 * GLYPH_ASCENT_RATIO, 10)
    expect(box.maxY).toBeCloseTo(10 + 4 * GLYPH_DESCENT_RATIO, 10)
  })

  it('start 从锚点起排、end 到锚点止', () => {
    const width = 4 * GLYPH_WIDTH_RATIO
    expect(glyphBox('1', [20, 10], 4, 'start').minX).toBe(20)
    expect(glyphBox('1', [20, 10], 4, 'end').maxX).toBe(20)
    expect(glyphBox('1', [20, 10], 4, 'end').minX).toBeCloseTo(20 - width, 10)
  })

  it('多字与全角内容按内容宽度展开', () => {
    expect(glyphBox('接地', [20, 10], 4, 'start').maxX).toBeCloseTo(20 + 8, 10)
    expect(glyphBox('接地', [20, 10], 4, 'end').minX).toBeCloseTo(12, 10)
  })
})

describe('boxCrossedBySegment', () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 6 }

  it('端点落在框内即算穿过', () => {
    expect(boxCrossedBySegment(box, [5, 3], [20, 3])).toBe(true)
    expect(boxCrossedBySegment(box, [20, 3], [5, 3])).toBe(true)
  })

  it('两端在框外但线段穿过框也算', () => {
    expect(boxCrossedBySegment(box, [-5, 3], [15, 3])).toBe(true)
    expect(boxCrossedBySegment(box, [5, -5], [5, 15])).toBe(true)
  })

  it('贴边、共线与完全在框外不算', () => {
    expect(boxCrossedBySegment(box, [-5, 0], [15, 0])).toBe(false)
    expect(boxCrossedBySegment(box, [0, 0], [10, 0])).toBe(false)
    expect(boxCrossedBySegment(box, [-5, -5], [15, -5])).toBe(false)
    expect(boxCrossedBySegment(box, [20, 20], [30, 30])).toBe(false)
  })
})

describe('leaderEnd', () => {
  it('水平引线止于占位框左右边界', () => {
    // 基线 (20,10)、字号 4：框 x 18.8–21.2、y 7–10.48，框心 (20, 8.74)。
    // 引线指向框心，故从左侧来、从右侧来都从左/右边界出框（不是上下边界）。
    const fromLeft = leaderEnd('1', [20, 10], 4, 'middle', [10, 10])
    const fromRight = leaderEnd('1', [20, 10], 4, 'middle', [30, 10])
    expect(fromLeft?.[0]).toBeCloseTo(18.8, 10)
    expect(fromRight?.[0]).toBeCloseTo(21.2, 10)
    for (const end of [fromLeft, fromRight]) {
      expect(end?.[1]).toBeGreaterThan(7)
      expect(end?.[1]).toBeLessThan(10.48)
    }
  })

  it('竖直引线止于占位框上下边界（按来向取上界或下界）', () => {
    const above = leaderEnd('1', [20, 10], 4, 'middle', [20, 0])
    expect(above?.[0]).toBeCloseTo(20, 10)
    expect(above?.[1]).toBeCloseTo(7, 10)
    const below = leaderEnd('1', [20, 10], 4, 'middle', [20, 30])
    expect(below?.[0]).toBeCloseTo(20, 10)
    expect(below?.[1]).toBeCloseTo(10.48, 10)
  })

  it('全角内容的框更宽，引线相应提前止步', () => {
    // 「接地」宽 8、半宽 4：自右侧来的引线止于 x=24，而非单字宽时的 21.2。
    expect(leaderEnd('接地', [20, 10], 4, 'middle', [40, 10])?.[0]).toBeCloseTo(24, 10)
  })

  it('起点与数字中心重合、或起点已落在占位框内时不画引线', () => {
    // 框心在 (20, 8.74)（基线 10 减去上升 3、下降 0.48 的中点）。
    expect(leaderEnd('1', [20, 10], 4, 'middle', [20, 8.74])).toBeUndefined()
    // 起点在框内（框 y 7–10.48）：后退量不小于起点距离，故不画。
    expect(leaderEnd('1', [20, 10], 4, 'middle', [20, 9])).toBeUndefined()
  })
})
