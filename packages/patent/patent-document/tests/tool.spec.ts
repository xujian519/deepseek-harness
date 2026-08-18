import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRenderPatentDocumentTool, renderDocumentResult } from '@deepseek-ai/dsh-patent-document'
import { fakeSubprocess, successHandle } from './helpers.ts'

describe('render_patent_document tool', () => {
  it('declares the defineTool shape', () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const tool = createRenderPatentDocumentTool({ subprocess })

    expect(tool.name).toBe('render_patent_document')
    expect(typeof tool.description).toBe('string')
    expect(tool.description.length).toBeGreaterThan(0)
    const parameters = tool.parameters as { properties?: Record<string, unknown> }
    expect(parameters.properties).toBeDefined()
    expect(parameters.properties).toHaveProperty('template')
    expect(parameters.properties).toHaveProperty('outputName')
    expect(parameters.properties).toHaveProperty('sections')
    expect(typeof tool.output.render).toBe('function')
    expect(typeof tool.execute).toBe('function')
  })

  it('renders the canonical result as pure model-facing prose', () => {
    const text = renderDocumentResult({
      htmlPath: '/out/a.html',
      pdfPath: '/out/a.pdf',
      warnings: ['section 未命中'],
    })
    expect(text).toContain('HTML written: /out/a.html')
    expect(text).toContain('PDF written: /out/a.pdf')
    expect(text).toContain('Warning: section 未命中')
  })

  it('names the PDF failure reason in prose', () => {
    const text = renderDocumentResult({ htmlPath: '/out/a.html', pdfError: 'no chrome', warnings: [] })
    expect(text).toContain('PDF not written: no chrome')
    expect(text).toContain('/out/a.html')
    expect(text).not.toContain('PDF written:')
  })

  it('executes an html-only render and returns the canonical value', async () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    try {
      const tool = createRenderPatentDocumentTool({ subprocess })
      const value = (await tool.execute(
        {
          template: 'patentability-opinion',
          outputName: 'test-opinion',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '标题' },
        },
        { signal: new AbortController().signal } as never,
      )) as { htmlPath: string; warnings: string[] }

      expect(value.htmlPath).toBe(join(dir, 'test-opinion.html'))
      expect(existsSync(value.htmlPath)).toBe(true)
      expect(Array.isArray(value.warnings)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('renders the canonical result through the output renderer', () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const tool = createRenderPatentDocumentTool({ subprocess })
    const blocks = tool.output.render({}, { htmlPath: '/out/a.html', warnings: [] })
    expect(blocks).toEqual([{ type: 'text', text: 'HTML written: /out/a.html' }])
  })

  it('executes without sections, brand, outputDir, or format into the default output directory', async () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    try {
      const tool = createRenderPatentDocumentTool({ subprocess, defaultOutputDir: dir, chromePath: join(dir, 'missing-chrome') })
      const value = (await tool.execute(
        { template: 'patentability-opinion', outputName: 'default-dir' },
        { signal: new AbortController().signal } as never,
      )) as { htmlPath: string; warnings: string[]; pdfError?: string }

      expect(value.htmlPath).toBe(join(dir, 'default-dir.html'))
      expect(existsSync(value.htmlPath)).toBe(true)
      expect(value.warnings).toEqual([])
      expect(value.pdfError).toContain('未找到 Chrome')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes with an inline brand and brandPath overrides', async () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    try {
      const themePath = join(dir, 'theme.json')
      writeFileSync(themePath, JSON.stringify({ documents: { patent: { accent: '#112233' } } }))
      const tool = createRenderPatentDocumentTool({ subprocess })
      const value = (await tool.execute(
        {
          template: 'patentability-opinion',
          outputName: 'branded',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '品牌' },
          brand: { firm: '显式事务所' },
          brandPath: themePath,
        },
        { signal: new AbortController().signal } as never,
      )) as { htmlPath: string }
      const html = readFileSync(value.htmlPath, 'utf8')
      expect(html).toContain('显式事务所')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes with a caseId into data/cases/<caseId>/outputs relative to the cwd', async () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    const savedCwd = process.cwd()
    try {
      process.chdir(dir)
      const tool = createRenderPatentDocumentTool({ subprocess })
      const value = (await tool.execute(
        {
          template: 'search-report',
          outputName: 'sr-case',
          caseId: 'c-2026-01',
          format: 'html',
          sections: { 'meta-title': '案卷' },
        },
        { signal: new AbortController().signal } as never,
      )) as { htmlPath: string }
      expect(value.htmlPath.endsWith(join('data', 'cases', 'c-2026-01', 'outputs', 'sr-case.html'))).toBe(true)
      expect(existsSync(value.htmlPath)).toBe(true)
    } finally {
      process.chdir(savedCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('executes a PDF render and reports the written pdf path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    try {
      writeFileSync(join(dir, 'chrome'), '')
      const subprocess = fakeSubprocess((spec) => {
        const pdfArg = spec.argv.find(a => a.startsWith('--print-to-pdf='))
        if (pdfArg !== undefined) writeFileSync(pdfArg.slice('--print-to-pdf='.length), '%PDF-1.4')
        return successHandle()
      }).runtime
      const tool = createRenderPatentDocumentTool({ subprocess, chromePath: join(dir, 'chrome') })
      const value = (await tool.execute(
        {
          template: 'patentability-opinion',
          outputName: 'pdf-ok',
          outputDir: dir,
          format: 'pdf',
          sections: { 'meta-title': 'PDF 成功' },
        },
        { signal: new AbortController().signal } as never,
      )) as { htmlPath: string; pdfPath?: string }

      expect(value.pdfPath).toBe(join(dir, 'pdf-ok.pdf'))
      expect(existsSync(value.pdfPath as string)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a non-string section value', async () => {
    const subprocess = fakeSubprocess(() => successHandle()).runtime
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-'))
    try {
      const tool = createRenderPatentDocumentTool({ subprocess })
      await expect(
        tool.execute(
          {
            template: 'patentability-opinion',
            outputName: 'bad-section',
            outputDir: dir,
            format: 'html',
            sections: { 'meta-title': 42 as never },
          },
          { signal: new AbortController().signal } as never,
        ),
      ).rejects.toThrow(/sections 的键 "meta-title" 必须是字符串/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
