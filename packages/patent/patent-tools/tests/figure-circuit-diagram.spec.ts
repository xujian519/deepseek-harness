import { describe, expect, it } from 'vitest'
import { CIRCUIT_SYMBOL_KINDS, buildCircuitDiagram } from '../src/figure/circuit-diagram.ts'
import type { CircuitComponent, CircuitDiagramInput, CircuitSymbolKind } from '../src/figure/circuit-diagram.ts'
import { VectorFigureError } from '../src/figure/vector-figure.ts'

/** 单元件电路（元件画在 (0,0) 单元中心）。 */
function solo(kind: CircuitSymbolKind, label?: string): CircuitDiagramInput {
  const component: CircuitComponent = label === undefined ? { id: 'x1', kind, col: 0, row: 0 } : { id: 'x1', kind, label, col: 0, row: 0 }
  return { components: [component], connections: [] }
}

/** 断言输入校验抛 VectorFigureError（接缝错误类型），并返回该错误。 */
function expectRejected(input: CircuitDiagramInput): VectorFigureError {
  try {
    buildCircuitDiagram(input)
  } catch (error) {
    expect(error).toBeInstanceOf(VectorFigureError)
    expect(error).toHaveProperty('name', 'VectorFigureError')
    return error as VectorFigureError
  }
  throw new Error('输入未被拒绝')
}

/** 图面片段中出现的全部填充色。 */
function fills(body: string): string[] {
  return [...body.matchAll(/fill="([^"]+)"/g)].map(match => match[1] ?? '')
}

