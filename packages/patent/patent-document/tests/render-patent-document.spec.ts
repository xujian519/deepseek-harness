import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_OUTPUT_DIR, renderPatentDocument } from '@deepseek-ai/dsh-patent-document'
import { fakeSubprocess, successHandle, unusedSubprocess } from './helpers.ts'

// Deterministic render-side seams: Chrome discovery and the template source
// are environment-dependent, and the atomic-write failure needs a controllable
// fs/promises. findChrome is a same-module binding of renderPdf, so discovery
// is fenced by mocking existsSync for the built-in candidate list instead.
const renderMocks = vi.hoisted(() => ({
  chromeCandidates: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    'C:\\Program Files\\Google Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  craftedTemplate: undefined as string | undefined,
  failNextWriteFile: false,
  failNextRm: false,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: ((p: unknown) => {
      const path = String(p)
      if (renderMocks.chromeCandidates.includes(path)) return false
      return actual.existsSync(p as Parameters<typeof actual.existsSync>[0])
    }) as typeof actual.existsSync,
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: vi.fn(async (...args: unknown[]) => {
      if (renderMocks.failNextWriteFile) {
        renderMocks.failNextWriteFile = false
        throw new Error('模拟磁盘写入失败')
      }
      return (actual.writeFile as (...a: unknown[]) => Promise<void>)(...args)
    }),
    rm: vi.fn(async (...args: unknown[]) => {
      if (renderMocks.failNextRm) {
        renderMocks.failNextRm = false
        throw new Error('模拟清理失败')
      }
      return (actual.rm as (...a: unknown[]) => Promise<void>)(...args)
    }),
  }
})

