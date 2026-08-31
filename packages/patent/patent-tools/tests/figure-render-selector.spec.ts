import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { pickRenderer } from '../src/figure/render-selector.ts'
import type { GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'

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
    pid: 7,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
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

/** onSpawn 侧预写 dot 输出占位文件（渲染器在退出码 0 后校验文件存在）。 */
function fakeCli(): { runtime: SubprocessRuntime; calls: SubprocessSpawnSpec[] } {
  return fakeSubprocess((spawnSpec) => {
    const out = spawnSpec.argv[spawnSpec.argv.indexOf('-o') + 1]
    if (out !== undefined) writeFileSync(out, 'cli-placeholder')
    return cliHandle()
  })
}

describe('pickRenderer', () => {
  it('默认（未配置）走 WASM：svg 无 subprocess 也渲染成功', async () => {
    const dir = await tempDir()
    const render = pickRenderer(undefined, {})
    const outcome = await render(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(await readFile(outcome.path, 'utf8')).toContain('<svg')
  })

  it("mode='wasm' 显式选择同样走内置引擎", async () => {
    const dir = await tempDir()
    const outcome = await pickRenderer('wasm', {})(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
  })

  it("mode='wasm' 时 png 路由到 CLI 兜底（argv -Tpng、指定 dot 路径生效）", async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const outcome = await pickRenderer('wasm', { subprocess: runtime, graphvizExecutable: dotPath })(spec({ outputDir: dir, format: 'png' }))
    expect(outcome.ok).toBe(true)
    expect(calls[0]?.argv[0]).toBe(dotPath)
    expect(calls[0]?.argv).toContain('-Tpng')
  })

  it("mode='cli' 走系统 dot 子进程（argv -Tsvg）", async () => {
    const dir = await tempDir()
    const dotPath = join(dir, 'dot')
    writeFileSync(dotPath, '')
    const { calls, runtime } = fakeCli()
    const outcome = await pickRenderer('cli', { subprocess: runtime, graphvizExecutable: dotPath })(spec({ outputDir: dir }))
    expect(outcome.ok).toBe(true)
    expect(calls[0]?.argv).toContain('-Tsvg')
  })

  it("mode='wasm' 时 pdf 无 subprocess → not_installed（兜底不可用）", async () => {
    const outcome = await pickRenderer('wasm', {})(spec({ format: 'pdf' }))
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
  })

  it("mode='cli' 无 subprocess → not_installed 并指明服务缺失", async () => {
    const outcome = await pickRenderer('cli', {})(spec({}))
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
    expect(!outcome.ok && outcome.error).toContain('subprocess')
  })
})
