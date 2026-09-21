import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { StructureRenderOutcome, StructureRenderSpec } from '../src/figure/freecad-renderer.ts'
import { STRUCTURE_MANIFEST_FILENAME } from '../src/figure/freecad-structure-script.ts'
import { createGenerateStructureFigureTool, STRUCTURE_FIGURE_MODEL_USED } from '../src/tool/generate-structure-figure.ts'
import type { FigureIndexEntry } from '../src/figure/index-store.ts'

/**
 * generate_structure_figure 工具规格：mock 渲染器（不依赖 FreeCAD），验证门禁、
 * 单模型/批量目录、件号 wording 告警、产物安全校验与索引持久化。
 */

const signal = new AbortController().signal
const exec = { signal } as never

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

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-structool-'))
}

/** 写一个占位模型文件（内容由 mock 渲染器忽略）。 */
function writeModel(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, 'ISO-10303-21;\nplaceholder\nEND-ISO-10303-21;')
  return path
}

type RenderOpts = { unsafe?: boolean; emptyViews?: boolean; svg?: string }

type MockRenderer = { render: (spec: StructureRenderSpec) => Promise<StructureRenderOutcome>; calls: StructureRenderSpec[] }

/** mock 渲染器：在 outputDir 写出各视图 SVG 与 manifest.json，返回 manifest 路径。 */
function okRenderer(opts: RenderOpts = {}): MockRenderer {
  const calls: StructureRenderSpec[] = []
  return {
    calls,
    render: (spec) => {
      calls.push(spec)
      mkdirSync(spec.outputDir, { recursive: true })
      const svg = opts.svg ?? (opts.unsafe
        ? '<!ENTITY x SYSTEM "file:///etc/passwd"><svg xmlns="http://www.w3.org/2000/svg"></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#000000"><path d="M0 0 L10 10"/></g></svg>')
      const views = spec.views.map((name, order) => {
        const path = join(spec.outputDir, `fig${spec.figureNumber}_${name}.svg`)
        writeFileSync(path, svg)
        return {
          name,
          order,
          path,
          bbox: [0, 0, 10, 10],
          anchors: spec.callouts.map(c => ({ numeral: c.numeral, label: c.label ?? '', point3d: [...c.point3d], point2d: [0, 0] })),
        }
      })
      const manifest = {
        figureNumber: spec.figureNumber,
        modelPath: spec.modelPath,
        scale: spec.scale,
        showHidden: spec.showHidden,
        generator: 'freecad-structure',
        views: opts.emptyViews ? [] : views,
      }
      const manifestPath = join(spec.outputDir, STRUCTURE_MANIFEST_FILENAME)
      writeFileSync(manifestPath, JSON.stringify(manifest))
      return Promise.resolve({ ok: true, manifestPath })
    },
  }
}

const twoCallouts = [
  { numeral: '100', point3d: [0, 0, 24] as [number, number, number], label: '立柱' },
  { numeral: '102', point3d: [20, -12, 8] as [number, number, number], label: '底板' },
]

