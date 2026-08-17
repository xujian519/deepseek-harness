import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
    const text = renderDocumentResult({ htmlPath: '/out/a.html', pdfError: 'no chrome' })
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
})
