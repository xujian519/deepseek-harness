import { describe, expect, it, vi } from 'vitest'
import {
  PatentOutputGate,
  processPatentOutput,
  type RuleOutputGate,
  type GateMessage,
  type PendingPatentMessage,
} from '@deepseek-ai/dsh-patent-workflow'

function assistant(text: string): GateMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

describe('processPatentOutput (quality gate)', () => {
  it('injects the disclaimer on a risk keyword and flags approval keywords', () => {
    const info = processPatentOutput('本方案存在侵权风险，最终建议规避。')
    expect(info.riskKeywordsHit).toContain('侵权')
    expect(info.disclaimerInjected).toBe(true)
    expect(info.needsApproval).toBe(true)
    expect(info.text).toContain('不构成正式法律意见')
  })

  it('does not flag a negated risk keyword (不构成侵权)', () => {
    const info = processPatentOutput('本方案不构成侵权。')
    expect(info.riskKeywordsHit).toEqual([])
    expect(info.disclaimerInjected).toBe(false)
  })
})

describe('PatentOutputGate (rule-gate seam)', () => {
  it('runs keyword gating without an injected rule engine', () => {
    const gate = new PatentOutputGate()
    const result = gate.processMessage(assistant('结论：专利结论为具备新颖性。'))
    expect(result.info.approvalKeywordsHit).toContain('专利结论')
    // no onPending configured → the approval keyword injects a hint but does not hang.
    expect(result.needsApproval).toBe(false)
  })

  it('chains an injected rule engine after keyword gating and surfaces its violations', () => {
    const ruleGate: RuleOutputGate = {
      process(text) {
        return {
          text: text + '\n\n---\n⚠️ 合规提示：\n- [CON-1] 示例规则：命中',
          violations: [
            {
              ruleId: 'CON-1',
              ruleName: '示例规则',
              severity: 'major',
              action: 'warn',
              message: '命中',
              evidence: ['示例'],
            },
          ],
          needsApproval: false,
          warnHits: ['CON-1'],
          reviewHits: [],
          blockHits: [],
          evaluation: {
            violations: [
              {
                ruleId: 'CON-1',
                ruleName: '示例规则',
                severity: 'major',
                action: 'warn',
                message: '命中',
                evidence: ['示例'],
              },
            ],
          },
        }
      },
    }
    const pending: string[] = []
    const gate = new PatentOutputGate({ ruleGate, onPending: (p) => { pending.push(p.message.content[0]?.type === 'text' ? p.message.content[0].text : '') } })

    const result = gate.processMessage(assistant('本方案存在侵权风险，最终建议规避。'))
    expect(result.info.riskKeywordsHit).toContain('侵权')
    expect(result.message.content[0]).toMatchObject({ type: 'text' })
    // keyword approval hit + onPending → a pending entry carrying the rule violations.
    expect(result.needsApproval).toBe(true)
    gate.flushPending(result.pendingIndex!)
    expect(pending).toHaveLength(1)
  })

  it('approve/reject remove the pending entry and write audit records', () => {
    const records: Array<{ verdict: string }> = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      approvalStore: {
        saveRecord(record) { records.push({ verdict: record.verdict }) },
        listRecords() { return [] },
      },
    })
    const result = gate.processMessage(assistant('最终建议：驳回。'), { sessionId: 's1' })
    expect(result.needsApproval).toBe(true)
    expect(result.pendingIndex).toBeDefined()

    gate.flushPending(result.pendingIndex!)
    const approved = gate.approve(result.pendingIndex!, 's1')
    expect(approved).toBeDefined()
    expect(gate.pendingCount()).toBe(0)
    expect(records.map(r => r.verdict)).toEqual(['adopted'])
  })
})