describe('buildCircuitDiagram 符号画法', () => {
  it('白名单覆盖十种符号', () => {
    expect(CIRCUIT_SYMBOL_KINDS).toEqual([
      'resistor',
      'capacitor',
      'inductor',
      'diode',
      'battery',
      'ground',
      'switch',
      'lamp',
      'npn_transistor',
      'voltage_source',
    ])
  })

  it('电阻：矩形（长边随接线轴向），纵向时绕中心旋转 90°', () => {
    expect(buildCircuitDiagram(solo('resistor')).body).toBe('<rect x="10.5" y="11.95" width="9" height="2.1"/>')
    const vertical = buildCircuitDiagram({
      components: [
        { id: 'r1', kind: 'resistor', col: 0, row: 0 },
        { id: 'c1', kind: 'capacitor', col: 0, row: 1 },
      ],
      connections: [{ from: 'r1', to: 'c1' }],
    })
    expect(vertical.body).toContain('<g transform="rotate(90 15 13)"><rect x="10.5" y="11.95" width="9" height="2.1"/></g>')
    expect(vertical.body).toContain('<polyline points="15,16.5 15,20 15,23.5" stroke-width="0.25"/>')
  })

  it('电容：两条平行短线加引出线', () => {
    const body = buildCircuitDiagram(solo('capacitor')).body
    expect(body).toContain('<line x1="13.875" y1="9.85" x2="13.875" y2="16.15"/>')
    expect(body).toContain('<line x1="16.125" y1="9.85" x2="16.125" y2="16.15"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="13.875" y2="13"/>')
    expect(body).toContain('<line x1="16.125" y1="13" x2="19.5" y2="13"/>')
  })

  it('电感：四段连续半圆弧占满符号宽', () => {
    const body = buildCircuitDiagram(solo('inductor')).body
    expect(body.match(/a 1\.125 1\.125 0 0 1 2\.25 0/g)).toHaveLength(4)
    expect(body).toContain('<path d="M 10.5 13')
    expect(body.endsWith('"/>')).toBe(true)
  })

  it('二极管：三角加阴极竖线', () => {
    const body = buildCircuitDiagram(solo('diode')).body
    expect(body).toContain('<polygon points="10.5,9.5 10.5,16.5 19.5,13"/>')
    expect(body).toContain('<line x1="19.5" y1="9.5" x2="19.5" y2="16.5"/>')
  })

  it('电池：两组长短线对加引出线', () => {
    const body = buildCircuitDiagram(solo('battery')).body
    expect(body).toContain('<line x1="12.075" y1="9.5" x2="12.075" y2="16.5"/>')
    expect(body).toContain('<line x1="13.875" y1="11.075" x2="13.875" y2="14.925"/>')
    expect(body).toContain('<line x1="16.125" y1="9.5" x2="16.125" y2="16.5"/>')
    expect(body).toContain('<line x1="17.925" y1="11.075" x2="17.925" y2="14.925"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="12.075" y2="13"/>')
    expect(body).toContain('<line x1="17.925" y1="13" x2="19.5" y2="13"/>')
  })

  it('电压源：一组长短线对加引出线', () => {
    const body = buildCircuitDiagram(solo('voltage_source')).body
    expect(body).toContain('<line x1="14.1" y1="9.5" x2="14.1" y2="16.5"/>')
    expect(body).toContain('<line x1="15.9" y1="11.075" x2="15.9" y2="14.925"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="14.1" y2="13"/>')
    expect(body).toContain('<line x1="15.9" y1="13" x2="19.5" y2="13"/>')
  })

  it('接地：三级递减横线，端口恒在上边（不随接线轴向旋转）', () => {
    const body = buildCircuitDiagram({
      components: [
        { id: 'g1', kind: 'ground', col: 0, row: 0 },
        { id: 'r1', kind: 'resistor', col: 0, row: 1 },
      ],
      connections: [{ from: 'r1', to: 'g1' }],
    }).body
    expect(body).toContain('<line x1="15" y1="9.5" x2="15" y2="13"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="19.5" y2="13"/>')
    expect(body).toContain('<line x1="12.3" y1="14.225" x2="17.7" y2="14.225"/>')
    expect(body).toContain('<line x1="13.875" y1="15.45" x2="16.125" y2="15.45"/>')
    expect(body).not.toContain('rotate(90 15 13)')
  })

  it('开关：斜线刀闸断开', () => {
    const body = buildCircuitDiagram(solo('switch')).body
    expect(body).toContain('<line x1="10.5" y1="13" x2="13.2" y2="13"/>')
    expect(body).toContain('<line x1="13.2" y1="13" x2="16.8" y2="9.85"/>')
    expect(body).toContain('<line x1="16.8" y1="13" x2="19.5" y2="13"/>')
  })

  it('灯泡：圆内叉加引出线', () => {
    const body = buildCircuitDiagram(solo('lamp')).body
    expect(body).toContain('<circle cx="15" cy="13" r="3.15"/>')
    expect(body).toContain('<line x1="12.773" y1="10.773" x2="17.227" y2="15.227"/>')
    expect(body).toContain('<line x1="12.773" y1="15.227" x2="17.227" y2="10.773"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="11.85" y2="13"/>')
  })

  it('NPN 晶体管：圆、基极竖线、两条斜线与发射极实心箭头', () => {
    const body = buildCircuitDiagram(solo('npn_transistor')).body
    expect(body).toContain('<circle cx="15" cy="13" r="3.325"/>')
    expect(body).toContain('<line x1="10.5" y1="13" x2="13.504" y2="13"/>')
    expect(body).toContain('<line x1="13.504" y1="11.005" x2="13.504" y2="14.995"/>')
    expect(body).toContain('<line x1="13.504" y1="11.836" x2="16.496" y2="10.506"/>')
    expect(body).toContain('<line x1="16.496" y1="10.506" x2="16.496" y2="9.5"/>')
    expect(body).toContain('<line x1="13.504" y1="14.164" x2="16.496" y2="15.494"/>')
    expect(body).toContain('<polygon points="16.496,15.494 14.707,15.426 15.247,14.211" fill="#000000" stroke="none"/>')
  })

  it('NPN 晶体管端口取基极、集电极与发射极', () => {
    const body = buildCircuitDiagram({
      components: [
        { id: 'q1', kind: 'npn_transistor', col: 1, row: 1 },
        { id: 'r1', kind: 'resistor', col: 1, row: 0 },
        { id: 'c1', kind: 'capacitor', col: 1, row: 2 },
        { id: 'l1', kind: 'inductor', col: 0, row: 1 },
      ],
      connections: [
        { from: 'r1', to: 'q1' },
        { from: 'c1', to: 'q1' },
        { from: 'l1', to: 'q1' },
      ],
    }).body
    // 集电极在上端口入线、发射极在下端口入线、基极在左端口入线；端口固定，符号不随轴向旋转。
    expect(body).toContain('<polyline points="33,16.5 33,20 34.496,20 34.496,23.5" stroke-width="0.25"/>')
    expect(body).toContain('<polyline points="33,37.5 33,34 34.496,34 34.496,30.5" stroke-width="0.25"/>')
    expect(body).toContain('<polyline points="19.5,27 23,27 25,27 28.5,27" stroke-width="0.25"/>')
    expect(body).toContain('<circle cx="33" cy="27" r="3.325"/>')
    expect(body).not.toContain('rotate(90 33 27)')
  })
})

