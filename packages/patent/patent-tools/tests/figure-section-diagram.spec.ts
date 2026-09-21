import { describe, expect, it } from 'vitest'
import { buildSectionDiagram, type CuttingMark } from '../src/figure/section-diagram.ts'
import { VectorFigureError } from '../src/figure/vector-figure.ts'

/** 10×10 正方形零件：剖面线的数量、方向与顶点对齐判定的基准。 */
const SQUARE: readonly (readonly [number, number])[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

/** 40×20 外轮廓（与零件组合，验证外轮廓与零件的组合画法）。 */
const OUTLINE: readonly (readonly [number, number])[] = [[0, 0], [40, 0], [40, 20], [0, 20]]

/** U 形凹多边形：槽口把通过槽区的剖面线切成两段。 */
const U_SHAPE: readonly (readonly [number, number])[] = [
  [0, 0], [12, 0], [12, 12], [8, 12], [8, 4], [4, 4], [4, 12], [0, 12],
]

/** body 中的 `<line>` 元素（剖面线 0.25 毫米与剖切位置线 0.5 毫米同形）。 */
function lineElements(body: string): { x1: number; y1: number; x2: number; y2: number; width: number }[] {
  const pattern = /<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke-width="([\d.]+)"\/>/g
  return [...body.matchAll(pattern)].map(match => ({
    x1: Number(match[1]!),
    y1: Number(match[2]!),
    x2: Number(match[3]!),
    y2: Number(match[4]!),
    width: Number(match[5]!),
  }))
}

/** 剖面线线段（细实线 0.25 毫米）。 */
function hatchLines(body: string): { x1: number; y1: number; x2: number; y2: number; width: number }[] {
  return lineElements(body).filter(line => line.width === 0.25)
}

/** `<polyline>` 的 points 文本（剖切箭头）。 */
function polylinePoints(body: string): string[] {
  return [...body.matchAll(/<polyline points="([^"]+)" stroke-width="0\.5"\/>/g)].map(match => match[1]!)
}

/** `<text>` 元素的位置、对齐与内容。 */
function textElements(body: string): { x: number; y: number; anchor: string; text: string }[] {
  const pattern = /<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-size="3\.5" text-anchor="(\w+)" fill="#000000" stroke="none">([^<]*)<\/text>/g
  return [...body.matchAll(pattern)].map(match => ({
    x: Number(match[1]!),
    y: Number(match[2]!),
    anchor: match[3]!,
    text: match[4]!,
  }))
}

/** body 中出现的全部坐标数值（x/y 属性与 points 列表）。 */
function coordinates(body: string): number[] {
  const values: number[] = []
  for (const tag of body.matchAll(/<[^>]+>/g)) {
    for (const attr of tag[0].matchAll(/(?:x|y|x1|y1|x2|y2)="(-?[\d.]+)"/g)) values.push(Number(attr[1]!))
    const points = /points="([^"]+)"/.exec(tag[0])?.[1]
    if (points !== undefined) {
      for (const pair of points.split(' ')) for (const value of pair.split(',')) values.push(Number(value))
    }
  }
  return values
}

/**
 * 运行并返回 VectorFigureError 的消息文本，同时把抛错类型钉在接缝类上。
 * 接缝的 VectorFigureError 目前未把构造参数回填到实例的 `code` 字段，错误分支只能按消息区分。
 * @param run - 待执行调用。
 * @returns 抛出错误的 message。
 */
function errorMessage(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof VectorFigureError) return error.message
    throw error
  }
  throw new Error('未抛出 VectorFigureError')
}

