import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { findFreeCadCmd, probeFreeCad, renderStructureViews } from '../src/figure/freecad-renderer.ts'
import { structureSvgFilename } from '../src/figure/freecad-structure-script.ts'

/**
 * 真实 FreeCAD 端到端 smoke：仅在本机装有 freecadcmd 时运行（无 FreeCAD 环境
 * 整组跳过）。走真实子进程（node:child_process 适配 SubprocessRuntime 接口），
 * 验证签入 STEP fixture → TechDraw 多视图投影 → 黑白线稿 SVG + manifest +
 * 件号锚定的完整链路。
 *
 * fixture 由 generate-structure-fixture.py 生成并签入（外部审查教训：fixture
 * 头部签名必须与生成器一致）；下方头部断言测试不依赖 FreeCAD，恒运行。
 *
 * CI 上没有这条链路的信号：`.github/workflows/ci-fork.yml` 不装 FreeCAD（没有
 * 免交互的 Linux 安装方式，镜像里也没有），所以 CI 上这一组必然跳过，跳过即
 * 「无信号」而不是「通过」。与 Graphviz 那条不同，这里没有可装的包来把信号补上，
 * 事实就登记在此处；要信号得走固化真实渲染产物的路线。
 */

/** 无 FreeCAD 时跳过端到端 suite。 */
const hasFreeCad = findFreeCadCmd() !== undefined

const FIXTURE = join(import.meta.dirname, 'fixtures', 'structure-bracket.step')

/** 将 node:child_process.spawn 适配为 SubprocessRuntime（透传 env，仅收集 stdout/stderr 与退出码）。 */
function realSubprocess(): SubprocessRuntime {
  return {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const child = spawn(spec.argv[0] as string, spec.argv.slice(1), {
        cwd: spec.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: spec.env === undefined ? process.env : { ...process.env, ...spec.env },
      })
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
  } as SubprocessRuntime
}

describe('STEP fixture 头部签名（与 generate-structure-fixture.py 生成器一致性）', () => {
  it('签入的 structure-bracket.step 是 FreeCAD 导出的 ISO-10303-21 STEP', () => {
    const head = readFileSync(FIXTURE, 'utf8').slice(0, 512)
    expect(head.startsWith('ISO-10303-21;')).toBe(true)
    expect(head).toContain('HEADER;')
    // 生成器签名：fixture 只能由 FreeCAD（Open CASCADE STEP processor）导出；
    // 改动生成脚本时必须重跑 freecadcmd generate-structure-fixture.py 并复核。
    expect(head).toContain('FreeCAD')
    expect(head).toContain('Open CASCADE STEP processor')
  })
})

describe.skipIf(!hasFreeCad)('real FreeCAD structure rendering (needs `freecadcmd` installed)', () => {
  const runtime = realSubprocess()
  const outDir = mkdtempSync(join(tmpdir(), 'dsh-freecadreal-'))

  it('probe 报告就绪与版本号', async () => {
    const result = await probeFreeCad(runtime)
    expect(result.ready).toBe(true)
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)
  }, 30_000)

  it('把签入 fixture 投影为 iso+front 黑白线稿并锚定件号', async () => {
    const result = await renderStructureViews(runtime, {
      modelPath: FIXTURE,
      views: ['iso', 'front'],
      scale: 1,
      showHidden: false,
      callouts: [
        { numeral: '100', point3d: [0, 0, 24], label: '立柱' },
        { numeral: '102', point3d: [20, -12, 8], label: '底板' },
      ],
      figureNumber: 1,
      outputDir: outDir,
    })
    // 这条成功断言就是 TransientDir 锚定的端到端保护：缓存目录不可写的沙箱（DSH 默认
    // workspace-write）下，旧行为会让 TechDraw 把模板拷到根目录（/）而整次渲染失败。
    // 锚定本身由 figure-freecad-structure-script.spec.ts 断言——文档关闭时 FreeCAD 会
    // 清掉 TransientDir，进程结束后无法在磁盘上复核那次拷贝。
    expect(result).toEqual({ ok: true, manifestPath: join(outDir, 'manifest.json') })
    if (!result.ok) return

    // manifest：视图顺序/文件名/包围盒/件号锚点齐备。
    const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as {
      figureNumber: number
      modelPath: string
      generator: string
      views: {
        name: string
        order: number
        path: string
        bbox: number[]
        anchors: { numeral: string; label: string; point3d: number[]; point2d: number[] }[]
      }[]
    }
    expect(manifest.figureNumber).toBe(1)
    expect(manifest.modelPath).toBe(FIXTURE)
    expect(manifest.generator).toBe('freecad-structure')
    expect(manifest.views.map(v => v.name)).toEqual(['iso', 'front'])
    expect(manifest.views.map(v => v.order)).toEqual([0, 1])

    for (const view of manifest.views) {
      expect(view.path).toBe(join(outDir, structureSvgFilename(1, view.name as 'iso' | 'front')))
      const svg = readFileSync(view.path, 'utf8')
      // 真实投影几何 + 件号引线/数字文本。
      expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
      expect(svg).toContain('<path')
      expect(svg).toContain('>100</text>')
      expect(svg).toContain('>102</text>')
      expect(svg).toContain('<line ')
      // 黑白线稿：几何黑描边、无填充。
      expect(svg).toContain('stroke="#000000"')
      expect(svg).toContain('fill="none"')
      // 防回退（CNIPA 指南 4.3）：图号/标题/模板边框绝不烧进像素；无彩色。
      expect(svg).not.toContain('图1')
      expect(svg).not.toContain('297')
      expect(svg).not.toMatch(/stroke="#(?!000000)/)
      expect(svg).not.toMatch(/fill="#(?!000000|none)/)
      // 包围盒为正、部件尺寸量级正确（底板 40 宽 × 总高 24，含画布内边距 6×2）。
      const [minX, minY, width, height] = view.bbox as [number, number, number, number]
      expect(width).toBeGreaterThan(40)
      expect(height).toBeGreaterThan(24)
      expect(width).toBeLessThan(120)
      expect(height).toBeLessThan(120)
      // 件号锚点落在视图包围盒内（锚定到真实几何投影而非图外）。
      expect(view.anchors.map(a => a.numeral)).toEqual(['100', '102'])
      for (const anchor of view.anchors) {
        const [ax, ay] = anchor.point2d as [number, number]
        expect(ax).toBeGreaterThanOrEqual(minX)
        expect(ax).toBeLessThanOrEqual(minX + width)
        expect(ay).toBeGreaterThanOrEqual(minY)
        expect(ay).toBeLessThanOrEqual(minY + height)
      }
    }

    // 两个视图的投影几何确实不同（iso 与 front 不是同一份输出）。
    const iso = readFileSync(join(outDir, structureSvgFilename(1, 'iso')), 'utf8')
    const front = readFileSync(join(outDir, structureSvgFilename(1, 'front')), 'utf8')
    expect(iso).not.toBe(front)
  }, 180_000)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })
})