describe('PatentOutputGate (pass-through and pending lifecycle)', () => {
  it('passes through non-assistant, tool_call, and empty messages without gating', () => {
    const gate = new PatentOutputGate()
    const user = gate.processMessage({ role: 'user', content: [{ type: 'text', text: '最终建议：驳回' }] })
    expect(user.needsApproval).toBe(false)
    expect(user.message.content[0]).toMatchObject({ type: 'text' })

    const toolCall = gate.processMessage({ role: 'assistant', content: [{ type: 'tool_call' }] })
    expect(toolCall.needsApproval).toBe(false)
    expect(toolCall.info.citationReport.total).toBe(0)

    const empty = gate.processMessage(assistant('   '))
    expect(empty.needsApproval).toBe(false)
  })

  it('drains an approval message when the pending queue is full (warn + direct pass)', () => {
    const warns: string[] = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      maxPending: 1,
      logger: { warn: m => warns.push(m), error: () => {} },
    })
    const first = gate.processMessage(assistant('最终建议：第一份'))
    expect(first.needsApproval).toBe(true)
    const second = gate.processMessage(assistant('最终建议：第二份'))
    expect(second.needsApproval).toBe(false)
    expect(warns.some(w => w.includes('挂起队列已满'))).toBe(true)
  })

  it('falls back to the default console logger when none is injected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const gate = new PatentOutputGate({ onPending: () => {}, maxPending: 0 })
      const result = gate.processMessage(assistant('最终建议：默认控制台'))
      expect(result.needsApproval).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('skipApproval: true bypasses the pending hang but keeps needsApproval on the info', () => {
    let pended = 0
    const gate = new PatentOutputGate({ onPending: () => { pended += 1 } })
    const result = gate.processMessage(assistant('最终建议：直接入库'), { skipApproval: true })
    expect(result.needsApproval).toBe(false)
    expect(result.info.needsApproval).toBe(true)
    expect(pended).toBe(0)
  })

  it('rule-only approval (no keyword hit) still hangs with the violation rule id as trigger', () => {
    const ruleGate: RuleOutputGate = {
      process(text) {
        return {
          text,
          violations: [{ ruleId: 'CON-1', ruleName: '规则一', severity: 'major', action: 'block', message: '命中', evidence: [] }],
          needsApproval: true,
          warnHits: [],
          reviewHits: [],
          blockHits: ['CON-1'],
          evaluation: { violations: [] },
        }
      },
    }
    const records: Array<{ triggerKeyword: string }> = []
    const gate = new PatentOutputGate({
      ruleGate,
      onPending: () => {},
      approvalStore: { saveRecord: (r) => { records.push({ triggerKeyword: r.triggerKeyword }) }, listRecords: () => [] },
    })
    const result = gate.processMessage(assistant('普通文本，无审批词'))
    expect(result.needsApproval).toBe(true)
    expect(result.pendingIndex).toBeDefined()
    gate.approve(result.pendingIndex!)
    expect(records[0]!.triggerKeyword).toBe('CON-1')
  })

  it('a rule approval without violations and without a keyword falls back to the unknown trigger', () => {
    const ruleGate: RuleOutputGate = {
      process(text) {
        return {
          text,
          violations: [],
          needsApproval: true,
          warnHits: [],
          reviewHits: [],
          blockHits: ['CON-2'],
          evaluation: { violations: [] },
        }
      },
    }
    const records: Array<{ triggerKeyword: string }> = []
    const gate = new PatentOutputGate({
      ruleGate,
      onPending: () => {},
      approvalStore: { saveRecord: (r) => { records.push({ triggerKeyword: r.triggerKeyword }) }, listRecords: () => [] },
    })
    const result = gate.processMessage(assistant('普通文本，无审批词'))
    gate.flushPending(result.pendingIndex!)
    gate.approve(result.pendingIndex!)
    expect(records[0]!.triggerKeyword).toBe('unknown')
  })

  it('flushPending on an unknown index is a no-op; pending is kept for later approval', () => {
    const pended: number[] = []
    const gate = new PatentOutputGate({ onPending: (p) => { pended.push(p.index) } })
    const result = gate.processMessage(assistant('最终建议：稍后处理'))
    gate.flushPending(999)
    gate.flushPending(result.pendingIndex!)
    expect(pended).toEqual([result.pendingIndex])
    expect(gate.pendingCount()).toBe(1)
  })

  it('flushPending with a vanished pending entry never invokes onPending', () => {
    const pended: number[] = []
    const gate = new PatentOutputGate({ onPending: (p) => { pended.push(p.index) } })
    const result = gate.processMessage(assistant('最终建议：先挂起'))
    // 模拟内部状态被破坏：unflushed 里还留有索引但 pending 已缺失。
    ;(gate as unknown as { pending: Map<number, PendingPatentMessage> }).pending.delete(result.pendingIndex!)
    gate.flushPending(result.pendingIndex!)
    expect(pended).toEqual([])
  })

  it('cancelPending removes the entry once and is a no-op afterwards', () => {
    const gate = new PatentOutputGate({ onPending: () => {} })
    const result = gate.processMessage(assistant('最终建议：写入失败'))
    expect(gate.pendingCount()).toBe(1)
    gate.cancelPending(result.pendingIndex!)
    expect(gate.pendingCount()).toBe(0)
    gate.cancelPending(result.pendingIndex!)
    expect(gate.pendingCount()).toBe(0)
  })

  it('approve/reject on an unknown index return undefined/false', () => {
    const gate = new PatentOutputGate({ onPending: () => {} })
    expect(gate.approve(42)).toBeUndefined()
    expect(gate.reject(42)).toBe(false)
  })

  it('approve rejects a session mismatch and an expired pending entry', () => {
    const warns: string[] = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      pendingTtlMs: 1000,
      now: () => 5_000,
      logger: { warn: m => warns.push(m), error: () => {} },
    })
    const result = gate.processMessage(assistant('最终建议：过期条目'), { sessionId: 's1' })
    expect(gate.approve(result.pendingIndex!, 's2')).toBeUndefined()
    expect(gate.pendingCount()).toBe(1)

    // 时钟越过 TTL 后审批被拒绝并清理。
    const expired = gate.processMessage(assistant('最终建议：第二份'), { sessionId: 's1' })
    ;(gate as unknown as { options: { now: () => number } }).options.now = () => 9_999
    expect(gate.approve(expired.pendingIndex!, 's1')).toBeUndefined()
    expect(gate.pendingCount()).toBe(1)
    expect(warns.some(w => w.includes('超过 TTL'))).toBe(true)
  })

  it('pruneExpired cleans stale entries at the next processMessage', () => {
    const warns: string[] = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      pendingTtlMs: 100,
      now: () => 1_000,
      logger: { warn: m => warns.push(m), error: () => {} },
    })
    gate.processMessage(assistant('最终建议：第一条'))
    gate.processMessage(assistant('最终建议：第二条'))
    ;(gate as unknown as { options: { now: () => number } }).options.now = () => 2_000
    gate.processMessage(assistant('普通消息'))
    expect(gate.pendingCount()).toBe(0)
    expect(warns.some(w => w.includes('已清理'))).toBe(true)
  })

  it('notifyCommitted triggers onApproved (and tolerates a missing callback)', () => {
    const committed: number[] = []
    const gate = new PatentOutputGate({ onApproved: (p) => { committed.push(p.index) } })
    const pending = {
      index: 7,
      message: assistant('x'),
      processed: assistant('x'),
      info: processPatentOutput('x'),
      createdAt: 1,
    } as PendingPatentMessage
    gate.notifyCommitted(pending)
    expect(committed).toEqual([7])

    const bare = new PatentOutputGate()
    bare.notifyCommitted(pending)
    expect(committed).toEqual([7])
  })

  it('reject writes the audit record with feedback and invokes onRejected', () => {
    const records: Array<{ verdict: string; feedback: string | undefined }> = []
    const rejected: number[] = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      onRejected: (p) => { rejected.push(p.index) },
      approvalStore: { saveRecord: (r) => { records.push({ verdict: r.verdict, feedback: r.feedback }) }, listRecords: () => [] },
    })
    const result = gate.processMessage(assistant('最终建议：拒绝它'), { sessionId: 's1' })
    expect(gate.reject(result.pendingIndex!, 's1', '人工复核不通过')).toBe(true)
    expect(rejected).toEqual([result.pendingIndex])
    expect(records).toEqual([{ verdict: 'rejected', feedback: '人工复核不通过' }])
    expect(gate.reject(result.pendingIndex!)).toBe(false)
  })

  it('approve without an approval store is zero-overhead', () => {
    const gate = new PatentOutputGate({ onPending: () => {} })
    const result = gate.processMessage(assistant('最终建议：无审计'))
    expect(gate.approve(result.pendingIndex!)).toBeDefined()
    expect(gate.pendingCount()).toBe(0)
  })

  it('an injected clock stamps decidedAt in the audit record', () => {
    const records: Array<{ decidedAt: string }> = []
    const tick = 1_000
    const gate = new PatentOutputGate({
      onPending: () => {},
      now: () => tick,
      approvalStore: { saveRecord: (r) => { records.push({ decidedAt: r.decidedAt }) }, listRecords: () => [] },
    })
    const result = gate.processMessage(assistant('最终建议：带时钟'))
    gate.approve(result.pendingIndex!)
    expect(records[0]!.decidedAt).toBe(new Date(1_000).toISOString())
  })

  it('recordApproval carries modifiedOutput when the audit decision provides it', () => {
    const records: Array<{ modifiedOutput: string | undefined }> = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      approvalStore: { saveRecord: (r) => { records.push({ modifiedOutput: r.modifiedOutput }) }, listRecords: () => [] },
    })
    const result = gate.processMessage(assistant('最终建议：人工改写'))
    const pending = gate.pendingItems()[0]!
    ;(gate as unknown as { recordApproval(p: PendingPatentMessage, d: { verdict: 'modified'; modifiedOutput: string }): void })
      .recordApproval(pending, { verdict: 'modified', modifiedOutput: '改写后文本' })
    expect(records[0]!.modifiedOutput).toBe('改写后文本')
    gate.cancelPending(result.pendingIndex!)
  })

  it('restore re-registers a pending entry exactly once', () => {
    const gate = new PatentOutputGate({ onPending: () => {} })
    const pending = {
      index: 3,
      message: assistant('恢复'),
      processed: assistant('恢复'),
      info: processPatentOutput('恢复'),
      createdAt: 1,
    } as PendingPatentMessage
    gate.restore(pending)
    expect(gate.pendingCount()).toBe(1)
    expect(gate.pendingItems().map(p => p.index)).toEqual([3])
    // 重复 restore 同一索引不产生重复条目。
    gate.restore(pending)
    expect(gate.pendingCount()).toBe(1)
  })

  it('a throwing onPending logs through the injected logger', () => {
    const errors: unknown[] = []
    const gate = new PatentOutputGate({
      onPending: () => { throw new Error('回调炸了') },
      logger: { warn: () => {}, error: (_m, err) => errors.push(err) },
    })
    const result = gate.processMessage(assistant('最终建议：触发回调'))
    gate.flushPending(result.pendingIndex!)
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('回调炸了')
  })

  it('a rejecting onPending promise is caught and logged', async () => {
    const errors: unknown[] = []
    const gate = new PatentOutputGate({
      onPending: () => Promise.reject(new Error('异步回调失败')),
      logger: { warn: () => {}, error: (_m, err) => errors.push(err) },
    })
    const result = gate.processMessage(assistant('最终建议：异步回调'))
    gate.flushPending(result.pendingIndex!)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('异步回调失败')
  })

  it('a rejecting audit store write is caught and logged', async () => {
    const errors: unknown[] = []
    const gate = new PatentOutputGate({
      onPending: () => {},
      approvalStore: { saveRecord: () => Promise.reject(new Error('审计写入失败')), listRecords: () => [] },
      logger: { warn: () => {}, error: (_m, err) => errors.push(err) },
    })
    const result = gate.processMessage(assistant('最终建议：写审计'))
    gate.approve(result.pendingIndex!)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(errors.some(e => (e as Error).message === '审计写入失败')).toBe(true)
  })

  it('rewrites the first text block and preserves non-text blocks', () => {
    const gate = new PatentOutputGate()
    const message: GateMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking' },
        { type: 'text', text: '本方案存在侵权风险。' },
        { type: 'text', text: '第二段会被合并。' },
      ],
    }
    const result = gate.processMessage(message)
    expect(result.needsApproval).toBe(false)
    // thinking 块原样保留；两个 text 块合并进第一个（后续 text 块丢弃）。
    expect(result.message.content).toHaveLength(2)
    expect(result.message.content[0]).toMatchObject({ type: 'thinking' })
    const rewritten = result.message.content[1]!
    expect(rewritten.type).toBe('text')
    if (rewritten.type === 'text') {
      expect(rewritten.text).toContain('不构成正式法律意见')
      expect(rewritten.text).toContain('第二段会被合并')
      expect(rewritten.text.split('\n\n---\n')).toHaveLength(2)
    }
  })
})