describe('buildSectionDiagram 剖面线裁剪', () => {
  it('矩形零件按默认 45° 正向剖面线：间距 3 毫米得 5 条，全部左上→右下', () => {
    const spec = buildSectionDiagram({ parts: [{ outline: SQUARE }] })
    expect({ widthMm: spec.widthMm, heightMm: spec.heightMm }).toEqual({ widthMm: 18, heightMm: 18 })
    expect(spec.labels).toEqual([])
    expect(spec.body).toContain('<polygon points="4,4 14,4 14,14 4,14" stroke-width="0.5"/>')
    const hatch = hatchLines(spec.body)
    expect(hatch).toHaveLength(5)
    for (const line of hatch) {
      expect(line.x2 - line.x1).toBeGreaterThan(0)
      expect(line.y2 - line.y1).toBeGreaterThan(0)
    }
    // c=0 的剖面线恰过对角两个顶点，配对后仍是完整对角线。
    expect(hatch).toContainEqual({ x1: 4, y1: 4, x2: 14, y2: 14, width: 0.25 })
  })

  it('backward 方向为负斜率，且与顶点相切的那条不画', () => {
    const spec = buildSectionDiagram({ parts: [{ outline: SQUARE, hatch: { direction: 'backward' } }] })
    const hatch = hatchLines(spec.body)
    expect(hatch).toHaveLength(4)
    for (const line of hatch) {
      expect(line.x2 - line.x1).toBeGreaterThan(0)
      expect(line.y2 - line.y1).toBeLessThan(0)
    }
  })

  it('三角形零件：剖面线端点全部落在三角形内部', () => {
    // 画布平移量为 (4,4)：三角形顶点为 (4,4)、(16,4)、(4,13)，斜边 0.75·(x-4) + (y-4) = 9。
    const spec = buildSectionDiagram({ parts: [{ outline: [[0, 0], [12, 0], [0, 9]] }] })
    const hatch = hatchLines(spec.body)
    expect(hatch).toHaveLength(5)
    for (const line of hatch) {
      for (const point of [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }]) {
        expect(point.x).toBeGreaterThanOrEqual(4)
        expect(point.y).toBeGreaterThanOrEqual(4)
        expect(0.75 * (point.x - 4) + (point.y - 4)).toBeLessThanOrEqual(9.001)
      }
    }
  })

  it('U 形凹多边形：通过槽口的剖面线被切成两段', () => {
    const spec = buildSectionDiagram({ parts: [{ outline: U_SHAPE }] })
    const hatch = hatchLines(spec.body)
    // 族参数 c = -6、-3、0、3、6：c=0 即 y=x，在左右两臂各得一段。
    expect(hatch).toHaveLength(6)
    expect(hatch).toContainEqual({ x1: 4, y1: 4, x2: 8, y2: 8, width: 0.25 })
    expect(hatch).toContainEqual({ x1: 12, y1: 12, x2: 16, y2: 16, width: 0.25 })
    for (const line of hatch) {
      for (const point of [{ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }]) {
        const [x, y] = [point.x - 4, point.y - 4]
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(12)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(12)
        // 槽口 x∈(4,8)、y>4 被挖空，线段端点不得落在其中。
        expect(x > 4.001 && x < 7.999 && y > 4.001).toBe(false)
      }
    }
  })

  it('angleDeg 与 spacingMm 覆盖值：60°/4 毫米得 4 条、6 毫米间距得 3 条', () => {
    const slanted = hatchLines(buildSectionDiagram({
      parts: [{ outline: SQUARE, hatch: { angleDeg: 60, spacingMm: 4 } }],
    }).body)
    expect(slanted).toHaveLength(4)
    for (const line of slanted) {
      expect((line.y2 - line.y1) / (line.x2 - line.x1)).toBeCloseTo(Math.tan(Math.PI / 3), 2)
    }
    expect(hatchLines(buildSectionDiagram({ parts: [{ outline: SQUARE, hatch: { spacingMm: 6 } }] }).body)).toHaveLength(3)
  })

  it('线与多边形相切于顶点时不产生零长线段', () => {
    // 90° 剖面线为竖直线，间距 4 只采到多边形最左顶点所在的 x=0 与右边缘 x=4，两处都只相切。
    const spec = buildSectionDiagram({ parts: [{ outline: [[0, 0], [4, 4], [4, -4]], hatch: { angleDeg: 90, spacingMm: 4 } }] })
    expect(hatchLines(spec.body)).toEqual([])
    expect(spec.body).toContain('<polygon points="4,8 8,12 8,4" stroke-width="0.5"/>')
  })

  it('顶点共线的退化轮廓：重心退化为顶点平均位置且不画剖面线', () => {
    const spec = buildSectionDiagram({ parts: [{ outline: [[0, 0], [5, 0], [10, 0]], label: '线材' }] })
    expect(hatchLines(spec.body)).toEqual([])
    expect(textElements(spec.body)).toEqual([{ x: 9, y: 8.7, anchor: 'middle', text: '线材' }])
  })
})

