/**
 * `render_doc_template` with `output_path`: the rendered document reaches disk
 * through `ctx.fs` — text through `writeText`, a DOCX package through
 * `writeBytes` — and the registered deliverable is readable by the delivery
 * gate. Without `output_path` the call stays the pure render it was: no file
 * is created and the result carries no `path`/`bytes`.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { loadStyles, stylesDirectory } from '@deepseek-ai/dsh-doc-style'
import { extractDocxText } from '@deepseek-ai/dsh-docx-kit'
import type { ZipReadLimits } from '@deepseek-ai/dsh-docx-kit'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as DocumentDeliver from '@deepseek-ai/dsh-document-deliver'
import * as DocTemplate from '../src/index.ts'
import { templatesDirectory } from '../src/asset-location.ts'
import { createTemplateStore } from '../src/store.ts'
import { listDocTemplates } from '../src/tool/list-doc-templates.ts'
import type { RenderDocTemplateOutput } from '../src/tool/render-doc-template.ts'

const DOCX_LIMITS: ZipReadLimits = { maxArchiveEntries: 10_000, maxUncompressedBytes: 64 * 1024 * 1024 }

let roots: string[] = []

afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** A tracked temporary workspace. */
async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-out-'))
  roots.push(root)
  return root
}

/** The shipped store used to discover the template's own variable names. */
function storeOf() {
  return createTemplateStore({
    templateDirs: [templatesDirectory()],
    styles: loadStyles([stylesDirectory()]),
    defaultLanguage: 'zh-CN',
    includeDisclaimer: true,
  })
}

/** Values for every variable the template declares, so the render leaves no residual. */
function variablesFor(template: string): Record<string, string> {
  const summary = listDocTemplates(storeOf(), {}).templates.find(entry => entry.name === template)
  if (summary === undefined) throw new Error(`test setup: no template named ${template}`)
  return Object.fromEntries(summary.variables.map(variable => [variable.name, `示例${variable.name}`]))
}

/** A context with the tool registry, the host filesystem at `cwd`, and both document plugins. */
async function mounted(cwd: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(DocTemplate, {})
  await ctx.plugin(DocumentDeliver, {})
  return ctx
}

/** Execute one registered tool. */
function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(name),
    name,
    arguments: args,
  })
}

/** The rendered value of a successful render call. */
function renderedValue(result: { isError: boolean; value?: unknown }): RenderDocTemplateOutput {
  if (result.isError) throw new Error('expected a successful render')
  return result.value as RenderDocTemplateOutput
}

describe('render_doc_template output_path', () => {
  it('writes a DOCX package to disk and reports path and bytes', async () => {
    const cwd = await tempWorkspace()
    const ctx = await mounted(cwd)
    const result = await execute(ctx, 'render_doc_template', {
      template: 'method-claim',
      variables: variablesFor('method-claim'),
      format: 'docx',
      output_path: 'out/report.docx',
    })
    const value = renderedValue(result)
    const written = join(cwd, 'out', 'report.docx')
    // The provider reports the physical path, which on macOS resolves /var → /private/var.
    expect(value.path).toBe(await realpath(written))
    expect(value.bytes).toBe((await stat(written)).size)
    expect(value.bytes).toBeGreaterThan(0)
    // The package is a real DOCX, not the base64 text written to disk.
    const projected = extractDocxText(new Uint8Array(await readFile(written)), DOCX_LIMITS)
    expect(projected.problems).toEqual([])
    expect(projected.text).toContain('权利要求书')
    expect(value.encoding).toBe('base64')
  })

  it('writes a text format as UTF-8', async () => {
    const cwd = await tempWorkspace()
    const ctx = await mounted(cwd)
    const result = await execute(ctx, 'render_doc_template', {
      template: 'method-claim',
      variables: variablesFor('method-claim'),
      format: 'markdown',
      output_path: 'out/report.md',
    })
    const value = renderedValue(result)
    const written = join(cwd, 'out', 'report.md')
    expect(value.path).toBe(await realpath(written))
    expect(value.bytes).toBe(Buffer.byteLength(value.content, 'utf8'))
    expect(await readFile(written, 'utf8')).toBe(value.content)
  })

  it('keeps the pure-render behavior when output_path is omitted', async () => {
    const cwd = await tempWorkspace()
    const ctx = await mounted(cwd)
    const result = await execute(ctx, 'render_doc_template', {
      template: 'method-claim',
      variables: variablesFor('method-claim'),
      format: 'docx',
    })
    const value = renderedValue(result)
    expect(value.path).toBeUndefined()
    expect(value.bytes).toBeUndefined()
    expect(value.encoding).toBe('base64')
    expect(await readdir(cwd)).toEqual([])
  })

  it('fails the call when the destination cannot be resolved', async () => {
    const cwd = await tempWorkspace()
    await writeFile(join(cwd, 'blocker'), '')
    const ctx = await mounted(cwd)
    const result = await execute(ctx, 'render_doc_template', {
      template: 'method-claim',
      variables: variablesFor('method-claim'),
      format: 'markdown',
      output_path: 'blocker/report.md',
    })
    expect(result.isError).toBe(true)
  })

  it('produces a deliverable that document_deliver registers as checked', async () => {
    const cwd = await tempWorkspace()
    const ctx = await mounted(cwd)
    const rendered = renderedValue(await execute(ctx, 'render_doc_template', {
      template: 'method-claim',
      variables: variablesFor('method-claim'),
      format: 'docx',
      output_path: 'out/report.docx',
    }))
    expect(rendered.path).toBe(await realpath(join(cwd, 'out', 'report.docx')))
    const delivered = await execute(ctx, 'document_deliver', {
      files: [{ path: 'out/report.docx', format: 'docx' }],
      gate: { p0: ['P0-1'] },
    })
    expect(delivered.isError).toBe(false)
    const value = delivered.value as { gate: { checks: { status: string }[] } }
    expect(value.gate.checks[0]?.status).toBe('checked')
  })
})
