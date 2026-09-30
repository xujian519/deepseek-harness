import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import {
  DEFAULT_FREECAD_PROBE_TIMEOUT_MS,
  DEFAULT_FREECAD_RENDER_TIMEOUT_MS,
  findFreeCadCmd,
  probeFreeCad,
  renderSectionGeometry,
  renderStructureViews,
} from '../src/figure/freecad-renderer.ts'
import { resolveSectionFrame, type SectionRing } from '../src/figure/freecad-section-geometry.ts'
import { SECTION_GEOMETRY_FILENAME, buildSectionScript } from '../src/figure/freecad-section-script.ts'
import { structureSvgFilename } from '../src/figure/freecad-structure-script.ts'
import { applyStructureLineStyle } from '../src/figure/structure-svg-postprocess.ts'
import { measureInkBounds } from '../src/figure/render-check.ts'

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

/** 用例显式声明的渲染预算（毫秒）；生产由宿主 Config.freecadRenderTimeoutMs 解析后注入。 */
const TEST_RENDER_TIMEOUT_MS = DEFAULT_FREECAD_RENDER_TIMEOUT_MS

/** 用例显式声明的探测预算（毫秒）；宿主插件不探测 freecadcmd，无对应 Config 字段。 */
const TEST_PROBE_TIMEOUT_MS = DEFAULT_FREECAD_PROBE_TIMEOUT_MS

/** 无 FreeCAD 时跳过端到端 suite。 */
const hasFreeCad = findFreeCadCmd() !== undefined

const FIXTURE = join(import.meta.dirname, 'fixtures', 'structure-bracket.step')

/** 剖切几何的 fixture：60×30×8 的板，两个 r5 通孔位于 x = ±15（见 generate-section-fixture.py）。 */
const SECTION_FIXTURE = join(import.meta.dirname, 'fixtures', 'section-holes-plate.step')