describe('buildSectionDiagram 画布与图面词语', () => {
  it('paddingMm 覆盖值与默认值：画布恒为包围盒加两倍留白', () => {
    expect(buildSectionDiagram({ parts: [{ outline: SQUARE }] }).widthMm).toBe(18)
    expect(buildSectionDiagram({ parts: [{ outline: SQUARE }], paddingMm: 0 }).widthMm).toBe(10)
    const wide = buildSectionDiagram({ parts: [{ outline: SQUARE }], paddingMm: 10 })
    expect({ widthMm: wide.widthMm, heightMm: wide.heightMm }).toEqual({ widthMm: 30, heightMm: 30 })
  })

  it('全部坐标为负时整体平移：画布内坐标恒为非负且贴留白', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: [[-30, -20], [-10, -20], [-10, -10], [-30, -10]] }],
      paddingMm: 2,
    })
    expect({ widthMm: spec.widthMm, heightMm: spec.heightMm }).toEqual({ widthMm: 24, heightMm: 14 })
    expect(spec.body).toContain('<polygon points="2,2 22,2 22,12 2,12" stroke-width="0.5"/>')
    expect(coordinates(spec.body).filter(value => value < 0)).toEqual([])
  })

  it('外轮廓与零件轮廓同用粗实线，零件名与剖切字母写入图面并收集到 labels', () => {
    const spec = buildSectionDiagram({
      outline: OUTLINE,
      parts: [
        { outline: [[2, 2], [18, 2], [18, 18], [2, 18]], label: ' 底板 ' },
        { outline: [[22, 2], [38, 2], [30, 18]], label: 'A&B', hatch: { direction: 'backward', spacingMm: 4 } },
      ],
      cuttingMarks: [{ id: 'A', from: [0, -4], to: [40, -4], arrow: 'up' }],
    })
    expect(spec.labels).toEqual(['底板', 'A&B', 'A'])
    expect(spec.body.match(/<polygon /g) ?? []).toHaveLength(3)
    expect(spec.body).toContain('A&amp;B')
    const texts = textElements(spec.body)
    // 两个零件名 + 剖切字母两端各一个；零件名先转义为 XML 文本。
    expect(texts.map(item => item.text)).toEqual(['底板', 'A&amp;B', 'A', 'A'])
    // 文字最后绘制：剖面线不得妨碍附图标记线和主线条的识别。
    expect(spec.body.indexOf('<text ')).toBeGreaterThan(spec.body.lastIndexOf('<line '))
    // 黑白输出：文本元素自带黑填充无描边，片段内不出现其他颜色。
    expect(new Set(spec.body.match(/#[0-9a-fA-F]{3,6}/g) ?? [])).toEqual(new Set(['#000000']))
    // 画布取外轮廓、零件、剖切符号与留白 (4) 的包围盒：位置线在轮廓上方 4 毫米，画布随之上扩。
    expect({ widthMm: spec.widthMm, heightMm: spec.heightMm }).toEqual({ widthMm: 61, heightMm: 39.5 })
  })

  it('外轮廓为空数组表示只画零件；空白零件名不写入图面', () => {
    const spec = buildSectionDiagram({ outline: [], parts: [{ outline: SQUARE, label: '   ' }] })
    expect(spec.body.match(/<polygon /g) ?? []).toHaveLength(1)
    expect(spec.body).not.toContain('<text ')
    expect(spec.labels).toEqual([])
  })
})

describe('buildSectionDiagram 剖切位置符号', () => {
  /** 四种投射方向下 from (0,0) → to (10,0) 的箭头折线、字母锚点与画布尺寸。 */
  const MARK_CASES: readonly {
    arrow: CuttingMark['arrow']
    positionLine: string
    polylines: readonly string[]
    anchors: readonly string[]
    xs: readonly number[]
    y: number
    widthMm: number
    heightMm: number
  }[] = [
    {
      arrow: 'left',
      positionLine: '<line x1="11.5" y1="7.5" x2="27.5" y2="7.5" stroke-width="0.5"/>',
      polylines: ['11.5,6.5 9,7.5 11.5,8.5', '27.5,6.5 25,7.5 27.5,8.5'],
      anchors: ['end', 'end'],
      xs: [7.5, 23.5],
      y: 8.7,
      widthMm: 31.5,
      heightMm: 21.5,
    },
    {
      arrow: 'right',
      positionLine: '<line x1="4" y1="7.5" x2="20" y2="7.5" stroke-width="0.5"/>',
      polylines: ['4,8.5 6.5,7.5 4,6.5', '20,8.5 22.5,7.5 20,6.5'],
      anchors: ['start', 'start'],
      xs: [8, 24],
      y: 8.7,
      widthMm: 31.5,
      heightMm: 21.5,
    },
    {
      arrow: 'up',
      positionLine: '<line x1="7.5" y1="11.5" x2="23.5" y2="11.5" stroke-width="0.5"/>',
      polylines: ['8.5,11.5 7.5,9 6.5,11.5', '24.5,11.5 23.5,9 22.5,11.5'],
      anchors: ['middle', 'middle'],
      xs: [7.5, 23.5],
      y: 8.7,
      widthMm: 31,
      heightMm: 25.5,
    },
    {
      arrow: 'down',
      positionLine: '<line x1="7.5" y1="4" x2="23.5" y2="4" stroke-width="0.5"/>',
      polylines: ['6.5,4 7.5,6.5 8.5,4', '22.5,4 23.5,6.5 24.5,4'],
      anchors: ['middle', 'middle'],
      xs: [7.5, 23.5],
      y: 9.2,
      widthMm: 31,
      heightMm: 18,
    },
  ]

  it('四种投射方向：箭头落在位置线两端外侧，字母写在箭头尖端外侧', () => {
    for (const expected of MARK_CASES) {
      const spec = buildSectionDiagram({
        parts: [{ outline: SQUARE }],
        cuttingMarks: [{ id: 'A', from: [0, 0], to: [10, 0], arrow: expected.arrow }],
      })
      expect(spec.widthMm).toBe(expected.widthMm)
      expect(spec.heightMm).toBe(expected.heightMm)
      expect(spec.body).toContain(expected.positionLine)
      expect(polylinePoints(spec.body)).toEqual([...expected.polylines])
      const texts = textElements(spec.body)
      expect(texts.map(item => item.anchor)).toEqual([...expected.anchors])
      expect(texts.map(item => item.x)).toEqual([...expected.xs])
      expect(texts.map(item => item.y)).toEqual([expected.y, expected.y])
      expect(texts.every(item => item.text === 'A')).toBe(true)
    }
  })

  it('剖切位置线两端各外延 3 毫米，字母占位一并计入画布', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: SQUARE }],
      cuttingMarks: [{ id: 'B', from: [0, -2], to: [10, -2], arrow: 'left' }],
    })
    const [position] = lineElements(spec.body).filter(line => line.width === 0.5)
    // 位置线 y=-2、两端外延到 x=-3 与 x=13；画布再左移 14.5、下移 9.5。
    expect(position).toEqual({ x1: 11.5, y1: 7.5, x2: 27.5, y2: 7.5, width: 0.5 })
    expect(coordinates(spec.body).filter(value => value < 0)).toEqual([])
  })
})

