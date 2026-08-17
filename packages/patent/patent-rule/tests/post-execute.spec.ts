import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import * as PatentRule from '@deepseek-ai/dsh-patent-rule'

const signal = new AbortController().signal

function exec(name: string): ToolExecution {
  const agent = { session: { header: { id: 's1' } } }
  return { callId: CallId(`call-${name}`), name, arguments: {}, agent, signal } as unknown as ToolExecution
}

function deliveryTool(name: string, text: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text }] },
  })
}

/** A rulesDir fixture with one block rule and one review rule (both keyword_blocklist, non-PAT). */
function makeRulesFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'patent-rule-'))
  const patentDir = join(root, 'patent')
  mkdirSync(patentDir)
  writeFileSync(
    join(patentDir, 'compliance.yaml'),
    [
      'rules:',
      '  - id: TEST-BLOCK',
      '    name: 测试拦截',
      '    severity: critical',
      '    action: block',
      '    check: { type: keyword_blocklist, keywords: ["BLOCKWORD"] }',
      '  - id: TEST-REVIEW',
      '    name: 测试审批',
      '    severity: major',
      '    action: review',
      '    check: { type: keyword_blocklist, keywords: ["REVIEWWORD"] }',
    ].join('\n'),
    'utf8',
  )
  return root
}

async function mount(config: PatentRule.Config): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(PatentRule, config)
  return ctx
}

describe('tools/post-execute output gate', () => {
  it('blocks a delivery-tool result hitting a block-level rule', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    ctx.tools.register(deliveryTool('render_patent_document', '包含 BLOCKWORD 的文档'))
    const result = await ctx.tools.execute(exec('render_patent_document'))
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/TEST-BLOCK/)
  })

  it('accepts a review-level result when approval allows', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    let requested: unknown
    ctx.provide('approval', { request: async (req: unknown): Promise<string> => { requested = req; return 'allowed-once' } })
    ctx.tools.register(deliveryTool('draft_claims', '包含 REVIEWWORD 的文档'))
    const result = await ctx.tools.execute(exec('draft_claims'))
    expect(result.isError).toBe(false)
    expect(requested).toBeDefined()
    expect((requested as { toolName?: string })?.toolName).toBe('draft_claims')
  })

  it('blocks a review-level result when approval rejects', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    ctx.provide('approval', { request: async (): Promise<string> => 'rejected' })
    ctx.tools.register(deliveryTool('draft_specification', '包含 REVIEWWORD 的文档'))
    const result = await ctx.tools.execute(exec('draft_specification'))
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/TEST-REVIEW/)
  })

  it('fails closed on a review-level result with no approval answerer', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    ctx.tools.register(deliveryTool('validate_specification', '包含 REVIEWWORD 的文档'))
    const result = await ctx.tools.execute(exec('validate_specification'))
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/无审批通道/)
  })

  it('delegates non-matching tools via next()', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    let downstreamCalled = false
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      downstreamCalled = true
      return next()
    })
    ctx.tools.register(deliveryTool('other_tool', '包含 BLOCKWORD 的文档'))
    const result = await ctx.tools.execute(exec('other_tool'))
    expect(result.isError).toBe(false)
    expect(downstreamCalled).toBe(true)
  })
})
