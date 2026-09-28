import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createGeneratePatentFigureTool } from '../src/tool/generate-patent-figure.ts'
import { createVerifyPatentFigureTool } from '../src/tool/verify-patent-figure.ts'

const signal = new AbortController().signal

/** 工具执行结果里的可见文本。 */
function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

/** 建一个只挂了本工具的运行时。 */
async function ctxWith(cwd: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createVerifyPatentFigureTool({ cwd }))
  return ctx
}

/** 一张最小 SVG。 */
function svg(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="40mm" viewBox="0 0 120 40">
  <g fill="none" stroke="#000000" stroke-width="0.35">
${body}
  </g>
</svg>`
}

describe('verify_patent_figure', () => {
  it('量测值随文本返回：画布、文字数、线宽与取向分布', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
    const ctx = await ctxWith(dir)
    try {
      writeFileSync(join(dir, 'fig1.svg'), svg([
        '<polygon points="10,10 50,10 50,30 10,30" stroke-width="0.5"/>',
        '<line x1="4" y1="20" x2="12" y2="20" stroke-width="0.25"/>',
        '<text x="60" y="20" font-size="3.5" text-anchor="middle" fill="#000000" stroke="none">1</text>',
      ].join('\n')))
      const result = await ctx.tools.execute({ signal, callId: ToolCallId('vf1'), name: 'verify_patent_figure', arguments: { svg_path: 'fig1.svg' } })
      expect(result.isError).toBe(false)
      const body = text(result)
      expect(body).toContain('附图渲染复核：fig1.svg')
      expect(body).toContain('绝对路径：')
      expect(body).toContain('画布 120×40 毫米')
      expect(body).toContain('文字元素 1 个')
      expect(body).toContain('0.25mm×1')
      expect(body).toContain('0.5mm×1')
      expect(body).toContain('未发现问题')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文字被线条贯穿时在 findings 里报出，并给出量测口径', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
    const ctx = await ctxWith(dir)
    try {
      writeFileSync(join(dir, 'fig1.svg'), svg([
        '<polygon points="10,10 50,10 50,30 10,30" stroke-width="0.5"/>',
        '<line x1="30" y1="20" x2="80" y2="10" stroke-width="0.25"/>',
        '<text x="80" y="11.2" font-size="3.5" text-anchor="middle" fill="#000000" stroke="none">3</text>',
      ].join('\n')))
      const result = await ctx.tools.execute({ signal, callId: ToolCallId('vf2'), name: 'verify_patent_figure', arguments: { svg_path: 'fig1.svg' } })
      expect(result.isError).toBe(false)
      const value = result as { value: { findings: { check: string; message: string }[] } }
      expect(value.value.findings.map(finding => finding.check)).toEqual(['text-crossed-by-line'])
      expect(text(result)).toContain('[text-crossed-by-line]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('文件缺失报 file_not_found，不安全 SVG 报 invalid_tool_input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
    const ctx = await ctxWith(dir)
    try {
      const missing = await ctx.tools.execute({ signal, callId: ToolCallId('vf3'), name: 'verify_patent_figure', arguments: { svg_path: 'nope.svg' } })
      expect(missing.isError).toBe(true)
      expect(text(missing)).toContain('SVG 文件不存在：nope.svg')

      // 目录当路径：读得出「存在」但读不出文本，报 invalid_tool_input 而不是 file_not_found。
      mkdirSync(join(dir, 'adir'))
      const asDirectory = await ctx.tools.execute({ signal, callId: ToolCallId('vf3b'), name: 'verify_patent_figure', arguments: { svg_path: 'adir' } })
      expect(asDirectory.isError).toBe(true)
      expect(text(asDirectory)).toContain('SVG 文件不可读：adir')

      writeFileSync(join(dir, 'unsafe.svg'), '<!ENTITY x "y"><svg></svg>')
      const unsafe = await ctx.tools.execute({ signal, callId: ToolCallId('vf4'), name: 'verify_patent_figure', arguments: { svg_path: 'unsafe.svg' } })
      expect(unsafe.isError).toBe(true)
      expect(text(unsafe)).toContain('SVG 复核被拒')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('verify_patent_figure 量测缺省', () => {
  it('画布尺寸缺失与无量测图元时给出缺省文本', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
    const ctx = await ctxWith(dir)
    try {
      writeFileSync(join(dir, 'bare.svg'), '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>')
      const result = await ctx.tools.execute({ signal, callId: ToolCallId('vf5'), name: 'verify_patent_figure', arguments: { svg_path: 'bare.svg' } })
      expect(result.isError).toBe(false)
      const value = result as { value: { widthMm?: number; strokeWidthMm: unknown[]; orientationDeg: unknown[] } }
      expect(value.value.widthMm).toBeUndefined()
      expect(value.value.strokeWidthMm).toEqual([])
      expect(value.value.orientationDeg).toEqual([])
      const body = text(result)
      expect(body).toContain('根元素未声明画布尺寸')
      expect(body).toContain('线宽分布：无')
      expect(body).toContain('线段取向（按线段数）：无')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generate_patent_figure → verify_patent_figure 联合复核', () => {
  it('工具生成的剖视图通过独立复核：无缺陷（两个模块各自解析同一张图）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-verify-'))
    const outDir = join(dir, 'figs')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(createGeneratePatentFigureTool({
      render: () => Promise.resolve({ ok: false, code: 'render_failed', error: '矢量图型不应走 Graphviz 渲染' }),
      outputDir: outDir,
      cwd: dir,
    }))
    ctx.tools.register(createVerifyPatentFigureTool({ cwd: dir }))
    try {
      const generated = await ctx.tools.execute({
        signal,
        callId: ToolCallId('gv1'),
        name: 'generate_patent_figure',
        arguments: {
          figure_type: 'cross_section',
          sections: {
            parts: [
              // 零件名（数字）画在轮廓右上角之外；中心线沿中高向两侧外延，不穿过数字占位框。
              { label: '1', outline: [[0, 0], [60, 0], [60, 24], [0, 24]], hatch: { angle_deg: 45, spacing_mm: 3, direction: 'forward' } },
              { outline: [[60, 0], [72, 0], [72, 24], [60, 24]], hatch: 'none' },
            ],
            // 第二个零件的标号在零件上方、由竖直引线引出。
            labels: [{ text: '2', at: [84, 34], from: [72, 12] }],
            centerlines: [{ from: [-14, 12], to: [56, 12] }],
          },
        },
      })
      expect(generated.isError).toBe(false)
      const verified = await ctx.tools.execute({ signal, callId: ToolCallId('gv2'), name: 'verify_patent_figure', arguments: { svg_path: 'figs/fig1.svg' } })
      expect(verified.isError).toBe(false)
      const value = verified as { value: { findings: unknown[]; textCount: number } }
      expect(value.value.findings).toEqual([])
      expect(value.value.textCount).toBe(2)
      expect(text(verified)).toContain('未发现问题')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
