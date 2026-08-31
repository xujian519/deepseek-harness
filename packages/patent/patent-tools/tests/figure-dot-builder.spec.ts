import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NUMERAL_STEP,
  DotBuildError,
  assignNumerals,
  buildBlockDiagramDOT,
  buildComponentHierarchyDOT,
  buildDotHeader,
  buildFlowchartDOT,
  escapeDotLabel,
  getDiagramTemplate,
  numeralSeriesStart,
  resolvePageBundle,
  sanitizeId,
} from '../src/figure/dot-builder.ts'

describe('numeralSeriesStart', () => {
  it('按图号推导系列起点：FIG.1=100、FIG.2=200', () => {
    expect(numeralSeriesStart(1)).toBe(100)
    expect(numeralSeriesStart(2)).toBe(200)
    expect(numeralSeriesStart(0)).toBe(100)
    expect(numeralSeriesStart(-3)).toBe(100)
  })
})

describe('assignNumerals', () => {
  it('默认系列+步进分配（FIG.1 从 100 起，步进 2）', () => {
    expect(assignNumerals(['a', 'b', 'c'])).toEqual([
      { id: 'a', numeral: '100' },
      { id: 'b', numeral: '102' },
      { id: 'c', numeral: '104' },
    ])
  })

  it('FIG.2 从 200 起；显式标号占用跳过', () => {
    expect(assignNumerals(['a', 'b', 'c'], { figureNumber: 2 })).toEqual([
      { id: 'a', numeral: '200' },
      { id: 'b', numeral: '202' },
      { id: 'c', numeral: '204' },
    ])
    expect(assignNumerals(['a', 'b', 'c'], { explicit: { b: '100' } })).toEqual([
      { id: 'a', numeral: '102' },
      { id: 'b', numeral: '100' },
      { id: 'c', numeral: '104' },
    ])
  })

  it('自定起点与步进', () => {
    expect(assignNumerals(['a', 'b'], { start: 10, step: 10 })).toEqual([
      { id: 'a', numeral: '10' },
      { id: 'b', numeral: '20' },
    ])
    expect(assignNumerals(['a'], { start: 10, step: DEFAULT_NUMERAL_STEP })).toEqual([{ id: 'a', numeral: '10' }])
  })

  it('拒绝非法起点/步进与空显式标号', () => {
    expect(() => assignNumerals(['a'], { start: 0 })).toThrow(DotBuildError)
    expect(() => assignNumerals(['a'], { start: 1.5 })).toThrow(DotBuildError)
    expect(() => assignNumerals(['a'], { step: 0 })).toThrow(DotBuildError)
    expect(() => assignNumerals(['a'], { step: -1 })).toThrow(DotBuildError)
    expect(() => assignNumerals(['a'], { explicit: { a: '  ' } })).toThrow(/为空/)
  })

  it('显式标号重复占用时抛冲突', () => {
    expect(() => assignNumerals(['a', 'b'], { explicit: { a: '100', b: '100' } })).toThrow(/重复占用/)
  })

  it('reserved 占用号被自动分配跳过（家族未出现组件的既有标号）', () => {
    expect(assignNumerals(['a', 'b', 'c'], { reserved: ['100', '104'] })).toEqual([
      { id: 'a', numeral: '102' },
      { id: 'b', numeral: '106' },
      { id: 'c', numeral: '108' },
    ])
  })

  it('reserved 与 explicit 同号时以 explicit 为准（同件沿用，不再视为占用）', () => {
    expect(assignNumerals(['a', 'b'], { explicit: { a: '100' }, reserved: ['100'] })).toEqual([
      { id: 'a', numeral: '100' },
      { id: 'b', numeral: '102' },
    ])
  })
})

describe('sanitizeId / escapeDotLabel / buildDotHeader', () => {
  it('清洗非法字符并拒绝空 id', () => {
    expect(sanitizeId('step 1!')).toBe('step_1_')
    expect(sanitizeId('!@#')).toBe('___')
    expect(() => sanitizeId('')).toThrow(/不合法/)
  })

  it('转义双引号、反斜杠与控制字符', () => {
    expect(escapeDotLabel('a"b\\c\u0001d')).toBe('a\\"b\\\\c d')
  })

  it('构建标准头（默认与 filled 模式）', () => {
    const lines = buildDotHeader('G', { rankdir: 'TB', fontName: 'Helvetica', filled: false })
    expect(lines.join('\n')).toContain('digraph G {')
    expect(lines.join('\n')).toContain('rankdir=TB;')
    expect(lines.join('\n')).toContain('fontname="Helvetica"')
    expect(lines.join('\n')).not.toContain('style=filled')
    expect(buildDotHeader('G', { rankdir: 'LR', fontName: 'Arial', filled: true }).join('\n')).toContain('style=filled')
  })
})