vi.mock('../src/document/templateResolver.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/document/templateResolver.ts')>()
  return {
    ...actual,
    readTemplateHtml: vi.fn((id: string) => renderMocks.craftedTemplate ?? actual.readTemplateHtml(id as never)),
  }
})

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

  it('lands in the default output directory when neither outputDir nor caseId is given', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'default-dir',
          format: 'html',
          sections: { 'meta-title': '缺省目录' },
        },
        dir,
        { subprocess: unusedSubprocess() },
      )
      expect(result.htmlPath).toBe(join(dir, DEFAULT_OUTPUT_DIR, 'default-dir.html'))
      expect(existsSync(result.htmlPath)).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('resolves a relative outputDir against cwd', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'rel-out',
          outputDir: 'out/docs',
          format: 'html',
          sections: { 'meta-title': '相对目录' },
        },
        dir,
        { subprocess: unusedSubprocess() },
      )
      expect(result.htmlPath).toBe(join(dir, 'out', 'docs', 'rel-out.html'))
      expect(existsSync(result.htmlPath)).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('resolves a relative brandPath against cwd and applies the theme brand', async () => {
    const dir = makeTempDir()
    try {
      writeFileSync(join(dir, 'theme.json'), JSON.stringify({ documents: { patent: { firm: '相对品牌' } } }))
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'rel-brand',
          outputDir: dir,
          format: 'html',
          brandPath: 'theme.json',
          sections: { 'meta-title': '相对品牌路径' },
        },
        dir,
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toContain('相对品牌')
    } finally {
      cleanup(dir)
    }
  })

  it('defaults the format to both and reports the pdf error', async () => {
    const dir = makeTempDir()
    try {
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'default-both',
          outputDir: dir,
          sections: { 'meta-title': '默认 both' },
        },
        process.cwd(),
        { subprocess: unusedSubprocess(), chromePath: join(dir, 'missing-chrome') },
      )
      expect(existsSync(result.htmlPath)).toBe(true)
      expect(result.pdfError).toBeDefined()
      expect(result.pdfError).toContain('未找到 Chrome')
    } finally {
      cleanup(dir)
    }
  })

  it('forwards an injected signal and omits the chromePath override', async () => {
    const dir = makeTempDir()
    try {
      const env = { ...process.env, DSH_CHROME_PATH: undefined, CHROME_PATH: undefined }
      vi.spyOn(process, 'env', 'get').mockReturnValue(env)
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'signal-only',
          outputDir: dir,
          format: 'pdf',
          sections: { 'meta-title': '信号传递' },
        },
        process.cwd(),
        {
          subprocess: unusedSubprocess(),
          signal: new AbortController().signal,
        },
      )
      expect(existsSync(result.htmlPath)).toBe(true)
      expect(result.pdfError).toContain('未找到 Chrome')
    } finally {
      vi.restoreAllMocks()
      cleanup(dir)
    }
  })

  it('cleans up the temp file and rethrows when the atomic write fails', async () => {
    const dir = makeTempDir()
    try {
      renderMocks.failNextWriteFile = true
      renderMocks.failNextRm = true
      await expect(
        renderPatentDocument(
          {
            template: 'patentability-opinion',
            outputName: 'write-fail',
            outputDir: dir,
            format: 'html',
            sections: { 'meta-title': '写失败' },
          },
          process.cwd(),
          { subprocess: unusedSubprocess() },
        ),
      ).rejects.toThrow(/模拟磁盘写入失败/)
    } finally {
      cleanup(dir)
    }
  })

  it('prepends the brand style when the template has no head', async () => {
    const dir = makeTempDir()
    try {
      renderMocks.craftedTemplate = '<html><body><section id="sec">x</section></body></html>'
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'no-head',
          outputDir: dir,
          format: 'html',
          brand: { firm: '无头品牌' },
          sections: {},
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html.startsWith('<style>')).toBe(true)
      expect(html).toContain('无头品牌')
    } finally {
      renderMocks.craftedTemplate = undefined
      cleanup(dir)
    }
  })

  it('balances void and self-closing tags and skips an element with no matching close', async () => {
    const dir = makeTempDir()
    try {
      renderMocks.craftedTemplate =
        '<html><head><title>t</title></head><body>' +
        '<section id="sec"><p>orig</p><br><span/></section>' +
        '<img id="img-only">' +
        '<div id="unclosed"><span>' +
        '</body></html>'
      const result = await renderPatentDocument(
        {
          template: 'patentability-opinion',
          outputName: 'tag-scan',
          outputDir: dir,
          format: 'html',
          sections: {
            sec: '新内容',
            'img-only': '不会注入',
          },
        },
        process.cwd(),
        { subprocess: unusedSubprocess() },
      )
      const html = readFileSync(result.htmlPath, 'utf8')
      expect(html).toMatch(/<section id="sec">新内容<\/section>/)
      expect(html).not.toContain('不会注入')
      expect(result.warnings.join(' ')).toContain('img-only')
    } finally {
      renderMocks.craftedTemplate = undefined
      cleanup(dir)
    }
  })

  it('renders each of the four post-draft templates from the real assets', async () => {
    const dir = makeTempDir()
    try {
      const cases = [
        {
          template: 'rectification-response',
          sections: { 'meta-title': '一种电池模组散热方法', 'rect-findings': '通知缺陷摘录' },
        },
        {
          template: 're-examination-request',
          sections: { 'meta-title': '一种电池模组散热结构', 'ground-1': '针对理由一的回应' },
        },
        {
          template: 'infringement-opinion',
          sections: { 'meta-title': '一种电池模组温度均衡装置', 'claim-text': '权利要求 1 全文', 'conclusion-text': '落入保护范围' },
        },
        {
          template: 'litigation-pleading',
          sections: { 'meta-title': '侵害发明专利权纠纷', 'doc-kind': '答辩状' },
        },
      ] as const
      for (const c of cases) {
        const result = await renderPatentDocument(
          {
            template: c.template,
            outputName: `tmp-${c.template}`,
            outputDir: dir,
            format: 'html',
            sections: c.sections,
          },
          process.cwd(),
          { subprocess: unusedSubprocess() },
        )
        const html = readFileSync(result.htmlPath, 'utf8')
        for (const value of Object.values(c.sections)) {
          expect(html).toContain(value)
        }
      }
    } finally {
      cleanup(dir)
    }
  })
})
