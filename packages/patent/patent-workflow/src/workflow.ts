/**
 * 声明式工作流执行器（门面）。
 *
 * 只保留一条声明式路径 —— WorkflowManifest（JSON/YAML 可序列化）+ 单一执行器 runWorkflow。
 * 类型契约、WorkflowError 与 validateWorkflowManifest 已在 dsh-patent-core 前置
 * （src/workflow/types.ts + manifest.ts），本文件保留执行器本体并 re-export。
 *
 * 原子执行（v2，移植自 Mady agentcore/atom.go + pipeline_handler.go）：
 * - WorkflowStage 可声明 atom；runWorkflow 优先按 atom 分发到 StageHandler
 *   （经注入的 handlers 注册表或全局注册表），handler 内部调用 LLM/检索器。
 * - 未声明 atom 的阶段回退到调用方 executor。
 * - 审批门等 handler 抛 InterruptStageError 时，runWorkflow 暂停并返回 interrupted。
 */

import {
  WorkflowError,
  clearStageOutputs,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  validateWorkflowManifest,
  type PipelineState,
  type StageExecutor,
  type WorkflowContext,
  type WorkflowInterrupt,
  type WorkflowManifest,
  type WorkflowRunOptions,
  type WorkflowRunResult,
  type WorkflowStage,
  type WorkflowStageResult,
} from '@deepseek-ai/dsh-patent-core'
import { signalFor, signalMatches } from './workflow/signal.ts'
import { runStageOnce, type RunStageOnceOptions } from './workflow/executor.ts'

// ---- 门面再导出（保持消费面不变） ----
export { WorkflowError, validateWorkflowManifest } from '@deepseek-ai/dsh-patent-core'
export type {
  StageExecutor,
  WorkflowContext,
  WorkflowInterrupt,
  WorkflowManifest,
  WorkflowRunOptions,
  WorkflowRunResult,
  WorkflowRunStore,
  WorkflowStage,
  WorkflowStageResult,
  WorkflowStrategy,
} from '@deepseek-ai/dsh-patent-core'
export {
  builtinPatentManifests,
  patentDisclosureManifest,
  patentInfringementManifest,
  patentInventivenessManifest,
  patentInvalidationManifest,
  patentNoveltyManifest,
  patentOaResponseManifest,
  patentPatentabilityManifest,
  patentReexaminationManifest,
} from './workflow/manifests.ts'
export { runStageOnce, type RunStageOnceOptions } from './workflow/executor.ts'
export { compileSignal, signalFor, signalMatches } from './workflow/signal.ts'

/**
 * 单一执行器：按顺序执行各阶段。
 * - 声明 atom 的阶段经 StageHandler 执行，输出合并进 PipelineState
 * - 未声明 atom 的阶段回退调用方 executor（输出为空时标记 degraded 而非中断）
 * - 审批门等中断（InterruptStageError）：暂停执行并返回 interrupted（不执行后续阶段）
 * @param manifest - 工作流清单。
 * @param ctx - 工作流上下文。
 * @param executor - 可选调用方阶段执行器（未声明 atom 的阶段回退使用；接收已累积的执行态，
 *                   按 `stage.consumes` 取上游阶段输出）。
 * @param options - 可选执行配置（handlers/atoms/provider/approvalGrants/persist/runId）。
 * @returns 工作流执行结果。
 */
export async function runWorkflow(
  manifest: WorkflowManifest,
  ctx: WorkflowContext,
  executor?: StageExecutor,
  options: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  validateWorkflowManifest(manifest)
  const atoms = options.atoms ?? globalAtomRegistry
  assertKnownAtoms(manifest, atoms)
  const run: StageRun = {
    manifest,
    options,
    state: { ...ctx },
    stageOptions: {
      handlers: options.handlers ?? globalStageHandlerRegistry,
      atoms,
      provider: options.provider,
      executor,
      maxRetries: manifest.validation?.maxRetries ?? 2,
      approvalGrants: options.approvalGrants,
      ctx,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    },
    atoms,
    requireAll: manifest.validation?.requireAllSteps ?? true,
    maxParallelStages: options.maxParallelStages ?? 4,
    stageIds: new Map(manifest.stages.map((s, i) => [s.id, i])),
    rewindCounts: new Map(),
    signalCache: new Map(),
    results: [],
  }
  const interrupted = await runStages(run)
  return await assembleRunResult(run, interrupted)
}

/** atom 契约注册表（执行配置的 atoms 字段，缺省取全局注册表）。 */
type StageAtoms = NonNullable<WorkflowRunOptions['atoms']>

