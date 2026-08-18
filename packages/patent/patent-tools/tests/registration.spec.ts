import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as tool from '../src/index.ts'

/** The 23 tools registered by patent-tools (render_patent_document is owned by dsh-patent-document). */
const EXPECTED_TOOLS = [
  'patent_search',
  'patent_metadata',
  'patent_legal_status',
  'patent_case_search',
  'patent_wiki_search',
  'patent_kg_query',
  'patent_eval',
  'claim_chart_build',
  'draft_claims',
  'draft_specification',
  'validate_specification',
  'evaluate_evidence',
  'rule_check',
  'analyze_patent_figure',
  'search_patent_figure',
  'patent_pdf_download',
  'recognize_chemical_structure',
  'flexible_plan',
  'patent_workflow',
  'patent_workflow_run',
  'patent_plan_task',
  'patent_worker_validate',
  'knowledge_note_save',
]

describe('@deepseek-ai/dsh-patent-tools registration', () => {
  it('exports the function-plugin surface', () => {
    expect(tool.name).toBe('patent-tools')
    expect(tool.inject).toContain('tools')
    expect(typeof tool.apply).toBe('function')
  })

  it('registers all 23 tools via ctx.plugin (direct mount)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {})
    const names = ctx.tools.schemas().map(s => s.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names).toContain(expected)
    }
  })

  it('unregisters every registered tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().map(s => s.name)).toEqual(expect.arrayContaining(EXPECTED_TOOLS))
    await fiber.dispose()
    const names = ctx.tools.schemas().map(s => s.name)
    for (const expected of EXPECTED_TOOLS) {
      expect(names).not.toContain(expected)
    }
  })

  it('does not register render_patent_document (owned by dsh-patent-document)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {})
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).not.toContain('render_patent_document')
  })
})

describe('model route fallback (B4)', () => {
  it('builds a real port from the deployment default route when Config omits provider/model', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) })
    let streamed = false
    ctx.provide('llm', {
      stream: async function* () {
        streamed = true
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    })
    await ctx.plugin(tool, {})
    // claim_chart_build needs a model port: with the default route fallback it
    // must reach the llm stream instead of throwing setup_required.
    const def = ctx.tools.get('claim_chart_build')
    expect(def).toBeDefined()
    // 空 LLM 响应会让 claim-chart 降级抛 tool_execution_failed——这正是真实
    // 端口被使用的证据；关键是绝不能抛 setup_required（那是 fail-loud 桩）。
    try {
      await def!.execute({
        claim_text: '1. 一种装置',
        targets: [],
        mode: 'patentability',
      }, {} as never)
    } catch (error) {
      const code = (error as { code?: string }).code
      expect(code).not.toBe('setup_required')
    }
    expect(streamed).toBe(true)
  })
})
