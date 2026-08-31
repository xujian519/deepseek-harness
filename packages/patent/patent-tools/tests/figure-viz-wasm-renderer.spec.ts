import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createVizWasmRenderer,
  renderWithVizWasm,
  vizLoadFailureMessage,
} from '../src/figure/viz-wasm-renderer.ts'
import type { GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'
import type { VizInstance } from '../src/figure/viz-wasm-renderer.ts'

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

async function tempDir(): Promise<string> {
  temp = await mkdtemp(join(tmpdir(), 'viz-wasm-'))
  return temp
}

function spec(overrides: Partial<GraphvizRenderSpec> = {}): GraphvizRenderSpec {
  return { dot: 'digraph { a -> b }', filename: 'fig1', format: 'svg', engine: 'dot', outputDir: '/tmp', ...overrides }
}

function stubViz(renderString: VizInstance['renderString']): VizInstance {
  return { renderString }
}

describe('renderWithVizWasm', () => {
  it('真实内置引擎渲染 SVG 并写盘', async () => {
    const dir = await tempDir()
    const outcome = await renderWithVizWasm(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.path).toBe(join(dir, 'fig1.svg'))
    const svg = await readFile(outcome.path, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
  })

  it('文件名经 sanitizeDotFilename 清洗', async () => {
    const dir = await tempDir()
    const outcome = await renderWithVizWasm(spec({ outputDir: dir, filename: 'a/b\\c' }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.path).toBe(join(dir, 'a_b_c.svg'))
  })

  it('加载失败映射 not_installed 并指明内置引擎', async () => {
    const dir = await tempDir()
    const render = createVizWasmRenderer({ loadViz: () => Promise.reject(new Error('wasm 资产缺失')) })
    const outcome = await render(spec({ outputDir: dir }))
    expect(outcome).toEqual({ ok: false, code: 'not_installed', error: vizLoadFailureMessage('wasm 资产缺失') })
    expect(!outcome.ok && outcome.error).toContain('@viz-js/viz')
  })

  it('渲染错误映射 render_failed 并保留 Graphviz 报错文本', async () => {
    const dir = await tempDir()
    const render = createVizWasmRenderer({
      loadViz: () => Promise.resolve(stubViz(() => { throw new Error('syntax error in line 1 near }') })),
    })
    const outcome = await render(spec({ outputDir: dir }))
    expect(outcome).toEqual({ ok: false, code: 'render_failed', error: 'Graphviz WASM 渲染失败：syntax error in line 1 near }' })
  })

  it('写盘失败映射 render_failed', async () => {
    const dir = await tempDir()
    const render = createVizWasmRenderer({
      loadViz: () => Promise.resolve(stubViz(() => '<svg/>')),
    })
    // outputDir 指向一个文件路径，writeFile 必然失败（ENOTDIR）。
    const blocker = join(dir, 'blocker')
    const { writeFile: writeFileFs } = await import('node:fs/promises')
    await writeFileFs(blocker, 'not a dir')
    const outcome = await render(spec({ outputDir: blocker }))
    expect(!outcome.ok && outcome.code).toBe('render_failed')
    expect(!outcome.ok && outcome.error).toContain('写盘失败')
  })

  it('WASM 构建不支持 png（Phase 0 实测）→ render_failed 保留引擎报错', async () => {
    const dir = await tempDir()
    const outcome = await renderWithVizWasm(spec({ outputDir: dir, format: 'png' }))
    expect(!outcome.ok && outcome.code).toBe('render_failed')
    expect(!outcome.ok && outcome.error).toContain('not recognized')
  })

  it('渲染前已取消映射 aborted，不写盘', async () => {
    const dir = await tempDir()
    const caller = new AbortController()
    caller.abort()
    const outcome = await renderWithVizWasm(spec({ outputDir: dir, signal: caller.signal }))
    expect(outcome).toEqual({ ok: false, code: 'aborted', error: 'Graphviz WASM 渲染被调用方取消' })
    await expect(readFile(join(dir, 'fig1.svg'), 'utf8')).rejects.toThrow()
  })

  it('加载期间取消映射 aborted，不调用渲染', async () => {
    const dir = await tempDir()
    const caller = new AbortController()
    let rendered = 0
    const render = createVizWasmRenderer({
      loadViz: () => new Promise<VizInstance>((resolve) => {
        // 加载挂起期间触发取消，加载完成后渲染函数应因已取消而跳过。
        caller.abort()
        resolve(stubViz(() => { rendered += 1; return '<svg/>' }))
      }),
    })
    const outcome = await render(spec({ outputDir: dir, signal: caller.signal }))
    expect(!outcome.ok && outcome.code).toBe('aborted')
    expect(rendered).toBe(0)
  })
})
