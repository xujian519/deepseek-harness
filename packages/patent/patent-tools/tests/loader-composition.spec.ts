/**
 * Real-composition test: boots a test cordis.yml through the real Loader
 * mounting @deepseek-ai/dsh-subprocess-local, the tools registry,
 * @deepseek-ai/dsh-patent-data, and @deepseek-ai/dsh-patent-tools, and
 * asserts the wired consumer layer: ctx.patentData resolves inside the
 * composition, knowledge_note_save persists through the file writer, and
 * patent_pdf_download no longer reports the unwired-stub message (its ego
 * runner is the real adapter over the mounted service).
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import PatentData from '@deepseek-ai/dsh-patent-data'
import * as PatentTools from '@deepseek-ai/dsh-patent-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(noteDir: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-patent-tools-loader-'))
  const configPath = join(root, 'cordis.yml')
  const yml = [
    "- name: '@deepseek-ai/dsh-subprocess-local'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-patent-data'",
    "- name: '@deepseek-ai/dsh-patent-tools'",
    '  config:',
    '    noteDir: ' + JSON.stringify(noteDir),
    '',
  ].join('\n')
  await writeFile(configPath, yml)

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-patent-data', PatentData],
    ['@deepseek-ai/dsh-patent-tools', PatentTools],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('patent-tools real Loader composition', () => {
  it('resolves ctx.patentData and registers the wired tools', async () => {
    const notes = join(await mkdtemp(join(tmpdir(), 'dsh-patent-tools-notes-')), '99-知识库')
    try {
      const ctx = await boot(notes)
      expect(ctx.patentData).toBeInstanceOf(PatentData)
      const names = ctx.tools.schemas().map(schema => schema.name)
      expect(names).toContain('patent_pdf_download')
      expect(names).toContain('knowledge_note_save')
    } finally {
      await rm(notes, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('persists a knowledge note through the file writer', async () => {
    const notes = join(await mkdtemp(join(tmpdir(), 'dsh-patent-tools-notes-')), '99-知识库')
    try {
      const ctx = await boot(notes)
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('loader-note-1'),
        name: 'knowledge_note_save',
        arguments: { title: '组合测试笔记', content: '写入内容', project: 'loader' },
      })
      expect(result.isError).toBe(false)
      const files = await readdir(notes)
      expect(files.filter(file => file.endsWith('.json')).length).toBe(1)
    } finally {
      await rm(notes, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('registers patent_pdf_download live (not an unwired stub)', async () => {
    const notes = join(await mkdtemp(join(tmpdir(), 'dsh-patent-tools-notes-')), '99-知识库')
    try {
      const ctx = await boot(notes)
      // The tool is registered by the real apply(); executing with an invalid
      // patent list fails at the tool's own validation regardless of whether the
      // host has ego-browser installed, proving the adapter wiring is live.
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId('loader-pdf-1'),
        name: 'patent_pdf_download',
        arguments: { patents: [], outputDir: notes },
      })
      expect(result.isError).toBe(true)
      const text = JSON.stringify(result.content)
      expect(text).not.toContain('当前未挂载')
    } finally {
      await rm(notes, { recursive: true, force: true }).catch(() => {})
    }
  })
})
