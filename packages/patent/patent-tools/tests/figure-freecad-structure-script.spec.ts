import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STRUCTURE_VIEWS,
  STRUCTURE_MANIFEST_FILENAME,
  STRUCTURE_TEMPLATE_FILENAME,
  STRUCTURE_TRANSIENT_DIRNAME,
  STRUCTURE_VIEW_DIRECTIONS,
  STRUCTURE_VIEWS,
  buildStructureScript,
  structureSvgFilename,
  type StructureScriptParams,
} from '../src/figure/freecad-structure-script.ts'

/**
 * buildStructureScript 是纯函数：断言它把请求渲染成一段自包含 Python 源码，
 * 只使用本机 FreeCAD 1.1 实测存在的 API，并把参数以双重序列化 JSON 内嵌。
 * 全程不接触 FreeCAD、不做 IO。
 */

function params(overrides: Partial<StructureScriptParams> = {}): StructureScriptParams {
  return {
    modelPath: '/abs/model.step',
    views: ['iso', 'front'],
    scale: 1,
    showHidden: false,
    callouts: [],
    figureNumber: 1,
    outputDir: '/abs/out',
    ...overrides,
  }
}

/** 从脚本源码里抽回内嵌 payload（json.loads("<双重转义 JSON>")），验证往返一致。 */
function extractPayload(script: string): Record<string, unknown> {
  // 内嵌字面量恒在单行（JSON.stringify 转义换行），不加 s 标志以免跨行贪婪误配后续 ")。
  const match = /json\.loads\((.*)\)/.exec(script)
  expect(match, 'script embeds a json.loads literal').not.toBeNull()
  const inner = JSON.parse(match![1] as string) as string
  return JSON.parse(inner) as Record<string, unknown>
}

