import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
