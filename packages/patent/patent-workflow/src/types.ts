/**
 * Type declarations for the patent workflow package: the durable patent/*
 * session events, the minimal agent/approval seams the plantask runner
 * consumes, the rule-output-gate seam the output gate consumes pre-P4.1, and
 * the message vocabulary the output gate inspects.
 * @module @deepseek-ai/dsh-patent-workflow/types
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type { PatentModelUsage, WorkflowRunResult } from '@deepseek-ai/dsh-patent-core'
import type { PlanTask, PlanTaskState } from './plantask.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A plantask plan entered a new state. The full task list travels with
     * every append, so the plan's machine state (pending/in_progress/completed
     * per task, plus the current PlanTaskState) is reconstructable from the
     * log alone; replaying the log IS the plan state. Log-only — never derived
     * model history.
     * @param event - the plantask state snapshot appended to the session log.
     */
    'patent/plantask': PatentPlantaskEvent
    /**
     * A workflow run finished (completed, degraded, or interrupted). Carries
     * the per-stage results and summary the run reports to the model, so a
     * model-visible run is reconstructable from the log. Log-only.
     * @param event - the workflow run result appended to the session log.
     */
    'patent/workflow-run': PatentWorkflowRunEvent
    /**
     * One model call the patent pipeline made through the harness LLM seam
     * outside the agent loop (stage closure text, claim-chart element mapping,
     * figure analysis). The loop's own calls are `request/*` + `assistant/*`
     * events; a call issued inside a tool has no such event, so without this
     * record the request is invisible to the log and the keyless replay cannot
     * rebuild the call order. Log-only; the request side stays reconstructable
     * from the tool-call arguments plus the manifest and stage state.
     * @param event - the completed model call appended to the session log.
     */
    'patent/model-call': PatentModelCallEvent
  }
}

/**
 * Durable record of one completed patent model call. A call whose stream fails
 * before completing appends nothing: it produced no visible model output, and
 * its degraded stage is recorded by the run result.
 */
export interface PatentModelCallEvent {
  /** Which patent surface issued the call (e.g. `patent_workflow_run`). */
  callSite: string
  /** Manifest the call ran under, when a workflow run issued it. */
  manifestId?: string
  /** Provider route the call was sent on; absent when the port declares no route. */
  provider?: string
  /** Model the call was sent to; absent when the port declares no route. */
  model?: string
  /** Complete visible output text. */
  output: string
  /** Provider-reported token usage, when the port surfaced any. */
  usage?: PatentModelUsage
  /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
  llmStreamCall: true
}

/** Static labels one tool call attaches to every model call it issues. */
export interface PatentModelCallContext {
  /** Patent surface name recorded on each call (`patent_workflow_run`, `claim_chart_build`, …). */
  callSite: string
  /** Manifest id recorded on each call, when the surface runs a workflow. */
  manifestId?: string
}

/**
 * Durable plantask state snapshot appended to the session log. state is the
 * PlanTaskState machine position; tasks is the full ordered task list whose
 * per-task status reconstructs execution progress.
 */
export interface PatentPlantaskEvent {
  caseId: string
  state: PlanTaskState
  tasks?: PlanTask[]
  /** Rejection feedback driving a replanning transition. */
  feedback?: string
}

/** Durable workflow-run result appended to the session log (runId distinguishes repeated runs). */
export interface PatentWorkflowRunEvent extends WorkflowRunResult {
  runId?: string
}

/** Minimal agent face the plantask runner needs: the session owning the durable log. */
export interface PatentAgent {
  session: Session
}

/** The closed approval-outcome vocabulary (mirrors dsh-user-approval). */
export type PatentApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** The approval request the plantask runner issues for its awaiting_approval gate. */
export interface PatentApprovalRequest {
  agent: PatentAgent
  toolName: string
  reason?: string | undefined
  signal?: AbortSignal
}

/**
 * The approval seam the plantask runner consumes. dsh-user-approval's
 * ApprovalService.request satisfies it; the package holds no compile-time
 * dependency on dsh-user-approval, so approval stays an optional
 * ctx.get('approval') composition.
 */
export interface PatentApprovalSeam {
  request(req: PatentApprovalRequest): Promise<PatentApprovalOutcome>
}

/** Options for one plantask run through its HITL gate. */
export interface PlantaskRunOptions {
  /** When false, leave the plan pending for an out-of-band approve/reject. Default true. */
  autoApprove?: boolean
  /** Human-readable reason given to the approval answerer. */
  approvalReason?: string
}

/** Result of driving a plantask plan through its HITL gate. */
export interface PlantaskRunResult {
  caseId: string
  state: PlanTaskState
  tasks: PlanTask[]
  toRun: string[]
  approvalOutcome?: PatentApprovalOutcome
  feedback?: string
}

/**
 * The rule-engine output-gate seam. Its single home is the protocol tier in
 * dsh-patent-core; this package re-exports it so workflow consumers keep a
 * stable import. The dsh-patent-rule RuleOutputGate (P4.1) implements it; the
 * workflow package holds no compile-time dependency on dsh-patent-rule, so the
 * engine is injected at runtime.
 */
export type { RuleOutputGate, RuleOutputGateResult } from '@deepseek-ai/dsh-patent-core'

/** A text content block the output gate reads and rewrites. */
export interface GateTextBlock {
  type: 'text'
  text: string
}

/** A non-text content block the output gate passes through untouched. */
export interface GateNonTextBlock {
  type: 'thinking' | 'image' | 'tool_call' | 'tool_result'
}

/** One message content block as the output gate sees it. */
export type GateContentBlock = GateTextBlock | GateNonTextBlock

/** One message the output gate inspects (assistant text messages are the gate's subject). */
export interface GateMessage {
  role: string
  content: GateContentBlock[]
}
