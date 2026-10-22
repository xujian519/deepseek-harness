/**
 * 一致性回退信号判定（graph adapter 的 retry 条件边与 workflow 执行器的
 * 一致性重试循环共用），以及结构化 RetrySignal 的解析与产出摘要。
 */

import { createHash } from 'node:crypto'
import type { RetrySignal } from './types.ts'

/** 单条 RevisionRecord 字段的长度上限：缺口编号、理由与证据引用。 */
const MAX_GAP_ID_LENGTH = 80
const MAX_RATIONALE_LENGTH = 240
const MAX_EVIDENCE_LENGTH = 200

/** 单次返回值最多接受的信号数：一次回退写一条记录，信号无限会让日志与回退次数失控。 */
const MAX_RETRY_SIGNALS = 32

/**
 * 解析 handler 返回的结构化回退信号。
 *
 * handler 返回值是 `PipelineState`（字符串键的任意值），信号跨进程/插件边界时
 * 无法由类型系统保证形状；无效项被丢弃，避免一次畸形返回值把整个运行拖入回退。
 * @param value - `state._revision_signals` 的原始值。
 * @returns 合法的信号列表；非数组时为空数组。
 */
export function parseRetrySignals(value: unknown): RetrySignal[] {
  if (!Array.isArray(value)) return []
  const signals: RetrySignal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const gapId = typeof record['gapId'] === 'string' ? record['gapId'].trim() : ''
    const rationale = typeof record['rationale'] === 'string' ? record['rationale'].trim() : ''
    if (gapId.length === 0 || rationale.length === 0) continue
    const evidence = typeof record['evidence'] === 'string' ? record['evidence'].trim() : ''
    signals.push({
      gapId: gapId.slice(0, MAX_GAP_ID_LENGTH),
      rationale: rationale.slice(0, MAX_RATIONALE_LENGTH),
      ...(evidence.length > 0 ? { evidence: evidence.slice(0, MAX_EVIDENCE_LENGTH) } : {}),
    })
    if (signals.length >= MAX_RETRY_SIGNALS) break
  }
  return signals
}

/**
 * 产出文本的短摘要（sha256 前 16 位十六进制），用于 RevisionRecord 的 before/after。
 * @param text - 阶段产出全文。
 * @returns 16 个字符的摘要。
 */
export function digestText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

/** 否定词窗口：命中位置前 12 字符内出现 [不未无没] 且无句界分隔 → 否定表述，不触发回退。
 * @param text - 待判定文本。
 * @param signal - 已编译的信号正则（带 g 标志）。
 * @returns 是否触发回退（命中且非否定语境）。
 */
export function signalMatches(text: string, signal: RegExp): boolean {
  let match: RegExpExecArray | null
  const RE = /[不未无没]/
  signal.lastIndex = 0 // 带 g 标志的正则跨调用保留 lastIndex：回退重入前必须重置，否则 exec 直接返回 null
  while ((match = signal.exec(text)) !== null) {
    const start = Math.max(0, match.index - 12)
    const before = text.slice(start, match.index)
    if (!before.includes('。') && !before.includes('；') && !before.includes(';') && !RE.test(before)) {
      return true
    }
    if (match[0].length === 0) signal.lastIndex += 1
  }
  return false
}

/**
 * 编译信号正则（g 标志必需：signalMatches 用 exec 遍历全部匹配位置，无 g 时 exec 每次从头匹配 → 死循环）。
 * @param pattern - 信号正则模式。
 * @returns 带 gi 标志的编译正则。
 */
export function compileSignal(pattern: string): RegExp {
  return new RegExp(pattern, 'gi')
}
