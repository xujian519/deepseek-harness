/**
 * StageHandler 运行时层（移植自 Mady agentcore/pipeline_handler.go 设计）。
 *
 * StageHandler 负责具体执行：读取 PipelineState，调用外部能力（LLM/检索器，
 * 经 StageProvider 注入），返回新的状态片段供后续阶段使用。
 *
 * 错误模型（对齐 Mady）：
 * - StageError：普通阶段错误（workflow 捕获后标记 degraded，不中断整个流程）
 * - InterruptStageError：需要人工介入的中断（如审批门），上层捕获后暂停等待恢复
 */

import type { AtomCategory } from './atom.ts'
import type { StageProvider } from '../types.ts'

/** 键值状态容器（字符串键 → 任意值），阶段间数据流管道。 */
export type PipelineState = Record<string, unknown>

/** 类型安全读取：键不存在或非字符串时返回缺省值。 */
export function getStateString(state: PipelineState, key: string, fallback = ''): string {
  const v = state[key]
  return typeof v === 'string' ? v : fallback
}

/** 类型安全写入。 */
export function setStateString(state: PipelineState, key: string, value: string): void {
  state[key] = value
}

/** 类型安全读取数组：非数组时返回空数组。 */
export function getStateArray(state: PipelineState, key: string): unknown[] {
  const v = state[key]
  return Array.isArray(v) ? v : []
}

export type StageExecuteInput = {
  state: PipelineState
  provider?: StageProvider
}

export interface StageHandler {
  /** 与 Atom.name 一致 */
  name: string
  category: AtomCategory
  execute(input: StageExecuteInput): Promise<PipelineState>
}

/** 普通阶段错误：workflow 捕获后标记 degraded（可选步骤失败不影响整体）。 */
export class StageError extends Error {
  readonly stageId: string
  readonly atom: string
  override readonly cause?: unknown

  constructor(stageId: string, atom: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'StageError'
    this.stageId = stageId
    this.atom = atom
    this.cause = cause
  }
}

/** 中断错误（如审批门）：上层捕获后暂停执行，等待人工恢复。 */
export class InterruptStageError extends Error {
  readonly stageId: string
  override readonly message: string
  readonly data: Record<string, unknown>

  constructor(stageId: string, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'InterruptStageError'
    this.stageId = stageId
    this.message = message
    this.data = data
  }
}

export function isInterruptStageError(err: unknown): err is InterruptStageError {
  return err instanceof InterruptStageError
}

export class StageHandlerRegistry {
  private readonly handlers = new Map<string, StageHandler>()

  /** 同名注册覆盖先前定义（对齐 Mady 覆盖语义，便于测试与扩展）。 */
  register(handler: StageHandler): void {
    if (!handler.name.trim()) throw new StageHandlerRegistryError('StageHandler 缺少 name')
    this.handlers.set(handler.name, handler)
  }

  lookup(name: string): StageHandler | undefined {
    return this.handlers.get(name)
  }

  list(): StageHandler[] {
    return [...this.handlers.values()]
  }
}

export class StageHandlerRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageHandlerRegistryError'
  }
}

/** 全局注册表（内置 handler 经 registerBuiltinAtoms 注册于此）。 */
export const globalStageHandlerRegistry = new StageHandlerRegistry()

export function RegisterStageHandler(handler: StageHandler): void {
  globalStageHandlerRegistry.register(handler)
}

export function LookupStageHandler(name: string): StageHandler | undefined {
  return globalStageHandlerRegistry.lookup(name)
}
