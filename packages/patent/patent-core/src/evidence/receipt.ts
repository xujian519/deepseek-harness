/**
 * 工具调用账本（移植自 Mady agentcore/evidence/receipt.go + ledger 设计）。
 *
 * 每次工具执行产生一张 Receipt（谁、何时、用什么工具、成败、读写分类），
 * 由 Ledger 按 turn 累积。Receipt 是 EvidenceSpan 的溯源底座 —— 证据的
 * receiptId 指向账本记录，实现"结论 → 证据 → 工具调用 → 参数/路径"全链路可审计。
 *
 * receiptFromToolExecution 通用适配器定义在 tool 层（src/tool/protocol/evidence.ts），
 * 此处 re-export 供领域层复用。
 */

import { createHash } from 'node:crypto'
import type { SatiEvidenceReceipt } from './protocol.ts'

/** 工具调用收据（= SatiEvidenceReceipt）。 */
export type Receipt = SatiEvidenceReceipt

export { receiptFromToolExecution } from './protocol.ts'

/** 新内容哈希的算法前缀；账本与收据据此区分 SHA-256 与旧版弱哈希。 */
export const CONTENT_HASH_PREFIX = 'sha256:'

/**
 * 内容哈希（SHA-256，`sha256:<小写十六进制>`）——用于证据原文完整性校验。
 * @param text - 待哈希的原文（按 UTF-8 编码）。
 * @returns 带算法前缀的 SHA-256 内容哈希。
 */
export function contentHash(text: string): string {
  return `${CONTENT_HASH_PREFIX}${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/**
 * Ledger：turn 级工具账本。每 turn 开始 reset（对齐 Mady BeforeTurn 语义），
 * 支持按工具名检索 —— 证据/审计消费方据此还原"本轮做过什么"。
 */
export class Ledger {
  private receipts: Receipt[] = []

  /** 清空账本（每 turn 开始调用，对齐 Mady BeforeTurn 语义）。 */
  reset(): void {
    this.receipts = []
  }

  /**
   * 记录一条工具调用收据。
   * @param receipt - 工具调用收据。
   */
  record(receipt: Receipt): void {
    this.receipts.push(receipt)
  }

  /**
   * 列出全部收据。
   * @returns 收据数组副本。
   */
  list(): Receipt[] {
    return [...this.receipts]
  }

  /**
   * 按工具名检索收据。
   * @param toolName - 工具名。
   * @returns 该工具的收据数组。
   */
  byTool(toolName: string): Receipt[] {
    return this.receipts.filter(r => r.toolName === toolName)
  }

  /**
   * 收据条数。
   * @returns 已记录收据数量。
   */
  size(): number {
    return this.receipts.length
  }
}
