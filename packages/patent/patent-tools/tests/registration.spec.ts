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
