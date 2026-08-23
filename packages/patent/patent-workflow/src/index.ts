/**
 * Service Definition for the patent execution pipeline (ctx.patentWorkflow):
 * the workflow executor, the flexible-plan layer, and the plantask HITL state
 * machine. plantask awaiting_approval resolves through ctx.get('approval')
 * (optional composition); workflow-run and plantask state are appended to the
 * calling agent's session as patent/* events when a session is available.
 * @module @deepseek-ai/dsh-patent-workflow
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  StageExecutor,
  WorkflowContext,
  WorkflowManifest,
  WorkflowRunOptions,
  WorkflowRunResult,
} from '@deepseek-ai/dsh-patent-core'
import { registerBuiltinAtoms } from '@deepseek-ai/dsh-patent-core'
import { runWorkflow as runWorkflowPipeline } from './workflow.ts'
import { PlanTaskStateMachine, syncPlanToTasks, type PlanTask, type PlanTaskState } from './plantask.ts'
import type {
  PatentAgent,
  PatentApprovalOutcome,
  PatentApprovalSeam,
  PatentWorkflowRunEvent,
  PlantaskRunOptions,
  PlantaskRunResult,
} from './types.ts'

// ---- pipeline API re-exports ----
export * from './workflow.ts'
export * from './plantask.ts'
export * from './flexible-plan.ts'
export * from './flexible-plan-store.ts'
export * from './worker-contract.ts'
export * from './role-contracts.ts'
export * from './workflow-store.ts'
export * from './workflow-dag.ts'
export * from './approval.ts'
export * from './quality-gate.ts'
export * from './output-gate.ts'
export * from './flow-graph.ts'
export type * from './types.ts'

/** A plantask parked at its awaiting_approval gate, awaiting the approve/reject decision. */
interface PendingPlantask {
  agent: PatentAgent
  caseId: string
  machine: PlanTaskStateMachine
  tasks: PlanTask[]
  toRun: string[]
}

/** Turn a closed approval outcome into the feedback that drives a replanning transition. */
function rejectionFeedback(outcome: PatentApprovalOutcome, feedback?: string): string {
  if (feedback !== undefined && feedback.trim() !== '') return feedback
  if (outcome === 'cancelled') return 'approval cancelled'
  if (outcome === 'unavailable') return 'no approval answerer available (fail closed)'
  return 'plan rejected by human approval'
}

/** Convert a workflow-run result into the durable patent/workflow-run event payload. */
function toWorkflowRunEvent(result: WorkflowRunResult, runId?: string): PatentWorkflowRunEvent {
  return { ...result, ...(runId !== undefined ? { runId } : {}) }
}

/**
 * PatentWorkflow service: the patent execution pipeline (ctx.patentWorkflow).
 * Approval is an optional seam read via ctx.get('approval'); storage-backed
 * file products are caller-provided stores (see the package README).
 */
export class PatentWorkflow extends Service {
  private readonly pending = new Map<string, PendingPlantask>()

  constructor(ctx: Context) {
    super(ctx, 'patentWorkflow')
    // 内置原子注册进全局注册表（幂等）：服务路径的 runWorkflow 与工具路径共用，
    // 不注册则 atom-bearing manifest 在 fail-fast 处抛错。
    registerBuiltinAtoms()
  }

  /**
   * Run a workflow manifest via the ported executor. When an agent is given,
   * the run result is appended to its session as a patent/workflow-run event.
   * @param manifest - the workflow to run.
   * @param wctx - the workflow context (caseId/input + stage state).
   * @param executor - fallback stage executor for stages without an atom.
   * @param options - handlers/atoms/provider/persist/approvalGrants/runId.
   * @param agent - optional agent whose session records the run.
   * @returns the run result (also persisted via options.persist when given).
   */
  async runWorkflow(
    manifest: WorkflowManifest,
    wctx: WorkflowContext,
    executor?: StageExecutor,
    options?: WorkflowRunOptions,
    agent?: PatentAgent,
  ): Promise<WorkflowRunResult> {
    const result = await runWorkflowPipeline(manifest, wctx, executor, options)
    if (agent !== undefined) {
      agent.session.append('patent/workflow-run', toWorkflowRunEvent(result, options?.runId))
    }
    return result
  }

