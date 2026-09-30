import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createGeneratePatentFigureTool } from '../src/tool/generate-patent-figure.ts'
import type { GraphvizRenderOutcome, GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

/** 记录 DOT 的渲染器替身；矢量图型不得调用它。 */
function trackingRenderer(): { render: (spec: GraphvizRenderSpec) => Promise<GraphvizRenderOutcome>; calls: GraphvizRenderSpec[] } {
  const calls: GraphvizRenderSpec[] = []
  return {
    calls,
    render: (spec) => {
      calls.push(spec)
      return Promise.resolve({ ok: false, code: 'render_failed', error: '矢量图型不应走 Graphviz 渲染' })
    },
  }
}

const circuit = {
  components: [
    { id: 'v1', kind: 'voltage_source', label: '电源', col: 0, row: 0 },
    { id: 'r1', kind: 'resistor', label: '电阻', col: 1, row: 0 },
    { id: 'l1', kind: 'lamp', label: '灯泡', col: 2, row: 0 },
  ],
  connections: [
    { from: 'v1', to: 'r1' },
    { from: 'r1', to: 'l1' },
  ],
}

describe('generate_patent_figure：状态图（DOT 图型）', () => {
  it('初始伪状态不分配标号，终态为双圆，转移条件写在箭头上', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-state-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({
      render: async (spec) => {
        // 状态图走 DOT：渲染器写回空 SVG 即可。
        tracker.calls.push(spec)
        const out = join(spec.outputDir, `${spec.filename}.${spec.format}`)
        const outcome: GraphvizRenderOutcome = { ok: true, path: out }
        return outcome
      },
      outputDir: outDir,
      cwd: dir,
    })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'state_diagram',
        states: [
          { id: 'init', label: '', kind: 'initial' },
          { id: 'idle', label: '待机' },
          { id: 'run', label: '运行' },
          { id: 'done', label: '结束', kind: 'final' },
        ],
        transitions: [
          { from: 'init', to: 'idle' },
          { from: 'idle', to: 'run', label: '启动' },
          { from: 'run', to: 'done', label: '完成' },
        ],
      }, 'st1')
      expect(result.isError).toBe(false)
      const dot = tracker.calls[0]?.dot ?? ''
      expect(dot).toContain('"init" [label="", shape=circle, style=filled, fillcolor=black')
      expect(dot).toContain('"idle" [label="100. 待机", shape=box, style=rounded];')
      expect(dot).toContain('"run" [label="102. 运行", shape=box, style=rounded];')
      expect(dot).toContain('"done" [label="104. 结束", shape=doublecircle];')
      expect(dot).toContain('"idle" -> "run" [label="启动"];')
      const value = result as { value: { components: { name: string }[]; figureType: string; figureDescription: string } }
      expect(value.value.figureType).toBe('state_diagram')
      expect(value.value.components.map(c => c.name)).toEqual(['待机', '运行', '结束'])
      expect(value.value.figureDescription).toContain('状态图')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('状态为空或转移端点不存在时报 invalid_tool_input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-state-'))
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: join(dir, 'figs'), cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const empty = await execute(ctx, 'generate_patent_figure', { figure_type: 'state_diagram' }, 'st2')
      expect(empty.isError).toBe(true)
      expect(text(empty)).toContain('state_diagram 需要 states')
      const dangling = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'state_diagram',
        states: [{ id: 'a', label: '甲' }],
        transitions: [{ from: 'a', to: 'b' }],
      }, 'st3')
      expect(dangling.isError).toBe(true)
      expect(text(dangling)).toContain('转移目标状态不存在')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_patent_figure：矢量图型（直接绘制 SVG）', () => {
  it('电路图：不经 Graphviz，直接落 SVG 文件，T 形结点画实心点', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', { figure_type: 'circuit', circuit }, 'v1')
      expect(result.isError).toBe(false)
      expect(tracker.calls).toHaveLength(0)
      const svg = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      expect(svg).toContain('width="')
      expect(svg).toContain('mm" height="')
      expect(svg).toContain('<title>电路图</title>')
      const value = result as { value: { figureType: string; warnings: string[] } }
      expect(value.value.figureType).toBe('circuit')
      expect(value.value.warnings).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('曲线图带实用新型「不得仅有性能图」提示；剖视图含剖面线', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const plot = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'plot',
        plot: { series: [{ name: '升温曲线', points: [[0, 20], [10, 60], [20, 95]] }], x_label: '时间', y_label: '温度', x_unit: 's', y_unit: '℃' },
      }, 'v2')
      expect(plot.isError).toBe(false)
      expect(text(plot)).toContain('7.3(10)')
      const section = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'cross_section',
        sections: { parts: [{ label: '底板', outline: [[0, 0], [40, 0], [40, 20], [0, 20]] }] },
      }, 'v3')
      expect(section.isError).toBe(false)
      const svg = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      expect(svg).toContain('#000000')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('时序图与外观设计排布：写出文件并透传图型提示', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const sequence = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'sequence_diagram',
        sequence: {
          participants: [{ id: 'u', label: '用户' }, { id: 's', label: '服务端' }],
          messages: [{ from: 'u', to: 's', label: '请求', activate: true }, { from: 's', to: 'u', label: '响应', kind: 'return' }],
        },
      }, 'v4')
      expect(sequence.isError).toBe(false)
      const appearance = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'appearance_view',
        appearance_views: {
          views: [
            { name: '主视图', body: '<rect x="0" y="0" width="10" height="10"/>', width_mm: 10, height_mm: 10, note: '省略仰视图：产品底面不常见' },
          ],
        },
      }, 'v5')
      expect(appearance.isError).toBe(false)
      const value = appearance as { value: { figureType: string; warnings: string[] } }
      expect(value.value.figureType).toBe('appearance_view')
      expect(value.value.warnings.join('\n')).toContain('省略仰视图：产品底面不常见')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('外观视图片段带复核拒绝的结构时记一条跳过说明，不吞掉已生成的图', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'appearance_view',
        appearance_views: {
          views: [{
            name: '主视图',
            body: '<!ENTITY x "y"><rect x="0" y="0" width="10" height="10"/>',
            width_mm: 10,
            height_mm: 10,
          }],
        },
      }, 'v11')
      expect(result.isError).toBe(false)
      const value = result as { value: { warnings: string[]; absolutePath: string } }
      // 复核因调用方片段里的实体声明被拒：图照常交付，只记一条跳过说明。
      expect(value.value.warnings.join('\n')).toContain('渲染复核被跳过')
      expect(readFileSync(join(outDir, 'fig1.svg'), 'utf8')).toContain('<!ENTITY')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('矢量图型支持落版（图号入图）与非法输入/格式的错误映射', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const laid = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'circuit',
        circuit,
        target_office: 'cnipa',
        figure_count: 2,
      }, 'v6')
      const laidValue = laid as { value: { layout: { caption?: string } } }
      expect(laidValue.value.layout.caption).toBe('图1')
      expect(readFileSync(join(outDir, 'fig1.svg'), 'utf8')).toContain('>图1</text>')
      const png = await execute(ctx, 'generate_patent_figure', { figure_type: 'circuit', circuit, format: 'png' }, 'v7')
      expect(png.isError).toBe(true)
      expect(text(png)).toContain('仅支持 format="svg"')
      const emptyCircuit = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'circuit',
        circuit: { components: [], connections: [] },
      }, 'v8')
      expect(emptyCircuit.isError).toBe(true)
      expect(text(emptyCircuit)).toContain('circuit 输入校验失败')
      const missingInput = await execute(ctx, 'generate_patent_figure', { figure_type: 'plot' }, 'v9')
      expect(missingInput.isError).toBe(true)
      expect(text(missingInput)).toContain('plot 需要 plot 输入')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('panels 模式的 schema 只接受 DOT 图型', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-vec-'))
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: join(dir, 'figs'), cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        panels: [{ suffix: 'A', figure_type: 'circuit', circuit }],
      }, 'v10')
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('panels[0].figure_type')
      expect(text(result)).toContain('must be one of')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_patent_figure：剖视图的引线标号、中心线、字号与文件输入', () => {
  /** 工具执行结果（文本内容用于断言错误消息，value 用于断言结构化输出）。 */
  type RunResult = { isError: boolean; value?: Record<string, unknown>; content: { type: string; text?: string }[] }

  /** 建一个只写不渲的工具上下文；返回执行器与输出目录。 */
  async function setup(): Promise<{ dir: string; outDir: string; run: (args: unknown, label: string) => Promise<RunResult> }> {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    const tool = createGeneratePatentFigureTool({ render: tracker.render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    return {
      dir,
      outDir,
      run: async (args, label) => await execute(ctx, 'generate_patent_figure', args, label) as RunResult,
    }
  }

  it('引线标号与中心线写进 SVG，输入检查与渲染复核都不报问题', async () => {
    const { dir, outDir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        sections: {
          parts: [{ outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: { angle_deg: 45, spacing_mm: 3, direction: 'forward' } }],
          labels: [{ text: '1', at: [44, 10], from: [40, 10] }],
          centerlines: [{ from: [-4, 10], to: [42, 10] }],
          label_font_size_mm: 5,
        },
      }, 's1')
      expect(result.isError).toBe(false)
      const svg = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      expect(svg).toContain('font-size="5"')
      // 中心线：至少 3 个「点」（≤1 毫米）与 2 个长划，且带 0.25 线宽。
      const thin = [...svg.matchAll(/<line x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)" stroke-width="0\.25"\/>/g)]
      expect(thin.length).toBeGreaterThan(4)
      const payload = result.value as { warnings: string[]; absolutePath: string }
      // 引线标号已由输入给出，引用渲染复核通过：只有「未指定剖面线」类的输入提示都不该出现。
      expect(payload.warnings).toEqual([])
      expect(payload.absolutePath.startsWith('/')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('零件未指定剖面线时给出「已套用默认」提示', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        sections: { parts: [{ outline: [[0, 0], [40, 0], [40, 20], [0, 20]] }] },
      }, 's2')
      const payload = result.value as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('未指定剖面线')
      expect(payload.warnings.join('\n')).toContain('hatch: "none"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('require_explicit_hatch 开启时未给 hatch 即报错，并把未给的轮廓序号列出来', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        require_explicit_hatch: true,
        sections: {
          parts: [
            { outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: 'none' },
            { outline: [[50, 0], [90, 0], [90, 20], [50, 20]] },
          ],
        },
      }, 's2-strict')
      expect(result.isError).toBe(true)
      expect(text(result)).toContain('require_explicit_hatch')
      expect(text(result)).toContain('零件 #2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('require_explicit_hatch 下每个轮廓都给了 hatch（含 none）时正常出图', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        require_explicit_hatch: true,
        sections: {
          parts: [
            { outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: { angle_deg: 45, spacing_mm: 3 } },
            { outline: [[50, 0], [90, 0], [90, 20], [50, 20]], hatch: 'none' },
          ],
        },
      }, 's2-strict-ok')
      expect(result.isError).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('零件名画在轮廓右上角之外并带引线：压在剖面线与沿中线的中心线上都不报贯穿', async () => {
    const { dir, outDir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        sections: {
          parts: [{ label: '1', outline: [[0, 0], [40, 0], [40, 20], [0, 20]] }],
          centerlines: [{ from: [-6, 10], to: [46, 10] }],
        },
      }, 's11')
      expect(result.isError).toBe(false)
      const payload = result.value as { warnings: string[] }
      // 数字在包围盒左上角之外，剖面线与中高处的中心线都不穿过数字：只有输入侧的
      // 「未指定剖面线」提示，没有渲染复核的贯穿提示。
      expect(payload.warnings.join('\n')).not.toContain('渲染复核：标号')
      const svg = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      const text = /<text x="([\d.]+)"[^>]*>1<\/text>/.exec(svg)
      expect(text).not.toBeNull()
      expect(Number(text?.[1])).toBeGreaterThan(40)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('同名零件名落在多个轮廓上时提示改用 labels', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        sections: {
          parts: [
            { label: '插头柄', outline: [[0, 0], [10, 0], [10, 10], [0, 10]], hatch: 'none' },
            { label: '插头柄', outline: [[10, 0], [20, 0], [20, 10], [10, 10]], hatch: 'none' },
          ],
        },
      }, 's3')
      const payload = result.value as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('零件名「插头柄」出现在 2 个轮廓上')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leader_lines 对直绘图型给出「不生效」提示而不是静默忽略', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        leader_lines: true,
        sections: { parts: [{ outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: 'none' }] },
      }, 's4')
      const payload = result.value as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('leader_lines')
      expect(payload.warnings.join('\n')).toContain('sections.labels')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('sections 传 JSON 文件路径：读入并渲染，缺文件与坏内容分别报错', async () => {
    const { dir, outDir, run } = await setup()
    try {
      writeFileSync(join(dir, 'fig4.json'), JSON.stringify({
        parts: [{ outline: [[0, 0], [30, 0], [30, 10], [0, 10]], hatch: 'none' }],
        labels: [{ text: '4', at: [34, 5], from: [30, 5] }],
      }))
      const fromFile = await run({ figure_type: 'cross_section', sections: 'fig4.json' }, 's5')
      expect(fromFile.isError).toBe(false)
      const svg = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      expect(svg).toContain('>4</text>')

      const missing = await run({ figure_type: 'cross_section', sections: 'nope.json' }, 's6')
      expect(missing.isError).toBe(true)
      expect(text(missing)).toContain('sections 文件不存在或不可读')

      writeFileSync(join(dir, 'bad.json'), '{ not json')
      const broken = await run({ figure_type: 'cross_section', sections: 'bad.json' }, 's7')
      expect(broken.isError).toBe(true)
      expect(text(broken)).toContain('不是合法 JSON')

      // 缺 required 字段：文件内容按同一套参数 schema 被拒。
      writeFileSync(join(dir, 'shape.json'), JSON.stringify({ outline: [] }))
      const wrong = await run({ figure_type: 'cross_section', sections: 'shape.json' }, 's8')
      expect(wrong.isError).toBe(true)
      expect(text(wrong)).toContain('sections 文件内容不符合剖视图输入')

      // schema 通过但语义不足：由构建层按内联输入同样的错误报出。
      writeFileSync(join(dir, 'empty.json'), JSON.stringify({ parts: [] }))
      const emptyParts = await run({ figure_type: 'cross_section', sections: 'empty.json' }, 's8b')
      expect(emptyParts.isError).toBe(true)
      expect(text(emptyParts)).toContain('剖视图至少需要一个被剖切零件')

      writeFileSync(join(dir, 'notobject.json'), JSON.stringify([1, 2]))
      const array = await run({ figure_type: 'cross_section', sections: 'notobject.json' }, 's9')
      expect(array.isError).toBe(true)
      expect(text(array)).toContain('不是 JSON 对象')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('给定 target_office 时复核量测的是落版后的附图页：页面级检查不误报', async () => {
    const { dir, outDir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        target_office: 'cnipa',
        sections: {
          parts: [{ outline: [[0, 0], [60, 0], [60, 24], [0, 24]], label: '1', hatch: { angle_deg: 45, spacing_mm: 3, direction: 'forward' } }],
          labels: [{ text: '2', at: [72, 32], from: [60, 12] }],
          centerlines: [{ from: [-6, 12], to: [66, 12] }],
        },
      }, 's12')
      const payload = result.value as { warnings: string[] }
      // 图形与图号都落在 210×297 页内：复核（在落版之后量测交付文件）不得报出越界或贯穿。
      expect(payload.warnings.filter(warning => warning.startsWith('渲染复核：'))).toEqual([])
      expect(readFileSync(join(outDir, 'fig1.svg'), 'utf8')).toContain('width="210mm"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('复核在文字转路径之前量测：转路径后仍保留贯穿提示', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sec-'))
    const outDir = join(dir, 'figs')
    const tracker = trackingRenderer()
    // 模拟 Config.figureTextToPath 的产物：图面已无 <text>（等价于文字转成了轮廓）。
    const tool = createGeneratePatentFigureTool({
      render: tracker.render,
      outputDir: outDir,
      cwd: dir,
      outlineText: (spec) => {
        writeFileSync(spec.path, readFileSync(spec.path, 'utf8').replace(/<text[^>]*>[^<]*<\/text>/g, ''), 'utf8')
        return Promise.resolve({ ok: true })
      },
    })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'cross_section',
        sections: {
          parts: [{ outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: { angle_deg: 45, spacing_mm: 4, direction: 'forward' } }],
          labels: [{ text: '1', at: [20, 10], from: [20, 10] }],
        },
      }, 's11') as RunResult
      const payload = result.value as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('渲染复核：图面文字「1」被线条贯穿')
      expect(readFileSync(join(outDir, 'fig1.svg'), 'utf8')).not.toContain('<text')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('渲染复核的发现随警告返回：文字被线条贯穿时给出提示', async () => {
    const { dir, run } = await setup()
    try {
      const result = await run({
        figure_type: 'cross_section',
        sections: {
          parts: [{ outline: [[0, 0], [40, 0], [40, 20], [0, 20]], hatch: { angle_deg: 45, spacing_mm: 4, direction: 'forward' } }],
          // 引线起点就是数字落点：复核会看到线条穿过数字占位框。
          labels: [{ text: '1', at: [20, 10], from: [20, 10] }],
        },
      }, 's10')
      const payload = result.value as { warnings: string[] }
      expect(payload.warnings.join('\n')).toContain('渲染复核：图面文字「1」被线条贯穿')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
