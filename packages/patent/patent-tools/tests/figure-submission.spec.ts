import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { figureCaption, officeProfile, sheetNumberText, TARGET_OFFICES } from '../src/figure/office-profile.ts'
import type { OfficeProfile } from '../src/figure/office-profile.ts'
import { buildSubmissionPage, parseDrawingSvg, parseLengthMm } from '../src/figure/submission-page.ts'
import type { SubmissionPageMetrics } from '../src/figure/submission-page.ts'
import { drawingComplianceWarnings } from '../src/figure/compliance.ts'
import { SvgAnnotateError } from '../src/figure/svg-annotate.ts'
import { createGeneratePatentFigureTool } from '../src/tool/generate-patent-figure.ts'
import type { GraphvizRenderOutcome, GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

/** Graphviz 形态的 SVG（含 pt 尺寸与带偏移的 viewBox），供落版解析。 */
const GRAPHVIZ_SVG = [
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
  '<svg width="400pt" height="500pt" viewBox="0 0 400 500" xmlns="http://www.w3.org/2000/svg">',
  '  <g><text font-size="10">A</text></g>',
  '</svg>',
].join('\n')

/** fake renderer：写出指定 SVG 文本并返回其路径。 */
function svgRenderer(svg: string): { render: (spec: GraphvizRenderSpec) => Promise<GraphvizRenderOutcome> } {
  return {
    render: (spec) => {
      const out = join(spec.outputDir, `${spec.filename}.${spec.format}`)
      writeFileSync(out, svg)
      return Promise.resolve({ ok: true, path: out })
    },
  }
}

const flowSteps = [
  { id: 'start', label: '开始', shape: 'ellipse' as const, next: ['s1'] },
  { id: 's1', label: '处理', next: [] },
]

describe('office-profile：目标法域附图规格', () => {
  it('中国档案：A4、25/25/15/15 毫米、图N、必要时彩色、附图片页码', () => {
    const profile = officeProfile('cnipa')
    expect(profile.paper).toEqual({ widthMm: 210, heightMm: 297 })
    expect(profile.margins).toEqual({ topMm: 25, leftMm: 25, rightMm: 15, bottomMm: 15 })
    expect(profile.captionStyle).toBe('figure-number')
    expect(profile.color).toBe('color-if-necessary')
    expect(profile.sheetNumbering).toBe('figure-pages')
    expect(profile.minCharHeightMm).toBeUndefined()
    expect(profile.reductionRatio).toBeCloseTo(2 / 3)
  })

  it('PCT 与美国档案：0.32 厘米最短字高、不得着色、1/3 页码', () => {
    for (const office of ['pct', 'uspto'] as const) {
      const profile = officeProfile(office)
      expect(profile.minCharHeightMm).toBe(3.2)
      expect(profile.color).toBe('monochrome')
      expect(profile.sheetNumbering).toBe('sheet-of')
      expect(profile.margins.bottomMm).toBe(10)
    }
    expect(officeProfile('pct').captionStyle).toBe('fig')
    expect(officeProfile('uspto').captionStyle).toBe('fig-upper')
    expect(TARGET_OFFICES).toEqual(['cnipa', 'pct', 'uspto'])
  })

  it('图号：两幅以上才编号；写法按法域', () => {
    expect(figureCaption(officeProfile('cnipa'), 1, 1)).toBeUndefined()
    expect(figureCaption(officeProfile('cnipa'), 2, 3)).toBe('图2')
    expect(figureCaption(officeProfile('pct'), 1, 1)).toBeUndefined()
    expect(figureCaption(officeProfile('pct'), 3, 3)).toBe('Fig. 3')
    expect(figureCaption(officeProfile('uspto'), 2, 2)).toBe('FIG. 2')
  })

  it('图号参数非法时报 RangeError', () => {
    expect(() => figureCaption(officeProfile('cnipa'), 0, 2)).toThrow(RangeError)
    expect(() => figureCaption(officeProfile('cnipa'), 1.5, 2)).toThrow(RangeError)
    expect(() => figureCaption(officeProfile('cnipa'), 3, 2)).toThrow(RangeError)
  })

  it('页码：中国写页序，PCT/美国写「页序/总页数」', () => {
    expect(sheetNumberText(officeProfile('cnipa'), 2, 5)).toBe('2')
    expect(sheetNumberText(officeProfile('pct'), 2, 5)).toBe('2/5')
    expect(sheetNumberText(officeProfile('uspto'), 1, 1)).toBe('1/1')
    expect(() => sheetNumberText(officeProfile('cnipa'), 0, 5)).toThrow(RangeError)
    expect(() => sheetNumberText(officeProfile('cnipa'), 6, 5)).toThrow(RangeError)
  })
})

describe('submission-page：SVG 长度解析与图形几何', () => {
  it('长度单位换算', () => {
    expect(parseLengthMm('210mm')).toBe(210)
    expect(parseLengthMm('21cm')).toBe(210)
    expect(parseLengthMm('8.27in')).toBeCloseTo(210.058)
    expect(parseLengthMm('72pt')).toBeCloseTo(25.4)
    expect(parseLengthMm('96px')).toBeCloseTo(25.4)
    expect(parseLengthMm('96')).toBeCloseTo(25.4)
    expect(parseLengthMm(' 12.5 mm ')).toBe(12.5)
    expect(parseLengthMm('50%')).toBeUndefined()
    expect(parseLengthMm('auto')).toBeUndefined()
  })

  it('解析 pt 尺寸与 viewBox，换算用户单位', () => {
    const { geometry, warnings } = parseDrawingSvg(GRAPHVIZ_SVG)
    expect(geometry.widthMm).toBeCloseTo(141.11, 1)
    expect(geometry.heightMm).toBeCloseTo(176.39, 1)
    expect(geometry.userUnitToMmX).toBeCloseTo(geometry.widthMm / 400)
    expect(geometry.userUnitToMmY).toBeCloseTo(geometry.heightMm / 500)
    expect(geometry.inner).toContain('<text font-size="10">A</text>')
    expect(warnings).toEqual([])
  })

  it('缺 width/height 时按 viewBox 的 96 dpi 换算并给提示', () => {
    const svg = '<svg viewBox="0 0 96 192" xmlns="http://www.w3.org/2000/svg"><g/></svg>'
    const { geometry, warnings } = parseDrawingSvg(svg)
    expect(geometry.widthMm).toBeCloseTo(25.4)
    expect(geometry.heightMm).toBeCloseTo(50.8)
    expect(warnings[0]).toContain('96 dpi')
  })

  it('拒绝非 SVG、缺尺寸与不安全结构', () => {
    expect(() => parseDrawingSvg('<html></html>')).toThrow(SvgAnnotateError)
    expect(() => parseDrawingSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')).toThrow(SvgAnnotateError)
    expect(() => parseDrawingSvg('<svg width="1mm" height="1mm"><!ENTITY x "y"></svg>')).toThrow(SvgAnnotateError)
  })
})

describe('submission-page：落版', () => {
  it('中国：A4 幅面、图号在图形正下方、页码在版心底部', () => {
    const page = buildSubmissionPage({
      drawingSvg: GRAPHVIZ_SVG,
      profile: officeProfile('cnipa'),
      caption: '图1',
      sheetNumber: '1',
      bodyFontSize: 10,
    })
    expect(page.svg).toContain('width="210mm" height="297mm"')
    expect(page.svg).toContain('viewBox="0 0 210 297"')
    expect(page.svg).toContain('text-anchor="middle"')
    expect(page.svg).toContain('>图1</text>')
    expect(page.svg).toContain('>1</text>')
    // 图号 y 在图形下沿之下
    const captionY = Number(/>图1<\/text>/.exec(page.svg) === null ? 0 : /<text x="[^"]*" y="([^"]*)"[^>]*>图1</.exec(page.svg)?.[1])
    expect(captionY).toBeGreaterThan(page.metrics.placedHeightMm + 25)
    expect(page.metrics.placedWidthMm).toBeCloseTo(page.metrics.drawingWidthMm * page.metrics.pageScale)
    expect(page.metrics.charHeightMm).toBeCloseTo(
      10 * (page.metrics.drawingHeightMm / 500) * 0.7 * page.metrics.pageScale,
    )
    expect(page.metrics.reducedCharHeightMm).toBeCloseTo((page.metrics.charHeightMm ?? 0) * (2 / 3))
    expect(page.warnings).toEqual([])
  })

  it('无图号/页码时不写入落版文本元素', () => {
    const page = buildSubmissionPage({ drawingSvg: GRAPHVIZ_SVG, profile: officeProfile('cnipa') })
    // 落版新增的图号/页码文本一律 text-anchor="middle"；源图形内没有这种文本。
    expect(page.svg).not.toContain('text-anchor="middle"')
    expect(page.metrics.charHeightMm).toBeUndefined()
    expect(page.metrics.reducedCharHeightMm).toBeUndefined()
  })

  it('极小的图形放大被截断并给出提示', () => {
    const tiny = '<svg width="1mm" height="1mm" xmlns="http://www.w3.org/2000/svg"><g/></svg>'
    const page = buildSubmissionPage({ drawingSvg: tiny, profile: officeProfile('uspto'), caption: 'FIG. 1', sheetNumber: '1/1' })
    expect(page.metrics.pageScale).toBe(4)
    expect(page.warnings[0]).toContain('放大被限制')
    expect(page.svg).toContain('>FIG. 1</text>')
  })

  it('参数与幅面非法时报 RangeError', () => {
    const tiny = '<svg width="10mm" height="10mm" xmlns="http://www.w3.org/2000/svg"><g/></svg>'
    const base = { drawingSvg: tiny, profile: officeProfile('cnipa') }
    expect(() => buildSubmissionPage({ ...base, captionFontMm: 0 })).toThrow(RangeError)
    expect(() => buildSubmissionPage({ ...base, captionGapMm: -1 })).toThrow(RangeError)
    expect(() => buildSubmissionPage({ ...base, sheetFontMm: Number.NaN })).toThrow(RangeError)
    expect(() => buildSubmissionPage({ ...base, bodyFontSize: 0 })).toThrow(RangeError)
    const crowded: OfficeProfile = { ...officeProfile('cnipa'), margins: { topMm: 200, leftMm: 20, rightMm: 20, bottomMm: 200 } }
    expect(() => buildSubmissionPage({ ...base, profile: crowded })).toThrow(RangeError)
  })
})

describe('compliance：合规核算', () => {
  const metrics = (over: Partial<SubmissionPageMetrics> = {}): SubmissionPageMetrics => ({
    pageScale: 1,
    drawingWidthMm: 150,
    drawingHeightMm: 200,
    placedWidthMm: 150,
    placedHeightMm: 200,
    ...over,
  })

  it('PCT/美国：彩色附图与未标图号各一条警告', () => {
    const pct = drawingComplianceWarnings({
      profile: officeProfile('pct'),
      style: 'semantic',
      figureCount: 3,
      hasCaption: false,
      metrics: metrics(),
    })
    expect(pct.join('\n')).toContain('11.13(a)')
    expect(pct.join('\n')).toContain('11.13(k)')
    const uspto = drawingComplianceWarnings({
      profile: officeProfile('uspto'),
      style: 'semantic',
      figureCount: 1,
      hasCaption: true,
      metrics: metrics(),
    })
    expect(uspto.join('\n')).toContain('1.84(a)(2)')
    expect(uspto).toHaveLength(1)
  })

  it('中国：彩色提示必要性与「正下方」编号依据', () => {
    const warnings = drawingComplianceWarnings({
      profile: officeProfile('cnipa'),
      style: 'semantic',
      figureCount: 2,
      hasCaption: false,
      metrics: metrics(),
    })
    expect(warnings.join('\n')).toContain('必要时')
    expect(warnings.join('\n')).toContain('第一部分第一章 4.3')
  })

  it('字高核算：低于该法域下限时报出法源与实测值', () => {
    const low = drawingComplianceWarnings({
      profile: officeProfile('pct'),
      style: 'grayscale',
      figureCount: 1,
      hasCaption: false,
      metrics: metrics({ charHeightMm: 2.5, reducedCharHeightMm: 1.6 }),
    })
    expect(low).toHaveLength(1)
    expect(low[0]).toContain('11.13(h)')
    const uspto = drawingComplianceWarnings({
      profile: officeProfile('uspto'),
      style: 'grayscale',
      figureCount: 1,
      hasCaption: true,
      metrics: metrics({ charHeightMm: 3.1 }),
    })
    expect(uspto.join('\n')).toContain('1.84(p)(3)')
    // 未提供字号时无字高结论
    expect(drawingComplianceWarnings({
      profile: officeProfile('pct'),
      style: 'grayscale',
      figureCount: 1,
      hasCaption: true,
      metrics: metrics(),
    })).toEqual([])
  })

  it('字高达标且黑白时无警告（中国不设字高下限）', () => {
    expect(drawingComplianceWarnings({
      profile: officeProfile('pct'),
      style: 'grayscale',
      figureCount: 1,
      hasCaption: false,
      metrics: metrics({ charHeightMm: 3.6, reducedCharHeightMm: 2.4 }),
    })).toEqual([])
    expect(drawingComplianceWarnings({
      profile: officeProfile('cnipa'),
      style: 'grayscale',
      figureCount: 5,
      hasCaption: true,
      metrics: metrics({ charHeightMm: 0.5, reducedCharHeightMm: 0.3 }),
    })).toEqual([])
  })
})

describe('generate_patent_figure：落版接线', () => {
  it('中国 + 多幅附图：图号入图、页码入图、返回落版尺寸', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-submit-'))
    const outDir = join(dir, 'figs')
    const tool = createGeneratePatentFigureTool({ ...svgRenderer(GRAPHVIZ_SVG), outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        invention_name: '一种自动加热装置',
        target_office: 'cnipa',
        figure_count: 3,
      }, 's1')
      expect(result.isError).toBe(false)
      const value = result as {
        value: {
          layout: { office: string; caption?: string; sheetNumber: string; pageScale: number; charHeightMm?: number }
          warnings: string[]
        }
      }
      expect(value.value.layout.office).toBe('cnipa')
      expect(value.value.layout.caption).toBe('图1')
      expect(value.value.layout.sheetNumber).toBe('1')
      expect(value.value.layout.charHeightMm).toBeGreaterThan(0)
      const written = readFileSync(join(outDir, 'fig1.svg'), 'utf8')
      expect(written).toContain('width="210mm" height="297mm"')
      expect(written).toContain('>图1</text>')
      expect(text(result)).toContain('## 落版（cnipa）')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('单幅附图不标图号；fit_to_page=false 只核算不改写画布', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-submit-'))
    const outDir = join(dir, 'figs')
    const tool = createGeneratePatentFigureTool({ ...svgRenderer(GRAPHVIZ_SVG), outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const single = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        target_office: 'pct',
        sheet_index: 1,
        sheet_total: 2,
      }, 's2')
      const singleValue = single as { value: { layout: { caption?: string; sheetNumber: string } } }
      expect(singleValue.value.layout.caption).toBeUndefined()
      expect(singleValue.value.layout.sheetNumber).toBe('1/2')
      const dry = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        target_office: 'cnipa',
        figure_count: 2,
        fit_to_page: false,
        filename: 'dry',
      }, 's3')
      const dryValue = dry as { value: { layout: { pageScale: number } } }
      expect(dryValue.value.layout.pageScale).toBeGreaterThan(0)
      expect(readFileSync(join(outDir, 'dry.svg'), 'utf8')).not.toContain('210mm')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('PCT 拒绝彩色；非法图号参数与 PNG 落版分别报错与提示', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-submit-'))
    const outDir = join(dir, 'figs')
    const tool = createGeneratePatentFigureTool({ ...svgRenderer(GRAPHVIZ_SVG), outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const colored = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        target_office: 'pct',
        style: 'semantic',
      }, 's4')
      expect(colored.isError).toBe(true)
      expect(text(colored)).toContain('11.13(a)')
      const badCount = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        target_office: 'cnipa',
        figure_count: 0,
      }, 's5')
      expect(badCount.isError).toBe(true)
      expect(text(badCount)).toContain('落版参数非法')
      const png = await execute(ctx, 'generate_patent_figure', {
        figure_type: 'flowchart',
        steps: flowSteps,
        target_office: 'cnipa',
        format: 'png',
      }, 's6')
      const pngValue = png as { value: { layout?: unknown; warnings: string[] } }
      expect(pngValue.value.layout).toBeUndefined()
      expect(pngValue.value.warnings.join('\n')).toContain('落版仅支持 SVG')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('panels：每个面板各自落版并追加面板后缀', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-submit-'))
    const outDir = join(dir, 'figs')
    const tool = createGeneratePatentFigureTool({ ...svgRenderer(GRAPHVIZ_SVG), outputDir: outDir, cwd: dir })
    const ctx = await ctxWith(tool)
    try {
      const result = await execute(ctx, 'generate_patent_figure', {
        figure_number: 2,
        figure_count: 2,
        target_office: 'cnipa',
        panels: [
          { suffix: 'A', figure_type: 'flowchart', steps: flowSteps },
          { suffix: 'B', figure_type: 'block_diagram', blocks: [{ id: 'a', label: '输入' }], connections: [] },
        ],
      }, 's7')
      expect(result.isError).toBe(false)
      const value = result as { value: { panels: { suffix: string; layout?: { caption?: string } }[] } }
      expect(value.value.panels.map(p => p.layout?.caption)).toEqual(['图2A', '图2B'])
      expect(readFileSync(join(outDir, 'fig2A.svg'), 'utf8')).toContain('>图2A</text>')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
