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
function lineElements(body: string): { x1: number; y1: number; x2: number; y2: number; width: number; role?: string }[] {
  const pattern = new RegExp(
    '<line x1="(-?[\\d.]+)" y1="(-?[\\d.]+)" x2="(-?[\\d.]+)" y2="(-?[\\d.]+)"'
    + ' stroke-width="([\\d.]+)"(?: data-dsh-role="(\\w+)")?/>',
    'g',
  )
  return [...body.matchAll(pattern)].map(match => ({
    x1: Number(match[1]!),
    y1: Number(match[2]!),
    x2: Number(match[3]!),
    y2: Number(match[4]!),
    width: Number(match[5]!),
    ...(match[6] === undefined ? {} : { role: match[6] }),
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
    expect(spec.body).toContain('<polygon points="4,8 8,12 8,4" stroke-width="0.5" data-dsh-hatch-group="0"/>')
  })

  it('顶点共线的退化轮廓：重心退化为顶点平均位置，引线自该点引出且不画剖面线', () => {
    const spec = buildSectionDiagram({ parts: [{ outline: [[0, 0], [5, 0], [10, 0]], label: '线材' }] })
    // 数字落在轮廓右上角之外（包围盒右边与上边各加两倍字号），故不压在轮廓上。
    expect(textElements(spec.body)).toEqual([{ x: 21, y: 6.625, anchor: 'middle', text: '线材' }])
    // 零面积轮廓不打剖面线：唯一一条 0.25 线是自顶点平均位置 (5,0) 引出的标号引线，
    // 止于「线材」占位框（宽 2×3.5=7，x 13.5–20.5）的边界。
    const [leader] = lineElements(spec.body)
    expect(leader).toMatchObject({ x1: 9, y1: 12.425, width: 0.25 })
    expect(leader?.x2).toBeCloseTo(18.353, 2)
    expect(leader?.y2).toBeCloseTo(7.045, 2)
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

  it('外轮廓与零件轮廓同用粗实线，零件名写在轮廓右上角之外并收集到 labels', () => {
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
    // 零件名各在自轮廓包围盒右侧两倍字号（7 毫米）之外，剖切字母在位置线两端之外。
    expect(texts.map(item => item.x)).toEqual([33.313, 53.313, 5.313, 51.313])
    // 文字最后绘制：剖面线不得妨碍附图标记线和主线条的识别。
    expect(spec.body.indexOf('<text ')).toBeGreaterThan(spec.body.lastIndexOf('<line '))
    // 黑白输出：文本元素自带黑填充无描边，片段内不出现其他颜色。
    expect(new Set(spec.body.match(/#[0-9a-fA-F]{3,6}/g) ?? [])).toEqual(new Set(['#000000']))
    // 画布取外轮廓、零件、零件名（按内容宽度的占位框）、剖切符号与留白 (4) 的包围盒。
    expect(spec.widthMm).toBeCloseTo(60.9875, 6)
    expect(spec.heightMm).toBeCloseTo(37.425, 6)
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
      positionLine: '<line x1="10.625" y1="5.425" x2="26.625" y2="5.425" stroke-width="0.5"/>',
      polylines: ['10.625,4.425 8.125,5.425 10.625,6.425', '26.625,4.425 24.125,5.425 26.625,6.425'],
      anchors: ['end', 'end'],
      xs: [6.625, 22.625],
      y: 6.625,
      widthMm: 30.625,
      heightMm: 19.425,
    },
    {
      arrow: 'right',
      positionLine: '<line x1="4" y1="5.425" x2="20" y2="5.425" stroke-width="0.5"/>',
      polylines: ['4,6.425 6.5,5.425 4,4.425', '20,6.425 22.5,5.425 20,4.425'],
      anchors: ['start', 'start'],
      xs: [8, 24],
      y: 6.625,
      widthMm: 30.625,
      heightMm: 19.425,
    },
    {
      arrow: 'up',
      positionLine: '<line x1="5.313" y1="9.425" x2="21.313" y2="9.425" stroke-width="0.5"/>',
      polylines: ['6.313,9.425 5.313,6.925 4.313,9.425', '22.313,9.425 21.313,6.925 20.313,9.425'],
      anchors: ['middle', 'middle'],
      xs: [5.313, 21.313],
      y: 6.625,
      widthMm: 26.625,
      heightMm: 23.425,
    },
    {
      arrow: 'down',
      positionLine: '<line x1="5.313" y1="4" x2="21.313" y2="4" stroke-width="0.5"/>',
      polylines: ['4.313,4 5.313,6.5 6.313,4', '20.313,4 21.313,6.5 22.313,4'],
      anchors: ['middle', 'middle'],
      xs: [5.313, 21.313],
      y: 9.2,
      widthMm: 26.625,
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
    // 位置线 y=-2、两端外延到 x=-3 与 x=13；画布再左移 13.625、下移 5.425。
    expect(position).toEqual({ x1: 10.625, y1: 5.425, x2: 26.625, y2: 5.425, width: 0.5 })
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

describe('buildSectionDiagram 引线标号、中心线、字号与非剖切轮廓', () => {
  /** 0–10 毫米正方形，留白 0：引线与中心线的坐标断言基准。 */
  const UNIT: readonly (readonly [number, number])[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

  it('labels 的引线止于数字占位框边，数字外框内没有线条', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, hatch: 'none' }],
      labels: [{ text: '7', at: [14, 5], from: [10, 5] }],
      paddingMm: 0,
    })
    expect(spec.labels).toEqual(['7'])
    expect(textElements(spec.body)).toEqual([{ x: 14, y: 6.2, anchor: 'middle', text: '7' }])
    const leader = lineElements(spec.body).filter(line => line.width === 0.25)
    expect(leader).toHaveLength(1)
    const [line] = leader as [{ x1: number; y1: number; x2: number; y2: number; width: number }]
    expect(line.x1).toBe(10)
    expect(line.y1).toBe(5)
    // 数字占位框左边界 x=12.95（14 − 0.6×3.5/2）：引线止点不得越过它。
    expect(line.x2).toBeCloseTo(12.95, 2)
    expect(line.x2).toBeLessThanOrEqual(12.95)
  })

  it('labels 的落点与引线起点一并计入画布', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, hatch: 'none' }],
      labels: [{ text: '3', at: [30, 20], from: [10, 10] }],
      paddingMm: 0,
    })
    // 数字占位框按内容宽度估算（宽 0.6 字号）：右边界 30 + 1.05、下边界 20 + 1.62。
    expect(spec.widthMm).toBeCloseTo(31.05, 6)
    expect(spec.heightMm).toBeCloseTo(21.62, 6)
  })

  it('centerlines 画细点划线：长划—间隔—点—间隔循环，末段截断', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, hatch: 'none' }],
      centerlines: [{ from: [0, 5], to: [25, 5] }],
      paddingMm: 0,
    })
    const centerline = lineElements(spec.body).filter(line => line.width === 0.25)
    expect(centerline.map(line => [line.x1, line.x2])).toEqual([
      [0, 8], [10, 10.4], [12.4, 20.4], [22.4, 22.8], [24.8, 25],
    ])
    expect(centerline.every(line => line.y1 === 5 && line.y2 === 5)).toBe(true)
    expect(spec.widthMm).toBe(25)
    expect(spec.heightMm).toBe(10)
  })

  it('labelFontSizeMm 同时放大文字、基线补偿与轮廓外的标号间距', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, label: '甲', hatch: 'none' }],
      labelFontSizeMm: 7,
      paddingMm: 0,
    })
    // 字号 7：标号落点在包围盒右上角外 (10 + 2×7, 0 − 2×7) = (24, −14)；占位框按内容宽度
    // （「甲」宽 7、基线以上 5.25、以下 0.84）计入，包围盒随之变为 (20.5,−16.85)–(27.5,10)，
    // 整体平移 (0,16.85)；基线补偿按字号比例缩放 1.2 × 7/3.5 = 2.4 → −14 + 2.4 + 16.85 = 5.25。
    expect(spec.body).toContain('<text x="24" y="5.25" font-size="7" text-anchor="middle" fill="#000000" stroke="none">甲</text>')
    expect(spec.widthMm).toBeCloseTo(27.5, 6)
    expect(spec.heightMm).toBeCloseTo(26.85, 6)
  })

  it('hatch 为 none 时只画轮廓，不打剖面线', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, hatch: 'none' }, { outline: [[20, 0], [30, 0], [30, 10], [20, 10]] }],
      paddingMm: 0,
    })
    // 第二个零件按默认 45°/3mm 打线；第一个零件的区域（x<10）内没有剖面线。
    const hatch = lineElements(spec.body).filter(line => line.width === 0.25)
    expect(hatch.length).toBeGreaterThan(0)
    expect(hatch.every(line => line.x1 >= 20 || line.x2 >= 20)).toBe(true)
  })

  it('参数非法时抛 invalid_input', () => {
    const bad = (input: object) => errorMessage(() => buildSectionDiagram({ parts: [{ outline: UNIT }], ...input }))
    expect(bad({ labels: [{ text: '  ', at: [20, 5] }] })).toContain('标号 #1 文本不能为空')
    expect(bad({ labels: [{ text: '1', at: [Number.NaN, 5] }] })).toContain('标号 #1 落点坐标必须是有限数')
    expect(bad({ labels: [{ text: '1', at: [20, 5], from: [Number.POSITIVE_INFINITY, 5] }] })).toContain('标号 #1 引线起点坐标必须是有限数')
    expect(bad({ centerlines: [{ from: [3, 3], to: [3, 3] }] })).toContain('中心线两端点不能重合：(3, 3)')
    expect(bad({ centerlines: [{ from: [Number.NaN, 3], to: [3, 3] }] })).toContain('中心线起点坐标必须是有限数')
    expect(bad({ labelFontSizeMm: 0 })).toContain('图面字号必须是正有限数：0')
    expect(bad({ labelFontSizeMm: Number.NaN })).toContain('图面字号必须是正有限数：NaN')
  })

  it('引线起点与数字落点重合时不画引线（不画反向残段）', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: UNIT, hatch: 'none' }],
      labels: [{ text: '2', at: [10, 5], from: [10, 5] }],
      paddingMm: 0,
    })
    expect(lineElements(spec.body)).toEqual([])
  })
})