describe('buildFlowchartDOT', () => {
  const steps = [
    { id: 'start', label: '开始', shape: 'ellipse' as const, next: ['s1'] },
    { id: 's1', label: '处理', next: ['d'] },
    { id: 'd', label: '成功？', shape: 'diamond' as const, next: [{ id: 's2', label: '是' }, { id: 's1', label: '否' }] },
    { id: 's2', label: '结束', shape: 'ellipse' as const, next: [] },
  ]

  it('生成专利风格流程图（标号前缀、无彩色）', () => {
    const dot = buildFlowchartDOT(steps)
    expect(dot).toContain('digraph Flowchart {')
    expect(dot).toContain('"start" [label="100. 开始", shape=ellipse];')
    expect(dot).toContain('"s1" [label="102. 处理", shape=box];')
    expect(dot).toContain('"d" -> "s2" [label="是"];')
    expect(dot).toContain('"d" -> "s1" [label="否"];')
    expect(dot).not.toContain('fillcolor')
    expect(dot).not.toContain('style=filled')
  })

  it('支持显式标号续接（跨图同号）', () => {
    const dot = buildFlowchartDOT(steps, { numerals: { start: '100' } })
    expect(dot).toContain('"start" [label="100. 开始", shape=ellipse];')
  })

  it('numeralStep 贯穿三个构建器', () => {
    expect(buildFlowchartDOT([{ id: 'a', label: 'A', next: [] }], { numeralStep: 10 })).toContain('"a" [label="100. A", shape=box];')
    expect(buildBlockDiagramDOT([{ id: 'a', label: 'A' }], [], { numeralStep: 10 })).toContain('"a" [label="A (100)", shape=box];')
    expect(buildComponentHierarchyDOT([{ id: 'a', label: 'A' }], { numeralStep: 10 })).toContain('"a" [label="A (100)"];')
    expect(buildBlockDiagramDOT([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], [], { numeralStep: 10 })).toContain('"b" [label="B (110)", shape=box];')
  })

  it('拒绝空输入、未知后继与决策分支缺标签', () => {
    expect(() => buildFlowchartDOT([])).toThrow(/至少需要一个步骤/)
    expect(() =>
      buildFlowchartDOT([{ id: 'a', label: 'A', next: ['ghost'] }], {}),
    ).toThrow(/后继不存在/)
    expect(() =>
      buildFlowchartDOT(
        [{ id: 'd', label: 'D', shape: 'diamond', next: ['x'] }, { id: 'x', label: 'X', next: [] }],
        {},
      ),
    ).toThrow(/必须带边标签/)
    expect(() =>
      buildFlowchartDOT(
        [{ id: 'd', label: 'D', shape: 'diamond', next: [{ id: 'x', label: '  ' }] }, { id: 'x', label: 'X', next: [] }],
        {},
      ),
    ).toThrow(/不能为空/)
  })

  it('拒绝非法形状', () => {
    expect(() =>
      buildFlowchartDOT(
        [{ id: 'a', label: 'A', shape: 'circle' as never, next: [] }],
        {},
      ),
    ).toThrow(/未知节点形状/)
  })
})

