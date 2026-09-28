import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { buildCircuitDiagram } from '../src/figure/circuit-diagram.ts'
import { DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS, findInkscape, outlineSvgText } from '../src/figure/inkscape-renderer.ts'
import { checkFigureRendering } from '../src/figure/render-check.ts'
import type { SubprocessSpawner } from '../src/figure/subprocess-render.ts'
import { vectorFigureSvg } from '../src/figure/vector-figure.ts'

/**
 * 真实 Inkscape 端到端 smoke：仅在本机装有 Inkscape 时运行（无 Inkscape 环境
 * 整组跳过）。走真实子进程（node:child_process 适配 SubprocessRuntime 接口），
 * 验证「已生成附图 → 文字转轮廓路径」的完整链路：文字消失、画布与几何逐值保持、
 * 转换后的文件仍能通过渲染复核。
 *
 * CI 上没有这条链路的信号：`.github/workflows/ci-fork.yml` 只装 graphviz 与
 * fonts-noto-cjk，不装 Inkscape（本机开发环境装了），所以 CI 上这一组必然跳过，
 * 跳过即「无信号」而不是「通过」；要信号得把 Inkscape 装进 CI 镜像。
 */

/** 无 Inkscape 时跳过端到端 suite。 */
const hasInkscape = findInkscape() !== undefined

/** 用例显式声明的转换预算（毫秒）；生产由宿主 Config.inkscapeRenderTimeoutMs 解析后注入。 */
const TEST_RENDER_TIMEOUT_MS = DEFAULT_INKSCAPE_RENDER_TIMEOUT_MS

/** 将 node:child_process.spawn 适配为注入用的 spawner（仅收集 stdout/stderr 与退出码）。 */
function realSubprocess(): SubprocessSpawner {
  return {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const child = spawn(spec.argv[0] as string, spec.argv.slice(1), { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdoutBuf = ''
      let stderrBuf = ''
      child.stdout.on('data', (chunk: Buffer) => { stdoutBuf += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString() })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('close', (code, signal) => { resolve({ exitCode: code, signal }) })
      })
      spec.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
      return {
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        control: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: stdoutBuf, nextOffset: stdoutBuf.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderrBuf, nextOffset: stderrBuf.length, lossy: false }) },
        },
        done,
        terminate: () => { child.kill('SIGTERM') },
        waitForExit: () => Promise.resolve(true),
      }
    },
  }
}

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** 生成一张含中文元件名与连线说明的电路图，写进临时目录。 */
function circuitSvgFile(): { path: string; svg: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-inkscape-real-'))
  dirs.push(dir)
  const svg = vectorFigureSvg(buildCircuitDiagram({
    components: [
      { id: 'ps', kind: 'battery', label: '电源', col: 0, row: 0 },
      { id: 'sw', kind: 'switch', label: '开关', col: 1, row: 0 },
      { id: 'lamp', kind: 'lamp', label: '指示灯', col: 2, row: 0 },
      { id: 'gnd', kind: 'ground', label: '接地', col: 2, row: 1 },
    ],
    connections: [{ from: 'ps', to: 'sw' }, { from: 'sw', to: 'lamp' }, { from: 'lamp', to: 'gnd', label: '接地线' }],
  }), '电路图')
  const path = join(dir, 'fig1.svg')
  writeFileSync(path, svg, 'utf8')
  return { path, svg }
}

describe.skipIf(!hasInkscape)('Inkscape 文字转路径（真实子进程）', () => {
  it('把图面文字转成轮廓路径，画布与几何逐值保持', async () => {
    const { path, svg } = circuitSvgFile()
    const before = checkFigureRendering(svg)
    expect(before.textCount).toBe(5)

    const outcome = await outlineSvgText(realSubprocess(), { path }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
    expect(outcome).toEqual({ ok: true })

    const outlined = readFileSync(path, 'utf8')
    // 文字全部成为路径：文件里不再有 <text>，但文字形状的墨迹仍在（标号框仍可量测为图形）。
    expect(outlined).not.toMatch(/<text[\s>]/)
    expect(outlined).toContain('<path')
    // 画布尺寸与线宽逐值保持（转换不改坐标系、不改线宽）。
    expect(outlined).toContain('width="66mm"')
    expect(outlined).toContain('height="40mm"')
    expect(outlined).toContain('viewBox="0 0 66 40"')
    expect(outlined).toContain('stroke-width="0.25"')
    expect(outlined).toContain('points="19.5,13 23,13 25,13 28.5,13"')
    // 产物比输入大（字形轮廓比 <text> 长），但不是空文件。
    expect(statSync(path).size).toBeGreaterThan(svg.length)

    // 转换后的图面复核：没有文字可量，也没有越界等新问题。
    const after = checkFigureRendering(outlined)
    expect(after.textCount).toBe(0)
    expect(after.findings.filter(finding => finding.check !== 'not-measured')).toEqual([])
  })

  it('输出路径不可写时报 render_failed，不改写原文件', async () => {
    const { path, svg } = circuitSvgFile()
    const outcome = await outlineSvgText(
      realSubprocess(),
      { path: join(import.meta.dirname, 'no-such-dir', 'fig1.svg') },
      { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS },
    )
    expect(outcome).toMatchObject({ ok: false, code: 'render_failed' })
    expect(readFileSync(path, 'utf8')).toBe(svg)
  })
})
