/**
 * document_deliver validation, resolution, registration, and presentation:
 * semantic parsing, workspace existence checks, the canonical result, and
 * the pending-call card.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'
import {
  createDocumentDeliverTool, missingDeliverableFiles, parseDocumentDeliverArgs,
  type DocumentDeliverInput,
} from '../src/tool.ts'

const signal = new AbortController().signal
const exec = { signal } as unknown as ToolRunContext

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

async function mounted(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(plugin)
  return ctx
}

async function run(ctx: Context, args: unknown): Promise<{ isError: boolean; content: string }> {
  const result = await ctx.tools.execute({
    signal,
    callId: ToolCallId('d-1'),
    name: 'document_deliver',
    arguments: args,
  })
  const block = result.content[0]
  if (block === undefined || block.type !== 'text') throw new Error('expected a text content block')
  return { isError: result.isError, content: block.text }
}

describe('parseDocumentDeliverArgs', () => {
  it('normalizes a valid registration and defaults p1/briefRef', () => {
    expect(parseDocumentDeliverArgs({
      files: [{ path: 'out/index.html', format: 'html' }, { path: 'report.md', format: 'markdown' }],
      gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] },
    })).toEqual({
      files: [{ path: 'out/index.html', format: 'html' }, { path: 'report.md', format: 'markdown' }],
      gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] },
    })
  })

  it('fills briefRef from brief_ref and empty p1 from omission', () => {
    expect(parseDocumentDeliverArgs({
      files: [{ path: 'deck.html', format: 'html' }],
      gate: { p0: ['命名规范'] },
      brief_ref: 'brief.md',
    })).toEqual({
      files: [{ path: 'deck.html', format: 'html' }],
      gate: { p0: ['命名规范'], p1: [] },
      briefRef: 'brief.md',
    })
  })

  it('rejects an empty files list', () => {
    expect(() => parseDocumentDeliverArgs({ files: [], gate: { p0: ['x'] } }))
      .toThrow(/files must list at least one/)
  })

  it('rejects blank and duplicate deliverable paths', () => {
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: '  ', format: 'html' }], gate: { p0: ['x'] },
    })).toThrow(/non-empty string/)
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }, { path: 'a.html', format: 'pdf' }], gate: { p0: ['x'] },
    })).toThrow(/duplicate deliverable path/)
  })

  it('rejects empty, blank, and partly blank P0 lists', () => {
    const gate = (p0: string[]): DocumentDeliverInput => ({
      files: [{ path: 'a.html', format: 'html' }],
      gate: { p0 },
    })
    expect(() => parseDocumentDeliverArgs(gate([]))).toThrow(/p0 must list/)
    expect(() => parseDocumentDeliverArgs(gate([' ']))).toThrow(/p0 must list/)
    expect(() => parseDocumentDeliverArgs(gate(['ok', ' ']))).toThrow(/p0 must list/)
  })

  it('rejects blank p1 items and a blank brief_ref', () => {
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'], p1: [' ', 'x'] },
    })).toThrow(/p1 items/)
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'] }, brief_ref: ' ',
    })).toThrow(/brief_ref/)
  })
})

describe('missingDeliverableFiles', () => {
  it('reports only the paths that do not resolve to a file', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const present = join(temp, 'report.html')
    await writeFile(present, '<h1>x</h1>')
    const missing = await missingDeliverableFiles(ctx, exec, [present, join(temp, 'ghost.pdf')])
    expect(missing).toEqual([join(temp, 'ghost.pdf')])
  })

  it('returns empty when every file exists', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const present = join(temp, 'report.html')
    await writeFile(present, '<h1>x</h1>')
    expect(await missingDeliverableFiles(ctx, exec, [present])).toEqual([])
  })
})

describe('document_deliver tool', () => {
  it('registers existing files and confirms gate state', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const html = join(temp, 'report.html')
    const md = join(temp, 'report.md')
    await writeFile(html, '<h1>x</h1>')
    await writeFile(md, '# x')
    const result = await run(ctx, {
      files: [{ path: html, format: 'html' }, { path: md, format: 'markdown' }],
      gate: { p0: ['命名规范', '自包含'], p1: ['可访问性'] },
      brief_ref: 'brief.md',
    })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('已登记 2 个交付文件')
    expect(result.content).toContain('P0 2 项通过，P1 1 项')
    expect(result.content).toContain('brief 参考：brief.md')
  })

  it('confirms without p1/brief_ref lines when they are absent', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const html = join(temp, 'deck.html')
    await writeFile(html, '<h1>x</h1>')
    const result = await run(ctx, {
      files: [{ path: html, format: 'html' }],
      gate: { p0: ['命名规范'] },
    })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('P0 1 项通过')
    expect(result.content).not.toContain('P1')
    expect(result.content).not.toContain('brief 参考')
  })

  it('fails loud when a registered file is missing', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const result = await run(ctx, {
      files: [{ path: join(temp, 'ghost.docx'), format: 'docx' }],
      gate: { p0: ['命名规范'] },
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('不存在')
  })

  it('fails semantic validation before touching the filesystem', async () => {
    const ctx = await mounted()
    const result = await run(ctx, { files: [{ path: 'a.html', format: 'html' }], gate: { p0: [] } })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('p0 must list')
  })

  it('rejects an unsupported format through the schema', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const present = join(temp, 'a.html')
    await writeFile(present, '<h1>x</h1>')
    const result = await run(ctx, {
      files: [{ path: present, format: 'slides' }],
      gate: { p0: ['命名规范'] },
    })
    expect(result.isError).toBe(true)
  })

  it('aborts before validation when the caller signal is already cancelled', async () => {
    const ctx = await mounted()
    const aborted = new AbortController()
    aborted.abort()
    const tool = createDocumentDeliverTool(ctx)
    await expect(tool.execute(
      { files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['x'] } },
      { signal: aborted.signal } as unknown as ToolRunContext,
    )).rejects.toThrow(/aborted/)
  })

  it('presents the pending call as a generic card with the file locations', () => {
    const tool = createDocumentDeliverTool(new Context())
    const view = tool.presentCall?.({
      files: [{ path: 'out/report.html', format: 'html' }],
      gate: { p0: ['命名规范'], p1: ['可访问性'] },
      brief_ref: 'brief.md',
    })
    expect(view).toEqual({
      card: 'generic',
      title: '登记文档交付物（1 个文件）',
      rawInput: { files: ['out/report.html (html)'], p0: 1, p1: 1, brief_ref: 'brief.md' },
      locations: [{ path: 'out/report.html' }],
    })
  })

  it('presents the card without a brief_ref key when none was provided', () => {
    const tool = createDocumentDeliverTool(new Context())
    const view = tool.presentCall?.({
      files: [{ path: 'out/deck.html', format: 'html' }],
      gate: { p0: ['命名规范'] },
    })
    expect(view).toEqual({
      card: 'generic',
      title: '登记文档交付物（1 个文件）',
      rawInput: { files: ['out/deck.html (html)'], p0: 1, p1: 0 },
      locations: [{ path: 'out/deck.html' }],
    })
  })

  it('resolves registered paths against the session cwd', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    await writeFile(join(temp, 'deck.html'), '<h1>x</h1>')
    const tool = createDocumentDeliverTool(ctx)
    const result = await tool.execute(
      { files: [{ path: 'deck.html', format: 'html' }], gate: { p0: ['命名规范'] } },
      { signal, agent: { session: { header: { cwd: temp } } } } as unknown as ToolRunContext,
    )
    expect(result).toEqual({
      registered: [{ path: 'deck.html', format: 'html' }],
      gate: { p0: ['命名规范'], p1: [] },
    })
  })

  it('falls back to the default card when the pending args are semantically invalid', () => {
    const tool = createDocumentDeliverTool(new Context())
    expect(tool.presentCall?.({ files: [], gate: { p0: ['x'] } })).toBeUndefined()
  })
})
