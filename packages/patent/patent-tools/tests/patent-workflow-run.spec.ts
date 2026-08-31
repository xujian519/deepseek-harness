import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  globalAtomRegistry,
  globalStageHandlerRegistry,
  registerBuiltinAtoms,
  type PatentModelPort,
  type WorkflowStageResult,
} from '@deepseek-ai/dsh-patent-core'
import { PatentToolError } from '../src/error.ts'
import {
  createPatentWorkflowRunTool,
  renderWorkflowRun,
  type PatentWorkflowRunOutput,
} from '../src/tool/patent-workflow-run.ts'
import { slopGateAtom, SlopGateHandler } from '../src/atoms/slop-gate.ts'

registerBuiltinAtoms()
// slop-gate 依赖本包的 slop 引擎，真实注册在 apply()（索引第 283-284 行）；
// 测试直接走包内实现，保证 manifest 校验与实际运行路径一致。
globalAtomRegistry.register(slopGateAtom)
globalStageHandlerRegistry.register(new SlopGateHandler())

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

  it('throws setup_required for graph mode without a model', async () => {
    await expect(
      createPatentWorkflowRunTool().execute({ graph: 'novelty', input: 'x' }, exec),
    ).rejects.toThrow('未提供模型客户端')
  })

  it('runs the citation-check graph against priorArt JSON and reports grounding', async () => {
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    const value = (await tool.execute(
      { graph: 'citation-check', input: '参见对比文件 D1', priorArt: JSON.stringify([{ title: 'D1' }]) },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(true)
    expect(value.mode).toBe('graph')
    expect(value.completed).toBe(true)
    const state = value.graphState as { citation_check_grounded?: unknown; citation_check_report?: unknown }
    expect(state.citation_check_grounded).toBe(true)
    expect(state.citation_check_report).toContain('引用全部接地')
  })

  it('rejects a non-JSON priorArt at the input boundary', async () => {
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    await expect(
      tool.execute({ graph: 'citation-check', input: 'x', priorArt: 'not-json' }, exec),
    ).rejects.toThrow(PatentToolError)
    await expect(
      tool.execute({ graph: 'citation-check', input: 'x', priorArt: 'not-json' }, exec),
    ).rejects.toThrow('priorArt 必须是 JSON 数组')
  })

  it('rejects a non-array priorArt at the input boundary', async () => {
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    await expect(
      tool.execute({ graph: 'citation-check', input: 'x', priorArt: '{"title": "D1"}' }, exec),
    ).rejects.toThrow('priorArt 必须是 JSON 数组')
  })

  it('runs a full graph with persisted checkpoints and approval-gate resume', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const cwd = temp
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, cwd })
    const value = (await tool.execute(
      { graph: 'novelty', input: 'x', caseId: 'case-1' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(true)
    expect(value.mode).toBe('graph')
    expect(value.checkpointNote).toBeDefined()
    expect(value.interruptNote).toBeDefined()

    // approveCheckpointId on an unknown checkpoint → soft error.
    const approve = (await tool.execute(
      { graph: 'novelty', input: 'x', caseId: 'case-1', approveCheckpointId: 'nope' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(approve.ok).toBe(false)
    expect(approve.error).toContain('检查点')

    // Granting the checkpoint the interrupted run left behind resumes past the gate.
    const granted = (await tool.execute(
      { graph: 'novelty', input: 'x', caseId: 'case-1', approveCheckpointId: 'patent_novelty-6' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(granted.ok).toBe(true)
    expect(granted.completed).toBe(true)
    expect(granted.interruptNote).toBeUndefined()
  })

  it('runs the manifest to completion with approved gates and persistence', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, cwd: temp })
    const value = (await tool.execute(
      {
        manifestId: 'patent_disclosure_v1',
        input: 'technical disclosure',
        caseId: 'case-2',
        approveStageIds: ['review_gate'],
        maxResults: 3,
        chartTargets: '[]',
      },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(true)
    // 审批门被放行：不中断，继续执行到收口（伪模型使部分原子阶段降级，但无 interrupt）。
    expect(value.interruptNote).toBeUndefined()
    expect(value.persistNote).toContain('持久化:')
    expect((value.degradedSteps ?? []).length).toBeGreaterThan(0)
  })

  it('disclosure manifest: a slop-heavy draft rewinds via the real slop-gate and exhausts', async () => {
    // 固定产出套话权利要求：真实 SlopGateHandler 判失败 → 回退 draft_claims 重跑 →
    // 仍失败 → maxRetries 耗尽降级。套话文本（total 30 < 通过线 35）由 slop-engine 确定性判定。
    const sloppyClaims = [
      '首先分析本申请的技术方案，再分析现有技术方案。',
      '进一步地，此外，值得一提的是，本申请具有显著进步。',
      '区别特征在于采用了新型结构。',
      '综上所述，保护范围合理。',
    ]
    const model: PatentModelPort = {
      stream: async function* () {
        yield { type: 'delta', text: JSON.stringify({ claims: sloppyClaims, notes: '撰写说明' }) }
        yield { type: 'done' }
      },
    }
    const tool = createPatentWorkflowRunTool({ model, search: fakeSearch })
    const value = (await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', approveStageIds: ['review_gate'], maxResults: 3 },
      exec,
    )) as PatentWorkflowRunOutput
    // 耗尽标记只在回退超过 maxRetries 时出现——证明 rewind 真实发生。
    // stages 在输出类型中是 JsonValue[]，运行值为 WorkflowStageResult[]（单向断言合法）。
    const stages = (value.stages ?? []) as WorkflowStageResult[]
    const slopClean = stages.filter(s => s.stageId === 'slop_clean')
    expect(slopClean).toHaveLength(1)
    expect(slopClean[0]!.output).toMatch(/\[WORKFLOW_RETRY_EXHAUSTED\]/)
    expect(slopClean[0]!.degraded).toBe(true)
    // 回退 splice 掉首轮结果，最终轮 draft 保留重跑后的套话草稿。
    const draftClaims = stages.filter(s => s.stageId === 'draft_claims')
    expect(draftClaims).toHaveLength(1)
    expect(draftClaims[0]!.output).toContain('首先分析')
    expect(value.degradedSteps).toContain('slop_clean')
  })

  it('renders graph edge cases and manifest prose', () => {
    const sparse = renderWorkflowRun({
      ok: true,
      mode: 'graph',
      manifestId: 'patent_novelty',
      graph: 'novelty',
      completed: true,
      summary: '',
      stages: [],
      degradedSteps: [],
      graphState: { rule_gate_verdict: 'pass', note: undefined, payload: { a: 1 }, long: '长'.repeat(90) } as unknown as JsonValue,
      graphDegraded: [
        { severity: 'info', reason: 'no_model', message: '节点降级', stateKeys: ['x'] },
      ],
      checkpointNote: '检查点: patent_novelty-1',
      persistNote: '持久化: x',
      interruptNote: '⏸ 审批门暂停',
    })
    expect(sparse).toContain('完成状态: completed')
    expect(sparse).toContain('⚠️ 降级标记')
    expect(sparse).toContain('(空)')
    expect(sparse).toContain('payload')
    expect(sparse).toContain('长'.repeat(90).slice(0, 80))

    const manifestWithInterrupt = renderWorkflowRun({
      ok: true,
      mode: 'manifest',
      manifestId: 'patent_disclosure_v1',
      completed: false,
      summary: 's',
      stages: [],
      degradedSteps: [],
      persistNote: '',
      interruptNote: '⏸ 审批门暂停',
    })
    expect(manifestWithInterrupt).toContain('⏸ 审批门暂停')

    const manifestBare = renderWorkflowRun({
      ok: true,
      mode: 'manifest',
      manifestId: 'patent_disclosure_v1',
      completed: true,
      summary: 's',
      stages: [],
      degradedSteps: [],
    })
    expect(manifestBare).toContain('完成状态: completed')

    const fallbacks = renderWorkflowRun({
      ok: true,
      mode: 'graph',
      manifestId: 'patent_novelty',
      graph: 'novelty',
      summary: '',
      stages: [],
      degradedSteps: [],
    })
    expect(fallbacks).toContain('（未启用）')
    expect(fallbacks).toContain('检查点: 无')
    expect(fallbacks).toContain('✅ 无降级')

    const failed = renderWorkflowRun({ ok: false, mode: 'manifest', manifestId: 'm', error: '坏' })
    expect(failed).toContain('坏')
    const bareFailed = renderWorkflowRun({ ok: false, mode: 'manifest', manifestId: 'm' })
    expect(bareFailed).toContain('失败')
  })

  it('renders through the registered tool', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    ctx.tools.register(createPatentWorkflowRunTool())
    const signal = new AbortController().signal
    const result = await ctx.tools.execute({
      signal,
      callId: ToolCallId('wfr-1'),
      name: 'patent_workflow_run',
      arguments: { manifestId: 'nope', input: 'x' },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const text = result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    expect(text).toContain('未知 manifest')
  })
})

let temp: string | undefined

afterEach(async () => {
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})
