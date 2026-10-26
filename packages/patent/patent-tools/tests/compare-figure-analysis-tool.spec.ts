import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createComparePatentFigureAnalysisTool } from '../src/tool/compare-patent-figure-analysis.ts'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const tool of tools) ctx.tools.register(tool)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

type ToolValue = {
  expectedCount: number
  actualCount: number
  findings: { check: string; ref: string; message: string }[]
  summary: string
  consistent: boolean
}

describe('compare_patent_figure_analysis', () => {
  it('一致时返回通过并渲染结论', async () => {
    const ctx = await ctxWith(createComparePatentFigureAnalysisTool())
    const result = await execute(ctx, 'compare_patent_figure_analysis', {
      expected: { figure_type: 'flowchart', components: [{ ref_number: '10', name: '壳体' }] },
      analysis: { figure_type: 'flowchart', components: [{ ref_number: '10', name: '壳体' }] },
    }, 'm1') as { value: ToolValue }
    expect(result.value.consistent).toBe(true)
    expect(result.value.expectedCount).toBe(1)
    const rendered = text(result as unknown as { content: { type: string; text?: string }[] })
    expect(rendered).toContain('图文比对：期望 vs 识图')
    expect(rendered).toContain('图文比对通过')
  })

  it('有发现时逐条渲染，缺省名称按空串处理', async () => {
    const ctx = await ctxWith(createComparePatentFigureAnalysisTool())
    const result = await execute(ctx, 'compare_patent_figure_analysis', {
      expected: { components: [{ ref_number: '10', name: '壳体' }] },
      analysis: { components: [{ ref_number: '20' }, { ref_number: '10', name: '底座' }] },
    }, 'm2') as { value: ToolValue }
    expect(result.value.consistent).toBe(false)
    expect(result.value.findings.map(finding => finding.check)).toEqual(['name-mismatch', 'unexpected-mark'])
    const rendered = text(result as unknown as { content: { type: string; text?: string }[] })
    expect(rendered).toContain('## 发现的问题')
    expect(rendered).toContain('[name-mismatch]')
    expect(rendered).toContain('[unexpected-mark]')
  })

  it('图型不符进入输出', async () => {
    const ctx = await ctxWith(createComparePatentFigureAnalysisTool())
    const result = await execute(ctx, 'compare_patent_figure_analysis', {
      expected: { figure_type: 'flowchart', components: [] },
      analysis: { figure_type: 'block_diagram', components: [] },
    }, 'm3') as { value: ToolValue }
    expect(result.value.findings[0]?.check).toBe('figure-type-mismatch')
    expect(result.value.summary).toContain('图型不符')
  })
})
