/**
 * 审批审计闭环（对齐 Mady domains/approval/approval.go 的 ApprovalRecord 设计）。
 *
 * 决策留痕：ApprovalRecord（谁、哪个关键词触发、AI 原文摘录、人工如何决策、
 * 何时）——只增审计日志（用于 AdoptionRate 指标与 Golden Benchmark 转换）。
 * 设计原则：审计写入不阻塞审批流程（fail-open）；store 未配置时零开销。
 */

export type ApprovalVerdict = 'adopted' | 'modified' | 'rejected'

/** 审批审计记录（谁、哪个关键词触发、AI 原文摘录、人工如何决策、何时）。 */
export type ApprovalRecord = {
  /** 挂起索引（对应 PatentOutputGate 的 pending index） */
  pendingIndex: number
  sessionId?: string
  turnId?: string
  /** 触发审批的关键词 */
  triggerKeyword: string
  /** AI 原文摘录（供审计/复核，截断至 500 字符） */
  originalOutputPreview: string
  verdict: ApprovalVerdict
  /** modified 时的替换输出 */
  modifiedOutput?: string
  /** rejected 时的人工反馈理由 */
  feedback?: string
  decidedAt: string
}

/** 审批审计存储接口：只增审计记录并可列出。 */
export type ApprovalStore = {
  /** 追加一条审计记录（只增）。可返回 Promise（异步落盘实现）。 */
  saveRecord(record: ApprovalRecord): void | Promise<void>
  /** 列出全部审计记录（按决定时间升序）。 */
  listRecords(): ApprovalRecord[]
}

/**
 * 构造审计记录（供 PatentOutputGate approve/reject 调用）。now 为可注入时钟（默认系统时钟）。
 * @param input - 审计记录字段（含可注入时钟 now，默认系统时钟）。
 * @returns 审计记录（originalOutputPreview 截断至 500 字符，decidedAt 为 ISO 时间戳）。
 */
export function createApprovalRecord(input: {
  pendingIndex: number
  sessionId?: string | undefined
  turnId?: string | undefined
  triggerKeyword: string
  originalOutputPreview: string
  verdict: ApprovalVerdict
  modifiedOutput?: string | undefined
  feedback?: string | undefined
  now?: (() => Date) | undefined
}): ApprovalRecord {
  return {
    pendingIndex: input.pendingIndex,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
    triggerKeyword: input.triggerKeyword,
    originalOutputPreview: input.originalOutputPreview.slice(0, 500),
    verdict: input.verdict,
    ...(input.modifiedOutput !== undefined ? { modifiedOutput: input.modifiedOutput } : {}),
    ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
    decidedAt: (input.now ?? (() => new Date()))().toISOString(),
  }
}
