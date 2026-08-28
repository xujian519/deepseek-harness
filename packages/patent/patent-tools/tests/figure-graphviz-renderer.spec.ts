import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  DOT_CANDIDATES,
  findDot,
  graphvizInstallMessage,
  probeGraphviz,
  renderWithGraphviz,
  sanitizeDotFilename,
} from '../src/figure/graphviz-renderer.ts'

// Deterministic discovery: the built-in candidate list is absolute system
// paths; existsSync returns whether the test put the candidate into the set.
// The hoisted copy must stay in sync with DOT_CANDIDATES (asserted below).
const mockFs = vi.hoisted(() => ({
  candidates: [
    '/opt/homebrew/bin/dot',
    '/usr/local/bin/dot',
    '/opt/local/bin/dot',
    '/usr/bin/dot',
    'C:\\Program Files\\Graphviz\\bin\\dot.exe',
    'C:\\Program Files (x86)\\Graphviz\\bin\\dot.exe',
    'C:\\ProgramData\\chocolatey\\bin\\dot.exe',
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

// dirname(absolute) never returns '' on POSIX; the empty-dirname cwd fallback
// is exercised through a marker path (same trick as pdf-renderer.spec).
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>()
  return {
    ...actual,
    dirname: (p: string) => (p.includes('__empty_dirname__') ? '' : actual.dirname(p)),
  }
})

function handleWith(outcome: { exitCode: number | null; signal: NodeJS.Signals | null }, stderr = ''): SubprocessHandle {
  return {
    pid: 7,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: stderr, nextOffset: 0, lossy: false }) } },
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
  delete process.env.DSH_GRAPHVIZ_DOT
  mockFs.existing.clear()
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-dot-'))
}

function fakeDot(): { dir: string; dot: string } {
  const dir = tempDir()
  const dot = join(dir, 'dot')
  writeFileSync(dot, '')
  return { dir, dot }
}

