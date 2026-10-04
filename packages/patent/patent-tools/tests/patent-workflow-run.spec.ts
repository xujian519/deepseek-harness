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
  StageHandlerRegistry,
  type PatentModelPort,
  type WorkflowStageResult,
} from '@deepseek-ai/dsh-patent-core'
import { JobId } from '@deepseek-ai/dsh-jobs'
import type { JobHooks, JobSpec, JobView } from '@deepseek-ai/dsh-jobs'
import { PatentToolError } from '../src/error.ts'
import {
  createPatentWorkflowRunTool,
  renderWorkflowRun,
  type PatentWorkflowRunOutput,
  type WorkflowRunJobRegistry,
} from '../src/tool/patent-workflow-run.ts'
import { slopGateAtom, SlopGateHandler } from '../src/atoms/slop-gate.ts'

registerBuiltinAtoms()
// slop-gate 依赖本包的 slop 引擎，真实注册在 apply()（索引第 283-284 行）；
// 测试直接走包内实现，保证 manifest 校验与实际运行路径一致。
globalAtomRegistry.register(slopGateAtom)
globalStageHandlerRegistry.register(new SlopGateHandler())

/**
 * Tool execution context for a call from this spec. `withAgent` adds the
 * calling agent, which the tool reads for job ownership (`owner`) and for
 * binding its model port to a session.
 * @param withAgent - include a calling agent.
 * @returns the execution context the tool body reads.
 */
function toolExec(withAgent = false): Parameters<ToolDefinition['execute']>[1] {
  const agent = { id: 'sess-1', session: { id: 'sess-1', append: () => {} } }
  const context = { signal: new AbortController().signal, ...(withAgent ? { agent } : {}) }
  return context as unknown as Parameters<ToolDefinition['execute']>[1]
}

const exec = toolExec()

function fakeModel(): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta', text: '{"features": ["f1"], "problems": ["p1"], "effects": ["e1"]}' }
      yield { type: 'done' }
    },
  }
}

const fakeSearch = async () => []

/**
 * 最小 job 注册表替身：捕获 starter 的 hooks，由测试驱动结算；`list` 反映仍在跑的
 * job（结算即从列表移除），供并发防护的用例使用。每个 hook 同时登记进
 * {@link outstanding}，由 teardown 统一结算后再删临时目录。
 */
function fakeJobRegistry(): {
  jobs: WorkflowRunJobRegistry
  started: JobSpec[]
  hooks: JobHooks[]
  progress: string[]
} {
  const started: JobSpec[] = []
  const hooks: JobHooks[] = []
  const progress: string[] = []
  const live = new Map<string, JobView>()
  return {
    started,
    hooks,
    progress,
    jobs: {
      list: () => [...live.values()],
      start: (spec) => {
        started.push(spec)
        const id = JobId(`patent-workflow-${started.length}`)
        live.set(id, {
          id,
          kind: spec.kind,
          label: spec.label,
          status: 'running',
          startedAt: 0,
          output: { total: 0, earliest: 0 },
        })
        const hook = spec.run({ id, append: () => {}, updateProgress: (line) => { progress.push(line) } })
        hooks.push(hook)
        outstanding.push(hook)
        void hook.done.then(() => { live.delete(id) })
        return id
      },
    },
  }
}

