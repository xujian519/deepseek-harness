import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { GraphvizRenderOutcome, GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'
import { createGeneratePatentFigureTool } from '../src/tool/generate-patent-figure.ts'
import { createAddPatentFigureReferencesTool } from '../src/tool/add-patent-figure-references.ts'
import { createSearchPatentFigureTool } from '../src/tool/search-patent-figure.ts'
import { figureIndexStore } from '../src/figure/index-store.ts'
import type { FigureIndexEntry } from '../src/figure/index-store.ts'

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

/** 成功结果的 value（isError=false 时存在；调用处以 as 断言结构）。 */
function valueOf(result: unknown): unknown {
  return (result as { value: unknown }).value
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-figgen-'))
}

/** fake renderer: writes an SVG at outputDir/"<filename>.svg" and returns its absolute path。 */
function okRenderer(_dir: string): { render: (spec: GraphvizRenderSpec) => Promise<GraphvizRenderOutcome>; calls: GraphvizRenderSpec[] } {
  const calls: GraphvizRenderSpec[] = []
  return {
    calls,
    render: (spec) => {
      calls.push(spec)
      const out = join(spec.outputDir, `${spec.filename}.${spec.format}`)
      writeFileSync(out, '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>')
      return Promise.resolve({ ok: true, path: out })
    },
  }
}

const flowSteps = [
  { id: 'start', label: '开始', shape: 'ellipse' as const, next: ['s1'] },
  { id: 's1', label: '处理', next: ['end'] },
  { id: 'end', label: '结束', shape: 'ellipse' as const, next: [] },
]

/** 直接驱动 tool.execute 的最小执行上下文；错误码断言走抛出的 PatentToolError。 */
const exec = { signal } as never

describe('generate_patent_figure tool', () => {
  it('生成流程图：标号表/附图说明/索引 upsert 闭环', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const upserted: FigureIndexEntry[] = []
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({
      render,
      outputDir: outDir,
      cwd: dir,
      upsertIndex: async entry => void upserted.push(entry),
    })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        figure_number: 1,
        invention_name: '一种自动加热装置',
        persist_index: true,
      }, 'g1')
      expect(result.isError).toBe(false)
      const value = result as {
        content: { type: string; text?: string }[]
        value: { path: string; numeralMap: { numeral: string }[]; figureDescription: string; components: unknown[]; indexed: boolean }
      }
      expect(value.value.path).toBe('figs/fig1.svg')
      expect(value.value.numeralMap.map(m => m.numeral)).toEqual(['100', '102', '104'])
      expect(value.value.figureDescription).toContain('图1是一种自动加热装置的流程图；图中：100-开始，102-处理，104-结束')
      expect(value.value.indexed).toBe(true)
      // render spec 传递
      expect(calls[0]?.dot).toContain('"start" [label="100. 开始", shape=ellipse];')
      expect(calls[0]?.dot).not.toContain('fillcolor')
      expect(calls[0]?.format).toBe('svg')
      expect(text(result)).toContain('参考标号')
      // 索引条目
      expect(upserted.length).toBe(1)
      expect(upserted[0]?.analysis.figureNumber).toBe(1)
      expect(upserted[0]?.analysis.modelUsed).toBe('graphviz-generator')
      expect(upserted[0]?.analysis.confidence).toBe(1)
      expect(upserted[0]?.analysis.components.length).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('框图 + 连接 + 显式标号续接 + semantic 彩色', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir, resolveFont: () => 'Arial' })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'block_diagram',
        blocks: [
          { id: 'in', label: '输入', type: 'input' },
          { id: 'cpu', label: '处理', type: 'process' },
        ],
        connections: [{ from: 'in', to: 'cpu', label: '信号' }],
        figure_number: 2,
        numerals: { cpu: '100' },
        style: 'semantic',
        filename: 'sys',
        format: 'png',
        engine: 'neato',
        persist_index: false,
      }, 'g2')
      expect(result.isError).toBe(false)
      const dot = calls[0]?.dot ?? ''
      expect(dot).toContain('fillcolor=lightblue')
      expect(dot).toContain('"cpu" [label="处理 (100)", shape=box, fillcolor=lightyellow]')
      expect(calls[0]?.format).toBe('png')
      expect(calls[0]?.engine).toBe('neato')
      expect(calls[0]?.dot).toContain('fontname="Arial"')
      const value = (result as never as { value: { numeralMap: { numeral: string }[]; indexed: boolean; path: string } }).value
      expect(value.numeralMap).toEqual([
        { componentId: 'in', label: '输入', numeral: '200', figure: 2 },
        { componentId: 'cpu', label: '处理', numeral: '100', figure: 2 },
      ])
      expect(value.indexed).toBe(false)
      expect(value.path).toBe('figs/sys.png')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('输入校验：缺步骤/模板/超限 DOT 转为 invalid_tool_input', async () => {
    const dir = tempDir()
    const tool = createGeneratePatentFigureTool({ render: okRenderer(dir).render, outputDir: dir, cwd: dir })
    try {
      // 注册表执行会把抛错折成 isError 文本结果（不保留 code），所以错误码
      // 断言直接驱动 tool.execute，与 analyze/figure-tools 规格保持同一约定。
      await expect(tool.execute({ figure_type: 'flowchart' }, exec)).rejects.toMatchObject({
        name: 'PatentToolError', code: 'invalid_tool_input',
      })
      await expect(tool.execute({ figure_type: 'template' }, exec)).rejects.toMatchObject({
        code: 'invalid_tool_input',
      })
      await expect(tool.execute({ figure_type: 'raw_dot', dot: 'x'.repeat(200_001) }, exec)).rejects.toMatchObject({
        code: 'invalid_tool_input',
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('渲染失败映射：not_installed→setup_required / 其它→tool_execution_failed / abort→tool_aborted', async () => {
    const dir = tempDir()
    const notInstalled = createGeneratePatentFigureTool({
      render: () => Promise.resolve({ ok: false, code: 'not_installed', error: '未找到 Graphviz，请 brew install graphviz' }),
      outputDir: dir,
      cwd: dir,
    })
    const failed = createGeneratePatentFigureTool({
      render: () => Promise.resolve({ ok: false, code: 'render_failed', error: '语法错误' }),
      outputDir: dir,
      cwd: dir,
    })
    const aborted = createGeneratePatentFigureTool({
      render: () => Promise.resolve({ ok: false, code: 'aborted', error: '取消' }),
      outputDir: dir,
      cwd: dir,
    })
    try {
      const blockInput = { figure_type: 'block_diagram', blocks: [{ id: 'a', label: 'A' }], connections: [] } as const
      await expect(notInstalled.execute(blockInput, exec)).rejects.toMatchObject({ code: 'setup_required' })
      await expect(failed.execute(blockInput, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
      await expect(aborted.execute(blockInput, exec)).rejects.toMatchObject({ code: 'tool_aborted' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('upsertIndex 抛错时静默降级（indexed 标记不变）', async () => {
    const dir = tempDir()
    const tool = createGeneratePatentFigureTool({
      render: okRenderer(dir).render,
      outputDir: dir,
      cwd: dir,
      upsertIndex: () => Promise.reject(new Error('disk full')),
    })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', { figure_type: 'block_diagram', blocks: [{ id: 'a', label: 'A' }], connections: [] }, 'e4')
      expect(result.isError).toBe(false)
      const value = (result as never as { value: { indexed: boolean } }).value
      expect(value.indexed).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('numeral_start/numeral_step 覆盖自动系列参数', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'block_diagram',
        blocks: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        connections: [],
        numeral_start: 500,
        numeral_step: 4,
      }, 'ns1')
      expect(result.isError).toBe(false)
      const value = (valueOf(result) as { numeralMap: { numeral: string }[] })
      expect(value.numeralMap.map(m => m.numeral)).toEqual(['500', '504'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flowchart 图型下 numeral_step 生效', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        numeral_step: 10,
      }, 'fs1')
      expect(result.isError).toBe(false)
      expect(calls[0]?.dot).toContain('"start" [label="100. 开始", shape=ellipse];')
      expect(calls[0]?.dot).toContain('"s1" [label="110. 处理", shape=box];')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无 cwd 注入时以 process.cwd 为基准', async () => {
    const dir = tempDir()
    const { render } = okRenderer(dir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'block_diagram',
        blocks: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        connections: [{ from: 'a', to: 'b' }],
      }, 'ncwd1')
      expect(result.isError).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('显式标号冲突 / 缺 blocks / 未知图型均转 invalid_tool_input', async () => {
    const dir = tempDir()
    const tool = createGeneratePatentFigureTool({ render: okRenderer(dir).render, outputDir: dir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const conflict = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'block_diagram',
        blocks: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
        connections: [],
        numerals: { a: '100', b: '100' },
      }, 'e5')
      expect(conflict.isError).toBe(true)
      expect(text(conflict)).toContain('标号分配失败')
      const noBlocks = await execute(ctx, 'generate_patent_figure', { figure_type: 'block_diagram' }, 'e6')
      expect(noBlocks.isError).toBe(true)
      expect(text(noBlocks)).toContain('block_diagram 需要 blocks')
      const emptyTree = await execute(ctx, 'generate_patent_figure', { figure_type: 'component_hierarchy' }, 'e6b')
      expect(emptyTree.isError).toBe(true)
      expect(text(emptyTree)).toContain('component_hierarchy 需要 tree')
      const emptyDot = await execute(ctx, 'generate_patent_figure', { figure_type: 'raw_dot' }, 'e6c')
      expect(emptyDot.isError).toBe(true)
      expect(text(emptyDot)).toContain('raw_dot 需要 dot 内容')
      const unknown = await execute(ctx, 'generate_patent_figure', { figure_type: 'nonexistent' }, 'e7')
      expect(unknown.isError).toBe(true)
      // schema enum 在 execute 前拦截未知图型
      expect(text(unknown)).toContain('must be one of')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('层级图型下 numeral_step 生效', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'component_hierarchy',
        tree: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B' }] }],
        numeral_step: 10,
      }, 'hs1')
      expect(result.isError).toBe(false)
      expect(calls[0]?.dot).toContain('"a" [label="A (100)"];')
      expect(calls[0]?.dot).toContain('"b" [label="B (110)"];')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('raw_dot 直通渲染并标注为 unknown 图型', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'raw_dot',
        dot: 'digraph X { a -> b; }',
        filename: 'custom',
      }, 'raw1')
      expect(result.isError).toBe(false)
      const value = (valueOf(result) as { path: string; figureType: string; numeralMap: unknown[] })
      expect(value.path).toBe('figs/custom.svg')
      expect(value.figureType).toBe('unknown')
      expect(value.numeralMap).toEqual([])
      expect(calls[0]?.dot).toContain('digraph X')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('生成 → 索引 → search 检索全链路闭环', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const indexPath = join(dir, 'figures-index.json')
    const { render } = okRenderer(outDir)
    const generate = createGeneratePatentFigureTool({
      render,
      outputDir: outDir,
      cwd: dir,
      upsertIndex: entry => figureIndexStore.upsert(indexPath, entry),
    })
    const search = createSearchPatentFigureTool({ loadIndex: () => figureIndexStore.load(indexPath) })
    const ctx = await ctxWith(generate, search)
    try {
      const gen = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        invention_name: '一种温控装置',
      }, 'chain1')
      expect(gen.isError).toBe(false)
      const hit = await execute(ctx, 'search_patent_figure', { query: '处理' }, 'chain2')
      expect(hit.isError).toBe(false)
      const value = (hit as never as {
        value: {
          query: string
          total: number
          indexedCount: number
          results: { figureNumber: number; figureDescription: string; components: unknown[] }[]
        }
      }).value
      expect(value.total).toBeGreaterThanOrEqual(1)
      expect(value.indexedCount).toBe(1)
      expect(value.results[0]?.figureNumber).toBe(1)
      expect(value.results[0]?.figureDescription).toContain('温控装置')
      expect(value.results[0]?.components.length).toBe(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('模板与层级图：模板名校验、层级先序标号', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const { render, calls } = okRenderer(outDir)
    const tool = createGeneratePatentFigureTool({ render, outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const tpl = await execute(ctx, 'generate_patent_figure', { figure_type: 'template', template: 'method_steps' }, 't1')
      expect(tpl.isError).toBe(false)
      expect(calls[0]?.dot).toContain('101. 接收输入数据')

      const hier = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'component_hierarchy',
        tree: [{ id: 'sys', label: '系统', children: [{ id: 'a', label: '组件A' }, { id: 'b', label: '组件B' }] }],
      }, 't2')
      const value = (valueOf(hier) as { numeralMap: { componentId: string; numeral: string }[]; figureType: string })
      expect(value.numeralMap).toEqual([
        { componentId: 'sys', label: '系统', numeral: '100', figure: 1 },
        { componentId: 'a', label: '组件A', numeral: '102', figure: 1 },
        { componentId: 'b', label: '组件B', numeral: '104', figure: 1 },
      ])
      expect(value.figureType).toBe('structure')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('add_patent_figure_references tool', () => {
  it('为既有 SVG 追加标号并输出 _annotated 文件', async () => {
    const dir = tempDir()
    const svg = join(dir, 'fig.svg')
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>Input Sensor</text></svg>')
    const tool = createAddPatentFigureReferencesTool({ cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'add_patent_figure_references', {
        svg_path: 'fig.svg',
        references: [{ label: 'Input Sensor', numeral: '20' }, { label: 'Ghost', numeral: '30' }],
      }, 'a1')
      expect(result.isError).toBe(false)
      const value = (result as never as { value: { path: string; numReferences: number; warnings: string[] } }).value
      expect(value.path).toBe('fig_annotated.svg')
      expect(value.numReferences).toBe(2)
      expect(value.warnings).toEqual(['Ghost'])
      const out = join(dir, 'fig_annotated.svg')
      expect(readFileSync(out, 'utf8')).toContain('Input Sensor (20)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('全部命中时无警告；未传 cwd 时用 process.cwd 基准', async () => {
    const dir = tempDir()
    const svg = join(dir, 'hit.svg')
    writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"><text>Sensor</text></svg>')
    const tool = createAddPatentFigureReferencesTool()
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'add_patent_figure_references', {
        svg_path: svg, // 绝对路径在无 cwd 实例下仍可解析
        references: [{ label: 'Sensor', numeral: '10' }],
      }, 'a4')
      expect(result.isError).toBe(false)
      const value = (valueOf(result) as { warnings: string[] })
      expect(value.warnings).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('非 .svg 文件名同样生成 _annotated.svg 输出', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'fig.txt'), '<svg xmlns="http://www.w3.org/2000/svg"><text>Sensor</text></svg>')
    const tool = createAddPatentFigureReferencesTool({ cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'add_patent_figure_references', {
        svg_path: 'fig.txt',
        references: [{ label: 'Sensor', numeral: '10' }],
      }, 'a5')
      expect(result.isError).toBe(false)
      expect((valueOf(result) as { path: string }).path).toBe('fig.txt_annotated.svg')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文件缺失与不安全 SVG 分别报 file_not_found / invalid_input', async () => {
    const dir = tempDir()
    const tool = createAddPatentFigureReferencesTool({ cwd: dir })
    try {
      await expect(tool.execute({ svg_path: 'nope.svg', references: [{ label: 'x', numeral: '1' }] }, exec))
        .rejects.toMatchObject({ name: 'PatentToolError', code: 'file_not_found' })
      writeFileSync(join(dir, 'bad.svg'), '<!DOCTYPE svg><svg></svg>')
      await expect(tool.execute({ svg_path: 'bad.svg', references: [{ label: 'x', numeral: '1' }] }, exec))
        .rejects.toMatchObject({ code: 'invalid_tool_input' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
