/**
 * document_deliver validation, resolution, registration, and presentation:
 * semantic parsing, workspace existence checks, the deterministic checks, the
 * canonical result, the durable presentation metadata, and the pending-call
 * card.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { findStyleByName, loadStyles, stylesDirectory } from '@deepseek-ai/dsh-doc-style'
import { renderDocx } from '@deepseek-ai/dsh-docx-kit'
import type { ZipReadLimits } from '@deepseek-ai/dsh-docx-kit'
import { writeZip } from '@deepseek-ai/dsh-docx-kit/src/zip.ts'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'
import {
  createDocumentDeliverTool, missingDeliverableFiles, parseDocumentDeliverArgs, MAX_CHECK_BYTES,
  type DocumentDeliverDeps, type DocumentDeliverInput, type DocumentDeliverResult,
} from '../src/tool.ts'

const signal = new AbortController().signal
const exec = { signal } as unknown as ToolRunContext

/**
 * DOCX read budgets for tools built straight from `deps()`; wide enough that no
 * fixture reaches them. The budget tests below mount the plugin instead, so
 * their budgets come from `Config` exactly as a deployment's would.
 */
const DOCX_LIMITS: ZipReadLimits = { maxArchiveEntries: 10_000, maxUncompressedBytes: 64 * 1024 * 1024 }

/** The loaded shipped styles, with the named one as the default of the test deployment. */
function deps(defaultStyle = 'assistant-neutral'): DocumentDeliverDeps {
  const styles = loadStyles([stylesDirectory()])
  const style = findStyleByName(styles, defaultStyle)
  if (style === undefined) throw new Error(`test setup: no style named ${defaultStyle}`)
  return { styles, defaultStyle: style, docxReadLimits: DOCX_LIMITS }
}

/** A tool over a bare context, for the checks that never reach the filesystem. */
function bareTool(defaultStyle = 'assistant-neutral'): ReturnType<typeof createDocumentDeliverTool> {
  return createDocumentDeliverTool(new Context(), deps(defaultStyle))
}

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

  it('carries the declared style and character budget, and rejects invalid ones', () => {
    expect(parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'] }, style: 'patent-standard', char_budget: 800,
    })).toEqual({
      files: [{ path: 'a.html', format: 'html' }],
      gate: { p0: ['ok'], p1: [] },
      styleName: 'patent-standard',
      charBudget: 800,
    })
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'] }, style: ' ',
    })).toThrow(/style must be a non-empty/)
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'] }, char_budget: 0,
    })).toThrow(/char_budget/)
    expect(() => parseDocumentDeliverArgs({
      files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['ok'] }, char_budget: 12.5,
    })).toThrow(/char_budget/)
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
    const tool = createDocumentDeliverTool(ctx, deps())
    await expect(tool.execute(
      { files: [{ path: 'a.html', format: 'html' }], gate: { p0: ['x'] } },
      { signal: aborted.signal } as unknown as ToolRunContext,
    )).rejects.toThrow(/aborted/)
  })

  it('presents the pending call as a generic card with the file locations', () => {
    const view = bareTool().presentCall?.({
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
    const view = bareTool().presentCall?.({
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
    await writeFile(join(temp, 'deck.html'), '<h1>x</h1>\n<p>正文。</p>\n')
    const tool = createDocumentDeliverTool(ctx, deps())
    const result = await tool.execute(
      { files: [{ path: 'deck.html', format: 'html' }], gate: { p0: ['命名规范'] } },
      { signal, agent: { session: { header: { cwd: temp } } } } as unknown as ToolRunContext,
    ) as DocumentDeliverResult
    expect(result).toEqual({
      registered: [{ path: 'deck.html', format: 'html' }],
      gate: {
        p0: ['命名规范'],
        p1: [],
        style: 'assistant-neutral',
        checks: [{ path: 'deck.html', format: 'html', status: 'checked', findings: [] }],
      },
    })
  })

  it('falls back to the default card when the pending args are semantically invalid', () => {
    expect(bareTool().presentCall?.({ files: [], gate: { p0: ['x'] } })).toBeUndefined()
  })
})

describe('document_deliver plugin configuration', () => {
  it('layers a configured style directory and selects the configured default style', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const styles = join(temp, 'styles')
    await mkdir(styles)
    await writeFile(join(styles, 'house.yaml'), [
      'name: house', 'domain: house', 'version: "1.0"', 'sections:', '  anti_patterns:',
      '    - word: 严禁词', '      replace: 替代词', '      severity: block', '',
    ].join('\n'))
    await ctx.plugin(plugin, { styleDirs: [styles], defaultStyle: 'house' })

    const path = join(temp, 'report.md')
    await writeFile(path, '# 报告\n\n正文。\n\n这里是严禁词。\n')
    const result = await run(ctx, { files: [{ path, format: 'markdown' }], gate: { p0: ['命名规范'] } })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('出现样式禁用词 "严禁词"，建议改用 "替代词"')
  })

  it('fails the deployment when the configured default style is not loaded', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await expect(ctx.plugin(plugin, { defaultStyle: 'no-such-style' }))
      .rejects.toThrow(/默认样式 "no-such-style" 未加载/)
  })

  it('falls back to the packaged style root and the shipped default style when applied without configuration', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    plugin.apply(ctx, {})
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'report.md')
    await writeFile(path, '# 报告\n\n正文。\n')
    const result = await run(ctx, { files: [{ path, format: 'markdown' }], gate: { p0: ['命名规范'] } })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('确定性核验（样式 assistant-neutral）')
  })
})

