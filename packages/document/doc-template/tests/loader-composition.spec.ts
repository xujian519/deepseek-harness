// 真实装配证据：把一份 cordis.yml 交给 Loader 启动后，两个工具被注册，
// 且随包分发的模板与样式资产从包内路径解析成功——不是手搭 ctx 的单元测试。

import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as DocTemplate from '@deepseek-ai/dsh-doc-template'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

let roots: string[] = []
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** Boot the plugin through the Loader with optional config lines. */
async function boot(configLines: readonly string[] = []): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-loader-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-doc-template'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-doc-template', DocTemplate],
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

/** Execute one tool of the booted composition. */
async function execute(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: name as never,
    name,
    arguments: args,
  })
}

/** The model-visible text of a tool result. */
function textOf(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

const SEARCH_REPORT_VARIABLES = {
  firm_name: '某所',
  invention_title: '图像处理',
  search_type: '新颖性',
  search_strategy: 's',
  databases_covered: 'd',
  key_hits: 'k',
  analysis: 'a',
  conclusion: 'c',
}

describe('doc-template real Loader composition through cordis.yml', () => {
  it('boots and registers both tools', async () => {
    const ctx = await boot()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).toContain('list_doc_templates')
    expect(names).toContain('render_doc_template')
  }, 30_000)

  it('lists the packaged catalog through the booted composition', async () => {
    const ctx = await boot()
    const result = await execute(ctx, 'list_doc_templates', {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect((result.value as { count: number }).count).toBe(17)
    expect(textOf(result)).toContain('- [patent-report] search-report — 专利检索报告')
  }, 30_000)

  it('renders a packaged template with its style disclaimer through the booted composition', async () => {
    const ctx = await boot()
    const missing = await execute(ctx, 'render_doc_template', { template: 'search-report', variables: {} })
    expect(missing.isError).toBe(true)
    const result = await execute(ctx, 'render_doc_template', { template: 'search-report', variables: SEARCH_REPORT_VARIABLES })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(textOf(result)).toContain('> ⚠️ 本分析由 AI 辅助生成')
    expect(textOf(result)).toContain('**机构：** 某所')
  }, 30_000)

  it('honours a configured template root through the Loader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-doc-template-loader-config-'))
    roots.push(root)
    const templates = join(root, 'templates')
    await mkdir(templates)
    await writeFile(join(templates, 'only.md'), '---\nname: only\ntitle: 仅此一份\ncategory: claims\n---\n# 正文\n')
    const ctx = await boot(['    templateDirs:', `      - ${JSON.stringify(templates)}`])
    const result = await execute(ctx, 'list_doc_templates', {})
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const names = (result.value as { templates: { name: string }[] }).templates.map(template => template.name)
    expect(names).toContain('only')
    expect(names).toContain('search-report')
  }, 30_000)
})
