import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { loadLawBaselines } from '../src/baseline.ts'
import { createLawVerifyTool, type LawVerifyOutput } from '../src/tool/law-verify.ts'
import type { CitationPolicySet, LawBaseline, LawName } from '../src/types.ts'

const POLICIES: CitationPolicySet = {
  mismatch: 'block',
  outOfRange: 'block',
  notIndexed: 'warn',
  unverified: 'warn',
}

/** The packaged index, whose entries are all still awaiting transcription. */
const shipped = loadLawBaselines()

/** A baseline whose single article is fully verified, for the accepted path. */
const verifiedIndex = new Map<LawName, LawBaseline>([['专利法', {
  law: '专利法',
  document: '中华人民共和国专利法',
  revision: null,
  maxArticle: 82,
  maxVerifiedOn: '2026-01-01',
  maxSource: 'fixture',
  articles: [{
    article: 22,
    topics: ['新颖性', '创造性'],
    text: '现行条文',
    sourceDoc: '主席令第五十五号',
    verifiedOn: '2026-01-01',
  }],
  sections: [],
}]])

async function host(index = shipped, policies = POLICIES): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.tools.register(createLawVerifyTool({ baselines: index, policies }))
  return ctx
}

function execute(ctx: Context, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('law-verify'),
    name: 'law_verify',
    arguments: args,
  })
}

/** Execute and return the canonical output value. */
async function run(ctx: Context, args: unknown): Promise<LawVerifyOutput> {
  const result = await execute(ctx, args)
  expect(result.isError).toBe(false)
  return result.value as LawVerifyOutput
}

describe('law_verify tool', () => {
  it('extracts the citations of a text and reports each as unverified', async () => {
    const value = await run(await host(), { text: '依据专利法第22条第3款与审查指南第二部分第四章3.2.1.1。' })
    expect(value.findings.map(finding => finding.raw)).toEqual(['专利法第22条第3款', '审查指南第二部分第四章3.2.1.1'])
    expect(value.findings.every(finding => finding.decision === 'unverified')).toBe(true)
    expect(value.blocked).toBe(false)
    expect(value.counts.unverified).toBe(2)
    expect(value.findings[0]).toMatchObject({ law: '专利法', article: 22, paragraph: 3 })
    expect(value.findings[1]).toMatchObject({ law: '专利审查指南', sectionPath: '第二部分第四章3.2.1.1' })
  })

  it('accepts a citation the index has verified', async () => {
    const value = await run(await host(verifiedIndex), { references: ['专利法第22条第3款'] })
    expect(value.findings[0]).toMatchObject({ decision: 'valid', policy: 'allow' })
    expect(value.blocked).toBe(false)
  })

  it('blocks a citation straight out of the valid article range', async () => {
    const value = await run(await host(verifiedIndex), { references: ['专利法第99条'] })
    expect(value.findings[0]).toMatchObject({ decision: 'out-of-range', policy: 'block' })
    expect(value.blocked).toBe(true)
    expect(value.counts['out-of-range']).toBe(1)
  })

  it('blocks a citation whose proposition the verified article does not support', async () => {
    const value = await run(await host(verifiedIndex), {
      references: ['专利法第22条第3款'],
      proposition: '说明书充分公开',
    })
    expect(value.findings[0]).toMatchObject({ decision: 'mismatch', policy: 'block' })
    expect(value.blocked).toBe(true)
  })

  it('reports an unparseable reference as an input error instead of skipping it', async () => {
    const ctx = await host()
    const result = await execute(ctx, { references: ['见前述条款'] })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('无法把「见前述条款」解析为单条法条引用')
  })

  it('reports a call with neither text nor references as an input error', async () => {
    const ctx = await host()
    const result = await execute(ctx, {})
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('至少要给出 text 或 references 之一')
  })

  it('renders a decision table with the unverified warning', async () => {
    const ctx = await host()
    const result = await execute(ctx, { text: '依据专利法第22条第3款。' })
    expect(JSON.stringify(result.content)).toContain('| 引用 | 判定 | 处置 | 说明 |')
    expect(JSON.stringify(result.content)).toContain('存在未核验引用')
  })

  it('renders the blocked warning when a citation is intercepted', async () => {
    const ctx = await host(verifiedIndex)
    const result = await execute(ctx, { references: ['专利法第99条'] })
    expect(JSON.stringify(result.content)).toContain('**存在被拦截的引用**')
  })

  it('renders the no-citation notice for text without references', async () => {
    const ctx = await host()
    const result = await execute(ctx, { text: '本案未引用条文。' })
    expect(JSON.stringify(result.content)).toContain('未在文本中识别到法条引用')
  })
})
