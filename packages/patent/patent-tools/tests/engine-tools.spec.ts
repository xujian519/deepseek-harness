import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RuleSet } from '@deepseek-ai/dsh-patent-core'
import type { EvidenceEngine } from '@deepseek-ai/dsh-patent-core'
import { createRuleCheckTool } from '../src/tool/rule-check.ts'
import { createEvaluateEvidenceTool } from '../src/tool/evaluate-evidence.ts'
import { createClaimChartBuildTool } from '../src/tool/claim-chart-build.ts'

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

describe('rule_check', () => {
  it('fails loud on an unknown scope (empty rule set)', async () => {
    const tool = createRuleCheckTool({ loader: () => ({ rules: [] }) })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: 'x', scope: 'bogus' }, 'r-1')
    expect(result.isError).toBe(true)
  })

  it('evaluates a keyword blocklist rule', async () => {
    const ruleSet = { rules: [{ id: 'r1', name: '禁止词', severity: 'block', action: 'block', check: { type: 'keyword_blocklist', keywords: ['禁止词'] } }] } as unknown as RuleSet
    const tool = createRuleCheckTool({ loader: () => ruleSet, synonyms: () => new Map() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: '包含禁止词的文本', scope: 'patent' }, 'r-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('1 条违规')
    expect(text(result)).toContain('r1')
  })

  it('reports zero violations on clean text', async () => {
    const ruleSet = { rules: [{ id: 'r1', name: '禁止词', severity: 'block', action: 'block', check: { type: 'keyword_blocklist', keywords: ['禁止词'] } }] } as unknown as RuleSet
    const tool = createRuleCheckTool({ loader: () => ruleSet, synonyms: () => new Map() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: '干净文本', scope: 'patent' }, 'r-3')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('无违规')
  })
})

describe('evaluate_evidence', () => {
  const engine = {
    judge: (span: { id: string }) => ({
      spanId: span.id, overallScore: 0.85, confidence: 0.9,
      relevanceJudgment: { dimension: 'relevance', score: 0.9, level: 'high', reasoning: 'r' },
      legalityJudgment: { dimension: 'legality', score: 0.8, level: 'high', reasoning: 'r' },
      authenticityJudgment: { dimension: 'authenticity', score: 0.7, level: 'medium', reasoning: 'r' },
      reasoning: 'reasoning', flaggedIssues: [], rulesApplied: [
        { ruleId: 'EVI-001', name: 'n', action: 'block', severity: 'error', satisfied: true, pendingInputs: [], failedConditions: [] },
        { ruleId: 'EVI-011', name: 'm', action: 'block', severity: 'error', satisfied: false, pendingInputs: ['notarized'], failedConditions: [] },
      ],
    }),
    assessBurdenOfProof: (_caseType: string) => ({ burdenHolder: 'h', standard: 's', hasShifted: false, reasoning: 'r' }),
  } as unknown as EvidenceEngine

  it('judges a snippet and carries EVI-011 guard fields', async () => {
    const tool = createEvaluateEvidenceTool({ engine })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'evaluate_evidence', { snippet: 's', caseType: 'invalidation', notarized: true, translated: true }, 'ev-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('0.85')
    expect(text(result)).toContain('EVI-011')
  })
})

describe('claim_chart_build', () => {
  it('fails loud without a model port', async () => {
    const tool = createClaimChartBuildTool({})
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'claim_chart_build', { mode: 'invalidity', claim_text: 'c', targets: [] }, 'cc-1')
    expect(result.isError).toBe(true)
  })

  it('rejects empty claim_text', async () => {
    const tool = createClaimChartBuildTool({ model: { stream: async function* () { yield { type: 'done' as const } } } })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'claim_chart_build', { mode: 'invalidity', claim_text: '  ', targets: [] }, 'cc-2')
    expect(result.isError).toBe(true)
  })
})
