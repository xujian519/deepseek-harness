import { describe, expect, it } from 'vitest'
import {
  PatentOutputGate,
  processPatentOutput,
  type RuleOutputGate,
  type GateMessage,
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