describe('document_deliver deterministic checks', () => {
  /** Register one declaration through the tool itself and render its result. */
  async function register(
    ctx: Context, args: Readonly<Record<string, unknown>>,
  ): Promise<{ value: DocumentDeliverResult; content: string }> {
    const tool = createDocumentDeliverTool(ctx, deps())
    const value = await tool.execute(args, exec) as DocumentDeliverResult
    const block = tool.output.render({}, value as never)[0]
    return { value, content: block?.type === 'text' ? block.text : '' }
  }

  it('refuses a deliverable that still carries a residual placeholder', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    await writeFile(join(temp, 'report.md'), '# 报告\n\n客户：{{client_name}}\n')
    const result = await run(ctx, {
      files: [{ path: join(temp, 'report.md'), format: 'markdown' }],
      gate: { p0: ['命名规范'] },
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('确定性核验未通过')
    expect(result.content).toContain('[placeholder] 第 3 行仍有残余占位符 "{{client_name}}"')
  })

  it('registers a checked document and reports its warnings', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'report.md')
    await writeFile(path, '# 报告\n\n正文。\n\n## 空节\n\n## 结论\n\n完成。\n')
    const result = await register(ctx, {
      files: [{ path, format: 'markdown' }],
      gate: { p0: ['命名规范'] },
      char_budget: 500,
    })
    expect(result.value.gate.checks[0]?.status).toBe('checked')
    expect(result.content).toContain(`确定性核验（样式 assistant-neutral）：${path} 2 项提示`)
    expect(result.content).toContain('提示（2）：')
    expect(result.content).toContain(`- ${path} [empty_section] 第 5 行的标题 "空节" 下没有任何内容`)
    expect(result.content).toContain(`- ${path} [length_budget] 全文`)
  })

  it('refuses a word the selected style forbids outright', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    await writeFile(join(temp, 'report.md'), '# 报告\n\n正文。\n\n绝对可行。\n')
    const result = await run(ctx, {
      files: [{ path: join(temp, 'report.md'), format: 'markdown' }],
      gate: { p0: ['命名规范'] },
      style: 'patent-standard',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('[anti_pattern] 第 5 行出现样式禁用词 "绝对"，建议改用 "通常"')
  })

  it('fails loud on a style name no loaded style carries', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    await writeFile(join(temp, 'report.md'), '# 报告\n')
    const result = await run(ctx, {
      files: [{ path: join(temp, 'report.md'), format: 'markdown' }],
      gate: { p0: ['命名规范'] },
      style: 'no-such-style',
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('未加载样式 "no-such-style"')
    expect(result.content).toContain('assistant-neutral')
  })

  it('reports the format-level limit of a file it cannot read as text', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'deck.pdf')
    await writeFile(path, '%PDF-1.4')
    const result = await register(ctx, { files: [{ path, format: 'pdf' }], gate: { p0: ['命名规范'] } })
    expect(result.value.gate.checks).toEqual([
      { path, format: 'pdf', status: 'unchecked', reason: 'pdf 格式没有文本读取器', findings: [] },
    ])
    expect(result.content).toContain(`${path} 未核验（pdf 格式没有文本读取器）`)
  })

  it('projects a DOCX package through docx-kit and checks its text', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'report.docx')
    await writeFile(path, renderDocx('# 报告\n\n正文内容。\n'))
    const clean = await register(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(clean.value.gate.checks[0]).toEqual({ path, format: 'docx', status: 'checked', findings: [] })

    await writeFile(path, renderDocx('# 报告\n\n客户：{{client_name}}\n'))
    const refused = await run(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(refused.isError).toBe(true)
    expect(refused.content).toContain('残余占位符 "{{client_name}}"')
  })

  it('reports a package it cannot project and a file it cannot read', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'broken.docx')
    await writeFile(path, 'not a zip package')
    const broken = await register(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(broken.value.gate.checks[0]?.status).toBe('unreadable')
    expect(broken.content).toContain(`确定性核验（样式 assistant-neutral）：${path} 无法核验`)

    const unreadable = await register(ctx, { files: [{ path: temp, format: 'markdown' }], gate: { p0: ['命名规范'] } })
    expect(unreadable.value.gate.checks[0]?.status).toBe('unreadable')
    expect(unreadable.value.gate.checks[0]?.reason).toBeDefined()
  })

  it('refuses a text deliverable beyond the documented read cap instead of scanning it', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'huge.md')
    await writeFile(path, `# 报告\n\n${'内'.repeat(MAX_CHECK_BYTES)}\n`)
    const result = await register(ctx, { files: [{ path, format: 'markdown' }], gate: { p0: ['命名规范'] } })
    expect(result.value.gate.checks[0]?.status).toBe('unreadable')
    expect(result.value.gate.checks[0]?.reason).toContain(`exceeds the ${String(MAX_CHECK_BYTES)}-byte limit`)
    expect(result.value.gate.checks[0]?.findings).toEqual([])
    expect(result.content).toContain('无法核验')
  })

  it('refuses a DOCX that expands past the configured budget', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem)
    await ctx.plugin(plugin, { maxUncompressedBytes: 4096 })
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'repetitive.docx')
    await writeFile(path, renderDocx(`# 报告\n\n${'正文。'.repeat(4096)}\n`))
    const result = await run(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(result.isError).toBe(false)
    expect(result.content).toContain('无法核验')
    expect(result.content).toContain('too-large')
  })

  it('checks a large DOCX under the shipped budgets', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'large.docx')
    await writeFile(path, renderDocx(`# 报告\n\n${Array.from({ length: 2_000 }, () => '正文内容。').join('\n\n')}\n`))
    const result = await run(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(result.isError).toBe(false)
    expect(result.content).toContain(`${path} 通过`)
  })

  it('rejects a DOCX read budget outside its accepted bounds at load', async () => {
    for (const config of [{ maxArchiveEntries: 0 }, { maxArchiveEntries: 0x1_0000 }, { maxUncompressedBytes: 0 }]) {
      const ctx = new Context()
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(LocalFileSystem)
      await expect(ctx.plugin(plugin, config)).rejects.toThrow()
    }
  })

  it('reports the body findings of a DOCX whose other parts did not project', async () => {
    const ctx = await mounted()
    temp = await mkdtemp(join(tmpdir(), 'dsh-deliver-'))
    const path = join(temp, 'partial.docx')
    const encoded = new TextEncoder()
    await writeFile(path, writeZip([
      { name: 'word/document.xml', data: encoded.encode('<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>正文。</w:t></w:r></w:p></w:body></w:document>') },
      { name: 'word/header1.xml', data: encoded.encode('<w:p>未闭合') },
    ]))
    const result = await register(ctx, { files: [{ path, format: 'docx' }], gate: { p0: ['命名规范'] } })
    expect(result.value.gate.checks[0]?.status).toBe('unreadable')
    expect(result.value.gate.checks[0]?.reason).toContain('DOCX 结构报告 malformed-xml')
    expect(result.value.gate.checks[0]?.findings).toEqual([])
    expect(result.content).toContain(`${path} 无法核验（DOCX 结构报告 malformed-xml`)
  })

  it('records the same reports as durable presentation metadata', () => {
    const tool = bareTool()
    const value: DocumentDeliverResult = {
      registered: [{ path: 'a.md', format: 'markdown' }, { path: 'deck.pdf', format: 'pdf' }],
      gate: {
        p0: ['命名规范'],
        p1: [],
        style: 'assistant-neutral',
        checks: [
          {
            path: 'a.md',
            format: 'markdown',
            status: 'checked',
            findings: [
              { check: 'empty_section', level: 'warn', detail: '第 5 行的标题 "空节" 下没有任何内容', line: 5 },
              { check: 'length_budget', level: 'warn', detail: '全文 103 字，超出声明的 80 字预算（允许 64–96 字）' },
            ],
          },
          { path: 'deck.pdf', format: 'pdf', status: 'unchecked', reason: 'pdf 格式没有文本读取器', findings: [] },
        ],
      },
    }
    expect(tool.output.presentationMeta?.({}, value as never)).toEqual({ checks: value.gate.checks })
  })
})