describe('buildBlockDiagramDOT', () => {
  const blocks = [
    { id: 'in', label: '输入', type: 'input' as const },
    { id: 'cpu', label: '处理', type: 'process' as const },
    { id: 'mem', label: '存储', type: 'storage' as const },
    { id: 'out', label: '输出', type: 'output' as const },
    { id: 'x', label: 'X' },
  ]
  const conns = [
    { from: 'in', to: 'cpu', label: '信号' },
    { from: 'cpu', to: 'mem' },
    { from: 'mem', to: 'cpu' },
    { from: 'cpu', to: 'out', label: '结果' },
  ]

  it('grayscale 默认：标号括号内嵌、零填充', () => {
    const dot = buildBlockDiagramDOT(blocks, conns)
    expect(dot).toContain('"in" [label="输入 (100)", shape=invhouse];')
    expect(dot).toContain('"cpu" [label="处理 (102)", shape=box];')
    expect(dot).toContain('"x" [label="X (108)", shape=box];')
    expect(dot).toContain('"in" -> "cpu" [label="信号"];')
    expect(dot).toContain('"cpu" -> "mem";')
    expect(dot).not.toContain('fillcolor')
  })

  it('semantic 模式按块类型填充（色彩承载技术内容时）', () => {
    const dot = buildBlockDiagramDOT(blocks, conns, { style: 'semantic' })
    expect(dot).toContain('fillcolor=lightblue')
    expect(dot).toContain('fillcolor=lightyellow')
    expect(dot).toContain('fillcolor=lightgray')
    expect(dot).toContain('fillcolor=lightgreen')
    expect(dot).toContain('style=filled')
  })

  it('拒绝空输入与未知连接端点', () => {
    expect(() => buildBlockDiagramDOT([], [])).toThrow(/至少需要一个块/)
    expect(() => buildBlockDiagramDOT(blocks, [{ from: 'ghost', to: 'cpu' }])).toThrow(/连接源块不存在/)
    expect(() => buildBlockDiagramDOT(blocks, [{ from: 'in', to: 'ghost' }])).toThrow(/连接目标块不存在/)
  })
})

describe('buildComponentHierarchyDOT', () => {
  const tree = [
    {
      id: 'sys',
      label: '系统',
      children: [
        { id: 'a', label: '组件A', children: [{ id: 'a1', label: '子件' }] },
        { id: 'b', label: '组件B' },
      ],
    },
  ]

  it('深度优先先序分配标号并画层级边', () => {
    const dot = buildComponentHierarchyDOT(tree)
    expect(dot).toContain('"sys" [label="系统 (100)"];')
    expect(dot).toContain('"a" [label="组件A (102)"];')
    expect(dot).toContain('"a1" [label="子件 (104)"];')
    expect(dot).toContain('"b" [label="组件B (106)"];')
    expect(dot).toContain('"sys" -> "a";')
    expect(dot).toContain('"a" -> "a1";')
    expect(dot).toContain('"sys" -> "b";')
  })

  it('拒绝空输入与重复 id', () => {
    expect(() => buildComponentHierarchyDOT([])).toThrow(/至少需要一个根节点/)
    expect(() =>
      buildComponentHierarchyDOT([{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }]),
    ).toThrow(/id 重复/)
  })
})

describe('getDiagramTemplate', () => {
  it('四个内置模板均可构建（默认黑白）', () => {
    for (const name of ['simple_flowchart', 'system_block', 'method_steps', 'component_hierarchy'] as const) {
      const dot = getDiagramTemplate(name)
      expect(dot).toContain('digraph')
      expect(dot).not.toContain('fillcolor')
    }
    expect(getDiagramTemplate('method_steps')).toContain('101. 接收输入数据')
    expect(getDiagramTemplate('system_block')).toContain('输入设备')
  })

  it('未知模板抛错', () => {
    expect(() => getDiagramTemplate('nope' as never)).toThrow(/未知模板/)
  })
})

describe('resolvePageBundle', () => {
  it('四项全缺省返回 undefined（零回归）', () => {
    expect(resolvePageBundle({})).toBeUndefined()
  })

  it('部分字段缺省时按显式字段构造 bundle', () => {
    expect(resolvePageBundle({ dpi: 300 })).toEqual({ dpi: 300 })
    expect(resolvePageBundle({ pageSize: 'a4' })).toEqual({ pageSize: 'a4' })
  })

  it('非法 dpi/页边距抛 invalid_page', () => {
    expect(() => resolvePageBundle({ dpi: 0 })).toThrow(DotBuildError)
    expect(() => resolvePageBundle({ dpi: -300 })).toThrow(DotBuildError)
    expect(() => resolvePageBundle({ dpi: 2.5 })).toThrow(/正整数/)
    expect(() => resolvePageBundle({ marginCm: -1 })).toThrow(DotBuildError)
    try {
      resolvePageBundle({ dpi: 0 })
    } catch (error) {
      expect((error as DotBuildError).code).toBe('invalid_page')
    }
  })
})

