import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS,
  INKSCAPE_CANDIDATES,
  findInkscape,
  inkscapeInstallMessage,
  outlineSvgText,
} from '../src/figure/inkscape-renderer.ts'
import type { SubprocessSpawner } from '../src/figure/subprocess-render.ts'

/** 用例显式声明的转换预算（毫秒）；生产由宿主 Config.inkscapeRenderTimeoutMs 解析后注入。 */
const TEST_RENDER_TIMEOUT_MS = DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS

// Deterministic discovery: the built-in candidate list is absolute system paths;
// existsSync returns whether the test put the candidate into the set (the
// hoisted copy must stay in sync with INKSCAPE_CANDIDATES, asserted below).
const mockFs = vi.hoisted(() => ({
  candidates: [
    '/opt/homebrew/bin/inkscape',
    '/usr/local/bin/inkscape',
    '/usr/bin/inkscape',
    '/snap/bin/inkscape',
    '/Applications/Inkscape.app/Contents/MacOS/inkscape',
    'C:\\Program Files\\Inkscape\\bin\\inkscape.exe',
    'C:\\Program Files (x86)\\Inkscape\\bin\\inkscape.exe',
  ],
  existing: new Set<string>(),
}))

// 原子写可被单次置为失败：用于验证「写回失败不留下半个文件」这条路径（不靠文件权限，
// 以管理员身份或 Windows 上同样可复现）。
const mockAtomic = vi.hoisted(() => ({ fail: false }))

vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return {
    ...actual,
    writeFileAtomic: (file: string, data: string, options: { mode: number }) =>
      mockAtomic.fail ? Promise.reject(new Error('EACCES')) : actual.writeFileAtomic(file, data, options),
  }
})

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

/** 已生成图形的样本（画布尺寸与线宽是转换必须保留的值）。 */
function sampleSvg(text = '<text x="1" y="2" font-size="3">接地</text>'): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20">',
    `  <g fill="none" stroke="#000000" stroke-width="0.35"><line x1="1" y1="1" x2="5" y2="5" stroke-width="0.25"/>${text}</g>`,
    '</svg>',
    '',
  ].join('\n')
}

/** 转换产物样本：文字已换成路径。 */
const OUTLINED = [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20">',
  '  <g fill="none" stroke="#000000" stroke-width="0.35"><line x1="1" y1="1" x2="5" y2="5" stroke-width="0.25"/><path d="M 1 2 h 3 v 3 z"/></g>',
  '</svg>',
  '',
].join('\n')

function handleWith(outcome: { exitCode: number | null; signal: NodeJS.Signals | null }, stderr = ''): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: 0, lossy: false }) },
    },
    done: Promise.resolve(outcome),
    terminate() {},
    waitForExit: () => Promise.resolve(true),
  }
}

/**
 * 假 subprocess：记录 spawn 规格，并在每次 spawn 时按需伪造产物文件。
 * @param onSpawn - 收到 spawn 规格后返回句柄；可在此写产物文件。
 * @returns 运行时与调用记录。
 */
function fakeSubprocess(
  onSpawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
): { runtime: SubprocessSpawner; calls: SubprocessSpawnSpec[] } {
  const calls: SubprocessSpawnSpec[] = []
  const runtime = {
    spawn: (spec: SubprocessSpawnSpec): SubprocessHandle => {
      calls.push(spec)
      return onSpawn(spec)
    },
  }
  return { runtime, calls }
}

/** 从 spawn 规格里取出 `--export-filename=` 指向的产物路径。 */
function outputPathOf(spec: SubprocessSpawnSpec): string {
  const flag = spec.argv.find(argument => argument.startsWith('--export-filename='))
  if (flag === undefined) throw new Error('spawn 规格里没有 --export-filename')
  return flag.slice('--export-filename='.length)
}

const dirs: string[] = []
afterEach(() => {
  mockFs.existing.clear()
  mockAtomic.fail = false
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 造一个已生成图形的临时文件。 */
function figureFile(body = sampleSvg()): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-outline-spec-'))
  dirs.push(dir)
  const path = join(dir, 'fig1.svg')
  writeFileSync(path, body, 'utf8')
  return path
}

describe('findInkscape', () => {
  it('候选路径表与用例副本一致', () => {
    expect([...INKSCAPE_CANDIDATES]).toEqual(mockFs.candidates)
  })

  it('覆盖路径不存在时不回落自动探测', () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    expect(findInkscape('/nope/inkscape')).toBeUndefined()
    expect(findInkscape('/opt/homebrew/bin/inkscape')).toBe('/opt/homebrew/bin/inkscape')
    expect(findInkscape()).toBe('/opt/homebrew/bin/inkscape')
    expect(findInkscape('')).toBe('/opt/homebrew/bin/inkscape')
  })

  it('环境变量与候选路径都缺失时返回 undefined', () => {
    const previous = process.env.DSH_INKSCAPE
    process.env.DSH_INKSCAPE = '/nope/inkscape'
    try {
      expect(findInkscape()).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.DSH_INKSCAPE
      else process.env.DSH_INKSCAPE = previous
    }
  })

  it('安装引导给出缺失提示与开启开关的退路', () => {
    expect(inkscapeInstallMessage(undefined)).toContain('未找到 Inkscape')
    expect(inkscapeInstallMessage('/x/inkscape')).toContain('已配置路径 /x/inkscape')
    expect(inkscapeInstallMessage(undefined)).toContain('Config.figureTextToPath')
  })
})

