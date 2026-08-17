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

/**
 * 类型安全读取：键不存在或非字符串时返回缺省值。
 * @param state - 状态容器。
 * @param key - 要读取的键。
 * @param fallback - 键不存在或非字符串时的缺省值。
 * @returns 字符串值或缺省值。
 */
export function getStateString(state: PipelineState, key: string, fallback = ''): string {
  const v = state[key]
  return typeof v === 'string' ? v : fallback
}

/**
 * 类型安全读取数组：非数组时返回空数组。
 * @param state - 状态容器。
 * @param key - 要读取的键。
 * @returns 数组值，非数组时为空数组。
 */
export function getStateArray(state: PipelineState, key: string): unknown[] {
  const v = state[key]
  return Array.isArray(v) ? v : []
}

/** 阶段执行输入：当前状态与可选的能力提供者。 */
export type StageExecuteInput = {
  state: PipelineState
  provider?: StageProvider
}

/** 阶段执行器契约：声明 name/category 元数据并实现 execute。 */
export interface StageHandler {
  /** 与 Atom.name 一致 */
  name: string
  category: AtomCategory
  execute(input: StageExecuteInput): Promise<PipelineState>
}

/** 普通阶段错误：workflow 捕获后标记 degraded（可选步骤失败不影响整体）。 */
export class StageError extends Error {
  /** 发生错误的阶段 id。 */
  readonly stageId: string
  /** 对应 Atom 名称。 */
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
  /** 中断发生的阶段 id。 */
  readonly stageId: string
  override readonly message: string
  /** 随中断携带的数据（如审批上下文）。 */
  readonly data: Record<string, unknown>

  constructor(stageId: string, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.name = 'InterruptStageError'
    this.stageId = stageId
    this.message = message
    this.data = data
  }
}

/**
 * 类型守卫：判断错误是否为中断错误。
 * @param err - 待判断的错误。
 * @returns 是否属于 InterruptStageError。
 */
export function isInterruptStageError(err: unknown): err is InterruptStageError {
  return err instanceof InterruptStageError
}

/** StageHandler 注册表：按 name 登记、查询执行器。 */
export class StageHandlerRegistry {
  private readonly handlers = new Map<string, StageHandler>()

  /**
   * 同名注册覆盖先前定义（对齐 Mady 覆盖语义，便于测试与扩展）。
   * @param handler - 待注册的 StageHandler。
   */
  register(handler: StageHandler): void {
    if (!handler.name.trim()) throw new StageHandlerRegistryError('StageHandler 缺少 name')
    this.handlers.set(handler.name, handler)
  }

  /**
   * 按 name 查询已注册的 StageHandler。
   * @param name - 执行器名称。
   * @returns 匹配的 StageHandler，未注册时返回 undefined。
   */
  lookup(name: string): StageHandler | undefined {
    return this.handlers.get(name)
  }

  /**
   * 列出全部已注册的 StageHandler。
   * @returns 已注册执行器数组。
   */
  list(): StageHandler[] {
    return [...this.handlers.values()]
  }
}

/** StageHandler 注册表错误：用于注册校验失败（如缺少 name）。 */
export class StageHandlerRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StageHandlerRegistryError'
  }
}

/** 全局注册表（内置 handler 经 registerBuiltinAtoms 注册于此）。 */
export const globalStageHandlerRegistry = new StageHandlerRegistry()

/**
 * 按 name 查询全局注册表中的 StageHandler。
 * @param name - 执行器名称。
 * @returns 匹配的 StageHandler，未注册时返回 undefined。
 */
export function LookupStageHandler(name: string): StageHandler | undefined {
  return globalStageHandlerRegistry.lookup(name)
}
