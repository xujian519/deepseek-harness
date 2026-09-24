import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS } from '../src/figure/graphviz-renderer.ts'
import { pickRenderer } from '../src/figure/render-selector.ts'
import type { GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'

/** 用例显式声明的渲染预算（毫秒）；生产由宿主 Config.graphvizRenderTimeoutMs 解析后注入。 */
const TEST_RENDER_TIMEOUT_MS = DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS

/** 超时用例注入的非默认预算（毫秒）：证明选择器把 deps 的预算转交渲染器，而非用模块默认值。 */
const INJECTED_RENDER_TIMEOUT_MS = 1_500

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

async function tempDir(): Promise<string> {
  temp = await mkdtemp(join(tmpdir(), 'render-selector-'))
  return temp
}

function spec(overrides: Partial<GraphvizRenderSpec> = {}): GraphvizRenderSpec {
  return { dot: 'digraph { a -> b }', filename: 'fig1', format: 'svg', engine: 'dot', outputDir: '/tmp', ...overrides }
}

/** 退出码 0 的 CLI handle；输出文件由 onSpawn 侧预写（渲染器校验存在性）。 */
function cliHandle(): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate() {},
    waitForExit: () => Promise.resolve(true),
  }
}

function fakeSubprocess(
  onSpawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
): { runtime: SubprocessRuntime; calls: SubprocessSpawnSpec[] } {
  const calls: SubprocessSpawnSpec[] = []
  const runtime = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      calls.push(spec)
      return onSpawn(spec)
    },
  } as unknown as SubprocessRuntime
  return { runtime, calls }
}

/** 按输出扩展名给出能通过产物校验（A2）的占位内容：svg 含根元素、png 带 magic bytes、pdf 带 %PDF 头。 */
function placeholderFor(path: string): string | Buffer {
  if (path.endsWith('.png')) return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (path.endsWith('.pdf')) return '%PDF-1.4\n'
  return '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
}

/** 永不退出的 CLI handle：只在截止期信号到达时以 SIGTERM 结束（模拟病态布局的渲染）。 */
function hangingCli(): { runtime: SubprocessRuntime; calls: SubprocessSpawnSpec[] } {
  return fakeSubprocess(spawnSpec => ({
    ...cliHandle(),
    done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      spawnSpec.signal?.addEventListener('abort', () => { resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
    }),
  }))
}

/** onSpawn 侧预写 dot 输出占位文件（渲染器在退出码 0 后校验文件存在与内容）。 */
function fakeCli(): { runtime: SubprocessRuntime; calls: SubprocessSpawnSpec[] } {
  return fakeSubprocess((spawnSpec) => {
    const out = spawnSpec.argv[spawnSpec.argv.indexOf('-o') + 1]
    if (out !== undefined) writeFileSync(out, placeholderFor(out))
    return cliHandle()
  })
}

describe('pickRenderer', () => {
  it('默认（未配置）走 WASM：svg 无 subprocess 也渲染成功', async () => {
    const dir = await tempDir()
    const render = pickRenderer(undefined, { graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    const outcome = await render(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(await readFile(outcome.path, 'utf8')).toContain('<svg')
  })

  it("mode='wasm' 显式选择同样走内置引擎", async () => {
    const dir = await tempDir()
    const outcome = await pickRenderer('wasm', { graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
  })

  it("mode='wasm' 时 png 路由到 CLI 兜底（argv -Tpng、指定 dot 路径生效）", async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizExecutable: dotPath, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ outputDir: dir, format: 'png' }))
    expect(outcome.ok).toBe(true)
    expect(calls[0]?.argv[0]).toBe(dotPath)
    expect(calls[0]?.argv).toContain('-Tpng')
  })

  it("mode='cli' 走系统 dot 子进程（argv -Tsvg）", async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const outcome = await pickRenderer('cli', { subprocess: runtime, graphvizExecutable: dotPath, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
    expect(calls[0]?.argv).toContain('-Tsvg')
  })

  it("mode='wasm' 时 pdf 无 subprocess → not_installed（兜底不可用）", async () => {
    const outcome = await pickRenderer('wasm', { graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ format: 'pdf' }))
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
  })

  it("mode='cli' 无 subprocess → not_installed 并指明服务缺失", async () => {
    const outcome = await pickRenderer('cli', { graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({}))
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
    expect(!outcome.ok && outcome.error).toContain('subprocess')
  })

  it('强制导向引擎的大 DOT 改走 CLI（WASM 同步渲染不可中断）', async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const big = `digraph {${'a -> b; '.repeat(2_500)}}`
    expect(big.length).toBeGreaterThan(20_000)
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizExecutable: dotPath, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(
      spec({ outputDir: dir, engine: 'neato', dot: big }),
    )
    expect(outcome.ok).toBe(true)
    expect(calls[0]?.argv).toContain('-Kneato')
  })

  it('强制导向引擎的小 DOT 仍走 WASM（无 spawn）', async () => {
    const dir = await tempDir()
    const { calls, runtime } = fakeCli()
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ outputDir: dir, engine: 'neato' }))
    expect(outcome.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('分层引擎的 WASM 上限更高：同一 DOT 在 dot 引擎下仍走 WASM', async () => {
    const dir = await tempDir()
    const { calls, runtime } = fakeCli()
    const medium = `digraph {${'a -> b; '.repeat(3_000)}}`
    expect(medium.length).toBeGreaterThan(20_000)
    expect(medium.length).toBeLessThan(64_000)
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ outputDir: dir, engine: 'dot', dot: medium }))
    expect(outcome.ok).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('分层引擎超过 64 KB 同样改走 CLI', async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const huge = `digraph {${'a -> b; '.repeat(8_000)}}`
    expect(huge.length).toBeGreaterThan(64_000)
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizExecutable: dotPath, graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(
      spec({ outputDir: dir, engine: 'dot', dot: huge }),
    )
    expect(outcome.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('超限输入在无 subprocess 时返回 not_installed（改走 CLI 的代价）', async () => {
    const big = `digraph {${'a -> b; '.repeat(2_500)}}`
    const outcome = await pickRenderer('wasm', { graphvizRenderTimeoutMs: TEST_RENDER_TIMEOUT_MS })(spec({ engine: 'sfdp', dot: big }))
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
  })

  it('病态/超大 DOT 改走 CLI 后在注入的期限内失败返回，而不是占住事件循环', async () => {
    vi.useFakeTimers()
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { runtime, calls } = hangingCli()
    try {
      const big = `digraph {${'a -> b; '.repeat(2_500)}}`
      const pending = pickRenderer('wasm', { subprocess: runtime, graphvizExecutable: dotPath, graphvizRenderTimeoutMs: INJECTED_RENDER_TIMEOUT_MS })(
        spec({ outputDir: dir, engine: 'neato', dot: big }),
      )
      vi.advanceTimersByTime(INJECTED_RENDER_TIMEOUT_MS)
      const outcome = await pending
      expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
      expect(!outcome.ok && outcome.error).toContain('渲染超时')
      expect(calls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