/** 受测试控制的模型：首个流调用挂起，直到 release() 被调用。 */
function gatedModel(): { port: PatentModelPort; release: () => void } {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  return {
    release: () => { release() },
    port: {
      stream: async function* () {
        await gate
        yield { type: 'delta', text: '{"features": ["f1"], "problems": ["p1"], "effects": ["e1"]}' }
        yield { type: 'done' }
      },
    },
  }
}

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

  it('run_in_background registers a job and returns its id without running the stages inline', async () => {
    const { jobs, started, hooks } = fakeJobRegistry()
    // caseId 使 manifest 运行把结果写到 <cwd>/data/cases/<id>/workflow-runs；cwd 指向临时目录，
    // 否则产物落进仓库工作树。
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs, cwd: temp })
    const value = (await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', caseId: 'CN2024-0003', run_in_background: true },
      exec,
    )) as PatentWorkflowRunOutput

    expect(value).toMatchObject({
      ok: true,
      mode: 'manifest',
      manifestId: 'patent_disclosure_v1',
      background: true,
      jobId: 'patent-workflow-1',
    })
    expect(value.stages).toBeUndefined()
    expect(started[0]?.kind).toBe('patent-workflow')
    expect(started[0]?.label).toBe('patent_disclosure_v1 (CN2024-0003)')
    expect(renderWorkflowRun(value)).toContain('已在后台启动 job patent-workflow-1')

    // 工作流在 job 自己的信号下跑完，结算结果就是前台调用会返回的那段文本。
    const outcome = await hooks[0]!.done
    expect(outcome.status).toBe('completed')
    expect(outcome.detail).toBe('interrupted')
    expect(outcome.result).toContain('patent_workflow_run(patent_disclosure_v1)')
    expect(outcome.result).toContain('review_gate')

    // 审批门已放行时同一 manifest 跑到头：结算 detail 为完成而不是中断。
    const done = fakeJobRegistry()
    const completeTool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => done.jobs })
    await completeTool.execute(
      {
        manifestId: 'patent_disclosure_v1',
        input: 'technical disclosure',
        run_in_background: true,
        approveStageIds: ['review_gate'],
      },
      exec,
    )
    await expect(done.hooks[0]!.done).resolves.toMatchObject({ status: 'completed', detail: 'completed' })
  })

  it('a cancelled background job settles killed', async () => {
    const { port, release } = gatedModel()
    const { jobs, hooks } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: port, search: fakeSearch, jobs: () => jobs })
    await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', run_in_background: true },
      exec,
    )

    hooks[0]!.cancel()
    release()
    const outcome = await hooks[0]!.done
    expect(outcome.status).toBe('killed')
    expect(outcome.result).toBeUndefined()
  })

  it('a background job whose run fails loud settles failed, owned by the calling agent session', async () => {
    // A stage handler that fails loud (setup_required) propagates out of the run
    // instead of degrading, which is the failure the job must report.
    const handlers = new StageHandlerRegistry()
    handlers.register({
      name: 'extract',
      category: 'extract',
      execute: () => { throw new PatentToolError('setup_required', 'stage handler exploded') },
    })
    const { jobs, started, hooks } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, handlers, jobs: () => jobs })
    await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', run_in_background: true },
      toolExec(true),
    )

    expect(started[0]?.owner).toBe('sess-1')
    expect(started[0]?.label).toBe('patent_disclosure_v1')
    const outcome = await hooks[0]!.done
    expect(outcome).toMatchObject({ status: 'failed', detail: 'stage handler exploded' })
  })

  it('rejects malformed arguments before registering a background job', async () => {
    const { jobs, started } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs })
    await expect(
      tool.execute(
        { manifestId: 'patent_disclosure_v1', input: 'x', priorArt: '{oops', run_in_background: true },
        exec,
      ),
    ).rejects.toThrow('priorArt 必须是 JSON 数组')
    expect(started).toHaveLength(0)
  })

  it('reports stage progress through the job handle as the run advances', async () => {
    const { jobs, hooks, progress } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs })
    await tool.execute(
      { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', run_in_background: true },
      exec,
    )
    await hooks[0]!.done

    // 结算前 job_output 读不到环内容，进展只能经 updateProgress（job_list 的状态行）。
    expect(progress[0]).toMatch(/^1\/\d+ \S+$/)
    expect(progress.some(line => line.includes('review_gate'))).toBe(true)
  })

  it('refuses a second live background run for the same case and manifest', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const { jobs, started } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs, cwd: temp })
    const args = {
      manifestId: 'patent_disclosure_v1',
      input: 'technical disclosure',
      caseId: 'CN2024-0001',
      run_in_background: true,
    }
    await tool.execute(args, exec)
    await expect(tool.execute(args, exec)).rejects.toThrow('已有一个后台运行')
    expect(started).toHaveLength(1)
  })

  it('starts the same case run again once the previous one settled', async () => {
    temp = await mkdtemp(join(tmpdir(), 'dsh-patent-wf-'))
    const { jobs, started, hooks } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs, cwd: temp })
    const args = {
      manifestId: 'patent_disclosure_v1',
      input: 'technical disclosure',
      caseId: 'CN2024-0002',
      run_in_background: true,
    }
    await tool.execute(args, exec)
    await hooks[0]!.done
    await expect(tool.execute(args, exec)).resolves.toMatchObject({ jobId: 'patent-workflow-2' })
    expect(started).toHaveLength(2)
  })

  it('does not constrain background runs that write no case artifacts', async () => {
    const { jobs, started } = fakeJobRegistry()
    const tool = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs })
    const args = { manifestId: 'patent_disclosure_v1', input: 'technical disclosure', run_in_background: true }
    await tool.execute(args, exec)
    await tool.execute(args, exec)
    expect(started).toHaveLength(2)
  })

  it('run_in_background requires a job registry and rejects the graph path', async () => {
    const withoutJobs = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch })
    await expect(
      withoutJobs.execute({ manifestId: 'patent_disclosure_v1', input: 'x', run_in_background: true }, exec),
    ).rejects.toThrow('未启用后台任务')

    const { jobs } = fakeJobRegistry()
    const withJobs = createPatentWorkflowRunTool({ model: fakeModel(), search: fakeSearch, jobs: () => jobs })
    await expect(
      withJobs.execute({ graph: 'citation-check', input: 'x', run_in_background: true }, exec),
    ).rejects.toThrow('仅支持 manifest 路径')
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

  it('hands a stage its declared upstream outputs and the separately supplied claims', async () => {
    const prompts: string[] = []
    const model: PatentModelPort = {
      stream: async function* (request) {
        prompts.push(request.messages.map(m => m.content).join('\n'))
        yield { type: 'delta', text: `产出${prompts.length}` }
        yield { type: 'done' }
      },
    }
    const tool = createPatentWorkflowRunTool({ model, search: async () => [] })
    const value = (await tool.execute(
      { manifestId: 'patent_novelty_v1', input: '交底书正文', claims: '1. 一种装置，其特征在于，包括壳体。' },
      exec,
    )) as PatentWorkflowRunOutput
    expect(value.ok).toBe(true)
    // 逐项对比阶段声明了 consumes: ['parse','search']，故两者产出与权利要求材料都进提示词。
    const compare = prompts.find(p => p.includes('逐项对比技术特征与现有技术'))
    expect(compare).toBeDefined()
    expect(compare).toContain('## 上游阶段产出: parse')
    expect(compare).toContain('## 上游阶段产出: search')
    expect(compare).toContain('产出1')
    expect(compare).toContain('## 权利要求书（本次调用的 claims 参数）')
    expect(compare).toContain('1. 一种装置，其特征在于，包括壳体。')
    // 首个阶段没有上游产出，只有材料与权利要求。
    const parse = prompts.find(p => p.includes('解析技术交底书'))
    expect(parse).not.toContain('上游阶段产出')
  })

  it('runs the reexamination and invalidation manifests with their own grounds table and chart mode', async () => {
    const prompts: string[] = []
    const model: PatentModelPort = {
      stream: async function* (request) {
        prompts.push(request.messages.map(m => m.content).join('\n'))
        yield { type: 'delta', text: `产出${prompts.length}` }
        yield { type: 'done' }
      },
    }
    const tool = createPatentWorkflowRunTool({ model, search: async () => [] })
    // 同一份驳回决定按两种程序解读：理由表与图表模式都不同。
    const decision =
      '本驳回决定认为权利要求 1 不具备创造性（专利法第22条第3款），且该实用新型专利的修改超出原说明书范围（专利法第33条）。'

    const reexam = (await tool.execute(
      { manifestId: 'patent_reexamination_v1', input: decision },
      exec,
    )) as PatentWorkflowRunOutput
    expect(reexam.ok).toBe(true)
    expect(prompts.some(p => p.includes('场景模式：reexamination'))).toBe(true)
    const reexamNovelty = prompts.find(p => p.includes('新颖性单独对比'))
    expect(reexamNovelty).toContain('## 上游阶段产出: grounds')
    expect(reexamNovelty).toContain('创造性缺陷')
    expect(reexamNovelty).not.toContain('创造性无效')

    prompts.length = 0
    const invalid = (await tool.execute(
      { manifestId: 'patent_invalidation_v1', input: decision },
      exec,
    )) as PatentWorkflowRunOutput
    expect(invalid.ok).toBe(true)
    expect(prompts.some(p => p.includes('场景模式：invalidity'))).toBe(true)
    const invalidNovelty = prompts.find(p => p.includes('新颖性单独对比'))
    expect(invalidNovelty).toContain('创造性无效（不具备创造性）')
    expect(invalidNovelty).not.toContain('创造性缺陷')
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

/**
 * 本文件启动过的后台 run。带 caseId 的 run 把运行记录写进 `temp`，且是先写兄弟临时
 * 文件再 rename；删除目录时若 run 仍在写，递归删除会在 rename 落地前撞上那个临时文件
 * 而以 ENOTEMPTY 失败。teardown 先等它们结算。
 */
const outstanding: JobHooks[] = []

afterEach(async () => {
  await Promise.all(outstanding.splice(0).map(hook => hook.done))
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})