/** 剖切 fixture 的解析几何：外环 60×30、孔半径 5、板厚 8。 */
const SECTION_PLATE_WIDTH_MM = 60
const SECTION_PLATE_DEPTH_MM = 30
const SECTION_PLATE_HEIGHT_MM = 8
const SECTION_HOLE_RADIUS_MM = 5
const SECTION_HOLE_CENTERS_MM = [-15, 15]

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
    const result = await probeFreeCad(runtime, { probeTimeoutMs: TEST_PROBE_TIMEOUT_MS })
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
    }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
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

  it('真实投影片段的线宽分组可被后处理改写（含隐藏线档）', async () => {
    // 后处理按 `<g stroke-width>` 分组识别可见/隐藏线；FreeCAD 换版若改了片段结构，
    // 这里的断言与 applyStructureLineStyle 的告警一起暴露，而不是静默交出没生效的图。
    const dir = mkdtempSync(join(tmpdir(), 'dsh-freecadstyle-'))
    try {
      const result = await renderStructureViews(runtime, {
        modelPath: FIXTURE,
        views: ['front'],
        scale: 1,
        showHidden: true,
        callouts: [],
        figureNumber: 1,
        outputDir: dir,
      }, { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const manifest = JSON.parse(readFileSync(result.manifestPath, 'utf8')) as { views: { path: string }[] }
      const path = manifest.views[0]?.path as string
      const original = readFileSync(path, 'utf8')
      // 实测形态：可见线 0.7 一组、隐藏线 0.35 一组，全篇无 stroke-dasharray。
      expect(original).toContain('stroke-width="0.7"')
      expect(original).toContain('stroke-width="0.35"')
      expect(original).not.toContain('stroke-dasharray')
      const styled = applyStructureLineStyle(original, { lineWidthMm: 0.5, hiddenLineStyle: 'dashed' })
      expect(styled.warnings).toEqual([])
      const tags = [...styled.svg.matchAll(/<g\b[^>]*>/g)].map(match => match[0])
      // 可见线改宽且不加虚线；隐藏线保持 0.35 并加按该线宽算出的虚线。
      expect(tags.some(tag => tag.includes('stroke-width="0.5"') && !tag.includes('stroke-dasharray'))).toBe(true)
      expect(tags.some(tag => tag.includes('stroke-width="0.35"') && tag.includes('stroke-dasharray="4.2 1.05"'))).toBe(true)
      expect(measureInkBounds(styled.svg)).toEqual(measureInkBounds(original))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })
})

describe('SECTION fixture 头部签名（与 generate-section-fixture.py 生成器一致性）', () => {
  it('签入的 section-holes-plate.step 是 FreeCAD 导出的 ISO-10303-21 STEP', () => {
    const head = readFileSync(SECTION_FIXTURE, 'utf8').slice(0, 512)
    expect(head.startsWith('ISO-10303-21;')).toBe(true)
    expect(head).toContain('HEADER;')
    // 生成器签名：fixture 只能由 FreeCAD 导出；改生成脚本时必须重跑
    // `freecadcmd generate-section-fixture.py`（期望 solids=1、volume=13143.363）并复核。
    expect(head).toContain('FreeCAD')
    expect(head).toContain('Open CASCADE STEP processor')
  })
})

describe.skipIf(!hasFreeCad)('real FreeCAD section geometry (needs `freecadcmd` installed)', () => {
  const runtime = realSubprocess()
  const outDir = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-'))
  const renderOptions = { renderTimeoutMs: TEST_RENDER_TIMEOUT_MS }

  /** 按外环/孔环分组（环序不是契约，按深度与包围盒归类）。 */
  function group(rings: readonly SectionRing[]): { outer: SectionRing; holes: SectionRing[] } {
    const outer = rings.find(ring => ring.depth === 0)
    if (outer === undefined) throw new Error('剖切结果没有深度 0 的外环')
    return { outer, holes: rings.filter(ring => ring.depth === 1) }
  }

  /** 环的包围盒（视图帧毫米）。 */
  function extent(ring: SectionRing): { width: number; height: number; centerX: number; centerY: number } {
    const xs = ring.points.map(point => point[0])
    const ys = ring.points.map(point => point[1])
    return {
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      centerX: (Math.max(...xs) + Math.min(...xs)) / 2,
      centerY: (Math.max(...ys) + Math.min(...ys)) / 2,
    }
  }

  it('z=4 的轴对齐剖切切出外环 + 两个通孔，面积与解析值逐值相符', async () => {
    const result = await renderSectionGeometry(runtime, {
      modelPath: SECTION_FIXTURE,
      plane: { origin: [0, 0, 4], normal: [0, 0, 1] },
      outputDir: outDir,
    }, renderOptions)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { geometry } = result

    // 模型信息：板 60×30×8、单实体；包围盒是模型单位的核对点（STEP 按毫米读入）。
    expect(geometry.model.solids).toBe(1)
    expect(geometry.model.boundBoxMm.min).toEqual([-30, -15, 0])
    expect(geometry.model.boundBoxMm.max).toEqual([30, 15, 8])
    expect(geometry.frame).toEqual({
      origin: [0, 0, 4],
      normal: [0, 0, 1],
      right: [1, 0, 0],
      down: [0, 1, 0],
    })
    expect(geometry.distanceMm).toBeCloseTo(4, 12)

    const { outer, holes } = group(geometry.rings)
    expect(geometry.rings).toHaveLength(3)
    expect(geometry.regions).toEqual([{ outer: 0, holes: [1, 2], netAreaMm2: 1800 - 2 * 78.539816 }])
    // 外环是矩形：四条直线边各取两端点，衔接后 4 个顶点。
    expect(outer.points).toHaveLength(4)
    expect(extent(outer)).toEqual({ width: 60, height: 30, centerX: 0, centerY: 0 })
    expect(outer.areaMm2).toBeCloseTo(SECTION_PLATE_WIDTH_MM * SECTION_PLATE_DEPTH_MM, 6)

    // 孔：1.5° 角度步长 → 全圆 240 点；半径 5、圆心 x = ±15 与模型逐值相符。
    expect(holes.map(hole => hole.points.length)).toEqual([240, 240])
    expect(holes.map(hole => extent(hole).centerX).sort((a, b) => a - b)).toEqual(SECTION_HOLE_CENTERS_MM)
    for (const hole of holes) {
      const box = extent(hole)
      expect(box.width / 2).toBeCloseTo(SECTION_HOLE_RADIUS_MM, 9)
      expect(box.height / 2).toBeCloseTo(SECTION_HOLE_RADIUS_MM, 9)
      expect(box.centerY).toBeCloseTo(0, 9)
      expect(hole.areaMm2).toBeCloseTo(Math.PI * SECTION_HOLE_RADIUS_MM ** 2, 6)
    }
    // 净面积 = 外环 − 两孔；解析值 1800 − 2π·25 = 1642.920367。
    expect(geometry.regions[0]?.netAreaMm2).toBeCloseTo(1642.920367, 5)
    // 离散多边形与 OCCT 精确面积的相对偏差（面积核对门限是 1e-3）：240 边形的内接
    // 相对误差 ≈ (2π/240)²/6 = 1.1e-4，即 78.54 毫米² 上差 0.009 毫米²（实测）。
    const holePolygonArea = Math.abs(shoeLace(holes[0] as SectionRing))
    expect(Math.abs(holePolygonArea - Math.PI * 25) / (Math.PI * 25)).toBeLessThan(1e-3)
    expect(Math.abs(holePolygonArea - Math.PI * 25)).toBeLessThan(0.01)
  }, 180_000)

  it('两次运行的几何逐字节一致（确定性）', async () => {
    const first = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-det-'))
    const second = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-det-'))
    try {
      const plane = { origin: [0, 0, 4] as const, normal: [0, 0, 1] as const }
      const a = await renderSectionGeometry(runtime, { modelPath: SECTION_FIXTURE, plane: { ...plane }, outputDir: first }, renderOptions)
      const b = await renderSectionGeometry(runtime, { modelPath: SECTION_FIXTURE, plane: { ...plane }, outputDir: second }, renderOptions)
      expect(a.ok && b.ok).toBe(true)
      if (!a.ok || !b.ok) return
      expect(readFileSync(join(first, SECTION_GEOMETRY_FILENAME), 'utf8'))
        .toBe(readFileSync(join(second, SECTION_GEOMETRY_FILENAME), 'utf8'))
    } finally {
      rmSync(first, { recursive: true, force: true })
      rmSync(second, { recursive: true, force: true })
    }
  }, 180_000)

  it('倾斜 10° 的剖切把通孔切成椭圆（面积与长短轴与解析值相符）', async () => {
    const tilt = (10 * Math.PI) / 180
    const result = await renderSectionGeometry(runtime, {
      modelPath: SECTION_FIXTURE,
      plane: { origin: [0, 0, 4], normal: [0, Math.sin(tilt), Math.cos(tilt)] },
      outputDir: outDir,
    }, renderOptions)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { outer, holes } = group(result.geometry.rings)
    expect(result.geometry.rings).toHaveLength(3)
    // 外环：平面从板的两个侧面穿出（y = ±15 处 z = 4 ∓ 15·tan10° ∈ (0, 8)），仍是矩形。
    expect(outer.points).toHaveLength(4)
    expect(outer.areaMm2).toBeCloseTo((SECTION_PLATE_WIDTH_MM * SECTION_PLATE_DEPTH_MM) / Math.cos(tilt), 5)
    // 孔：斜切圆柱得椭圆，长短半轴 = r/cos10° 与 r；面积 = πr²/cos10°（OCCT 精确值）。
    expect(holes).toHaveLength(2)
    for (const hole of holes) {
      const box = extent(hole)
      expect(hole.areaMm2).toBeCloseTo((Math.PI * SECTION_HOLE_RADIUS_MM ** 2) / Math.cos(tilt), 5)
      expect(box.width).toBeCloseTo(2 * SECTION_HOLE_RADIUS_MM, 2)
      expect(box.height).toBeCloseTo((2 * SECTION_HOLE_RADIUS_MM) / Math.cos(tilt), 2)
      // 椭圆边没有角度参数，走弦长步长档（0.1 毫米）→ 点数明显多于 1.5° 角度档的 240。
      expect(hole.points.length).toBeGreaterThan(240)
      expect(hole.points.length).toBeLessThanOrEqual(2000)
    }
    // 整块切片仍是「一个外环 + 两个孔」的材料区域。
    expect(result.geometry.regions).toHaveLength(1)
    expect(result.geometry.regions[0]?.holes).toHaveLength(2)
  }, 180_000)

  it('法向沿 X 时缺省参考方向退到 +Y，切出 y–z 断面', async () => {
    const result = await renderSectionGeometry(runtime, {
      modelPath: SECTION_FIXTURE,
      plane: { origin: [25, 0, 4], normal: [1, 0, 0] },
      outputDir: outDir,
    }, renderOptions)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.geometry.frame.right).toEqual([0, 1, 0])
    expect(result.geometry.frame.down).toEqual([0, 0, 1])
    const { outer, holes } = group(result.geometry.rings)
    expect(holes).toEqual([])
    expect(outer.points).toHaveLength(4)
    expect(outer.areaMm2).toBeCloseTo(SECTION_PLATE_DEPTH_MM * SECTION_PLATE_HEIGHT_MM, 6)
    expect(extent(outer)).toMatchObject({ width: 30, height: 8 })
  }, 180_000)

  it('平面未与模型相交、模型载入失败都归入 geometry_failed 且不产出几何', async () => {
    const missDir = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-miss-'))
    const missingDir = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-missing-'))
    try {
      const miss = await renderSectionGeometry(runtime, {
        modelPath: SECTION_FIXTURE,
        plane: { origin: [0, 0, 400], normal: [0, 0, 1] },
        outputDir: missDir,
      }, renderOptions)
      expect(miss.ok).toBe(false)
      if (miss.ok) return
      expect(miss.code).toBe('geometry_failed')
      // 本机 freecadcmd 的 stderr 不能编码中文，Python 把非 ASCII 转义成 \uXXXX
      // （实测），故这里断言消息里的 ASCII 部分与异常类型；面向模型的中文文案由工具层给。
      expect(miss.error).toContain('RuntimeError')
      expect(miss.error).toContain('origin=[0.0, 0.0, 400.0]')
      expect(existsSync(join(missDir, SECTION_GEOMETRY_FILENAME))).toBe(false)

      const missing = await renderSectionGeometry(runtime, {
        modelPath: join(missDir, 'not-a-model.step'),
        plane: { origin: [0, 0, 4], normal: [0, 0, 1] },
        outputDir: missingDir,
      }, renderOptions)
      expect(missing.ok).toBe(false)
      if (missing.ok) return
      expect(missing.code).toBe('geometry_failed')
      // 实测：Part.read 对不存在的文件直接抛 FreeCAD 异常（不是返回空形状），
      // 消息由 OCCT 给出，故断言这段 ASCII 文案。
      expect(missing.error).toContain('File to load not existing or not readable')
      expect(existsSync(join(missingDir, SECTION_GEOMETRY_FILENAME))).toBe(false)
    } finally {
      rmSync(missDir, { recursive: true, force: true })
      rmSync(missingDir, { recursive: true, force: true })
    }
  }, 180_000)

  it('TMPDIR 指向不存在路径时 freecadcmd 无声崩溃，既不产出几何也不误报成功', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-freecadsection-tmp-'))
    try {
      const scriptPath = join(dir, 'run.py')
      writeFileSync(scriptPath, buildSectionScript({
        modelPath: SECTION_FIXTURE,
        frame: resolveSectionFrame({ origin: [0, 0, 4], normal: [0, 0, 1] }),
        outputDir: dir,
      }), 'utf8')
      // 实测（FreeCAD 1.1.3）：TMPDIR 指向不存在的路径时 freecadcmd 在跑任何 Python 之前
      // SIGSEGV，stdout/stderr 全空、退出码为 null（被信号终止）；HOME 与 XDG_CACHE_HOME
      // 指向不存在路径只产生缓存/配置告警，不影响产出（286 字节 stderr，几何正常）。
      // 故渲染器必须在 spawn 前先 mkdir 隔离目录（freecad-renderer 的 FREECAD_HOME_DIRNAME）：
      // 否则这条链路会「无产物、无诊断」地失败。断言只钉住产品关心的部分。
      const absent = join(dir, '.absent-tmp')
      const run = spawnSync(findFreeCadCmd() as string, [scriptPath], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, HOME: dir, TMPDIR: absent, TEMP: absent, TMP: absent },
      })
      expect(run.status).not.toBe(0)
      expect(run.stdout).not.toContain('SECTION_OK')
      expect(existsSync(join(dir, SECTION_GEOMETRY_FILENAME))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true })
  })
})

/** 环的有向面积（只为独立复核离散面积，不复用被测代码）。 */
function shoeLace(ring: SectionRing): number {
  let sum = 0
  for (let index = 0; index < ring.points.length; index += 1) {
    const current = ring.points[index] as readonly [number, number]
    const next = ring.points[(index + 1) % ring.points.length] as readonly [number, number]
    sum += current[0] * next[1] - next[0] * current[1]
  }
  return sum / 2
}
