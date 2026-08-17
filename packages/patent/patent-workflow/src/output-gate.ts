import type { RuleViolation } from '@deepseek-ai/dsh-patent-core'
import type { GateContentBlock, GateMessage, RuleOutputGate } from './types.ts'
import { processPatentOutput, type QualityGateResult } from './quality-gate.ts'
import { createApprovalRecord, type ApprovalStore } from './approval.ts'

/**
 * PatentOutputGate — 把质量门禁接入 Agent 输出流。
 *
 * - 风险词命中 → 输出追加免责声明（照常入库）
 * - 审批词命中且配置了 onPending → 消息挂起等待人工审批，但仍照常入库
 * - 未配置 onPending 时审批词命中仅注入提示、不挂起（跑批安全，不丢消息）
 * - 非 assistant 文本消息 / 含 tool_call 的消息直接放行
 *
 * 规则驱动门禁（可选）：关键词门禁之后串接。ruleGate 由 P4.1 的 dsh-patent-rule
 * 引擎运行时注入（本包无编译期依赖）；未注入时仅关键词门禁。
 */

export type PendingPatentMessage = {
  index: number
  /** 原始消息（审批 UI 展示用） */
  message: GateMessage
  /** 处理后的消息（含免责声明/存疑提示；已入库的版本） */
  processed: GateMessage
  /** 门禁判定结果 */
  info: QualityGateResult
  /** 规则门禁违规清单（配置 ruleGate 时才有） */
  ruleViolations?: RuleViolation[] | undefined
  sessionId?: string | undefined
  turnId?: string | undefined
  createdAt: number
}

/** 输出门禁选项（风险词/审批词/绝对化表述、免责声明、引用核验、规则门禁、挂起容量与 TTL、回调、审计存储、时钟）。 */
export type PatentOutputGateOptions = {
  riskKeywords?: string[]
  approvalKeywords?: string[]
  absolutePhrases?: string[]
  disclaimer?: string
  enableCitationGate?: boolean
  /**
   * 规则驱动门禁（可选）：关键词门禁之后串接。block/review 命中同样挂起审批，
   * warn 命中追加合规提示。未配置时行为与历史一致（仅关键词门禁）。
   */
  ruleGate?: RuleOutputGate
  /** 挂起队列容量上限（默认 100）：超出时放弃挂起、直接入库（不丢消息）。 */
  maxPending?: number
  /** 挂起消息 TTL 毫秒（默认 0 = 不过期）。 */
  pendingTtlMs?: number
  /** 挂起回调：审批词命中且需人工审批时触发。 */
  onPending?: (pending: PendingPatentMessage) => void | Promise<void>
  /** 审批通过且写库成功后的回调。 */
  onApproved?: (pending: PendingPatentMessage) => void | Promise<void>
  /** 审批拒绝回调。 */
  onRejected?: (pending: PendingPatentMessage) => void | Promise<void>
  /** 审批审计存储（可选）。 */
  approvalStore?: ApprovalStore
  /** 可注入时钟（毫秒时间戳；默认 Date.now）。 */
  now?: () => number
}

/** 单条消息门禁处理结果（写库消息、是否需审批、挂起索引、门禁判定）。 */
export type ProcessedMessageResult = {
  /** 写库用的消息（可能已追加免责声明/存疑提示） */
  message: GateMessage
  /** 是否需人工审批 */
  needsApproval: boolean
  /** 挂起索引（needsApproval=true 时有效） */
  pendingIndex?: number
  /** 门禁判定结果 */
  info: QualityGateResult
}

/** 把质量门禁接入 Agent 输出流：风险词追加免责声明、审批词挂起等待人工审批、规则门禁串接。 */
export class PatentOutputGate {
  private readonly pending = new Map<number, PendingPatentMessage>()
  private readonly unflushed = new Set<number>()
  private nextIndex = 0
  private readonly options: PatentOutputGateOptions

