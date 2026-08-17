import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderPatentDocument } from '@deepseek-ai/dsh-patent-document'
import { fakeSubprocess, successHandle, unusedSubprocess } from './helpers.ts'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-doc-'))
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** A subprocess runtime that writes the requested PDF path, simulating headless Chrome. */
function pdfWritingSubprocess() {
  return fakeSubprocess((spec) => {
    const pdfArg = spec.argv.find(a => a.startsWith('--print-to-pdf='))
    if (pdfArg !== undefined) writeFileSync(pdfArg.slice('--print-to-pdf='.length), '%PDF-1.4')
    return successHandle()
  }).runtime
}

describe('renderPatentDocument', () => {
  it('renders HTML with injected content and brand', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'test-opinion',
          outputDir: dir,
          format: 'html',
          brand: { firm: '测试事务所' },
          sections: {
            'meta-client': '委托方 A',
            'meta-title': '智能保温杯',
            'sum-conclusion': '授权前景良好。',
          },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )

      expect(existsSync(result.htmlPath)).toBe(true)
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toContain('测试事务所')
      expect(html).toContain('委托方 A')
      expect(html).toContain('智能保温杯')
      expect(html).toContain('授权前景良好。')
      expect(result.pdfPath).toBeUndefined()
      expect(result.pdfError).toBeUndefined()
    } finally {
      cleanup(dir)
    }
  })

  it('falls back to template tokens.css defaults when no brand is given', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'test-default-brand',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '默认品牌测试' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toContain('XX 知识产权代理事务所')
    } finally {
      cleanup(dir)
    }
  })

  it('uses data/cases/<caseId>/outputs when a caseId is given', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'search-report',
          outputName: 'sr-001',
          caseId: 'case-2026-001',
          format: 'html',
          sections: { 'meta-title': '检索报告测试' },
        },
        dir,
        { subprocess: unusedSubprocess() },
      )
      expect(result.htmlPath.endsWith(join('data', 'cases', 'case-2026-001', 'outputs', 'sr-001.html'))).toBe(true)
      expect(existsSync(result.htmlPath)).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('fails closed on an illegal output name', async () => {
    const dir = makeTempDir()
    try {
      await expect(
        renderPatentDocument(
          {
            template: 'patentability-opinion',
            outputName: '../escape',
            outputDir: dir,
            format: 'html',
            sections: {},
          },
          process.cwd(),
          { subprocess: unusedSubprocess() },
        ),
      ).rejects.toThrow(/非法输出文件名/)
    } finally {
      cleanup(dir)
    }
  })

  it('renders a PDF through the injected subprocess seam', async () => {
    const dir = makeTempDir()
    try {
      writeFileSync(join(dir, 'chrome'), '')
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'test-pdf',
          outputDir: dir,
          format: 'pdf',
          sections: { 'meta-title': 'PDF 生成测试' },
        },
        process.cwd(),
        { subprocess: pdfWritingSubprocess(), chromePath: join(dir, 'chrome') },
      )
      expect(result.pdfPath).toBeDefined()
      expect(result.pdfPath).toBe(join(dir, 'test-pdf.pdf'))
      expect(existsSync(result.pdfPath as string)).toBe(true)
      expect(existsSync(result.htmlPath)).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('degrades to HTML-only when no Chrome is discoverable', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'no-chrome',
          outputDir: dir,
          format: 'both',
          sections: { 'meta-title': '降级测试' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess(), chromePath: join(dir, 'missing-chrome') },
      )
      expect(existsSync(result.htmlPath)).toBe(true)
      expect(result.pdfPath).toBeUndefined()
      expect(result.pdfError).toBeDefined()
      expect(result.pdfError).toContain('未找到 Chrome')
    } finally {
      cleanup(dir)
    }
  })

  it('injects a container section without breaking structure', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'container-inject',
          outputDir: dir,
          format: 'html',
          sections: { 'executive-summary': '<h3>新摘要</h3><p>内容 A</p>' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toMatch(/<section id="executive-summary"[^>]*>\s*<h3>新摘要<\/h3><p>内容 A<\/p>\s*<\/section>/)
    } finally {
      cleanup(dir)
    }
  })

  it('warns on unmatched or illegal section ids without polluting the HTML', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'warn-ids',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '正常', 'no-such-id': '丢弃', '../bad': '非法' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      expect(result.warnings?.join(' ')).toContain('no-such-id')
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toContain('正常')
      expect(html).not.toContain('丢弃')
    } finally {
      cleanup(dir)
    }
  })

  it('fails closed on an illegal case id', async () => {
    const dir = makeTempDir()
    try {
      await expect(
        renderPatentDocument(
          {
            template: 'patentability-opinion',
            outputName: 'escape',
            caseId: '../../etc',
            format: 'html',
            sections: {},
          },
          dir,
          { subprocess: unusedSubprocess() },
        ),
      ).rejects.toThrow(/非法案卷号/)
    } finally {
      cleanup(dir)
    }
  })

  it('atomically overwrites a same-named document', async () => {
    const dir = makeTempDir()
    try {
      await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'dup',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '第一版' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'dup',
          outputDir: dir,
          format: 'html',
          sections: { 'meta-title': '第二版' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toContain('第二版')
      expect(html).not.toContain('第一版')
    } finally {
      cleanup(dir)
    }
  })

  it('warns when an explicit brandPath is missing', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'missing-brand',
          outputDir: dir,
          format: 'html',
          brandPath: join(dir, 'not-there.json'),
          sections: { 'meta-title': '品牌回退测试' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      expect(result.warnings?.join(' ')).toContain('品牌配置文件不存在')
    } finally {
      cleanup(dir)
    }
  })
})
