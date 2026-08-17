/**
 * src/patent/workflow — barrel。
 *
 * 类型契约与 validateWorkflowManifest 在 dsh-patent-core；本 barrel 再导出
 * 内置 manifest 数据与单阶段执行器/信号工具。执行器 runWorkflow 在
 * ../workflow.ts 门面。
 */

export type {
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
export { WorkflowError, validateWorkflowManifest } from '@deepseek-ai/dsh-patent-core'
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
} from './manifests.ts'
export { runStageOnce, type RunStageOnceOptions } from './executor.ts'
export { compileSignal, signalFor, signalMatches } from './signal.ts'
