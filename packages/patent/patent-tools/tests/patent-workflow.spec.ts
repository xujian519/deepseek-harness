import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  createPatentWorkflowTool,
  renderPatentWorkflow,
  type PatentWorkflowOutput,
} from '../src/tool/patent-workflow.ts'

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

const NOVELTY_OUTPUTS = [
  { stageId: 'parse', text: 'parsed' },
  { stageId: 'search', text: 'searched' },
  { stageId: 'compare', text: 'compared' },
  { stageId: 'conclude', text: 'concluded' },
  { stageId: 'approval', text: 'approved' },
]

describe('patent_workflow', () => {
  const tool = createPatentWorkflowTool()

  it('registers under patent_workflow', () => {
    expect(tool.name).toBe('patent_workflow')
  })

  it('returns found=false for an unknown manifest with the catalog', async () => {
    const value = (await tool.execute({ manifestId: 'nope' }, exec)) as PatentWorkflowOutput
    expect(value.found).toBe(false)
    expect(value.valid).toBe(false)
    expect(value.available).toEqual(expect.arrayContaining(['patent_novelty_v1', 'patent_disclosure_v1']))
  })

  it('assembles per-stage outputs into a completed run record', async () => {
    const value = (await tool.execute({ manifestId: 'patent_novelty_v1', outputs: NOVELTY_OUTPUTS }, exec)) as PatentWorkflowOutput
    expect(value.found).toBe(true)
    expect(value.valid).toBe(true)
    expect(value.completed).toBe(true)
    expect(value.stages).toHaveLength(5)
    expect(value.degradedSteps).toEqual([])
    expect(value.persistNote).toContain('未启用')
  })

  it('marks missing stages degraded', async () => {
    const value = (await tool.execute(
      { manifestId: 'patent_novelty_v1', outputs: [{ stageId: 'parse', text: 'only-parse' }] },
      exec,
    )) as PatentWorkflowOutput
    expect(value.completed).toBe(false)
    expect(value.degradedSteps.length).toBeGreaterThan(0)
  })

  it('renders unknown-manifest and assembled-summary prose', () => {
    const unknown = renderPatentWorkflow({
      manifestId: 'nope',
      found: false,
      valid: false,
      completed: false,
      caseType: '',
      stages: [],
      degradedSteps: [],
      summary: '',
      persistNote: '',
      available: ['patent_novelty_v1'],
    })
    expect(unknown).toContain('未知 manifest "nope"')

    const assembled = renderPatentWorkflow({
      manifestId: 'patent_novelty_v1',
      found: true,
      valid: true,
      completed: true,
      caseType: 'novelty_search',
      stages: [{ stageId: 'parse', strategy: 'chain', output: 'parsed', degraded: false, retries: 0 }],
      degradedSteps: [],
      summary: '工作流 patent_novelty_v1（专利新颖性分析）: 1/1 阶段完成',
      persistNote: '持久化: 未启用（未提供 caseId）',
    })
    expect(assembled).toContain('patent_workflow(patent_novelty_v1)')
    expect(assembled).toContain('- ✅ parse (chain): parsed')
    expect(assembled).toContain('完成状态: completed')
  })
})
