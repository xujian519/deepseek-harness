import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_FREECAD_PROBE_TIMEOUT_MS,
  DEFAULT_FREECAD_RENDER_TIMEOUT_MS,
  FREECAD_CMD_CANDIDATES,
  findFreeCadCmd,
  freecadInstallMessage,
  probeFreeCad,
  renderStructureViews,
  type StructureRenderSpec,
} from '../src/figure/freecad-renderer.ts'

/** 用例显式声明的渲染预算（毫秒）；生产由宿主 Config.freecadRenderTimeoutMs 解析后注入。 */
const TEST_RENDER_TIMEOUT_MS = DEFAULT_FREECAD_RENDER_TIMEOUT_MS

/** 用例显式声明的探测预算（毫秒）；宿主插件不探测 freecadcmd，无对应 Config 字段。 */
const TEST_PROBE_TIMEOUT_MS = DEFAULT_FREECAD_PROBE_TIMEOUT_MS

/** 渲染超时用例注入的非默认预算（毫秒）：证明期限取自注入值而非渲染器模块默认值。 */
const INJECTED_RENDER_TIMEOUT_MS = 1_500
import { STRUCTURE_MANIFEST_FILENAME } from '../src/figure/freecad-structure-script.ts'

// Deterministic discovery: the built-in candidate list is absolute system paths;
// existsSync returns whether the test put the candidate into the set. The
// hoisted copy must stay in sync with FREECAD_CMD_CANDIDATES (asserted below).
const mockFs = vi.hoisted(() => ({
  candidates: [
    '/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd',
    '/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd',
    '/usr/bin/freecadcmd',
    '/usr/local/bin/freecadcmd',
    '/opt/homebrew/bin/freecadcmd',
    '/snap/bin/freecadcmd',
    'C:\\Program Files\\FreeCAD 1.1\\bin\\FreeCADCmd.exe',
    'C:\\Program Files\\FreeCAD\\bin\\FreeCADCmd.exe',
  ],
  existing: new Set<string>(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: ((p: unknown) => {
      const path = String(p)
      if (mockFs.candidates.includes(path)) return mockFs.existing.has(path)
      return actual.existsSync(p as Parameters<typeof actual.existsSync>[0])
    }) as typeof actual.existsSync,
  }
})

function handleWith(outcome: { exitCode: number | null; signal: NodeJS.Signals | null }, stderr = '', stdout = ''): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve(outcome),
    terminate() {},
    waitForExit: () => Promise.resolve(true),
  }
}