describe('buildSectionDiagram 剖面线分组标记', () => {
  /** 直接从图元文本取全部分组号（按出现顺序）。 */
  const groups = (body: string): string[] =>
    [...body.matchAll(/data-dsh-hatch-group="([^"]*)"/g)].map(match => match[1] as string)

  it('同一材料的分段共用一个分组号，不同材料各占一号', () => {
    const spec = buildSectionDiagram({
      parts: [
        { outline: [[0, 0], [10, 0], [10, 10], [0, 10]], hatch: { angleDeg: 45, spacingMm: 3, direction: 'forward' } },
        { outline: [[20, 0], [30, 0], [30, 10], [20, 10]], hatch: { angleDeg: 45, spacingMm: 3, direction: 'forward' } },
        { outline: [[40, 0], [50, 0], [50, 10], [40, 10]], hatch: { angleDeg: 75, spacingMm: 4 } },
      ],
    })
    expect(groups(spec.body)).toEqual(['0', '0', '1'])
  })

  it('缺省值与等价显式写法同组：缺省角度/间距/方向按解析后的值比较', () => {
    const spec = buildSectionDiagram({
      parts: [
        { outline: [[0, 0], [10, 0], [10, 10], [0, 10]], hatch: {} },
        { outline: [[20, 0], [30, 0], [30, 10], [20, 10]], hatch: { angleDeg: 45, spacingMm: 3, direction: 'forward' } },
      ],
    })
    expect(groups(spec.body)).toEqual(['0', '0'])
  })

  it('未给 hatch 与 hatch 为 none 的轮廓不写分组标记（缺省是漏写，合并会掩盖真缺陷）', () => {
    const spec = buildSectionDiagram({
      parts: [
        { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] },
        { outline: [[20, 0], [30, 0], [30, 10], [20, 10]], hatch: 'none' },
      ],
      paddingMm: 0,
    })
    expect(groups(spec.body)).toEqual([])
  })

  it('外轮廓不写分组标记', () => {
    const spec = buildSectionDiagram({
      outline: [[-5, -5], [45, -5], [45, 15], [-5, 15]],
      parts: [{ outline: [[0, 0], [10, 0], [10, 10], [0, 10]], hatch: { angleDeg: 45 } }],
      paddingMm: 0,
    })
    expect(spec.body.match(/<polygon /g) ?? []).toHaveLength(2)
    expect(groups(spec.body)).toEqual(['0'])
  })
})

