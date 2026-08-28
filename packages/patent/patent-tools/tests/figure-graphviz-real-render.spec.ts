import { readFileSync, statSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { buildBlockDiagramDOT, buildFlowchartDOT, getDiagramTemplate } from '../src/figure/dot-builder.ts'
import { findDot, renderWithGraphviz } from '../src/figure/graphviz-renderer.ts'
import { annotateSvg } from '../src/figure/svg-annotate.ts'

/**
 * 真实 Graphviz 端到端 smoke：仅在本机装有 dot 时运行（无 dot 环境全组跳过）。
 * 走真实子进程（node:child_process 适配 SubprocessRuntime 接口），验证
 * DOT 构建 → dot CLI 渲染 → 真实 SVG 后处理标注的完整链路与中文渲染。
 */

/** 无 Graphviz 时跳过整个 suite。 */
const hasDot = findDot() !== undefined

/** 将 node:child_process.spawn 适配为 SubprocessRuntime（仅收集 stdout/stderr 与退出码）。 */
function realSubprocess(): SubprocessRuntime {
  return {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const child = spawn(spec.argv[0] as string, spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdoutBuf = ''
      let stderrBuf = ''
      child.stdout.on('data', (chunk: Buffer) => { stdoutBuf += chunk.toString() })
      child.stderr.on('data', (chunk: Buffer) => { stderrBuf += chunk.toString() })
      const stdinData = spec.stdio.stdin === 'ignore' ? '' : (spec.stdio.stdin as { data: string }).data
      child.stdin.end(stdinData)
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.on('close', (code, signal) => { resolve({ exitCode: code, signal }) })
      })
      spec.signal?.addEventListener('abort', () => { child.kill('SIGTERM') }, { once: true })
      return {
        pid: child.pid as number,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: stdoutBuf, nextOffset: stdoutBuf.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderrBuf, nextOffset: stderrBuf.length, lossy: false }) },
        },
        done,
        terminate: () => { child.kill('SIGTERM') },
        waitForExit: () => Promise.resolve(true),
      }
    },
  } as SubprocessRuntime
}

const runtime = realSubprocess()
const outDir = mkdtempSync(join(tmpdir(), 'dsh-figreal-'))
const CJK_FONT = 'PingFang SC'

describe.skipIf(!hasDot)('real Graphviz rendering (needs `dot` installed)', () => {
  it('renders a CJK block diagram to SVG in grayscale mode', async () => {
    const result = await renderWithGraphviz(runtime, {
      dot: buildBlockDiagramDOT(
        [
          { id: 'sensor', label: '温度传感器', type: 'input' },
          { id: 'ctrl', label: '控制单元', type: 'process' },
          { id: 'out', label: '显示装置', type: 'output' },
        ],
        [
          { from: 'sensor', to: 'ctrl', label: '信号' },
          { from: 'ctrl', to: 'out', label: '结果' },
        ],
        { figureNumber: 1, fontName: CJK_FONT },
      ),
      filename: 'cjk_block',
      format: 'svg',
      engine: 'dot',
      outputDir: outDir,
    })
    expect(result.ok).toBe(true)
    const svg = readFileSync((result as { ok: true; path: string }).path, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('温度传感器 (100)')
    expect(svg).not.toContain('fillcolor')
    expect(statSync((result as { ok: true; path: string }).path).size).toBeGreaterThan(1000)
  })

  it('renders semantic color fills and a flowchart with labeled decision edges', async () => {
    const colored = await renderWithGraphviz(runtime, {
      dot: buildBlockDiagramDOT(
        [
          { id: 'in', label: '输入', type: 'input' },
          { id: 'cpu', label: '处理', type: 'process' },
        ],
        [{ from: 'in', to: 'cpu', label: '数据' }],
        { figureNumber: 2, style: 'semantic', fontName: CJK_FONT },
      ),
      filename: 'semantic',
      format: 'svg',
      engine: 'dot',
      outputDir: outDir,
    })
    expect(colored.ok).toBe(true)
    expect(readFileSync((colored as { ok: true; path: string }).path, 'utf8')).toContain('fill="lightyellow"')

    const flow = await renderWithGraphviz(runtime, {
      dot: buildFlowchartDOT(
        [
          { id: 's', label: '开始', shape: 'ellipse', next: ['d'] },
          { id: 'd', label: '数据有效？', shape: 'diamond', next: [{ id: 't', label: '是' }, { id: 'f', label: '否' }] },
          { id: 't', label: '处理', next: ['e'] },
          { id: 'f', label: '校验失败', next: ['e'] },
          { id: 'e', label: '结束', shape: 'ellipse', next: [] },
        ],
        { figureNumber: 3, fontName: CJK_FONT },
      ),
      filename: 'flow',
      format: 'png',
      engine: 'dot',
      outputDir: outDir,
    })
    expect(flow.ok).toBe(true)
    expect(statSync((flow as { ok: true; path: string }).path).size).toBeGreaterThan(1000)
  })

  it('renders the method_steps template (fixed 101-105 numerals) as PDF', async () => {
    const result = await renderWithGraphviz(runtime, {
      dot: getDiagramTemplate('method_steps', { fontName: CJK_FONT }),
      filename: 'method',
      format: 'pdf',
      engine: 'dot',
      outputDir: outDir,
    })
    expect(result.ok).toBe(true)
    expect(statSync((result as { ok: true; path: string }).path).size).toBeGreaterThan(500)
  })

  it('annotates a real Graphviz SVG (tspan structure) with reference numerals', async () => {
    const result = await renderWithGraphviz(runtime, {
      dot: buildBlockDiagramDOT(
        [
          { id: 'dev', label: '传感器', type: 'input' },
          { id: 'cpu', label: '处理器', type: 'process' },
        ],
        [],
        { figureNumber: 5, fontName: CJK_FONT },
      ),
      filename: 'annotate_src',
      format: 'svg',
      engine: 'dot',
      outputDir: outDir,
    })
    expect(result.ok).toBe(true)
    const sourcePath = (result as { ok: true; path: string }).path
    const annotated = annotateSvg(readFileSync(sourcePath, 'utf8'), [
      { label: '传感器', numeral: '20' },
      { label: '处理器', numeral: '30' },
    ])
    expect(annotated.svg).toContain('传感器 (500) (20)')
    expect(annotated.svg).toContain('处理器 (502) (30)')
    expect(annotated.warnings).toEqual([])
  })

  it('rejects a non-existent executable with install guidance (engine error path)', async () => {
    const result = await renderWithGraphviz(runtime, {
      dot: 'digraph G { a -> b; }',
      filename: 'nope',
      format: 'svg',
      engine: 'dot',
      outputDir: outDir,
    }, join(tmpdir(), 'no-such-dot-binary'))
    expect(result).toMatchObject({ ok: false, code: 'not_installed' })
  }, 20_000)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })
})