function fakeSubprocess(
  onSpawn: (_spec: SubprocessSpawnSpec) => SubprocessHandle,
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

function cleanEnv(): void {
  delete process.env.DSH_FREECAD_CMD
  mockFs.existing.clear()
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-freecad-'))
}

/** 写一个假的 freecadcmd 可执行文件，作为 override 路径（走真实 existsSync）。 */
function fakeFreecad(): { dir: string; exe: string } {
  const dir = tempDir()
  const exe = join(dir, 'freecadcmd')
  writeFileSync(exe, '')
  return { dir, exe }
}

function spec(overrides: Partial<StructureRenderSpec> = {}): StructureRenderSpec {
  return {
    modelPath: '/abs/model.step',
    views: ['iso', 'front'],
    scale: 1,
    showHidden: false,
    callouts: [],
    figureNumber: 1,
    outputDir: tempDir(),
    ...overrides,
  }
}

afterEach(() => {
  cleanEnv()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('findFreeCadCmd', () => {
  it('测试候选清单与源码 FREECAD_CMD_CANDIDATES 保持一致', () => {
    expect(mockFs.candidates).toEqual([...FREECAD_CMD_CANDIDATES])
  })

  it('override 存在时优先使用（不存在则未找到，不回落）', () => {
    const { dir, exe } = fakeFreecad()
    try {
      expect(findFreeCadCmd(exe)).toBe(exe)
      expect(findFreeCadCmd(join(dir, 'missing'))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('按 DSH_FREECAD_CMD → 候选路径 → PATH 顺序解析', () => {
    const { dir, exe } = fakeFreecad()
    try {
      process.env.DSH_FREECAD_CMD = exe
      expect(findFreeCadCmd()).toBe(exe)

      process.env.DSH_FREECAD_CMD = join(dir, 'missing')
      const candidate = mockFs.candidates[0] as string
      mockFs.existing.add(candidate)
      expect(findFreeCadCmd()).toBe(candidate)

      delete process.env.DSH_FREECAD_CMD
      mockFs.existing.clear()
      const originalPath = process.env.PATH
      process.env.PATH = dir + (originalPath === undefined ? '' : `:${originalPath}`)
      expect(findFreeCadCmd()).toBe(join(dir, 'freecadcmd'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PATH 未定义或含空段时安全跳过并回落', () => {
    const originalPath = process.env.PATH
    try {
      delete process.env.PATH
      expect(findFreeCadCmd()).toBeUndefined()
      process.env.PATH = ':'
      expect(findFreeCadCmd()).toBeUndefined()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })
})

describe('freecadInstallMessage', () => {
  it('未找到与路径失效分别给出引导', () => {
    expect(freecadInstallMessage(undefined)).toContain('FreeCAD')
    expect(freecadInstallMessage(undefined)).toContain('DSH_FREECAD_CMD')
    expect(freecadInstallMessage('/no/freecadcmd')).toContain('/no/freecadcmd')
  })
})

describe('probeFreeCad', () => {
  it('--version 成功时报告就绪与版本', async () => {
    const { exe } = fakeFreecad()
    const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }, '', 'FreeCAD 1.1.3 Revision: 20260725 (Git shallow)'))
    const result = await probeFreeCad(runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(result.ready).toBe(true)
    expect(result.version).toBe('1.1.3')
    expect(calls[0]?.argv).toEqual([exe, '--version'])
  })

  it('--version 成功但无版本号时仍就绪', async () => {
    const { exe } = fakeFreecad()
    const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }, '', 'FreeCAD'))
    const result = await probeFreeCad(runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(result).toEqual({ ready: true, executable: exe })
  })

  it('非零退出、信号终止与 spawn 异常时报告未就绪', async () => {
    const { exe } = fakeFreecad()
    const failed = await probeFreeCad(fakeSubprocess(() => handleWith({ exitCode: 1, signal: null }, 'bad')).runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(failed.ready).toBe(false)
    expect(failed.message).toContain('退出码 1')

    const signalled = await probeFreeCad(fakeSubprocess(() => handleWith({ exitCode: null, signal: 'SIGTERM' })).runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(signalled.ready).toBe(false)
    expect(signalled.message).toContain('退出码 未知')

    const caught = await probeFreeCad(fakeSubprocess(() => { throw new Error('boom') }).runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(caught.ready).toBe(false)
    expect(caught.message).toContain('boom')

    const caughtPlain = await probeFreeCad(fakeSubprocess(() => { throw 'plain-boom' }).runtime, { executable: exe, probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
    expect(caughtPlain.ready).toBe(false)
    expect(caughtPlain.message).toContain('plain-boom')
  })

  it('找不到可执行文件时返回安装引导', async () => {
    const dir = tempDir()
    try {
      process.env.PATH = dir
      const result = await probeFreeCad(
        fakeSubprocess(() => handleWith({ exitCode: 0, signal: null })).runtime,
        { probeTimeoutMs: TEST_PROBE_TIMEOUT_MS },
      )
      expect(result.ready).toBe(false)
      expect(result.message).toContain('FreeCAD')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('renderStructureViews', () => {
  it('成功：写脚本、隔离 env、返回 manifest 路径', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const { runtime, calls } = fakeSubprocess((spawnSpec) => {
        // 模拟 FreeCAD 子进程：在 cwd（=outputDir）写出 manifest.json 后退出 0。
        writeFileSync(join(spawnSpec.cwd, STRUCTURE_MANIFEST_FILENAME), '{"views":[{"name":"iso"}]}')
        return handleWith({ exitCode: 0, signal: null })
      })
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toEqual({ ok: true, manifestPath: join(outputDir, STRUCTURE_MANIFEST_FILENAME) })

      const call = calls[0]!
      expect(call.argv[0]).toBe(exe)
      expect((call.argv[1] as string).endsWith('.py')).toBe(true)
      expect(call.cwd).toBe(outputDir)
      // 子进程 HOME/缓存/临时目录隔离到 outputDir 内子目录
      expect(call.env?.HOME).toBe(join(outputDir, '.freecad-home'))
      expect(call.env?.XDG_CACHE_HOME).toContain(outputDir)
      expect(call.graceMs).toBe(3_000)
      // 脚本已写入且含实测 API
      const script = readFileSync(call.argv[1] as string, 'utf8')
      expect(script).toContain('TechDraw.viewPartAsSvg')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('outputDir 不存在时自动创建', async () => {
    const { exe } = fakeFreecad()
    const base = tempDir()
    const outputDir = join(base, 'nested', 'fig1')
    try {
      const { runtime } = fakeSubprocess((spawnSpec) => {
        writeFileSync(join(spawnSpec.cwd, STRUCTURE_MANIFEST_FILENAME), '{"views":[]}')
        return handleWith({ exitCode: 0, signal: null })
      })
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result.ok).toBe(true)
      expect(existsSync(outputDir)).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('未安装时返回 not_installed', async () => {
    const dir = tempDir()
    try {
      process.env.PATH = dir
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await renderStructureViews(runtime, spec({ outputDir: dir }), { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toMatchObject({ ok: false, code: 'not_installed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('非零退出回传 stderr 摘录（cfg/transcoder 告警非致命，仅退出码判定）', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 1, signal: null }, 'Traceback: RuntimeError 投影未产生任何几何'))
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('退出码 1')
      expect((result as { error: string }).error).toContain('投影未产生任何几何')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('退出 0 但未生成 manifest 时报 render_failed', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('未生成 manifest')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('被信号终止且无调用方取消时报告 render_failed', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: null, signal: null }))
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('被信号 未知 终止')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('调用方取消且 spawn 抛错时分类为 aborted', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const caller = new AbortController()
      const { runtime } = fakeSubprocess(() => {
        caller.abort()
        throw new Error('boom')
      })
      const result = await renderStructureViews(
        runtime,
        spec({ outputDir, signal: caller.signal }),
        { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS },
      )
      expect(result).toMatchObject({ ok: false, code: 'aborted' })
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('非 Error 抛出也分类为 render_failed', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const { runtime } = fakeSubprocess(() => { throw 'plain-boom' })
      const result = await renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('plain-boom')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('预中止信号传入子进程', async () => {
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      const caller = new AbortController()
      caller.abort()
      const { runtime, calls } = fakeSubprocess((spawnSpec) => {
        writeFileSync(join(spawnSpec.cwd, STRUCTURE_MANIFEST_FILENAME), '{"views":[]}')
        return handleWith({ exitCode: 0, signal: null })
      })
      await renderStructureViews(
        runtime,
        spec({ outputDir, signal: caller.signal }),
        { executable: exe, renderTimeoutMs: TEST_RENDER_TIMEOUT_MS },
      )
      expect(calls[0]?.signal?.aborted).toBe(true)
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('渲染超时（内部计时器）分类为 render_failed', async () => {
    vi.useFakeTimers()
    const { exe } = fakeFreecad()
    const outputDir = tempDir()
    try {
      let signal: AbortSignal | undefined
      const { runtime } = fakeSubprocess((spawnSpec) => {
        signal = spawnSpec.signal
        mkdirSync(spawnSpec.cwd, { recursive: true })
        return {
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          control: undefined,
          collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
          done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            signal?.addEventListener('abort', () => { resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
          }),
          terminate() {},
          waitForExit: () => Promise.resolve(true),
        }
      })
      const pending = renderStructureViews(runtime, spec({ outputDir }), { executable: exe, renderTimeoutMs: INJECTED_RENDER_TIMEOUT_MS })
      vi.advanceTimersByTime(INJECTED_RENDER_TIMEOUT_MS)
      const result = await pending
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('渲染超时')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