describe('generate_structure_figure gate', () => {
  it('默认关闭时 fail-loud 为 setup_required（不静默降级）', async () => {
    const dir = tempDir()
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: writeModel(dir, 'a.step') }, exec)).rejects.toMatchObject({ code: 'setup_required' })
      // enabled:false 同样门禁
      const off = createGenerateStructureFigureTool({ render, enabled: false, outputDir: dir, cwd: dir })
      await expect(off.execute({ model_path: join(dir, 'a.step') }, exec)).rejects.toMatchObject({ code: 'setup_required' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_structure_figure 落版', () => {
  it('给定 target_office 时把每个视图 SVG 落版为 A4 附图页并返回尺寸', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const model = writeModel(dir, 'bracket.step')
    // 带物理尺寸与 viewBox 的片段，供落版解析（相当于 freecad 脚本产出的视图 SVG）。
    const { render } = okRenderer({ svg: '<svg width="200pt" height="150pt" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="#000000"><path d="M0 0 L10 10"/></g></svg>' })
    try {
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: outDir, cwd: dir })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', {
        model_path: model,
        views: ['iso'],
        figure_number: 3,
        target_office: 'cnipa',
        sheet_index: 1,
        sheet_total: 2,
      }, 's-layout') as { isError: boolean; value: { layout?: { office: string; sheetNumber: string; pageScale: number }; warnings: string[] } }
      expect(result.isError).toBe(false)
      expect(result.value.layout?.office).toBe('cnipa')
      expect(result.value.layout?.sheetNumber).toBe('1')
      expect(result.value.layout?.pageScale).toBeGreaterThan(0)
      const written = readFileSync(join(outDir, 'fig3', 'fig3_iso.svg'), 'utf8')
      expect(written).toContain('width="210mm" height="297mm"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_structure_figure success', () => {
  it('单模型：路径/标号表/组件/附图说明/索引闭环', async () => {
    const dir = tempDir()
    const outDir = join(dir, 'figs')
    const model = writeModel(dir, 'bracket.step')
    const upserted: FigureIndexEntry[] = []
    try {
      const { render, calls } = okRenderer()
      const tool = createGenerateStructureFigureTool({
        render,
        enabled: true,
        outputDir: outDir,
        cwd: dir,
        upsertIndex: async entry => void upserted.push(entry),
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', {
        model_path: model,
        views: ['iso', 'front'],
        callouts: twoCallouts,
        figure_number: 1,
        invention_name: '一种支架',
        persist_index: true,
      }, 's1') as { isError: boolean; value: { paths: string[]; figures: unknown[]; figureDescription: string; numeralMap: { numeral: string; label: string; figure: number }[]; components: { refNumber: string; name: string; kind: string }[]; warnings: string[]; indexed: boolean } }
      expect(result.isError).toBe(false)
      const value = result.value
      expect(value.paths).toEqual(['figs/fig1/fig1_iso.svg', 'figs/fig1/fig1_front.svg'])
      expect(value.figures).toHaveLength(1)
      expect(value.figureDescription).toBe('图1是本发明实施例提供的一种支架的结构示意图；图中：100-立柱，102-底板。')
      expect(value.numeralMap).toEqual([
        { componentId: '100', label: '立柱', numeral: '100', figure: 1 },
        { componentId: '102', label: '底板', numeral: '102', figure: 1 },
      ])
      expect(value.components[0]).toEqual({ refNumber: '100', name: '立柱', description: '立柱', kind: 'mechanical' })
      expect(value.indexed).toBe(true)
      // 生成方式告警
      expect(value.warnings.some(w => w.includes('FreeCAD TechDraw'))).toBe(true)
      // 渲染 spec 传递
      expect(calls[0]?.views).toEqual(['iso', 'front'])
      expect(calls[0]?.figureNumber).toBe(1)
      expect(calls[0]?.outputDir).toBe(join(outDir, 'fig1'))
      // 索引条目
      expect(upserted).toHaveLength(1)
      expect(upserted[0]?.analysis.figureType).toBe('structure')
      expect(upserted[0]?.analysis.modelUsed).toBe(STRUCTURE_FIGURE_MODEL_USED)
      expect(upserted[0]?.analysis.confidence).toBe(1)
      expect(upserted[0]?.analysis.usable).toBe(true)
      expect(upserted[0]?.imagePath).toBe('figs/fig1/fig1_iso.svg')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('批量目录：每个模型一图，图号自 base 递增', async () => {
    const dir = tempDir()
    const modelDir = join(dir, 'models')
    mkdirSync(modelDir, { recursive: true })
    writeModel(modelDir, 'a.step')
    writeModel(modelDir, 'b.step')
    writeFileSync(join(modelDir, 'notes.txt'), 'ignored')
    const outDir = join(dir, 'figs')
    try {
      const { render, calls } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: outDir, cwd: dir })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', {
        model_path: modelDir,
        views: ['iso'],
        figure_number: 3,
      }, 's2') as { isError: boolean; value: { paths: string[]; figures: { figureNumber: number }[]; figureDescription: string } }
      expect(result.isError).toBe(false)
      expect(result.value.figures.map(f => f.figureNumber)).toEqual([3, 4])
      expect(calls.map(c => c.figureNumber)).toEqual([3, 4])
      expect(result.value.paths).toEqual(['figs/fig3/fig3_iso.svg', 'figs/fig4/fig4_iso.svg'])
      expect(result.value.figureDescription).toBe('图3是本发明实施例提供的结构示意图；图4是本发明实施例提供的结构示意图。')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('persist_index=false 时不写索引', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    const upserted: FigureIndexEntry[] = []
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({
        render, enabled: true, outputDir: dir, cwd: dir, upsertIndex: async e => void upserted.push(e),
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', { model_path: model, views: ['iso'], persist_index: false }, 's3') as { value: { indexed: boolean } }
      expect(result.value.indexed).toBe(false)
      expect(upserted).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('无 callouts 时为纯几何线稿，标号表/组件为空', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', { model_path: model, views: ['front'] }, 's4') as { value: { numeralMap: unknown[]; components: unknown[]; figureDescription: string } }
      expect(result.value.numeralMap).toEqual([])
      expect(result.value.components).toEqual([])
      expect(result.value.figureDescription).toBe('图1是本发明实施例提供的结构示意图。')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_structure_figure wording & validation', () => {
  it('非阿拉伯数字标号触发图面用语告警', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', {
        model_path: model,
        views: ['iso'],
        callouts: [{ numeral: 'A1', point3d: [0, 0, 0], label: '部件' }],
      }, 's5') as { value: { warnings: string[] } }
      expect(result.value.warnings.some(w => w.includes('阿拉伯数字'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('不支持的视图名在 schema 层被拒（enum 门禁先于 execute）', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: model, views: ['bogus'] }, exec)).rejects.toMatchObject({ code: 'INVALID_ARGS' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('不支持的模型格式报 invalid_tool_input', async () => {
    const dir = tempDir()
    const bad = join(dir, 'model.obj')
    writeFileSync(bad, 'x')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: bad }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('模型路径不存在报 file_not_found', async () => {
    const dir = tempDir()
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: join(dir, 'missing.step') }, exec)).rejects.toMatchObject({ code: 'file_not_found' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('目录内无受支持模型报 invalid_tool_input', async () => {
    const dir = tempDir()
    const empty = join(dir, 'empty')
    mkdirSync(empty, { recursive: true })
    writeFileSync(join(empty, 'readme.txt'), 'x')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: empty }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('批量目录与 callouts 同用报 invalid_tool_input，且不落到渲染器', async () => {
    const dir = tempDir()
    const modelDir = join(dir, 'models')
    mkdirSync(modelDir, { recursive: true })
    writeModel(modelDir, 'a.step')
    writeModel(modelDir, 'b.step')
    try {
      const { render, calls } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: modelDir, views: ['iso'], callouts: twoCallouts }, exec))
        .rejects.toMatchObject({ code: 'invalid_tool_input' })
      expect(calls).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('scale 非正数报 invalid_tool_input', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: model, views: ['iso'], scale: 0 }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
      await expect(tool.execute({ model_path: model, views: ['iso'], scale: -2 }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('figure_number 非正整数报 invalid_tool_input', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: model, views: ['iso'], figure_number: 0 }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
      await expect(tool.execute({ model_path: model, views: ['iso'], figure_number: -1 }, exec)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_structure_figure render outcome mapping', () => {
  function fixed(outcome: StructureRenderOutcome) {
    return { render: () => Promise.resolve(outcome) }
  }

  it('not_installed→setup_required / aborted→tool_aborted / render_failed→tool_execution_failed', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const notInstalled = createGenerateStructureFigureTool({ ...fixed({ ok: false, code: 'not_installed', error: '未找到 FreeCAD' }), enabled: true, outputDir: dir, cwd: dir })
      const aborted = createGenerateStructureFigureTool({ ...fixed({ ok: false, code: 'aborted', error: '取消' }), enabled: true, outputDir: dir, cwd: dir })
      const failed = createGenerateStructureFigureTool({ ...fixed({ ok: false, code: 'render_failed', error: '退出码 1' }), enabled: true, outputDir: dir, cwd: dir })
      await expect(notInstalled.execute({ model_path: model, views: ['iso'] }, exec)).rejects.toMatchObject({ code: 'setup_required' })
      await expect(aborted.execute({ model_path: model, views: ['iso'] }, exec)).rejects.toMatchObject({ code: 'tool_aborted' })
      await expect(failed.execute({ model_path: model, views: ['iso'] }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('manifest 无视图时报 tool_execution_failed', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer({ emptyViews: true })
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: model, views: ['iso'] }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('视图 SVG 含不安全结构时报 tool_execution_failed', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer({ unsafe: true })
      const tool = createGenerateStructureFigureTool({ render, enabled: true, outputDir: dir, cwd: dir })
      await expect(tool.execute({ model_path: model, views: ['iso'] }, exec)).rejects.toMatchObject({ code: 'tool_execution_failed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('索引写入失败降级为告警且不阻断（indexed=false）', async () => {
    const dir = tempDir()
    const model = writeModel(dir, 'a.step')
    try {
      const { render } = okRenderer()
      const tool = createGenerateStructureFigureTool({
        render,
        enabled: true,
        outputDir: dir,
        cwd: dir,
        upsertIndex: async () => { throw new Error('disk full') },
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'generate_structure_figure', { model_path: model, views: ['iso'], callouts: twoCallouts }, 's6') as { isError: boolean; value: { indexed: boolean; warnings: string[] } }
      expect(result.isError).toBe(false)
      expect(result.value.indexed).toBe(false)
      expect(result.value.warnings.some(w => w.includes('附图索引写入失败') && w.includes('disk full'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
