/**
 * src/patent/graph — 图状态工具：深拷贝快照 + 类型安全读写。
 *
 * 深拷贝用 structuredClone（Node >= 17 全局可用；本项目 Node >= 22.13），
 * 保留 int64/Date 等类型（不做 JSON 往返），对齐 Mady PregelState.Clone 的
 * "保留类型"设计意图。
 */

import type { GraphState } from './types.ts'

/** 深拷贝图状态（BSP 快照）。structuredClone 失败时降级 JSON 往返。
 * @param state - 要拷贝的图状态。
 * @returns 深拷贝后的图状态。
 */
export function cloneState(state: GraphState): GraphState {
  try {
    return structuredClone(state)
  } catch {
    // 兜底：含不可克隆值（函数/类实例）时 JSON 往返（仅拷贝可序列化键）。
    return JSON.parse(JSON.stringify(state)) as GraphState
  }
}

export { getStateString, getStateArray } from '../atoms/handler.ts'
