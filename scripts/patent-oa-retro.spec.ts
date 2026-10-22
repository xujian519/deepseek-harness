import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIN_CASES,
  findAnonymizationLeaks,
  parseOaRetroJsonl,
  renderValidationReport,
  validateOaRetroDataset,
} from './patent-oa-retro.ts'

/** One structurally valid row; overrides replace top-level fields. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'oa-001',
    firstOa: { text: '第一次审查意见（已匿名化）' },
    secondOa: {
      text: '第二次审查意见（已匿名化）',
      disputes: [{ statute: 'A22.3', claims: [1], point: '维持创造性争点' }],
    },
    claims: '1. 一种示例装置。',
    outcome: 'pending',
    ...overrides,
  }
}

describe('parseOaRetroJsonl', () => {
  it('skips blank lines and comments and parses one value per data line', () => {
    const records = parseOaRetroJsonl('\n# comment\n{"id":"a"}\n\n{"id":"b"}\n')
    expect(records).toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('names the failing line for invalid JSON', () => {
    expect(() => parseOaRetroJsonl('{"id":"a"}\nnot json\n')).toThrow('line 2: invalid JSON')
  })
})

describe('validateOaRetroDataset', () => {
  it('accepts a valid dataset and counts statute and claim coverage', () => {
    const result = validateOaRetroDataset(
      [
        row(),
        row({
          id: 'oa-002',
          secondOa: {
            text: '第二次审查意见',
            disputes: [
              { statute: 'A22.3', claims: [1, 2], point: '维持创造性争点' },
              { statute: 'A26.4', claims: [2], point: '维持不清楚争点' },
            ],
          },
        }),
      ],
      { minCases: 2 },
    )
    expect(result.errors).toEqual([])
    expect(result.cases).toBe(2)
    expect(result.disputes).toBe(3)
    expect(result.byStatute).toEqual({ 'A22.3': 2, 'A26.4': 1 })
    expect(result.byClaim).toEqual({ '1': 2, '2': 2 })
  })

  it('enforces the default and explicit minimum case counts', () => {
    const result = validateOaRetroDataset([row()])
    expect(result.errors).toContain(`dataset has 1 cases; at least ${DEFAULT_MIN_CASES} required`)
    expect(validateOaRetroDataset([row()], { minCases: 0 }).errors[0]).toMatch(/positive integer/)
  })

  it('reports every structural defect in one pass', () => {
    const result = validateOaRetroDataset(
      [
        null,
        row({ id: 'BAD ID' }),
        row(),
        row(),
        row({ firstOa: {}, claims: '' }),
        row({ id: 'oa-003', outcome: 'unknown' }),
        row({ id: 'oa-004', secondOa: {} }),
        row({ id: 'oa-005', secondOa: { text: '二通', disputes: [] } }),
        row({
          id: 'oa-006',
          secondOa: { text: '二通', disputes: [null, { statute: '22.3', claims: [], point: '' }] },
        }),
        row({
          id: 'oa-007',
          secondOa: { text: '二通', disputes: [{ statute: 'A22.3', claims: [0, 1.5], point: '争点' }] },
        }),
      ],
      { minCases: 1 },
    )
    const text = result.errors.join('\n')
    expect(text).toContain('case 1: not an object')
    expect(text).toContain('case 2: id must use lower-case letters')
    expect(text).toContain('case 4: duplicate id oa-001')
    expect(text).toContain('case 5: firstOa.text must be a non-empty string')
    expect(text).toContain('case 5: claims must be a non-empty string')
    expect(text).toContain('case 6: outcome must be granted')
    expect(text).toContain('case 7: secondOa.text must be a non-empty string')
    expect(text).toContain('case 8: secondOa.disputes must be a non-empty array')
    expect(text).toContain('case 9 dispute 1: dispute is not an object')
    expect(text).toContain('case 9 dispute 2: statute must look like A22.3')
    expect(text).toContain('case 9 dispute 2: claims must be a non-empty array')
    expect(text).toContain('case 9 dispute 2: point must be a non-empty string')
    expect(text).toContain('case 10 dispute 1: claim numbers must be positive integers')
  })

  it('deduplicates repeated claim numbers within one dispute', () => {
    const result = validateOaRetroDataset(
      [row({ secondOa: { text: '二通', disputes: [{ statute: 'A22.3', claims: [1, 1], point: '争点' }] } })],
      { minCases: 1 },
    )
    expect(result.errors).toEqual([])
    expect(result.byClaim).toEqual({ '1': 1 })
  })

  it('reports anonymization leaks once per row', () => {
    const result = validateOaRetroDataset(
      [
        row({
          firstOa: { text: '申请号：202210132346.1 申请人：张三 电话 13800138000 邮箱 a@b.com' },
          secondOa: { text: 'CN101234567A 作为 D1', disputes: [{ statute: 'A22.3', claims: [1], point: '争点' }] },
        }),
      ],
      { minCases: 1 },
    )
    const leaks = result.errors.filter(error => error.includes('anonymization leak'))
    expect(leaks).toEqual([
      'case 1: anonymization leak: patent or application number',
      'case 1: anonymization leak: application-number field',
      'case 1: anonymization leak: applicant field',
      'case 1: anonymization leak: phone number',
      'case 1: anonymization leak: email address',
    ])
  })
})

describe('findAnonymizationLeaks', () => {
  it('accepts technical prose with aliases and claim numbers', () => {
    expect(findAnonymizationLeaks('权利要求 1 相对于对比文件 D1 与 D2 的结合不具备创造性。')).toEqual([])
  })

  it('recognizes header fields that survive anonymization', () => {
    expect(findAnonymizationLeaks('发明人：李四；代理机构：某所；代理人：王五；地址：某市')).toEqual([
      'inventor field',
      'agency field',
      'agent field',
      'address field',
    ])
  })
})

describe('renderValidationReport', () => {
  it('sorts coverage and appends errors', () => {
    const report = renderValidationReport({
      cases: 2,
      disputes: 2,
      byStatute: { 'A26.4': 1, 'A22.3': 1 },
      byClaim: { '2': 1, '1': 1 },
      errors: ['boom'],
    })
    expect(report).toBe(
      ['OA retro dataset: 2 cases, 2 disputes', 'Statutes: A22.3=1, A26.4=1', 'Claims: 1=1, 2=1', 'ERROR: boom'].join(
        '\n',
      ),
    )
  })

  it('renders empty coverage as a dash', () => {
    expect(renderValidationReport({ cases: 0, disputes: 0, byStatute: {}, byClaim: {}, errors: [] })).toBe(
      ['OA retro dataset: 0 cases, 0 disputes', 'Statutes: -', 'Claims: -'].join('\n'),
    )
  })
})