describe('buildCircuitDiagram 连线与结点', () => {
  it('同排连线为一条直线', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 1, row: 0 },
      ],
      connections: [{ from: 'a1', to: 'b1' }],
    })
    expect(spec.body).toContain('<polyline points="19.5,13 23,13 25,13 28.5,13" stroke-width="0.25"/>')
    expect(spec.body).not.toContain('r="0.5"')
  })

  it('斜向连线正交折线（先水平后垂直）', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 1, row: 1 },
      ],
      connections: [{ from: 'a1', to: 'b1' }],
    })
    expect(spec.body).toContain('<polyline points="19.5,13 23,13 23,27 25,27 28.5,27" stroke-width="0.25"/>')
  })

  it('纵向元件接横向元件时先垂直后水平', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 0, row: 2 },
        { id: 'c1', kind: 'inductor', col: 1, row: 0 },
      ],
      connections: [
        { from: 'a1', to: 'b1' },
        { from: 'a1', to: 'c1' },
      ],
    })
    expect(spec.body).toContain('<polyline points="15,9.5 15,6 25,6 25,13 28.5,13" stroke-width="0.25"/>')
  })

  it('两条以上连线共用端点时画实心连接点', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 1, row: 1 },
        { id: 'c1', kind: 'inductor', col: 1, row: 0 },
      ],
      connections: [
        { from: 'a1', to: 'b1' },
        { from: 'a1', to: 'c1' },
      ],
    })
    // a1 的右侧端口（19.5,13）被两条连线共用。
    expect(spec.body).toContain('<circle cx="19.5" cy="13" r="0.5" fill="#000000" stroke="none"/>')
    expect(spec.body.match(/r="0\.5"/g)).toHaveLength(1)
  })
})

describe('buildCircuitDiagram 图面词语与黑白输出', () => {
  it('收集元件名与连线说明，且不写入元件 id', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'zz1', kind: 'voltage_source', label: '电源', col: 0, row: 0 },
        { id: 'zz2', kind: 'lamp', label: 'LAMP', col: 1, row: 0 },
      ],
      connections: [{ from: 'zz1', to: 'zz2', label: 'VCC' }],
    })
    expect(spec.labels).toEqual(['VCC', '电源', 'LAMP'])
    expect(spec.body).not.toContain('zz1')
    expect(spec.body).not.toContain('zz2')
    expect(spec.body).toContain('>VCC</text>')
    expect(spec.body).toContain('>电源</text>')
  })

  it('水平走线的说明写在走线上方居中', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'resistor', col: 1, row: 0 },
      ],
      connections: [{ from: 'a1', to: 'b1', label: 'VCC' }],
    })
    expect(spec.body).toContain('<text x="24" y="11.8" font-size="3" text-anchor="middle" fill="#000000" stroke="none">VCC</text>')
  })

  it('竖直走线的说明写在走线右侧左对齐', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 0, row: 1 },
      ],
      connections: [{ from: 'a1', to: 'b1', label: 'GND' }],
    })
    expect(spec.body).toContain('<text x="16.2" y="21" font-size="3" text-anchor="start" fill="#000000" stroke="none">GND</text>')
  })

  it('文本转义 & < >，labels 保留原文', () => {
    const spec = buildCircuitDiagram({
      components: [{ id: 'a1', kind: 'resistor', label: 'R&D <1>', col: 0, row: 0 }],
      connections: [],
    })
    expect(spec.labels).toEqual(['R&D <1>'])
    expect(spec.body).toContain('>R&amp;D &lt;1&gt;</text>')
  })

  it('空标签不下笔也不收集', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', label: '', col: 0, row: 0 },
        { id: 'b1', kind: 'capacitor', col: 1, row: 0 },
      ],
      connections: [{ from: 'a1', to: 'b1', label: '' }],
    })
    expect(spec.labels).toEqual([])
    expect(spec.body).not.toContain('<text')
  })

  it('只输出黑色：填充色只有 #000000，不带其它颜色', () => {
    const spec = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'npn_transistor', label: 'Q1', col: 0, row: 0 },
        { id: 'b1', kind: 'ground', label: 'GND', col: 1, row: 1 },
      ],
      connections: [{ from: 'a1', to: 'b1', label: 'E' }],
    })
    expect(fills(spec.body).length).toBeGreaterThan(0)
    expect(new Set(fills(spec.body))).toEqual(new Set(['#000000']))
    expect(new Set([...spec.body.matchAll(/#[0-9a-fA-F]{3,6}/g)].map(match => match[0]))).toEqual(new Set(['#000000']))
  })
})