/** 单次 runWorkflow 的累积态：阶段执行选项、重试记账与已产出的阶段结果。 */
type StageRun = {
  manifest: WorkflowManifest
  options: WorkflowRunOptions
  /** 累积的执行态；阶段输出合并进该对象，回退时按阶段清除。 */
  state: PipelineState
  stageOptions: RunStageOnceOptions
  atoms: StageAtoms
  /** requireAllSteps：存在降级阶段时是否判定未完成。 */
  requireAll: boolean
  maxParallelStages: number
  /** 阶段 id → 序号，供 rewindTo 定位。 */
  stageIds: ReadonlyMap<string, number>
  /** 阶段 id → 已回退次数。 */
  rewindCounts: Map<string, number>
  signalCache: Map<string, RegExp>
  results: WorkflowStageResult[]
}

/** 单阶段之后的走向：下一阶段序号（null 表示停止循环），或中断。 */
type StageStep = {
  nextIndex: number | null
  interrupted?: WorkflowInterrupt | undefined
}

/**
 * 原子契约存在性 fail-fast：声明了未知 atom（连契约都没有）直接抛错；
 * 已知 atom 但 handler 未注册时回退 executor（atom 是契约，handler 是实现，可延迟注册）。
 * @param manifest - 工作流清单。
 * @param atoms - atom 契约注册表。
 * @throws WorkflowError 阶段声明了未注册的 atom。
 */
function assertKnownAtoms(manifest: WorkflowManifest, atoms: StageAtoms): void {
  for (const stage of manifest.stages) {
    if (stage.atom !== undefined && !atoms.lookup(stage.atom)) {
      throw new WorkflowError(`阶段 ${stage.id} 声明了未知 atom "${stage.atom}"（请先 RegisterAtom）`)
    }
  }
}

/**
 * 调用方取消：阶段边界检查，中止时中止执行（stage 内部的长调用由调用方另行取消）。
 * @param signal - 调用方取消信号。
 * @throws WorkflowError 信号已中止。
 */
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new WorkflowError('工作流执行已取消')
}

/**
 * 把一次阶段产出记入结果列表：空输出与降级标记都算 degraded。
 * @param run - 执行态。
 * @param stage - 产出所属阶段。
 * @param outcome - 阶段的输出与重试次数。
 */
function pushStageResult(run: StageRun, stage: WorkflowStage, outcome: { output: string; retries: number }): void {
  run.results.push({
    stageId: stage.id,
    strategy: stage.strategy,
    output: outcome.output,
    degraded: outcome.output.trim().length === 0 || outcome.output.startsWith('[WORKFLOW_DEGRADED]'),
    retries: outcome.retries,
    ...(stage.atom !== undefined ? { atom: stage.atom } : {}),
  })
}

/**
 * 计算可并行窗口（从当前 stage 起，连续且无 retry、无 consumes、同 atom 的阶段）。
 * @param manifest - 工作流清单。
 * @param index - 窗口起始阶段序号。
 * @param maxParallelStages - 窗口长度上限。
 * @returns 窗口长度；起始阶段不存在时为 0。
 */
function stageWindow(manifest: WorkflowManifest, index: number, maxParallelStages: number): number {
  let window = 1
  const current = manifest.stages[index]
  if (current === undefined) return 0
  const groupAtom = current.atom
  while (index + window < manifest.stages.length && window < maxParallelStages) {
    const candidate = manifest.stages[index + window]
    if (candidate === undefined) break
    // 声明 consumes 的阶段排除在并行窗口外：同组阶段并发读写同一 state，
    // 它可能读到同组上游尚未合并的产出。
    if (
      candidate.retry !== undefined ||
      candidate.consumes !== undefined ||
      candidate.atom !== groupAtom ||
      groupAtom === undefined
    ) break
    window += 1
  }
  return window
}

/**
 * 并行组：各阶段独立执行，组内出现中断即停止本组。
 * @param run - 执行态。
 * @param group - 本组阶段（并行窗口切片）。
 * @returns 组内中断；无中断时为 undefined。
 */
async function runParallelGroup(run: StageRun, group: readonly WorkflowStage[]): Promise<WorkflowInterrupt | undefined> {
  const outcomes = await Promise.all(group.map(stage => runStageOnce(stage, run.state, run.stageOptions)))
  for (let gi = 0; gi < outcomes.length; gi += 1) {
    const outcome = outcomes[gi]
    const groupStage = group[gi]
    if (outcome === undefined || groupStage === undefined) break
    if (outcome.interrupted) return outcome.interrupted
    pushStageResult(run, groupStage, outcome)
  }
  return undefined
}

/**
 * 单阶段执行，含一致性重试回退：输出触发信号时回退到 rewindTo 阶段重新执行，
 * 超过最大回退次数则保留不一致输出并标记 degraded。
 * @param run - 执行态。
 * @param index - 当前阶段序号。
 * @returns 下一阶段序号（null 表示停止循环），或中断。
 */