  /**
   * Drive a plantask plan through planning → awaiting_approval → executing.
   * The awaiting_approval gate resolves through ctx.get('approval'); without an
   * approval service the plan fails closed (replanning with a feedback) rather
   * than auto-approving. Set options.autoApprove to false to leave the plan
   * pending for an out-of-band approve/reject.
   * @param agent - the agent whose session records the patent/plantask events.
   * @param caseId - case identity keying the tracked pending plantask.
   * @param planSteps - the ordered plan steps to sync into tasks.
   * @param options - autoApprove and approvalReason.
   * @returns the final plantask state plus tasks and the approval outcome.
   */
  async runPlantask(
    agent: PatentAgent,
    caseId: string,
    planSteps: string[],
    options?: PlantaskRunOptions,
  ): Promise<PlantaskRunResult> {
    const machine = new PlanTaskStateMachine()
    const { tasks, toRun } = syncPlanToTasks(planSteps)
    if (this.pending.has(caseId)) {
      throw new Error(
        `patentWorkflow: caseId "${caseId}" 已有挂起的 plantask，拒绝覆盖（先 approve/reject 或等待其完成）`,
      )
    }
    machine.transition('awaiting_approval')
    this.appendPlantask(agent, caseId, machine.state, tasks)
    this.pending.set(caseId, { agent, caseId, machine, tasks, toRun })

    if (options?.autoApprove === false) {
      return { caseId, state: machine.state, tasks, toRun }
    }

    try {
      const approval = this.ctx.get('approval') as PatentApprovalSeam | undefined
      const outcome: PatentApprovalOutcome = approval !== undefined
        ? await approval.request({ agent, toolName: 'patent_plantask', reason: options?.approvalReason })
        : 'unavailable'
      return this.applyDecision(caseId, outcome)
    } catch (error) {
      // 审批请求或决策迁移抛错时不留僵尸 pending：caseId 必须可重试，
      // 否则该 case 会被"已有挂起 plantask"永久锁死到进程重启。
      this.pending.delete(caseId)
      throw error
    }
  }

  /**
   * Decision entry: approve a pending plantask (resume to executing).
   * Single-session single-case semantics: one pending plantask per caseId;
   * concurrent runs of the same caseId are rejected by runPlantask.
   * @param caseId - the case keying the parked plantask.
   * @returns the final plantask state, tasks, and approval outcome.
   */
  approve(caseId: string): PlantaskRunResult {
    return this.applyDecision(caseId, 'allowed-once')
  }

  /**
   * Decision entry: reject a pending plantask and roll back to replanning.
   * @param caseId - the case keying the parked plantask.
   * @param feedback - optional rejection feedback driving the replanning transition.
   * @returns the final plantask state, tasks, and approval outcome.
   */
  reject(caseId: string, feedback?: string): PlantaskRunResult {
    return this.applyDecision(caseId, 'rejected', feedback)
  }

  private applyDecision(caseId: string, outcome: PatentApprovalOutcome, feedback?: string): PlantaskRunResult {
    const pending = this.pending.get(caseId)
    if (pending === undefined) {
      throw new Error(`patentWorkflow: no pending plantask for caseId "${caseId}"`)
    }
    if (outcome === 'allowed-once') {
      pending.machine.transition('executing', { tasks: pending.tasks })
    } else {
      pending.machine.transition('replanning', { feedback: rejectionFeedback(outcome, feedback) })
    }
    const state = pending.machine.state
    this.appendPlantask(pending.agent, caseId, state, pending.tasks, feedback)
    this.pending.delete(caseId)
    return {
      caseId,
      state,
      tasks: pending.tasks,
      toRun: pending.toRun,
      approvalOutcome: outcome,
      ...(feedback !== undefined ? { feedback } : {}),
    }
  }

  private appendPlantask(
    agent: PatentAgent,
    caseId: string,
    state: PlanTaskState,
    tasks: PlanTask[],
    feedback?: string,
  ): void {
    agent.session.append('patent/plantask', {
      caseId,
      state,
      tasks,
      ...(feedback !== undefined ? { feedback } : {}),
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    patentWorkflow: PatentWorkflow
  }
}

export default PatentWorkflow
