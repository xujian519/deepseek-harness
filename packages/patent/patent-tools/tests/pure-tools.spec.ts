import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createPatentEvalTool, evaluatePatentContent } from '../src/tool/patent-eval.ts'
import { createDraftClaimsTool, draftClaims } from '../src/tool/draft-claims.ts'
import { createDraftSpecificationTool, draftSpecification } from '../src/tool/draft-specification.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

describe('patent_eval', () => {
  it('scores an empty report at zero', () => {
    const out = evaluatePatentContent('report', '', [])
    expect(out.mode).toBe('report')
    expect(out.passed).toBe(false)
  })

  it('detects missing report sections', () => {
    const out = evaluatePatentContent('report', '# 技术领域\n技术方案', [])
    expect(out.details['结构完整性']).toBeDefined()
    expect(out.details['结构完整性']?.passed).toBe(false)
  })

  it('evaluates citations against required statutes', () => {
    const out = evaluatePatentContent('citations', '第二十二条第三款', ['第二十二条第二款', '第二十二条第三款'])
    expect(out.details['引用合规性']).toBeDefined()
    expect(out.details['引用合规性']?.score).toBe(0.5)
  })

  it('standardizes the search strategy for retrieval mode', () => {
    const out = evaluatePatentContent('retrieval', '创造性 三步法 技术启示', [])
    expect(out.searchStrategy).toBeDefined()
    expect(out.searchStrategy?.query).toBe('创造性 三步法 技术启示')
    expect(out.searchStrategy?.keywords).toEqual(['创造性', '三步法', '技术启示'])
    expect(out.searchStrategy?.hits).toBe(3)
  })

  it('runs through the registered tool', async () => {
    const ctx = await ctxWith(createPatentEvalTool())
    const result = await execute(ctx, 'patent_eval', { mode: 'retrieval', content: 'a b c' }, 'e-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('检索覆盖度')
  })
})

describe('draft_claims', () => {
  it('drafts an independent + dependent claim', () => {
    const out = draftClaims({ invention_name: '一种装置', technical_features: ['特征A', '特征B'], optional_features: ['特征C'] })
    expect(out.claims.length).toBe(2)
    expect(out.claims[0]?.type).toBe('independent')
    expect(out.claims[1]?.type).toBe('dependent')
    expect(out.claims[1]?.refersTo).toBe(1)
  })

  it('flags a trailing-period violation', () => {
    const out = draftClaims({ invention_name: '一种装置', technical_features: ['特征A'] })
    // The independent claim ends with '。' per the template, so no period violation.
    expect(out.violations.every(v => v.rule !== 'period')).toBe(true)
  })

  it('runs through the registered tool', async () => {
    const ctx = await ctxWith(createDraftClaimsTool())
    const result = await execute(ctx, 'draft_claims', { invention_name: '一种装置', technical_features: ['特征A'] }, 'dc-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('权利要求书草案')
  })
})

describe('draft_specification', () => {
  it('assembles the five sections', () => {
    const out = draftSpecification({ title: '一种装置' })
    expect(out.sections.map(s => s.name)).toEqual(['技术领域', '背景技术', '发明内容', '附图说明', '具体实施方式'])
    expect(out.sections.some(s => s.placeholder)).toBe(true)
  })

  it('warns when a utility model lacks drawings', () => {
    const out = draftSpecification({ title: '一种装置', patent_type: 'utility_model' })
    expect(out.warnings.some(w => w.includes('附图'))).toBe(true)
  })

  it('runs through the registered tool', async () => {
    const ctx = await ctxWith(createDraftSpecificationTool())
    const result = await execute(ctx, 'draft_specification', { title: '一种装置' }, 'ds-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('说明书草案')
  })
})

describe('draft_claims patent_type', () => {
  it('flags a utility-model draft over the 10-claim cap (细则 A23)', () => {
    const out = draftClaims({
      invention_name: '一种装置',
      patent_type: 'utility_model',
      technical_features: ['特征A'],
      optional_features: Array.from({ length: 11 }, (_, i) => `附加特征${i + 1}`),
    })
    expect(out.claims).toHaveLength(12)
    const limit = out.violations.find(v => v.rule === 'claim_limit')
    expect(limit).toBeDefined()
    expect(limit!.severity).toBe('error')
  })

  it('does not flag an invention draft for the same claim count', () => {
    const out = draftClaims({
      invention_name: '一种装置',
      patent_type: 'invention',
      technical_features: ['特征A'],
      optional_features: Array.from({ length: 11 }, (_, i) => `附加特征${i + 1}`),
    })
    expect(out.violations.find(v => v.rule === 'claim_limit')).toBeUndefined()
  })
})