async function runSingleStage(run: StageRun, index: number): Promise<StageStep> {
  const stage = run.manifest.stages[index]
  if (stage === undefined) return { nextIndex: null }
  const outcome = await runStageOnce(stage, run.state, run.stageOptions)
  if (outcome.interrupted) return { nextIndex: null, interrupted: outcome.interrupted }
  const { output, retries } = outcome

  // 一致性重试循环：输出触发信号时回退到 rewindTo 阶段重新执行。
  if (output.trim().length > 0 && stage.retry !== undefined) {
    const signal = signalFor(stage, run.signalCache)
    if (signal !== undefined && signalMatches(output, signal)) {
      const rewindTo = stage.retry.rewindTo ?? stage.id
      const rewindIndex = run.stageIds.get(rewindTo)
      if (rewindIndex === undefined) return { nextIndex: null }
      const rewindCount = (run.rewindCounts.get(stage.id) ?? 0) + 1
      const maxRewind = stage.retry.maxRetries ?? 1
      if (rewindCount > maxRewind) {
        // 超过最大回退次数：保留当前（不一致）输出并继续，标记 degraded。
        run.results.push({
          stageId: stage.id,
          strategy: stage.strategy,
          output: `[WORKFLOW_RETRY_EXHAUSTED] ${stage.id}: ${output}`,
          degraded: true,
          retries,
          ...(stage.atom !== undefined ? { atom: stage.atom } : {}),
        })
        return { nextIndex: index + 1 }
      }
      // 覆盖从 rewindTo 起的结果与 state 键（防陈旧输出被兜底复用），回退重执行。
      run.rewindCounts.set(stage.id, rewindCount)
      run.results.splice(rewindIndex)
      clearStageOutputs({ state: run.state, stages: run.manifest.stages.slice(rewindIndex), atoms: run.atoms })
      return { nextIndex: rewindIndex }
    }
  }

  pushStageResult(run, stage, { output, retries })
  return { nextIndex: index + 1 }
}

/**
 * 主循环：按并行窗口推进阶段。
 * @param run - 执行态。
 * @returns 中断（审批门暂停）；无中断时为 undefined。
 */
async function runStages(run: StageRun): Promise<WorkflowInterrupt | undefined> {
  for (let index = 0; index < run.manifest.stages.length; ) {
    assertNotAborted(run.options.signal)
    const window = stageWindow(run.manifest, index, run.maxParallelStages)
    if (window > 1) {
      const group = run.manifest.stages.slice(index, index + window)
      const interrupted = await runParallelGroup(run, group)
      if (interrupted !== undefined) return interrupted
      index += window
      continue
    }
    const step = await runSingleStage(run, index)
    if (step.interrupted !== undefined) return step.interrupted
    if (step.nextIndex === null) break
    index = step.nextIndex
  }
  return undefined
}

/**
 * 汇总执行结果，并把持久化失败降级为结果里的告警。
 * @param run - 执行态。
 * @param interrupted - 中断（审批门暂停），无中断时为 undefined。
 * @returns 工作流执行结果。
 */
async function assembleRunResult(run: StageRun, interrupted: WorkflowInterrupt | undefined): Promise<WorkflowRunResult> {
  const degradedSteps = run.results.filter(r => r.degraded).map(r => r.stageId)
  // 中断（审批门暂停）≠ 完成：即使 requireAllSteps=false（容忍降级），暂停中的
  // 运行也必须报告 incomplete，否则"未确认"会被误读为"已完成"。
  const completed = interrupted === undefined
    && (run.requireAll ? degradedSteps.length === 0 : true)
  const okCount = run.results.filter(r => !r.degraded).length

  let summary: string
  if (interrupted) {
    summary = `工作流 ${run.manifest.id}（${run.manifest.name}）: 已执行 ${run.results.length}/${run.manifest.stages.length} 阶段，在 "${interrupted.stageId}" 暂停等待人工确认`
  } else {
    summary = `工作流 ${run.manifest.id}（${run.manifest.name}）: ${okCount}/${run.results.length} 阶段完成${degradedSteps.length > 0 ? `，降级阶段: ${degradedSteps.join('、')}` : ''}`
  }

  const result: WorkflowRunResult = {
    manifestId: run.manifest.id,
    caseType: run.manifest.caseType,
    completed,
    stages: run.results,
    degradedSteps,
    summary,
    ...(interrupted ? { interrupted } : {}),
  }
  // 持久化失败不阻断执行结果，仅把告警带回结果供调用方展示。
  try {
    await run.options.persist?.saveRun(result, run.options.runId)
  } catch (error) {
    result.persistWarning = `持久化失败（不影响执行结果）: ${error instanceof Error ? error.message : String(error)}`
  }
  return result
}
