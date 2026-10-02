import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { LawSearchResult } from '@deepseek-ai/dsh-patent-knowledge'
import { createLawSearchTool } from '../src/tool/law-search.ts'
import type { LawSearchDeps } from '../src/tool/law-search.ts'

const signal = new AbortController().signal

/** 一条命中（id/name/level + 可溯源 file_path + 正文）。 */
function hit(id: string, name: string, filePath: string, content: string): LawSearchResult {
  return { id, name, level: '法律', filename: filePath, content, score: -1, expired: 0, categoryId: 0 }
}

const LAW_HIT = hit('law:专利法', '中华人民共和国专利法', '法律法规_md/中华人民共和国专利法.md', '第二十六条 说明书应当对发明作出清楚、完整的说明。')
const GUIDELINE_HIT = hit('raw:审查指南_md:第二部分第八章', '专利审查指南 第二部分第八章-实质审查程序', '审查指南_md/第二部分第八章-实质审查程序.md', '4.1 审查员应当发出审查意见通知书，指出申请文件的缺陷。')

/** 记录检索调用的替身。 */
function recorder(overrides: { law?: LawSearchResult[]; guideline?: LawSearchResult[]; dbPath?: string; throwLaw?: boolean } = {}) {
  const calls: { scope: string; query: string; limit: number }[] = []
  const deps: LawSearchDeps = {
    searchLaw: (query, options) => {
      calls.push({ scope: 'law', query, limit: options?.limit ?? 0 })
      if (overrides.throwLaw === true) throw new Error('database is locked')
      return overrides.law ?? [LAW_HIT]
    },
    searchGuideline: (query, options) => {
      calls.push({ scope: 'guideline', query, limit: options?.limit ?? 0 })
      return overrides.guideline ?? [GUIDELINE_HIT]
    },
    ...(overrides.dbPath === undefined ? {} : { dbPath: overrides.dbPath }),
  }
  return { calls, deps }
}

async function ctxWith(deps: LawSearchDeps): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createLawSearchTool(deps))
  return ctx
}

function call(ctx: Context, args: Record<string, unknown>, label = 'law') {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name: 'law_search', arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

describe('law_search', () => {
  it('缺省检索法规原文，命中带 sourcePath（file_path）与片段', async () => {
    const ctx = await ctxWith(recorder().deps)
    const result = await call(ctx, { query: '说明书' })
    expect(result.isError).toBe(false)
    const body = text(result)
    expect(body).toContain('法规条文')
    expect(body).toContain('检索式：说明书')
    expect(body).toContain('中华人民共和国专利法')
    expect(body).toContain('sourcePath**: 法律法规_md/中华人民共和国专利法.md')
    expect(body).toContain('第二十六条')
  })

  it('scope=guideline 检索《专利审查指南》全文', async () => {
    const rec = recorder()
    const ctx = await ctxWith(rec.deps)
    const result = await call(ctx, { query: '审查意见通知书', scope: 'guideline' })
    expect(rec.calls).toEqual([{ scope: 'guideline', query: '审查意见通知书', limit: 5 }])
    const body = text(result)
    expect(body).toContain('审查指南全文')
    expect(body).toContain('sourcePath**: 审查指南_md/第二部分第八章-实质审查程序.md')
    expect((result.value as { scope: string }).scope).toBe('guideline')
  })

  it('命中为空时明确说明不得据此下结论', async () => {
    const ctx = await ctxWith(recorder({ guideline: [] }).deps)
    const result = await call(ctx, { query: '不存在的规则', scope: 'guideline' })
    expect(text(result)).toContain('0 条审查指南全文命中')
  })

  it('limit 收敛到 1–10，include_content=false 不带片段', async () => {
    const rec = recorder()
    const ctx = await ctxWith(rec.deps)
    await call(ctx, { query: '说明书', limit: 99 }, 'law-max')
    expect(rec.calls[0]?.limit).toBe(10)
    const result = await call(ctx, { query: '说明书', limit: 0, include_content: false }, 'law-min')
    expect(text(result)).not.toContain('第二十六条')
  })

  it('未注入检索端口或库路径不存在时报 setup_required 并给出安装指引', async () => {
    const bare = await ctxWith({})
    const missing = await call(bare, { query: '说明书' }, 'law-bare')
    expect(missing.isError).toBe(true)
    expect(text(missing)).toContain('本地规范库不可用')

    const absent = await ctxWith(recorder({ dbPath: '/nonexistent/knowledge.db' }).deps)
    const notFound = await call(absent, { query: '说明书', scope: 'guideline' }, 'law-absent')
    expect(notFound.isError).toBe(true)
    expect(text(notFound)).toContain('本地规范库不可用')
  })

  it('检索抛错时按 setup_required 报出，原始原因随结构化错误带出', async () => {
    const tool = createLawSearchTool(recorder({ throwLaw: true }).deps)
    const failure = await tool.execute({ query: '说明书' }, { signal } as never).then(
      () => undefined,
      (error: unknown) => error as { code?: string; details?: Record<string, unknown> },
    )
    expect(failure?.code).toBe('setup_required')
    expect(failure?.details?.['cause']).toBe('database is locked')
  })
})
