/**
 * src/patent/workflow — 单阶段执行器（参数化）。
 *
 * 副作用时序契约（勿改）：
 * - Object.assign(state, segment) 在 handler 产出后立即合并（state 引用共享）；
 * - 主输出键 = atom.outputSchema[0]，兜底 state[stage.id]；
 * - degraded 前缀 [WORKFLOW_DEGRADED] 保留错误信息；
 * - approvedGate 经 APPROVAL_GRANTED_KEY 注入 execState（与图路径同一契约）。
 */

import {
  APPROVAL_GRANTED_KEY,
  APPROVAL_GRANTED_OUTPUT,
  isApprovalGateHandler,
  isInterruptStageError,
} from '@deepseek-ai/dsh-patent-core'
import type {
  AtomRegistry,
  PipelineState,
  StageExecutor,
  StageHandlerRegistry,
  StageProvider,
  WorkflowContext,
  WorkflowInterrupt,
  WorkflowStage,
} from '@deepseek-ai/dsh-patent-core'

/** 单阶段执行选项（handlers/atoms/provider/executor/maxRetries/approvalGrants/ctx）。 */
export type RunStageOnceOptions = {
  handlers: StageHandlerRegistry
  atoms: AtomRegistry
  provider?: StageProvider | undefined
  executor?: StageExecutor | undefined
  maxRetries: number
  approvalGrants?: string[] | undefined
  ctx: WorkflowContext
}

/**
 * 执行单个 stage（含重试循环与 degraded 输出构造），不处理信号回退。
 * 供 runWorkflow 串行路径与并行组共用；state 为调用方持有的共享对象（原地合并）。
 * @param stage - 待执行阶段。
 * @param state - 调用方持有的共享执行态（原地合并）。
 * @param options - 执行配置（handlers/atoms/provider/executor/maxRetries 等）。
 * @returns 阶段输出、重试次数与可选中断信号。
 */
export async function runStageOnce(
  stage: WorkflowStage,
  state: PipelineState,
  options: RunStageOnceOptions,
): Promise<{ output: string; retries: number; interrupted?: WorkflowInterrupt }> {
  const handler = stage.atom !== undefined ? options.handlers.lookup(stage.atom) : undefined
  let output = ''
  let retries = 0
  let lastError: unknown

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    try {
      if (handler) {
        // 已人工批准的审批门：把放行标记注入 handler 执行态，由 ApprovalGateHandler
        // 统一判定放行（与图路径同一契约）；此处不跳过执行。
        const approvedGate = isApprovalGateHandler(handler) && options.approvalGrants?.includes(stage.id)
        // 阶段静态参数合并进执行态（不污染共享 state，仅本次 handler 可见）。
        const execState = stage.params !== undefined ? { ...state, ...stage.params } : state
        if (approvedGate) {
          execState[APPROVAL_GRANTED_KEY] = true
        }
        const segment = await handler.execute({
          state: execState,
          ...(options.provider !== undefined ? { provider: options.provider } : {}),
        })
        Object.assign(state, segment)
        // 主输出键 = atom.outputSchema[0]（对齐 Mady 约定，文本/JSON 均可）；兜底按 stage.id 引用。
        const mainKey = stage.atom !== undefined ? options.atoms.lookup(stage.atom)?.outputSchema?.[0] : undefined
        const raw = mainKey !== undefined ? segment[mainKey] : undefined
        output = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw, null, 2)
        if (output.trim().length === 0) output = String(state[stage.id] ?? '')
        // 已批准审批门放行后无实质输出：占位避免被标记 degraded（语义 = 已人工批准）。
        if (approvedGate && output.trim().length === 0) {
          output = APPROVAL_GRANTED_OUTPUT
        }
        state[stage.id] = output
      } else if (options.executor) {
        output = (await options.executor(stage, options.ctx)) ?? ''
      }
      if (output.trim().length > 0) break
      lastError = new Error('阶段执行未产生输出')
    } catch (err) {
      if (isInterruptStageError(err)) {
        return { output: '', retries, interrupted: { stageId: stage.id, message: err.message, data: err.data } }
      }
      // 配置类错误（fail-loud LLM stub 的 setup_required）向上传播，不重试不降级。
      if (err instanceof Error && (err as { code?: unknown }).code === 'setup_required') throw err
      lastError = err
      retries += 1
      if (attempt >= options.maxRetries) {
        output = ''
        break
      }
    }
    retries = attempt + 1
  }

  if (
    output.trim().length === 0 &&
    lastError !== undefined &&
    !(lastError instanceof Error && lastError.message === '阶段执行未产生输出')
  ) {
    // 保留错误信息到输出，便于诊断；仍标记 degraded。
    output = `[WORKFLOW_DEGRADED] ${stage.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  }
  return { output, retries }
}
