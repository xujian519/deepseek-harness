/**
 * src/patent/workflow — 一致性回退信号判定（纯函数）。
 *
 * signalMatches/compileSignal 实现前置到 dsh-patent-core（graph adapter 与
 * workflow 执行器共用）；本模块保留 signalFor（按阶段 id 缓存编译正则）并
 * re-export 共享实现，保持本包消费面不变。
 */

import type { WorkflowStage } from '@deepseek-ai/dsh-patent-core'
import { compileSignal, signalMatches } from '@deepseek-ai/dsh-patent-core'

export { compileSignal, signalMatches }

/**
 * 带缓存的信号获取（按阶段 id 缓存，避免每次执行/回退重新编译）。
 * @param stage - 工作流阶段。
 * @param cache - 阶段 id → 编译正则的缓存。
 * @returns 编译后的信号正则；阶段未声明 retry 时为 undefined。
 */
export function signalFor(stage: WorkflowStage, cache: Map<string, RegExp>): RegExp | undefined {
  if (stage.retry === undefined) return undefined
  const cached = cache.get(stage.id)
  if (cached !== undefined) return cached
  const compiled = compileSignal(stage.retry.whenOutputMatches)
  cache.set(stage.id, compiled)
  return compiled
}
