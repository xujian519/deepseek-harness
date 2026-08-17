import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findChrome, renderPdf } from '@deepseek-ai/dsh-patent-document'
import { fakeSubprocess, successHandle } from './helpers.ts'

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'dsh-pdf-'))
}

describe('pdfRenderer', () => {
  it('renders a PDF by spawning headless Chrome through the subprocess seam', async () => {
    const dir = makeTempDir()
    try {
      const chromePath = join(dir, 'chrome')
      const htmlPath = join(dir, 'doc.html')
      const pdfPath = join(dir, 'doc.pdf')
      writeFileSync(chromePath, '')
      writeFileSync(htmlPath, '<html></html>')

      const { runtime, calls } = fakeSubprocess((spec) => {
        const pdfArg = spec.argv.find(a => a.startsWith('--print-to-pdf='))
        if (pdfArg !== undefined) writeFileSync(pdfArg.slice('--print-to-pdf='.length), '%PDF-1.4')
        return successHandle()
      })

      const result = await renderPdf(runtime, htmlPath, pdfPath, { chromePath })
      expect(result).toEqual({ ok: true, path: pdfPath })
      expect(existsSync(pdfPath)).toBe(true)

      expect(calls).toHaveLength(1)
      const argv = calls[0]?.argv ?? []
      expect(argv[0]).toBe(chromePath)
      expect(argv).toContain('--headless')
      expect(argv).toContain('--print-to-pdf-no-header')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('degrades to an error when no Chrome is discoverable', async () => {
    const dir = makeTempDir()
    try {
      const htmlPath = join(dir, 'doc.html')
      const pdfPath = join(dir, 'doc.pdf')
      writeFileSync(htmlPath, '<html></html>')

      const { runtime, calls } = fakeSubprocess(() => successHandle())
      const result = await renderPdf(runtime, htmlPath, pdfPath, { chromePath: join(dir, 'missing-chrome') })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('未找到 Chrome')
      expect(calls).toHaveLength(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a failure when Chrome exits non-zero', async () => {
    const dir = makeTempDir()
    try {
      const chromePath = join(dir, 'chrome')
      const htmlPath = join(dir, 'doc.html')
      const pdfPath = join(dir, 'doc.pdf')
      writeFileSync(chromePath, '')
      writeFileSync(htmlPath, '<html></html>')

      const { runtime } = fakeSubprocess(() => ({
        ...successHandle(),
        done: Promise.resolve({ exitCode: 1, signal: null }),
      }))

      const result = await renderPdf(runtime, htmlPath, pdfPath, { chromePath })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('Chrome PDF 打印失败')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports a failure when Chrome exits 0 but writes no PDF', async () => {
    const dir = makeTempDir()
    try {
      const chromePath = join(dir, 'chrome')
      const htmlPath = join(dir, 'doc.html')
      const pdfPath = join(dir, 'doc.pdf')
      writeFileSync(chromePath, '')
      writeFileSync(htmlPath, '<html></html>')

      const { runtime } = fakeSubprocess(() => successHandle())
      const result = await renderPdf(runtime, htmlPath, pdfPath, { chromePath })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toContain('Chrome 未生成 PDF')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('findChrome returns undefined for an explicitly missing override', () => {
    expect(findChrome('/no/such/chrome/binary')).toBeUndefined()
  })
})