  constructor(options?: PatentOutputGateOptions) {
    this.options = options ?? {}
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  /**
   * 处理单条消息：非 assistant 或含 tool_call 的消息直接放行，否则跑关键词门禁与规则门禁。
   * @param message - 待处理消息。
   * @param context - 可选上下文（会话/轮次/是否跳过审批挂起）。
   * @returns 处理结果（写库消息 + 是否需审批 + 门禁判定）。
   */
  processMessage(
    message: GateMessage,
    context?: { sessionId?: string; turnId?: string; skipApproval?: boolean },
  ): ProcessedMessageResult {
    if (!this.shouldProcess(message)) {
      return { message, needsApproval: false, info: emptyGateInfo() }
    }

    this.pruneExpired()

    const text = extractMessageText(message)
    const info = processPatentOutput(text, {
      riskKeywords: this.options.riskKeywords,
      approvalKeywords: this.options.approvalKeywords,
      absolutePhrases: this.options.absolutePhrases,
      disclaimer: this.options.disclaimer,
      enableCitationGate: this.options.enableCitationGate,
    })

    const ruleResult = this.options.ruleGate?.process(info.text)
    const finalText = ruleResult?.text ?? info.text
    const mergedInfo: QualityGateResult = ruleResult === undefined ? info : { ...info, text: finalText }

    const processed = finalText === text ? message : replaceLastTextBlock(message, finalText)

    const needsApproval = mergedInfo.needsApproval || (ruleResult?.needsApproval ?? false)
    if (needsApproval && this.options.onPending && context?.skipApproval !== true) {
      const maxPending = this.options.maxPending ?? 100
      if (this.pending.size >= maxPending) {
        console.warn(`[PatentOutputGate] 挂起队列已满（${maxPending}），审批词消息直接入库`)
        return { message: processed, needsApproval: false, info: mergedInfo }
      }
      const index = this.nextIndex
      this.nextIndex += 1
      const pending: PendingPatentMessage = {
        index,
        message,
        processed,
        info: mergedInfo,
        ruleViolations: ruleResult?.violations,
        sessionId: context?.sessionId,
        turnId: context?.turnId,
        createdAt: this.now(),
      }
      this.pending.set(index, pending)
      this.unflushed.add(index)
      return { message: processed, needsApproval: true, pendingIndex: index, info: mergedInfo }
    }

    return { message: processed, needsApproval: false, info: mergedInfo }
  }

  /**
   * 转录写入成功后调用：触发 onPending。
   * @param index - 挂起消息索引。
   */
  flushPending(index: number): void {
    if (!this.unflushed.delete(index)) return
    const pending = this.pending.get(index)
    if (pending) this.safeInvoke(this.options.onPending, pending)
  }

  /**
   * 转录写入失败时调用：撤销挂起条目。
   * @param index - 挂起消息索引。
   */
  cancelPending(index: number): void {
    if (!this.unflushed.delete(index)) return
    this.pending.delete(index)
  }

  /**
   * 审批通过：取出并移除挂起消息（触发 onApproved 由 notifyCommitted 完成）。
   * @param index - 挂起消息索引。
   * @param sessionId - 可选会话标识（与挂起消息的 sessionId 不一致时拒绝）。
   * @returns 已通过的挂起消息；不存在、会话不匹配或已过期时为 undefined。
   */
  approve(index: number, sessionId?: string): PendingPatentMessage | undefined {
    const pending = this.takePending(index, sessionId)
    if (!pending) return undefined
    this.recordApproval(pending, { verdict: 'adopted' })
    return pending
  }

  /**
   * 审批通过且写库成功：触发 onApproved。
   * @param pending - 已通过且已入库的挂起消息。
   */
  notifyCommitted(pending: PendingPatentMessage): void {
    this.safeInvoke(this.options.onApproved, pending)
  }

  /**
   * 审批拒绝：丢弃挂起消息。
   * @param index - 挂起消息索引。
   * @param sessionId - 可选会话标识（与挂起消息的 sessionId 不一致时拒绝）。
   * @param feedback - 可选人工反馈理由。
   * @returns 是否成功拒绝（不存在、会话不匹配或已过期时为 false）。
   */
  reject(index: number, sessionId?: string, feedback?: string): boolean {
    const pending = this.takePending(index, sessionId)
    if (!pending) return false
    this.recordApproval(pending, { verdict: 'rejected', feedback })
    this.safeInvoke(this.options.onRejected, pending)
    return true
  }

  /**
   * 取出并移除指定挂起消息：不存在、会话不匹配或已过期时返回 undefined（过期顺带清理并告警）。
   * @param index - 挂起消息索引。
   * @param sessionId - 可选会话标识（与挂起消息的 sessionId 不一致时返回 undefined）。
   * @returns 已取出的挂起消息；不存在、会话不匹配或已过期时为 undefined。
   */
  private takePending(index: number, sessionId?: string): PendingPatentMessage | undefined {
    const pending = this.pending.get(index)
    if (!pending) return undefined
    if (pending.sessionId !== undefined && sessionId !== pending.sessionId) {
      return undefined
    }
    if (this.isExpired(pending)) {
      this.pending.delete(index)
      this.unflushed.delete(index)
      console.warn(`[PatentOutputGate] 挂起消息 ${index} 超过 TTL 未审批，拒绝审批`)
      return undefined
    }
    this.pending.delete(index)
    this.unflushed.delete(index)
    return pending
  }

  /** 审计留痕（approve/reject 时调用；store 未配置时零开销）。 */
  private recordApproval(
    pending: PendingPatentMessage,
    decision: { verdict: 'adopted' | 'modified' | 'rejected'; modifiedOutput?: string | undefined; feedback?: string | undefined },
  ): void {
    const store = this.options.approvalStore
    if (!store) return
    const record = createApprovalRecord({
      pendingIndex: pending.index,
      sessionId: pending.sessionId,
      turnId: pending.turnId,
      triggerKeyword: pending.info.approvalKeywordsHit[0] ?? pending.ruleViolations?.[0]?.ruleId ?? 'unknown',
      originalOutputPreview: extractMessageText(pending.message),
      verdict: decision.verdict,
      ...(decision.modifiedOutput !== undefined ? { modifiedOutput: decision.modifiedOutput } : {}),
      ...(decision.feedback !== undefined ? { feedback: decision.feedback } : {}),
      now: this.options.now !== undefined ? () => new Date(this.now()) : undefined,
    })
    this.reportRejection(store.saveRecord(record), '审批审计写入失败')
  }

  /**
   * 宿主会话恢复钩子：重新注册挂起条目。
   * @param pending - 待恢复的挂起消息。
   */
  restore(pending: PendingPatentMessage): void {
    if (!this.pending.has(pending.index)) {
      this.pending.set(pending.index, pending)
      this.unflushed.add(pending.index)
    }
  }

  /**
   * 返回当前挂起消息数量。
   * @returns 挂起消息数量。
   */
  pendingCount(): number {
    return this.pending.size
  }

  /**
   * 返回全部挂起消息。
   * @returns 挂起消息列表。
   */
  pendingItems(): PendingPatentMessage[] {
    return [...this.pending.values()]
  }

  private pruneExpired(): void {
    const ttl = this.options.pendingTtlMs ?? 0
    if (ttl <= 0) return
    for (const [index, pending] of this.pending) {
      if (this.isExpired(pending)) {
        this.pending.delete(index)
        this.unflushed.delete(index)
        console.warn(`[PatentOutputGate] 挂起消息 ${index} 超过 TTL（${ttl}ms）未审批，已清理`)
      }
    }
  }

  private isExpired(pending: PendingPatentMessage): boolean {
    const ttl = this.options.pendingTtlMs ?? 0
    if (ttl <= 0) return false
    return this.now() - pending.createdAt > ttl
  }

  private shouldProcess(message: GateMessage): boolean {
    if (message.role !== 'assistant') return false
    if (message.content.some(block => block.type === 'tool_call' || block.type === 'tool_result')) {
      return false
    }
    return extractMessageText(message).trim().length > 0
  }

  private safeInvoke(
    callback: ((pending: PendingPatentMessage) => void | Promise<void>) | undefined,
    pending: PendingPatentMessage,
  ): void {
    if (!callback) return
    try {
      this.reportRejection(callback(pending), 'callback failed')
    } catch (err) {
      console.error('[PatentOutputGate] callback failed:', err)
    }
  }

  /**
   * 结果可能为 Promise 时挂接 catch，记录拒绝错误（label 拼接到 "[PatentOutputGate] " 之后）。
   * @param result - 可能为 Promise 的调用结果。
   * @param label - 错误日志前缀。
   */
  private reportRejection(result: void | Promise<void>, label: string): void {
    if (result !== undefined) {
      result.catch((err: unknown) => {
        console.error(`[PatentOutputGate] ${label}:`, err)
      })
    }
  }
}

/**
 * 提取消息的纯文本（text 块拼接，跳过 thinking/图片等）。
 * @param message - 门禁消息。
 * @returns text 块拼接的纯文本。
 */
export function extractMessageText(message: GateMessage): string {
  return message.content
    .filter((block): block is Extract<GateContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** 把完整文本写入消息：第一个 text 块承载 fullText，其余 text 块丢弃。 */
function replaceLastTextBlock(message: GateMessage, fullText: string): GateMessage {
  const content: GateContentBlock[] = []
  let inserted = false
  for (const block of message.content) {
    if (block.type === 'text') {
      if (!inserted) {
        content.push({ type: 'text', text: fullText })
        inserted = true
      }
    } else {
      content.push(block)
    }
  }
  if (!inserted) {
    content.push({ type: 'text', text: fullText })
  }
  return { ...message, content }
}

function emptyGateInfo(): QualityGateResult {
  return {
    text: '',
    riskKeywordsHit: [],
    approvalKeywordsHit: [],
    absolutePhrasesHit: [],
    needsApproval: false,
    disclaimerInjected: false,
    citationReport: { total: 0, valid: 0, unknown: 0, unverifiable: 0, suspect: 0, invalid: 0, flagged: [] },
  }
}