afterEach(() => {
  cleanEnv()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('findDot', () => {
  it('测试候选清单与源码 DOT_CANDIDATES 保持一致', () => {
    expect(mockFs.candidates).toEqual([...DOT_CANDIDATES])
  })

  it('PATH 未定义或含空段时安全跳过并回落', () => {
    const originalPath = process.env.PATH
    try {
      delete process.env.PATH
      expect(findDot()).toBeUndefined()
      process.env.PATH = ':' // 只有空段
      expect(findDot()).toBeUndefined()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it('override 存在时优先使用（不存在则未找到，不回落）', () => {
    const dir = tempDir()
    try {
      const dot = join(dir, 'my-dot')
      writeFileSync(dot, '')
      expect(findDot(dot)).toBe(dot)
      expect(findDot(join(dir, 'missing'))).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('按 DSH_GRAPHVIZ_DOT → 候选路径 → PATH 顺序解析', () => {
    const dir = tempDir()
    try {
      const envDot = join(dir, 'env-dot')
      writeFileSync(envDot, '')
      process.env.DSH_GRAPHVIZ_DOT = envDot
      expect(findDot()).toBe(envDot)

      process.env.DSH_GRAPHVIZ_DOT = join(dir, 'missing-env-dot')
      const candidate = mockFs.candidates[0] as string
      mockFs.existing.add(candidate)
      expect(findDot()).toBe(candidate)

      delete process.env.DSH_GRAPHVIZ_DOT
      mockFs.existing.clear()
      const originalPath = process.env.PATH
      process.env.PATH = dir + (originalPath === undefined ? '' : `:${originalPath}`)
      writeFileSync(join(dir, 'dot'), '')
      expect(findDot()).toBe(join(dir, 'dot'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('graphvizInstallMessage', () => {
  it('未找到与路径失效分别给出引导', () => {
    expect(graphvizInstallMessage(undefined)).toContain('brew install graphviz')
    expect(graphvizInstallMessage('/no/dot')).toContain('/no/dot')
  })
})

describe('probeGraphviz', () => {
  it('dot -V 成功时报告就绪与版本', async () => {
    const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }, 'dot - graphviz version 12.2.1'))
    const { dot: dotPath } = fakeDot()
    const result = await probeGraphviz(runtime, dotPath)
    expect(result.ready).toBe(true)
    expect(result.version).toBe('12.2.1')
    expect(calls[0]?.argv).toEqual([dotPath, '-V'])
  })

  it('dot -V 成功但无输出流时仍就绪（无版本号）', async () => {
    const { dot: dotPath } = fakeDot()
    const { runtime } = fakeSubprocess(() => ({
      pid: 7,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {},
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate() {},
      waitForExit: () => Promise.resolve(true),
    }))
    const result = await probeGraphviz(runtime, dotPath)
    expect(result).toEqual({ ready: true, executable: dotPath })
  })

  it('dot -V 非零退出、信号终止与 spawn 异常时报告未就绪', async () => {
    const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 1, signal: null }, 'bad'))
    const { dot: dotPath2 } = fakeDot()
    const failed = await probeGraphviz(runtime, dotPath2)
    expect(failed.ready).toBe(false)
    expect(failed.message).toContain('退出码 1')

    const { runtime: nullExit } = fakeSubprocess(() => handleWith({ exitCode: null, signal: 'SIGTERM' }))
    const { dot: dotPath3 } = fakeDot()
    const signalled = await probeGraphviz(nullExit, dotPath3)
    expect(signalled.ready).toBe(false)
    expect(signalled.message).toContain('退出码 未知')

    const { runtime: throwing } = fakeSubprocess(() => {
      throw new Error('boom')
    })
    const { dot: dotPath4 } = fakeDot()
    const caught = await probeGraphviz(throwing, dotPath4)
    expect(caught.ready).toBe(false)
    expect(caught.message).toContain('boom')

    const { runtime: throwingPlain } = fakeSubprocess(() => {
      throw 'plain-boom'
    })
    const { dot: dotPath5 } = fakeDot()
    const caughtPlain = await probeGraphviz(throwingPlain, dotPath5)
    expect(caughtPlain.ready).toBe(false)
    expect(caughtPlain.message).toContain('plain-boom')
  })

  it('可执行路径无目录（marker 仿真）时以 cwd 回退', async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, '__empty_dirname__'), { recursive: true })
      const dotPath = join(dir, '__empty_dirname__', 'dot')
      writeFileSync(dotPath, '')
      const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await probeGraphviz(runtime, dotPath)
      expect(result.ready).toBe(true)
      expect(calls[0]?.cwd).toBe(process.cwd())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('找不到可执行文件时返回安装引导', async () => {
    const dir = tempDir()
    try {
      process.env.PATH = dir // 空 PATH（无 dot）
      const result = await probeGraphviz(fakeSubprocess(() => handleWith({ exitCode: 0, signal: null })).runtime)
      expect(result.ready).toBe(false)
      expect(result.message).toContain('brew install graphviz')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('sanitizeDotFilename', () => {
  it('清洗非法字符并回退空名', () => {
    expect(sanitizeDotFilename('fig1')).toBe('fig1')
    expect(sanitizeDotFilename('a/b\\c')).toBe('a_b_c')
    expect(sanitizeDotFilename('')).toBe('diagram')
  })
})

describe('renderWithGraphviz', () => {
  function okOutput(filename = 'fig1'): string {
    const dir = tempDir()
    const path = join(dir, `${filename}.svg`)
    writeFileSync(path, '<svg/>')
    return path
  }

  it('成功渲染：argv/stdin/cwd 正确并返回输出路径', async () => {
    const path = okOutput('fig-1')
    const outputDir = dirname(path)
    try {
      const { dot: dotPath } = fakeDot()
      const { runtime, calls } = fakeSubprocess((_spec) => {
        return handleWith({ exitCode: 0, signal: null })
      })
      const result = await renderWithGraphviz(runtime, {
        dot: 'digraph G {}',
        filename: 'fig-1',
        format: 'svg',
        engine: 'dot',
        outputDir,
      }, dotPath)
      expect(result).toEqual({ ok: true, path })
      const argv = calls[0]?.argv as string[]
      expect(argv).toEqual([dotPath, '-Tsvg', '-Kdot', '-o', path, '-'])
      expect(calls[0]?.cwd).toBe(outputDir)
      expect(calls[0]?.stdio).toEqual({ stdin: { data: 'digraph G {}' }, stdout: { maxBytes: 100_000 }, stderr: { maxBytes: 100_000 } })
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })

  it('未安装时返回 not_installed；空 DOT 走 stdin ignore', async () => {
    const dir = tempDir()
    try {
      process.env.PATH = dir
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await renderWithGraphviz(runtime, { dot: '', filename: 'x', format: 'svg', engine: 'dot', outputDir: dir })
      expect(result).toMatchObject({ ok: false, code: 'not_installed' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('渲染超时（内部计时器）分类为 render_failed', async () => {
    vi.useFakeTimers()
    const dir = tempDir()
    try {
      let signal: AbortSignal | undefined
      const { dot: dotPath } = fakeDot()
      const { runtime, calls } = fakeSubprocess((spec) => {
        signal = spec.signal
        return {
          pid: 7,
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) }, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
          done: new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            signal?.addEventListener('abort', () => { resolve({ exitCode: null, signal: 'SIGTERM' }) }, { once: true })
          }),
          terminate() {},
          waitForExit: () => Promise.resolve(true),
        }
      })
      const pending = renderWithGraphviz(runtime, { dot: 'digraph {}', filename: 'x', format: 'svg', engine: 'dot', outputDir: dir }, dotPath)
      vi.advanceTimersByTime(60_000)
      const result = await pending
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('渲染超时')
      expect(calls.length).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('空 DOT 走 stdin ignore 且成功渲染', async () => {
    const { dot: dotPath } = fakeDot()
    const dir = tempDir()
    try {
      writeFileSync(join(dir, 'f.svg'), '<svg/>')
      const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await renderWithGraphviz(runtime, { dot: '', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir }, dotPath)
      expect(result).toEqual({ ok: true, path: join(dir, 'f.svg') })
      expect(calls[0]?.stdio).toEqual({ stdin: 'ignore', stdout: { maxBytes: 100_000 }, stderr: { maxBytes: 100_000 } })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('被信号终止且无调用方取消时报告 render_failed', async () => {
    const dir = tempDir()
    try {
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: null, signal: null }))
      const result = await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir }, dotPath)
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('被信号 未知 终止')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('调用方取消且 spawn 抛错时分类为 aborted', async () => {
    const dir = tempDir()
    try {
      const caller = new AbortController()
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess(() => {
        caller.abort()
        throw new Error('boom')
      })
      const result = await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir, signal: caller.signal }, dotPath)
      expect(result).toMatchObject({ ok: false, code: 'aborted' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('非 Error 抛出也分类为 render_failed', async () => {
    const dir = tempDir()
    try {
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess(() => {
        throw 'plain-boom'
      })
      const result = await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir }, dotPath)
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('plain-boom')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('预中止信号传入子进程', async () => {
    const dir = tempDir()
    try {
      const caller = new AbortController()
      caller.abort()
      const { dot: dotPath } = fakeDot()
      const { runtime, calls } = fakeSubprocess((_spec) => {
        return handleWith({ exitCode: 0, signal: null })
      })
      await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir, signal: caller.signal }, dotPath)
      expect(calls[0]?.signal?.aborted).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('调用方取消与 spawn 异常分类正确', async () => {
    const dir = tempDir()
    try {
      const caller = new AbortController()
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess((_spec) => {
        caller.abort()
        return {
          pid: 7,
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          collected: {},
          done: Promise.resolve({ exitCode: null, signal: 'SIGTERM' }),
          terminate() {},
          waitForExit: () => Promise.resolve(true),
        }
      })
      const aborted = await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir, signal: caller.signal }, dotPath)
      expect(aborted).toMatchObject({ ok: false, code: 'aborted' })

      const { dot: dotPath2 } = fakeDot()
      const { runtime: runtime2 } = fakeSubprocess(() => {
        throw new Error('spawn boom')
      })
      const failed = await renderWithGraphviz(runtime2, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir }, dotPath2)
      expect(failed).toMatchObject({ ok: false, code: 'render_failed' })
      expect((failed as { error: string }).error).toContain('spawn boom')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('零退出但未生成输出文件时报 render_failed', async () => {
    const dir = tempDir()
    try {
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
      const result = await renderWithGraphviz(runtime, { dot: 'x', filename: 'never', format: 'png', engine: 'dot', outputDir: dir }, dotPath)
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('未生成输出文件')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('非零退出回传 stderr 摘录', async () => {
    const dir = tempDir()
    try {
      const { dot: dotPath } = fakeDot()
      const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 2, signal: null }, 'syntax error'))
      const result = await renderWithGraphviz(runtime, { dot: 'x', filename: 'f', format: 'svg', engine: 'dot', outputDir: dir }, dotPath)
      expect(result).toMatchObject({ ok: false, code: 'render_failed' })
      expect((result as { error: string }).error).toContain('syntax error')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
