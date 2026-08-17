import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { registerBuiltinAtoms, type PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { PatentToolError } from '../src/error.ts'
import {
  createPatentWorkflowRunTool,
  renderWorkflowRun,
  type PatentWorkflowRunOutput,
} from '../src/tool/patent-workflow-run.ts'

registerBuiltinAtoms()

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

function fakeModel(): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta', text: '{"features": ["f1"], "problems": ["p1"], "effects": ["e1"]}' }
      yield { type: 'done' }
    },
  }
}

const fakeSearch = async () => []

describe('patent_workflow_run', () => {
  it('registers under patent_workflow_run', () => {
    expect(createPatentWorkflowRunTool().name).toBe('patent_workflow_run')
  })

  it('returns ok=false for an unknown manifest with the catalog', async () => {
    const tool = createPatentWorkflowRunTool()
    const value = (await tool.execute({ manifestId: 'nope', input: 'x' }, exec)) as PatentWorkflowRunOutput
    expect(value.ok).toBe(false)
    expect(value.mode).toBe('manifest')
    expect(value.available).toEqual(expect.arrayContaining(['patent_disclosure_v1']))
  })

  it('throws setup_required without a model', async () => {
    const tool = createPatentWorkflowRunTool()
    await expect(
      tool.execute({ manifestId: 'patent_disclosure_v1', input: 'x' }, exec),
    ).rejects.toThrow('未提供模型客户端')
  })

  it('runs the disclosure manifest with injected model + search, pausing at review_gate', async () => {
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    const value = (await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(true)
    expect(value.mode).toBe('manifest')
    expect(value.manifestId).toBe('patent_disclosure_v1')
    expect(value.interruptNote).toBeDefined()
    expect(value.interruptNote).toContain('review_gate')
  })

  it('returns ok=false for an unknown graph checkpoint', async () => {
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    const value = (await tool.execute(
      { graph: 'novelty', input: 'x', resumeCheckpointId: 'nope' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(false)
    expect(value.mode).toBe('graph')
    expect(value.error).toContain('检查点')
  })

  it('renders manifest and graph prose', () => {
    const manifest = renderWorkflowRun({
      ok: true,
      mode: 'manifest',
      manifestId: 'patent_disclosure_v1',
      completed: true,
      summary: '工作流 patent_disclosure_v1（技术交底书披露分析）: 1/1 阶段完成',
      stages: [{ stageId: 'extract', strategy: 'sub_agent', output: 'out', degraded: false, retries: 0, atom: 'extract' }],
      degradedSteps: [],
      persistNote: '持久化: 未启用（未提供 caseId）',
    })
    expect(manifest).toContain('patent_workflow_run(patent_disclosure_v1)')
    expect(manifest).toContain('- ✅ extract [atom:extract]: out')

    const graph = renderWorkflowRun({
      ok: true,
      mode: 'graph',
      manifestId: 'patent_novelty',
      graph: 'novelty',
      steps: 3,
      completed: false,
      summary: '',
      stages: [],
      degradedSteps: [],
      persistNote: '持久化: 未启用（未提供 caseId）',
      graphState: { rule_gate_verdict: 'pass', novelty_report: 'report text' },
      graphDegraded: [],
      checkpointNote: '检查点: patent_novelty-0',
    })
    expect(graph).toContain('图引擎执行 3 超步')
    expect(graph).toContain('规则门 verdict: pass')
  })

  it('throws PatentToolError for setup and input failures', async () => {
    await expect(createPatentWorkflowRunTool().execute({ input: 'x' }, exec)).rejects.toThrow(PatentToolError)
  })
})