describe('buildStructureScript', () => {
  it('使用实测存在的 TechDraw API，不使用已知的 1.1.3 破坏 API', () => {
    const script = buildStructureScript(params())
    expect(script).toContain('TechDraw.viewPartAsSvg')
    expect(script).toContain('view.projectPoint')
    expect(script).toContain('Part.read')
    expect(script).toContain('TechDraw::DrawViewPart')
    // 隐藏线开关的四个布尔属性
    for (const prop of ['HardHidden', 'IsoHidden', 'SmoothHidden', 'SeamHidden']) {
      expect(script).toContain(prop)
    }
    // DrawProjGroup.addProjection 在 1.1.3 抛 TypeError，脚本必须避开
    expect(script).not.toContain('addProjection')
    expect(script).not.toContain('DrawProjGroup')
  })

  it('以 DrawPage + DrawSVGTemplate 承载视图（投影只在带模板的页面上执行）', () => {
    const script = buildStructureScript(params())
    expect(script).toContain('TechDraw::DrawPage')
    expect(script).toContain('TechDraw::DrawSVGTemplate')
    expect(script).toContain('page.addView')
    // 自带最小空白模板，不依赖 FreeCAD bundle 模板路径
    expect(script).toContain(STRUCTURE_TEMPLATE_FILENAME)
    expect(script).toContain('<svg xmlns="http://www.w3.org/2000/svg"')
  })

  it('freecadcmd 吞异常，脚本显式 sys.exit(1) 让渲染器据退出码 fail-loud', () => {
    const script = buildStructureScript(params())
    expect(script).toContain('import sys')
    expect(script).toContain('import traceback')
    expect(script).toContain('traceback.print_exc()')
    expect(script).toContain('sys.exit(1)')
  })

  it('每次 open() 都显式指定 UTF-8，写出不依赖宿主 locale', () => {
    const script = buildStructureScript(params())
    const opens = script.match(/\bopen\([^)]*\)/g) ?? []
    // 三处文本写出：模板、每视图 SVG、含中文件号名的 manifest。
    expect(opens).toHaveLength(3)
    for (const call of opens) {
      expect(call).toContain('encoding="utf-8"')
    }
  })

  it('把文档 TransientDir 锚定到 outputDir 子目录（TechDraw 以它拷贝模板）', () => {
    const script = buildStructureScript(params())
    // FreeCAD 只在自身缓存目录可写时才派生内存文档的 TransientDir；它为空串时
    // TechDraw 把模板拷到根目录（/）导致渲染失败，故脚本必须显式锚定。
    expect(script).toContain(STRUCTURE_TRANSIENT_DIRNAME)
    expect(script).toContain('os.makedirs(transient_dir, exist_ok=True)')
    expect(script).toContain('doc.TransientDir = transient_dir')
  })

  it('片段翻正（scale(1,-1)）以对齐 y-down SVG 画布', () => {
    const script = buildStructureScript(params())
    expect(script).toContain('transform="scale(1,-1)"')
  })

  it('往返一致：内嵌 payload 双重序列化后可还原为原请求', () => {
    const script = buildStructureScript(params({
      modelPath: '/abs/含空格 model.step',
      views: ['iso', 'front', 'top'],
      scale: 2.5,
      showHidden: true,
      callouts: [{ numeral: '100', point3d: [1, -2.5, 3], label: '立柱' }],
      figureNumber: 7,
      outputDir: '/abs/out "quoted"',
    }))
    const payload = extractPayload(script)
    expect(payload.modelPath).toBe('/abs/含空格 model.step')
    expect(payload.views).toEqual(['iso', 'front', 'top'])
    expect(payload.scale).toBe(2.5)
    expect(payload.showHidden).toBe(true)
    expect(payload.figureNumber).toBe(7)
    expect(payload.outputDir).toBe('/abs/out "quoted"')
    expect(payload.callouts).toEqual([{ numeral: '100', point3d: [1, -2.5, 3], label: '立柱' }])
    expect(payload.manifestFilename).toBe(STRUCTURE_MANIFEST_FILENAME)
    expect(payload.templateFilename).toBe(STRUCTURE_TEMPLATE_FILENAME)
    expect(payload.transientDirname).toBe(STRUCTURE_TRANSIENT_DIRNAME)
  })

  it('为每个请求视图注入 Direction/XDirection 与输出文件名', () => {
    const script = buildStructureScript(params({ views: ['iso', 'right'], figureNumber: 3 }))
    const payload = extractPayload(script)
    const directions = payload.directions as Record<string, number[][]>
    expect(directions.iso).toEqual([...STRUCTURE_VIEW_DIRECTIONS.iso])
    expect(directions.right).toEqual([...STRUCTURE_VIEW_DIRECTIONS.right])
    // 未请求的视图不注入方向表
    expect(Object.keys(directions).sort()).toEqual(['iso', 'right'])
    expect(payload.svgFilenames).toEqual({
      iso: 'fig3_iso.svg',
      right: 'fig3_right.svg',
    })
  })

  it('无 callouts 时仍产出合法脚本，件号列表为空', () => {
    const script = buildStructureScript(params({ callouts: [] }))
    expect(extractPayload(script).callouts).toEqual([])
    // 引线/件号绘制逻辑仍在（供有件号时使用）
    expect(script).toContain('<text')
  })

  it('相同入参恒返回相同源码（纯函数）', () => {
    const a = buildStructureScript(params({ callouts: [{ numeral: '100', point3d: [0, 0, 0] }] }))
    const b = buildStructureScript(params({ callouts: [{ numeral: '100', point3d: [0, 0, 0] }] }))
    expect(a).toBe(b)
  })

  it('callout label 缺省时归一为空字符串（payload 不携带 undefined）', () => {
    const script = buildStructureScript(params({ callouts: [{ numeral: '102', point3d: [1, 2, 3] }] }))
    const payload = extractPayload(script)
    expect(payload.callouts).toEqual([{ numeral: '102', point3d: [1, 2, 3], label: '' }])
  })
})

describe('structure view constants', () => {
  it('视图表覆盖全部 STRUCTURE_VIEWS，每项为两个非零三维向量', () => {
    expect(Object.keys(STRUCTURE_VIEW_DIRECTIONS).sort()).toEqual([...STRUCTURE_VIEWS].sort())
    for (const view of STRUCTURE_VIEWS) {
      const [dir, xdir] = STRUCTURE_VIEW_DIRECTIONS[view]
      for (const vec of [dir, xdir]) {
        expect(vec).toHaveLength(3)
        // 注：iso 的 XDirection 是方向提示，TechDraw 内部对其 Direction 重新正交化，
        // 故不要求与 Direction 严格点积为 0（本机实测该组值产出正确的等轴测图）。
        expect(Math.hypot(vec[0], vec[1], vec[2])).toBeGreaterThan(0)
      }
    }
  })

  it('缺省视图集是 STRUCTURE_VIEWS 的子集', () => {
    for (const view of DEFAULT_STRUCTURE_VIEWS) {
      expect(STRUCTURE_VIEWS).toContain(view)
    }
  })

  it('structureSvgFilename 遵循 fig{N}_{view}.svg 约定', () => {
    expect(structureSvgFilename(2, 'top')).toBe('fig2_top.svg')
  })
})