describe('buildCircuitDiagram 画布尺寸', () => {
  it('默认单元格 18×14mm，画布按最大行列推出并含留白', () => {
    const spec = buildCircuitDiagram(solo('resistor'))
    expect(spec.widthMm).toBe(30)
    expect(spec.heightMm).toBe(26)
    const wide = buildCircuitDiagram({
      components: [
        { id: 'a1', kind: 'resistor', col: 2, row: 1 },
        { id: 'b1', kind: 'capacitor', col: 0, row: 0 },
      ],
      connections: [{ from: 'a1', to: 'b1' }],
    })
    expect(wide.widthMm).toBe(66)
    expect(wide.heightMm).toBe(40)
  })

  it('单元格尺寸可覆盖，符号随之缩放', () => {
    const spec = buildCircuitDiagram({
      components: [{ id: 'a1', kind: 'resistor', col: 1, row: 1 }],
      connections: [],
      cellWidthMm: 20,
      cellHeightMm: 10,
    })
    expect(spec.widthMm).toBe(52)
    expect(spec.heightMm).toBe(32)
    expect(spec.body).toBe('<rect x="31" y="20.25" width="10" height="1.5"/>')
  })
})

describe('buildCircuitDiagram 输入校验', () => {
  it('元件为空抛 empty_input', () => {
    expect(expectRejected({ components: [], connections: [] }).message).toContain('至少需要一个元件')
  })

  it('id 重复抛 invalid_input', () => {
    const error = expectRejected({
      components: [
        { id: 'a1', kind: 'resistor', col: 0, row: 0 },
        { id: 'a1', kind: 'capacitor', col: 1, row: 0 },
      ],
      connections: [],
    })
    expect(error.message).toContain('id 重复：a1')
  })

  it('列号非整数、为负或超上限抛 invalid_input', () => {
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: 0.5, row: 0 }],
      connections: [],
    }).message).toContain('列号必须是 0 至 200 的整数：0.5')
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: -1, row: 0 }],
      connections: [],
    }).message).toContain('列号必须是 0 至 200 的整数：-1')
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: 201, row: 0 }],
      connections: [],
    }).message).toContain('列号必须是 0 至 200 的整数：201')
  })

  it('行号非整数、为负或超上限抛 invalid_input', () => {
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: 0, row: Number.NaN }],
      connections: [],
    }).message).toContain('行号必须是 0 至 200 的整数')
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: 0, row: -1 }],
      connections: [],
    }).message).toContain('行号必须是 0 至 200 的整数：-1')
    expect(expectRejected({
      components: [{ id: 'a1', kind: 'resistor', col: 0, row: 201 }],
      connections: [],
    }).message).toContain('行号必须是 0 至 200 的整数：201')
  })

  it('未知符号种类抛 invalid_input', () => {
    const error = expectRejected({
      components: [{ id: 'a1', kind: 'fuse' as unknown as CircuitSymbolKind, col: 0, row: 0 }],
      connections: [],
    })
    expect(error.message).toContain('未知电路符号：fuse')
  })

  it('连线端点未声明抛 invalid_input', () => {
    const components: readonly CircuitComponent[] = [{ id: 'a1', kind: 'resistor', col: 0, row: 0 }]
    expect(expectRejected({ components, connections: [{ from: 'b1', to: 'a1' }] }).message).toContain('未声明的元件：b1')
    expect(expectRejected({ components, connections: [{ from: 'a1', to: 'b1' }] }).message).toContain('未声明的元件：b1')
  })

  it('单元格尺寸非正或非有限抛 invalid_input', () => {
    expect(expectRejected({ ...solo('resistor'), cellWidthMm: 0 }).message).toContain('单元格宽必须是正有限数')
    expect(expectRejected({ ...solo('resistor'), cellWidthMm: Number.NaN }).message).toContain('单元格宽必须是正有限数')
    expect(expectRejected({ ...solo('resistor'), cellHeightMm: 0 }).message).toContain('单元格高必须是正有限数')
    expect(expectRejected({ ...solo('resistor'), cellHeightMm: Number.NaN }).message).toContain('单元格高必须是正有限数')
  })
})