describe('buildSectionDiagram 线宽（T-07）', () => {
  /** body 中每个 `<polygon>` 的线宽（按出现顺序）。 */
  const polygonWidths = (body: string): number[] =>
    [...body.matchAll(/<polygon [^>]*stroke-width="([\d.]+)"[^>]*\/>/g)].map(match => Number(match[1]!))

  it('缺省不传线宽时，输出与显式给出 0.5/0.25 逐字节相同', () => {
    const input = { parts: [{ outline: SQUARE, hatch: {} }], paddingMm: 0 } as const
    const implicit = buildSectionDiagram(input)
    const explicit = buildSectionDiagram({ ...input, strokeWidthMm: 0.5, thinStrokeWidthMm: 0.25 })
    expect(implicit.body).toBe(explicit.body)
  })

  it('零件的 strokeWidthMm 落到该轮廓自身，其他轮廓沿用图级默认', () => {
    const spec = buildSectionDiagram({
      outline: OUTLINE,
      parts: [
        { outline: [[0, 0], [10, 0], [10, 10], [0, 10]], hatch: 'none', strokeWidthMm: 0.7 },
        { outline: [[20, 0], [30, 0], [30, 10], [20, 10]], hatch: 'none' },
      ],
      paddingMm: 0,
    })
    // 外轮廓 → 0.5（图级默认）、薄壁件 → 0.7、另一件 → 0.5。
    expect(polygonWidths(spec.body)).toEqual([0.5, 0.7, 0.5])
  })

  it('图级粗/细线宽分别落到轮廓与剖面线、中心线', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: SQUARE, hatch: {} }],
      centerlines: [{ from: [0, 5], to: [10, 5] }],
      strokeWidthMm: 1,
      thinStrokeWidthMm: 0.35,
      paddingMm: 0,
    })
    expect(polygonWidths(spec.body)).toEqual([1])
    const widths = new Set(lineElements(spec.body).map(line => line.width))
    expect(widths).toEqual(new Set([0.35]))
  })

  it('引线用细线且带 data-dsh-role="leader"，中心线不带该标记', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: SQUARE, hatch: 'none' }],
      centerlines: [{ from: [0, 5], to: [25, 5] }],
      labels: [{ text: '7', at: [14, 5], from: [10, 5] }],
      paddingMm: 0,
    })
    const roles = [...spec.body.matchAll(/<line [^>]*data-dsh-role="leader"[^>]*\/>/g)]
    expect(roles).toHaveLength(1)
    expect(roles[0]?.[0]).toContain('stroke-width="0.25"')
    // 中心线沿用同线宽但不带 role：净距判据只排除引线。
    const plain = lineElements(spec.body).filter(line => line.role === undefined)
    expect(plain.every(line => line.width === 0.25)).toBe(true)
    expect(plain.length).toBeGreaterThan(1)
  })

  it('低于 0.18 毫米、零、负数与非有限数一律拒绝并指明主体', () => {
    const parts = [{ outline: SQUARE, hatch: 'none' as const }]
    expect(errorMessage(() => buildSectionDiagram({ parts, strokeWidthMm: 0.13 })))
      .toContain('轮廓线宽必须是不小于 0.18 毫米的有限数')
    expect(errorMessage(() => buildSectionDiagram({ parts, thinStrokeWidthMm: 0 })))
      .toContain('细实线线宽必须是不小于 0.18 毫米的有限数')
    expect(errorMessage(() => buildSectionDiagram({ parts, thinStrokeWidthMm: Number.NaN })))
      .toContain('细实线线宽必须是不小于 0.18 毫米的有限数')
    expect(errorMessage(() => buildSectionDiagram({
      parts: [{ outline: SQUARE, hatch: 'none', strokeWidthMm: -1 }],
    }))).toContain('零件 #1 线宽必须是不小于 0.18 毫米的有限数')
  })

  it('零件线宽缺省时继承图级默认，而不是硬编码的 0.5', () => {
    const spec = buildSectionDiagram({
      parts: [{ outline: SQUARE, hatch: 'none' }, { outline: [[20, 0], [30, 0], [30, 10], [20, 10]], hatch: 'none' }],
      strokeWidthMm: 1.4,
      paddingMm: 0,
    })
    expect(polygonWidths(spec.body)).toEqual([1.4, 1.4])
  })
})
