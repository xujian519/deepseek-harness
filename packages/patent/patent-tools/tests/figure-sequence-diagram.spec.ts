import { describe, expect, it, vi } from 'vitest'
import { VectorFigureError } from '../src/figure/vector-figure.ts'
import type { VectorFigureErrorCode } from '../src/figure/vector-figure.ts'
import { buildSequenceDiagram } from '../src/figure/sequence-diagram.ts'
import type { SequenceDiagramInput, SequenceMessage } from '../src/figure/sequence-diagram.ts'

/**
 * 时序图几何：参与者盒与生命线排布、三种消息类型的箭线/箭头/虚线、激活条的
 * 行覆盖、画布尺寸推导、图面用语与颜色，以及全部输入校验分支。
 *
 * 断言里的毫米坐标按模块常量手算：盒宽 30、盒高 8、间距 10、留白 5、相邻盒
 * 净距 12、箭头长 3 半宽 1.2、字号 3.5、名字距箭线 1.2。
 */

/** 错误构造参数：本模块的校验约定是错误码，而接缝实例不保留 code，故在构造处记录。 */
const raisedErrors: { code: VectorFigureErrorCode; message: string }[] = []

vi.mock('../src/figure/vector-figure.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/figure/vector-figure.ts')>()
  /** 记录构造参数后委托接缝实现。 */
  class RecordingVectorFigureError extends actual.VectorFigureError {
    constructor(code: VectorFigureErrorCode, message: string) {
      raisedErrors.push({ code, message })
      super(code, message)
    }
  }
  return { ...actual, VectorFigureError: RecordingVectorFigureError }
})