describe('outlineSvgText', () => {
  it('未安装 Inkscape 时返回 not_installed 且不改写文件', async () => {
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'not_installed' })
    expect(calls).toHaveLength(0)
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('转换成功时就地改写文件，argv 直传且输出写临时目录', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const { runtime, calls } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), OUTLINED, 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toEqual({ ok: true })
    expect(readFileSync(path, 'utf8')).toBe(OUTLINED)
    const call = calls[0] as SubprocessSpawnSpec
    expect(call.argv.slice(1, 4)).toEqual(['--export-type=svg', '--export-plain-svg', '--export-text-to-path'])
    expect(call.argv.at(-1)).toBe(path)
    // 产物写在临时目录（不与图形同目录），且转换后临时目录被清理。
    const outputPath = outputPathOf(call)
    expect(outputPath.startsWith(tmpdir())).toBe(true)
    expect(existsSync(outputPath)).toBe(false)
    expect(call.stdio?.stdin).toBe('ignore')
  })

  it('产物仍含 <text> 时报 render_failed，绝不交出仍有字体依赖的文件', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    const { runtime } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), sampleSvg(), 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('仍含 `<text>`')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('产物含实体或 CDATA 时按安全校验拒绝', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const { runtime } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), '<svg xmlns="http://www.w3.org/2000/svg"><g><![CDATA[x]]></g></svg>', 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('SVG 校验失败')
  })

  it('产物几何走样时报 render_failed，原文件不改写', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    const { runtime } = fakeSubprocess((spec) => {
      // 产物把图形整体挪到画布外：几何护栏必须拦下（否则会静默替换掉一张好图）。
      writeFileSync(outputPathOf(spec), OUTLINED.replace('<line x1="1" y1="1" x2="5" y2="5" stroke-width="0.25"/>', '<line x1="90" y1="90" x2="95" y2="95" stroke-width="0.25"/>'), 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('几何走样')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('产物里没有可量测图形时报 render_failed', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    const { runtime } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="20mm" viewBox="0 0 30 20"></svg>', 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('没有可量测的图形')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('写回失败时报 render_failed，原文件保持原样', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    mockAtomic.fail = true
    const { runtime } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), OUTLINED, 'utf8')
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('EACCES')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('待转换文件读不到时报 render_failed，不启动子进程', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const { runtime, calls } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
    const outcome = await outlineSvgText(runtime, { path: join(tmpdir(), 'dsh-outline-missing.svg') }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('读取待转换的 SVG 失败')
    expect(calls).toHaveLength(0)
  })

  it('子进程退出后、写回前被取消：不改写文件并报 aborted', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const before = readFileSync(path, 'utf8')
    const controller = new AbortController()
    const { runtime } = fakeSubprocess((spec) => {
      writeFileSync(outputPathOf(spec), OUTLINED, 'utf8')
      controller.abort()
      return handleWith({ exitCode: 0, signal: null })
    })
    const outcome = await outlineSvgText(runtime, { path, signal: controller.signal }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'aborted' })
    expect(readFileSync(path, 'utf8')).toBe(before)
  })

  it('退出码非零时报 render_failed 并带上 stderr', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 1, signal: null }, 'boom'))
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('退出码 1')
    expect(outcome.ok ? '' : outcome.error).toContain('boom')
  })

  it('未生成产物文件时报 render_failed', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const { runtime } = fakeSubprocess(() => handleWith({ exitCode: 0, signal: null }))
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('未生成输出文件')
  })

  it('调用方取消时报 aborted', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const controller = new AbortController()
    controller.abort()
    const { runtime } = fakeSubprocess(() => handleWith({ exitCode: null, signal: 'SIGTERM' }))
    const outcome = await outlineSvgText(runtime, { path, signal: controller.signal }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'aborted' })
  })

  it('spawn 抛错时报 render_failed', async () => {
    mockFs.existing.add('/opt/homebrew/bin/inkscape')
    const path = figureFile()
    const runtime: SubprocessSpawner = {
      spawn: () => { throw new Error('spawn 不可用') },
    }
    const outcome = await outlineSvgText(runtime, { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(outcome.ok ? '' : outcome.error).toContain('spawn 不可用')
  })
})