describe('page attributes in DOT header', () => {
  it('缺省时输出与现状一致的头部（无任何布局属性）', () => {
    const lines = buildDotHeader('Flowchart', { rankdir: 'TB', fontName: 'Helvetica', filled: false })
    const header = lines.join('\n')
    expect(header).not.toContain('page="')
    expect(header).not.toContain('size="')
    expect(header).not.toContain('margin="')
    expect(header).not.toContain('dpi=')
    expect(header).not.toContain('orientation=')
  })

  it('A4 纵向 + 300DPI + 2.5cm 边距输出 page/size/margin/dpi', () => {
    const lines = buildDotHeader('Flowchart', {
      rankdir: 'TB',
      fontName: 'Helvetica',
      filled: false,
      page: { pageSize: 'a4', orientation: 'portrait', dpi: 300, marginCm: 2.5 },
    })
    const header = lines.join('\n')
    expect(header).toContain('page="8.27,11.69";')
    expect(header).toContain('size="6.3,9.72";')
    expect(header).toContain('margin="0.98,0.98";')
    expect(header).toContain('dpi=300;')
    expect(header).not.toContain('orientation=')
  })

  it('letter 横向输出对调 page 尺寸与 orientation=landscape；size 仅随边距', () => {
    const lines = buildDotHeader('BlockDiagram', {
      rankdir: 'LR',
      fontName: 'Helvetica',
      filled: false,
      page: { pageSize: 'letter', orientation: 'landscape' },
    })
    const header = lines.join('\n')
    expect(header).toContain('page="11,8.5";')
    expect(header).toContain('orientation=landscape;')
    expect(header).not.toContain('size="')
    expect(header).not.toContain('margin="')
  })

  it('仅边距（无页面尺寸）输出独立 margin 行', () => {
    const lines = buildDotHeader('Flowchart', {
      rankdir: 'TB',
      fontName: 'Helvetica',
      filled: false,
      page: { marginCm: 1.27 },
    })
    const header = lines.join('\n')
    expect(header).toContain('margin="0.5,0.5";')
    expect(header).not.toContain('page=')
  })

  it('流程图/框图/层级图/模板构建器透传页面属性', () => {
    const page = { pageSize: 'a4', dpi: 600 } as const
    expect(buildFlowchartDOT([{ id: 'a', label: 'A', next: [] }], { page })).toContain('page="8.27,11.69";')
    expect(buildBlockDiagramDOT([{ id: 'a', label: 'A' }], [], { page })).toContain('dpi=600;')
    expect(buildComponentHierarchyDOT([{ id: 'a', label: 'A' }], { page })).toContain('page="8.27,11.69";')
    expect(getDiagramTemplate('simple_flowchart', { page })).toContain('page="8.27,11.69";')
  })
})

describe('embedNumerals', () => {
  it('缺省保持内嵌标号：框图/层级图 ` (NN)`、流程图 `NNN. `', () => {
    expect(buildFlowchartDOT([{ id: 'a', label: 'A', next: [] }])).toContain('"a" [label="100. A", shape=box];')
    expect(buildBlockDiagramDOT([{ id: 'a', label: 'A' }], [])).toContain('"a" [label="A (100)", shape=box];')
    expect(buildComponentHierarchyDOT([{ id: 'a', label: 'A' }])).toContain('"a" [label="A (100)"];')
  })

  it('embedNumerals:false 时三个构建器的标签均不含标号（引线通路构建输入）', () => {
    const flow = buildFlowchartDOT(
      [{ id: 'a', label: 'A', next: [{ id: 'b', label: '至 B' }] }, { id: 'b', label: 'B', next: [] }],
      { embedNumerals: false },
    )
    expect(flow).toContain('"a" [label="A", shape=box];')
    expect(flow).not.toContain('100. ')
    expect(buildBlockDiagramDOT([{ id: 'a', label: 'A' }], [], { embedNumerals: false })).toContain('"a" [label="A", shape=box];')
    expect(buildComponentHierarchyDOT([{ id: 'a', label: 'A' }], { embedNumerals: false })).toContain('"a" [label="A"];')
    expect(getDiagramTemplate('system_block', { embedNumerals: false })).not.toContain(' (100)')
    expect(getDiagramTemplate('method_steps', { embedNumerals: false })).not.toContain('101. ')
  })
})