/** 生成 count 个参与者（p0…）。 */
function participants(count: number): { id: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index}`, label: `参与者${index}` }))
}

/** 生成 count 条 a→b 的消息。 */
function messages(count: number): SequenceMessage[] {
  return Array.from({ length: count }, () => ({ from: 'a', to: 'b', label: '消息' }))
}

/** 片段在 body 中出现的次数。 */
function countOf(body: string, fragment: string): number {
  return body.split(fragment).length - 1
}

/** body 中出现的颜色 token。 */
function colorsOf(body: string): string[] {
  return body.match(/#[0-9a-fA-F]{6}/g) ?? []
}

/** 构建并返回本次抛出的错误构造参数；未抛错或抛错类型不符时失败。 */
function raisedError(input: SequenceDiagramInput): { code: VectorFigureErrorCode; message: string } {
  raisedErrors.length = 0
  let thrown: unknown
  try {
    buildSequenceDiagram(input)
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(VectorFigureError)
  const recorded = raisedErrors[0]
  if (recorded === undefined) throw new Error('未记录到错误构造参数')
  return recorded
}

describe('buildSequenceDiagram 图面结构', () => {
  it('两参与者一条消息：生命线为 0.25 细实线，盒内文字居中，箭线止于实心箭头底边', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [{ from: 'a', to: 'b', label: '请求' }],
    })
    expect(spec.widthMm).toBe(82)
    expect(spec.heightMm).toBe(33)
    expect(spec.labels).toEqual(['客户端', '服务端', '请求'])
    expect(spec.body).toBe([
      '<line x1="20" y1="13" x2="20" y2="28" stroke="#000000" stroke-width="0.25"/>',
      '<line x1="62" y1="13" x2="62" y2="28" stroke="#000000" stroke-width="0.25"/>',
      '<rect x="5" y="5" width="30" height="8" fill="none" stroke="#000000" stroke-width="0.35"/>',
      '<text x="20" y="10.225" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">客户端</text>',
      '<rect x="47" y="5" width="30" height="8" fill="none" stroke="#000000" stroke-width="0.35"/>',
      '<text x="62" y="10.225" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">服务端</text>',
      '<line x1="20" y1="23" x2="59" y2="23" stroke="#000000" stroke-width="0.35"/>',
      '<polygon points="62,23 59,21.8 59,24.2" fill="#000000" stroke="#000000" stroke-width="0.25"/>',
      '<text x="41" y="21.8" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">请求</text>',
    ].join('\n'))
  })

  it('三种消息类型：sync 实心三角、return 虚线、async 空心三角，且只有返回消息用虚线', () => {
    const spec = buildSequenceDiagram({
      participants: [
        { id: 'a', label: '客户端' },
        { id: 'b', label: '服务端' },
        { id: 'c', label: '缓存' },
      ],
      messages: [
        { from: 'a', to: 'b', label: '请求' },
        { from: 'b', to: 'a', label: '响应', kind: 'return' },
        { from: 'a', to: 'c', label: '写缓存', kind: 'async' },
      ],
    })
    // 同步：实线箭线 + 实心三角。
    expect(spec.body).toContain('<line x1="20" y1="23" x2="59" y2="23" stroke="#000000" stroke-width="0.35"/>')
    expect(spec.body).toContain('<polygon points="62,23 59,21.8 59,24.2" fill="#000000" stroke="#000000" stroke-width="0.25"/>')
    // 返回：虚线箭线 + 实心三角，箭头指向左（箭尾在箭尖右侧）。
    expect(spec.body).toContain('<line x1="62" y1="33" x2="23" y2="33" stroke="#000000" stroke-width="0.35" stroke-dasharray="1.5 1"/>')
    expect(spec.body).toContain('<polygon points="20,33 23,31.8 23,34.2" fill="#000000" stroke="#000000" stroke-width="0.25"/>')
    // 异步：实线箭线 + 空心三角（fill="none"）。
    expect(spec.body).toContain('<line x1="20" y1="43" x2="101" y2="43" stroke="#000000" stroke-width="0.35"/>')
    expect(spec.body).toContain('<polygon points="104,43 101,41.8 101,44.2" fill="none" stroke="#000000" stroke-width="0.25"/>')
    expect(countOf(spec.body, 'stroke-dasharray')).toBe(1)
  })

  it('activate 打开时在目标生命线上画 2mm 宽激活条，覆盖该行上下各半格；关闭时不画', () => {
    const activated = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [{ from: 'a', to: 'b', label: '请求', activate: true }],
    })
    expect(activated.body).toContain('<rect x="61" y="18" width="2" height="10" fill="none" stroke="#000000" stroke-width="0.25"/>')
    // 两条参与者盒 + 一条激活条。
    expect(countOf(activated.body, '<rect ')).toBe(3)
    const plain = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [{ from: 'a', to: 'b', label: '请求', activate: false }],
    })
    expect(countOf(plain.body, '<rect ')).toBe(2)
    expect(plain.body).not.toContain('height="10"')
  })

  it('消息名写在箭线上方并居中于两端生命线，左右两向都按中点定位', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [
        { from: 'a', to: 'b', label: '请求' },
        { from: 'b', to: 'a', label: '响应', kind: 'return' },
      ],
    })
    // 右向行 y=23、左向行 y=33：(20+62)/2=41，两行同名位置一致。
    expect(spec.body).toContain('<text x="41" y="21.8" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">请求</text>')
    expect(spec.body).toContain('<text x="41" y="31.8" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">响应</text>')
  })

  it('无消息时仍画出参与者盒与生命线，生命线至少一格', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [],
    })
    expect(spec.widthMm).toBe(82)
    expect(spec.heightMm).toBe(33)
    expect(spec.labels).toEqual(['客户端', '服务端'])
    expect(spec.body).toContain('<line x1="20" y1="13" x2="20" y2="28" stroke="#000000" stroke-width="0.25"/>')
    expect(spec.body).toContain('<line x1="62" y1="13" x2="62" y2="28" stroke="#000000" stroke-width="0.25"/>')
    expect(spec.body).not.toContain('<polygon')
  })
})

describe('buildSequenceDiagram 画布尺寸', () => {
  it('按参与者与消息数量加留白推出画布，行距决定消息行的纵坐标', () => {
    const spec = buildSequenceDiagram({
      participants: [
        { id: 'a', label: '客户端' },
        { id: 'b', label: '服务端' },
        { id: 'c', label: '缓存' },
      ],
      messages: [
        { from: 'a', to: 'b', label: '请求' },
        { from: 'b', to: 'c', label: '读' },
        { from: 'c', to: 'a', label: '回填' },
      ],
    })
    // 宽 = 2*5 + 3*30 + 2*12 = 124；高 = 5 + 8 + 3*10 + 5 + 5 = 53。
    expect(spec.widthMm).toBe(124)
    expect(spec.heightMm).toBe(53)
    // 第三列生命线在 5 + 2*(30+12) + 15 = 104；末行 y = 13 + 3*10 = 43。
    expect(spec.body).toContain('<line x1="104" y1="13" x2="104" y2="48" stroke="#000000" stroke-width="0.25"/>')
    expect(spec.body).toContain('<polygon points="20,43 23,41.8 23,44.2" fill="#000000" stroke="#000000" stroke-width="0.25"/>')
  })

  it('覆盖盒宽、消息间距与留白', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [{ from: 'a', to: 'b', label: 'ping' }],
      boxWidthMm: 20,
      messageSpacingMm: 6,
      paddingMm: 2,
    })
    // 宽 = 2*2 + 2*20 + 12 = 56；高 = 2 + 8 + 6 + 3 + 2 = 21。
    expect(spec.widthMm).toBe(56)
    expect(spec.heightMm).toBe(21)
    expect(spec.body).toContain('<line x1="12" y1="10" x2="12" y2="19" stroke="#000000" stroke-width="0.25"/>')
    expect(spec.body).toContain('<rect x="2" y="2" width="20" height="8" fill="none" stroke="#000000" stroke-width="0.35"/>')
    expect(spec.body).toContain('<text x="12" y="7.225" text-anchor="middle" fill="#000000" stroke="none" font-size="3.5">客户端</text>')
    expect(spec.body).toContain('<line x1="12" y1="16" x2="41" y2="16" stroke="#000000" stroke-width="0.35"/>')
  })

  it('到达上限的数量仍可构建：50 个参与者与 500 条消息', () => {
    const wide = buildSequenceDiagram({ participants: participants(50), messages: [] })
    // 宽 = 2*5 + 50*30 + 49*12 = 2098。
    expect(wide.widthMm).toBe(2098)
    const tall = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: messages(500),
    })
    // 高 = 5 + 8 + 500*10 + 5 + 5 = 5023。
    expect(tall.heightMm).toBe(5023)
    expect(countOf(tall.body, '<polygon')).toBe(500)
  })
})

describe('buildSequenceDiagram 图面用语与颜色', () => {
  it('labels 收集参与者与消息的名字，并去掉首尾空白', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: ' a ', label: ' 客户端 ' }, { id: 'b', label: '服务端' }],
      messages: [{ from: ' a ', to: 'b', label: ' 请求 ' }],
    })
    expect(spec.labels).toEqual(['客户端', '服务端', '请求'])
    expect(spec.body).toContain('>请求</text>')
  })

  it('全黑白：除 #000000 外不出现其他颜色，文本元素自带 fill 与 stroke', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }],
      messages: [
        { from: 'a', to: 'b', label: '请求', activate: true },
        { from: 'b', to: 'a', label: '响应', kind: 'return' },
        { from: 'a', to: 'b', label: '通知', kind: 'async' },
      ],
    })
    expect([...new Set(colorsOf(spec.body))]).toEqual(['#000000'])
    expect(spec.body).not.toContain('rgb(')
    expect(spec.body).not.toContain('style="')
    const textTags = [...spec.body.matchAll(/<text[^>]*>/g)]
    expect(textTags.length).toBe(5)
    for (const tag of textTags) expect(tag[0]).toContain('fill="#000000" stroke="none"')
  })

  it('图面文字转义 XML 保留字符', () => {
    const spec = buildSequenceDiagram({
      participants: [{ id: 'a', label: '前端<A&B>' }, { id: 'b', label: '服务端' }],
      messages: [{ from: 'a', to: 'b', label: '调"用"' }],
    })
    expect(spec.body).toContain('前端&lt;A&amp;B&gt;')
    expect(spec.body).toContain('调&quot;用&quot;')
    expect(spec.labels).toEqual(['前端<A&B>', '服务端', '调"用"'])
  })
})

describe('buildSequenceDiagram 校验', () => {
  const twoParticipantIds = [{ id: 'a', label: '客户端' }, { id: 'b', label: '服务端' }]
  const oneMessage = [{ from: 'a', to: 'b', label: '请求' }]

  it('参与者为空时报空输入', () => {
    expect(raisedError({ participants: [], messages: [] }))
      .toEqual({ code: 'empty_input', message: '时序图的参与者列表为空' })
  })

  it('参与者数量超上限', () => {
    const error = raisedError({ participants: participants(51), messages: [] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('参与者数量超上限（50）：51')
  })

  it('参与者 id 为空', () => {
    const error = raisedError({ participants: [{ id: '  ', label: '客户端' }], messages: [] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('参与者 id 不能为空（第 1 项）')
  })

  it('参与者名字为空', () => {
    const error = raisedError({ participants: [{ id: 'a', label: ' ' }], messages: [] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('参与者 "a" 的名字不能为空')
  })

  it('参与者 id 重复', () => {
    const error = raisedError({ participants: [...twoParticipantIds, { id: 'a', label: '另一客户端' }], messages: [] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('参与者 id 重复：a')
  })

  it('消息起点不是已声明的参与者', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: [{ from: 'c', to: 'b', label: '请求' }] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('第 1 条消息的起点不是已声明的参与者：c')
  })

  it('消息终点不是已声明的参与者', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: [{ from: 'a', to: 'c', label: '请求' }] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('第 1 条消息的终点不是已声明的参与者：c')
  })

  it('不支持自环消息', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: [{ from: 'a', to: 'a', label: '递归' }] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('第 1 条消息的起点与终点相同，不支持自环：a')
  })

  it('消息名字为空', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: [{ from: 'a', to: 'b', label: ' ' }] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('第 1 条消息的名字不能为空')
  })

  it('消息类型非法', () => {
    const bad = { from: 'a', to: 'b', label: '请求', kind: 'signal' } as unknown as SequenceMessage
    const error = raisedError({ participants: twoParticipantIds, messages: [bad] })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('第 1 条消息的类型非法：signal')
  })

  it('消息数量超上限', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: messages(501) })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('消息数量超上限（500）：501')
  })

  it('盒宽非正', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: oneMessage, boxWidthMm: 0 })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('boxWidthMm 必须为正有限数：0')
  })

  it('消息间距非正', () => {
    const error = raisedError({ participants: twoParticipantIds, messages: oneMessage, messageSpacingMm: -1 })
    expect(error.code).toBe('invalid_input')
    expect(error.message).toContain('messageSpacingMm 必须为正有限数：-1')
  })

  it('留白非正或非有限', () => {
    const notANumber = raisedError({ participants: twoParticipantIds, messages: oneMessage, paddingMm: Number.NaN })
    expect(notANumber.code).toBe('invalid_input')
    expect(notANumber.message).toContain('paddingMm 必须为正有限数：NaN')
    const infinite = raisedError({ participants: twoParticipantIds, messages: oneMessage, paddingMm: Number.POSITIVE_INFINITY })
    expect(infinite.code).toBe('invalid_input')
    expect(infinite.message).toContain('paddingMm 必须为正有限数：Infinity')
  })
})
