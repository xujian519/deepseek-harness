import { describe, expect, it } from 'vitest'
import { createApprovalRecord, InMemoryApprovalStore, type ApprovalRecord } from '@deepseek-ai/dsh-patent-workflow'

/** Build a minimal audit record with the given verdict. */
function record(verdict: ApprovalRecord['verdict'], pendingIndex = 0): ApprovalRecord {
  return createApprovalRecord({
    pendingIndex,
    triggerKeyword: '专利结论',
    originalOutputPreview: '输出内容',
    verdict,
  })
}

describe('createApprovalRecord', () => {
  it('fills the audit fields and stamps an ISO decidedAt', () => {
    const record = createApprovalRecord({
      pendingIndex: 3,
      sessionId: 's1',
      turnId: 't1',
      triggerKeyword: '专利结论',
      originalOutputPreview: '输出内容',
      verdict: 'adopted',
    })
    expect(record).toMatchObject({
      pendingIndex: 3,
      sessionId: 's1',
      turnId: 't1',
      triggerKeyword: '专利结论',
      originalOutputPreview: '输出内容',
      verdict: 'adopted',
    })
    expect(new Date(record.decidedAt).getTime()).not.toBeNaN()
  })

  it('omits optional fields and the now clock defaults to the system clock', () => {
    const record = createApprovalRecord({
      pendingIndex: 1,
      triggerKeyword: '侵权判断',
      originalOutputPreview: 'x',
      verdict: 'rejected',
    })
    expect(record.sessionId).toBeUndefined()
    expect(record.turnId).toBeUndefined()
    expect(record.modifiedOutput).toBeUndefined()
    expect(record.feedback).toBeUndefined()
  })

  it('carries modifiedOutput and feedback when given', () => {
    const record = createApprovalRecord({
      pendingIndex: 2,
      triggerKeyword: '最终建议',
      originalOutputPreview: '原输出',
      verdict: 'modified',
      modifiedOutput: '替换输出',
      feedback: '理由不充分',
    })
    expect(record.modifiedOutput).toBe('替换输出')
    expect(record.feedback).toBe('理由不充分')
  })

  it('truncates originalOutputPreview to 500 characters', () => {
    const record = createApprovalRecord({
      pendingIndex: 0,
      triggerKeyword: 'k',
      originalOutputPreview: '长'.repeat(600),
      verdict: 'adopted',
    })
    expect(record.originalOutputPreview).toHaveLength(500)
  })

  it('uses the injected clock for decidedAt', () => {
    const frozen = new Date('2026-02-03T04:05:06.000Z')
    const record = createApprovalRecord({
      pendingIndex: 0,
      triggerKeyword: 'k',
      originalOutputPreview: 'x',
      verdict: 'adopted',
      now: () => frozen,
    })
    expect(record.decidedAt).toBe('2026-02-03T04:05:06.000Z')
  })

  it('roundtrips through an ApprovalStore-typed record', () => {
    const record = createApprovalRecord({
      pendingIndex: 0,
      triggerKeyword: 'k',
      originalOutputPreview: 'x',
      verdict: 'rejected',
    })
    const asAudit: ApprovalRecord = record
    expect(asAudit.pendingIndex).toBe(0)
  })
})

describe('InMemoryApprovalStore', () => {
  it('saves records and lists them back in insertion order', () => {
    const store = new InMemoryApprovalStore()
    store.saveRecord(record('adopted', 0))
    store.saveRecord(record('rejected', 1))
    expect(store.listRecords().map(r => r.pendingIndex)).toEqual([0, 1])
    expect(store.listRecords()[0]!.verdict).toBe('adopted')
  })

  it('listRecords returns a copy the caller cannot use to mutate stored records', () => {
    const store = new InMemoryApprovalStore()
    store.saveRecord(record('adopted', 0))
    const listed = store.listRecords()
    listed.push(record('rejected', 9))
    listed[0]!.verdict = 'rejected'
    expect(store.listRecords()).toHaveLength(1)
    expect(store.listRecords()[0]!.verdict).toBe('adopted')
  })

  it('stats counts every verdict and derives adoptionRate from the total', () => {
    const store = new InMemoryApprovalStore()
    store.saveRecord(record('adopted', 0))
    store.saveRecord(record('adopted', 1))
    store.saveRecord(record('modified', 2))
    store.saveRecord(record('rejected', 3))
    expect(store.stats()).toEqual({ total: 4, adopted: 2, modified: 1, rejected: 1, adoptionRate: 0.5 })
  })

  it('stats reports a zero adoptionRate for an empty store', () => {
    expect(new InMemoryApprovalStore().stats()).toEqual({
      total: 0,
      adopted: 0,
      modified: 0,
      rejected: 0,
      adoptionRate: 0,
    })
  })
})