describe('buildSectionDiagram 校验', () => {
  it('parts 为空抛 empty_input', () => {
    expect(errorMessage(() => buildSectionDiagram({ parts: [] }))).toContain('至少需要一个被剖切零件')
  })

  it('顶点不足、坐标非有限数抛 invalid_input', () => {
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: [[0, 0], [1, 1]] }] }))).toContain('零件 #1 轮廓至少需要 3 个顶点，实际 2 个')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: [[0, 0], [1, 1], [Number.NaN, 2]] }] }))).toContain('零件 #1 轮廓坐标必须是有限数：(NaN, 2)')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: [[0, 0], [1, 1], [2, Number.POSITIVE_INFINITY]] }] }))).toContain('(2, Infinity)')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE }], outline: [[0, 0], [10, 10]] }))).toContain('外轮廓至少需要 3 个顶点')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE }], outline: [[0, 0], [10, Number.NaN], [10, 10]] }))).toContain('外轮廓坐标必须是有限数')
  })

  it('剖面线参数越界抛 invalid_input，边界值 90° 通过', () => {
    const at = (hatch: object) => errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE, hatch }] }))
    expect(at({ spacingMm: 0 })).toContain('剖面线间距必须为正有限数：0')
    expect(at({ spacingMm: -1 })).toContain('剖面线间距必须为正有限数：-1')
    expect(at({ spacingMm: Number.NaN })).toContain('剖面线间距必须为正有限数：NaN')
    expect(at({ angleDeg: 0 })).toContain('剖面线角度必须在 (0, 90] 度内：0')
    expect(at({ angleDeg: 90.5 })).toContain('剖面线角度必须在 (0, 90] 度内：90.5')
    expect(at({ angleDeg: Number.NaN })).toContain('剖面线角度必须在 (0, 90] 度内：NaN')
    expect(at({ direction: 'sideways' as 'forward' })).toContain('剖面线方向只能是 forward 或 backward：sideways')
    expect(() => buildSectionDiagram({ parts: [{ outline: SQUARE, hatch: { angleDeg: 90 } }] })).not.toThrow()
  })

  it('剖切位置符号与画布留白非法抛 invalid_input', () => {
    const mark = (value: CuttingMark) => errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE }], cuttingMarks: [value] }))
    expect(mark({ id: '  ', from: [0, 0], to: [10, 0], arrow: 'up' })).toContain('剖切标记字母不能为空')
    expect(mark({ id: 'A', from: [1, 1], to: [1, 1], arrow: 'up' })).toContain('剖切位置线两端点不能重合：(1, 1)')
    expect(mark({ id: 'A', from: [Number.NaN, 0], to: [1, 0], arrow: 'up' })).toContain('剖切位置线起点坐标必须是有限数：(NaN, 0)')
    expect(mark({ id: 'A', from: [0, 0], to: [1, Number.POSITIVE_INFINITY], arrow: 'up' })).toContain('剖切位置线终点坐标必须是有限数')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE }], paddingMm: -1 }))).toContain('画布留白必须是非负有限数：-1')
    expect(errorMessage(() => buildSectionDiagram({ parts: [{ outline: SQUARE }], paddingMm: Number.NaN }))).toContain('画布留白必须是非负有限数：NaN')
  })
})
