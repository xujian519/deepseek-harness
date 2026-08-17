import { describe, expect, it } from 'vitest'
import { appendFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { createPatentPdfDownloadTool, normalizePatentNumber } from '../src/tool/patent-pdf-download.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: CallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

describe('normalizePatentNumber', () => {
  it('trims, uppercases and strips separators', () => {
    expect(normalizePatentNumber(' us 11452699 b2 ')).toBe('US11452699B2')
    expect(normalizePatentNumber('CN-115690481-A')).toBe('CN115690481A')
    expect(normalizePatentNumber('CN115690481/9')).toBe('CN1156904819')
  })
})

describe('patent_pdf_download', () => {
  it('downloads a batch through the ego runner and renders the summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-pdf-'))
    try {
      const tool = createPatentPdfDownloadTool({
        runEgo: async () => ({ items: [{ patent: 'US1A', status: 'ok', path: join(dir, 'US1A.pdf') }] }),
        resolveOutputDir: () => dir,
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'patent_pdf_download', { patents: ['us 1 a'] }, 'p-1')
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      expect(text(result)).toContain('下载完成：1/1 成功')
      expect(text(result)).toContain('US1A')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls back to fetch for a fallback item and writes the PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-pdf-'))
    try {
      const body = '%PDF-1.4 ' + 'x'.repeat(600)
      const fetchImpl = (async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/pdf' : null) },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
      })) as unknown as typeof fetch
      const tool = createPatentPdfDownloadTool({
        runEgo: async () => ({ items: [{ patent: 'US1A', status: 'fallback', pdfUrl: 'https://cdn/US1A.pdf', error: 'no intercept' }] }),
        resolveOutputDir: () => dir,
        fetchImpl,
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'patent_pdf_download', { patents: ['US1A'] }, 'p-2')
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      expect(text(result)).toContain('US1A')
      expect(text(result)).toContain('（fetch 兜底）')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips already-downloaded patents via MANIFEST resume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-pdf-'))
    try {
      const file = join(dir, 'US1A.pdf')
      await writeFile(file, '%PDF-1.4 resume body')
      const st = await stat(file)
      await appendFile(
        join(dir, '.MANIFEST.jsonl'),
        JSON.stringify({ patent: 'US1A', status: 'ok', path: file, size: st.size, ts: Date.now() }) + '\n',
      )
      const tool = createPatentPdfDownloadTool({
        runEgo: async () => {
          throw new Error('should not be called')
        },
        resolveOutputDir: () => dir,
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'patent_pdf_download', { patents: ['US1A'] }, 'p-3')
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      expect(text(result)).toContain('（已下载，跳过）')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an empty patents list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-pdf-'))
    try {
      const tool = createPatentPdfDownloadTool({
        runEgo: async () => ({ items: [] }),
        resolveOutputDir: () => dir,
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'patent_pdf_download', { patents: [] }, 'p-4')
      expect(result.isError).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects path traversal characters in patent numbers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-pdf-'))
    try {
      const tool = createPatentPdfDownloadTool({
        runEgo: async () => ({ items: [] }),
        resolveOutputDir: () => dir,
      })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'patent_pdf_download', { patents: ['../evil'] }, 'p-5')
      expect(result.isError).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
