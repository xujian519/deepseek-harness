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
import { runStageOnce } from './workflow/executor.ts'

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
  type BuiltinPatentManifest,
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
 * @param executor - 可选调用方阶段执行器（未声明 atom 的阶段回退使用）。
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
  const requireAll = manifest.validation?.requireAllSteps ?? true
  const maxRetries = manifest.validation?.maxRetries ?? 2
  const handlers = options.handlers ?? globalStageHandlerRegistry
  const atoms = options.atoms ?? globalAtomRegistry

  // 原子契约存在性 fail-fast：声明了未知 atom（连契约都没有）直接抛错；
  // 已知 atom 但 handler 未注册时回退 executor（atom 是契约，handler 是实现，可延迟注册）。
  for (const stage of manifest.stages) {
    if (stage.atom !== undefined && !atoms.lookup(stage.atom)) {
      throw new WorkflowError(`阶段 ${stage.id} 声明了未知 atom "${stage.atom}"（请先 RegisterAtom）`)
    }
  }

  const state: PipelineState = { ...ctx }
  const results: WorkflowStageResult[] = []
  let interrupted: WorkflowInterrupt | undefined

  const stageIds = new Map(manifest.stages.map((s, i) => [s.id, i]))
  const rewindCounts = new Map<string, number>()
  const signalCache = new Map<string, RegExp>()

  const stageOptions = {
    handlers,
    atoms,
    provider: options.provider,
    executor,
    maxRetries,
    approvalGrants: options.approvalGrants,
    ctx,
  }

  const pushResult = (stage: WorkflowStage, outcome: { output: string; retries: number }): void => {
    results.push({
      stageId: stage.id,
      strategy: stage.strategy,
      output: outcome.output,
      degraded: outcome.output.trim().length === 0 || outcome.output.startsWith('[WORKFLOW_DEGRADED]'),
      retries: outcome.retries,
      ...(stage.atom !== undefined ? { atom: stage.atom } : {}),
    })
  }

  const MAX_PARALLEL_STAGES = 4

  for (let index = 0; index < manifest.stages.length; ) {
    // 计算可并行窗口（从当前 stage 起，连续且无 retry、同 atom 的阶段）。
    let window = 1
    const current = manifest.stages[index]
    if (current === undefined) break
    const groupAtom = current.atom
    while (index + window < manifest.stages.length && window < MAX_PARALLEL_STAGES) {
      const candidate = manifest.stages[index + window]
      if (candidate === undefined) break
      if (candidate.retry !== undefined || candidate.atom !== groupAtom || groupAtom === undefined) break
      window += 1
    }

    if (window > 1) {
      // 并行组：各 stage 独立执行。
      const group = manifest.stages.slice(index, index + window)
      const outcomes = await Promise.all(group.map(stage => runStageOnce(stage, state, stageOptions)))
      let groupInterrupted: WorkflowInterrupt | undefined
      for (let gi = 0; gi < outcomes.length; gi += 1) {
        const outcome = outcomes[gi]
        const groupStage = group[gi]
        if (outcome === undefined || groupStage === undefined) break
        if (outcome.interrupted) {
          groupInterrupted = outcome.interrupted
          break
        }
        pushResult(groupStage, outcome)
      }
      if (groupInterrupted) {
        interrupted = groupInterrupted
        break
      }
      index += window
      continue
    }

    const stage = manifest.stages[index]
    if (stage === undefined) break
    const outcome = await runStageOnce(stage, state, stageOptions)
    if (outcome.interrupted) {
      interrupted = outcome.interrupted
      break
    }
    const { output, retries } = outcome

    // 一致性重试循环：输出触发信号时回退到 rewindTo 阶段重新执行。
    if (output.trim().length > 0 && stage.retry !== undefined) {
      const signal = signalFor(stage, signalCache)
      if (signal !== undefined && signalMatches(output, signal)) {
        const rewindTo = stage.retry.rewindTo ?? stage.id
        const rewindIndex = stageIds.get(rewindTo)
        if (rewindIndex === undefined) break
        const rewindCount = (rewindCounts.get(stage.id) ?? 0) + 1
        const maxRewind = stage.retry.maxRetries ?? 1
        if (rewindCount > maxRewind) {
          // 超过最大回退次数：保留当前（不一致）输出并继续，标记 degraded。
          results.push({
            stageId: stage.id,
            strategy: stage.strategy,
            output: `[WORKFLOW_RETRY_EXHAUSTED] ${stage.id}: ${output}`,
            degraded: true,
            retries,
            ...(stage.atom !== undefined ? { atom: stage.atom } : {}),
          })
          index += 1
          continue
        }
        // 覆盖从 rewindTo 起的结果与 state 键（防陈旧输出被兜底复用），回退重执行。
        rewindCounts.set(stage.id, rewindCount)
        results.splice(rewindIndex)
        for (const rewinded of manifest.stages.slice(rewindIndex)) {
          Reflect.deleteProperty(state, rewinded.id)
        }
        index = rewindIndex
        continue
      }
    }

    pushResult(stage, { output, retries })
    index += 1
  }

  const degradedSteps = results.filter(r => r.degraded).map(r => r.stageId)
  const completed = !requireAll || (degradedSteps.length === 0 && interrupted === undefined)
  const okCount = results.filter(r => !r.degraded).length

  let summary: string
  if (interrupted) {
    summary = `工作流 ${manifest.id}（${manifest.name}）: 已执行 ${results.length}/${manifest.stages.length} 阶段，在 "${interrupted.stageId}" 暂停等待人工确认`
  } else {
    summary = `工作流 ${manifest.id}（${manifest.name}）: ${okCount}/${results.length} 阶段完成${degradedSteps.length > 0 ? `，降级阶段: ${degradedSteps.join('、')}` : ''}`
  }

  const result: WorkflowRunResult = {
    manifestId: manifest.id,
    caseType: manifest.caseType,
    completed,
    stages: results,
    degradedSteps,
    summary,
    ...(interrupted ? { interrupted } : {}),
  }
  // 持久化失败不阻断执行结果，仅把告警带回结果供调用方展示。
  try {
    await options.persist?.saveRun(result, options.runId)
  } catch (error) {
    result.persistWarning = `持久化失败（不影响执行结果）: ${error instanceof Error ? error.message : String(error)}`
  }
  return result
}
