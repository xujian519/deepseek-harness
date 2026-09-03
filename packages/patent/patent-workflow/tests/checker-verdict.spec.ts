import { describe, expect, it } from 'vitest'
import {
  CHECKER_VERDICT_REQUIRED_FIELDS,
  CheckerVerdictParseError,
  parseCheckerVerdict,
} from '@deepseek-ai/dsh-patent-workflow'

const valid = {
  status: 'needs_revision',
  summary: '对比文件引用缺少段落定位',
  issues: [
    { severity: 'major', description: 'D1 未标注具体段落', anchor: '权项1' },
    { severity: 'minor', description: '措辞口语化' },
  ],
  legal_basis: ['专利法第22条第3款'],
}

describe('parseCheckerVerdict', () => {
  it('解析合法 verdict，保留可选字段', () => {
    const verdict = parseCheckerVerdict(JSON.stringify(valid))
    expect(verdict.status).toBe('needs_revision')
    expect(verdict.issues).toHaveLength(2)
    expect(verdict.issues[0]?.anchor).toBe('权项1')
    expect(verdict.legal_basis).toEqual(['专利法第22条第3款'])
  })

  it('容忍 markdown 代码围栏', () => {
    const fenced = '```json\n' + JSON.stringify({ ...valid, status: 'pass', issues: [] }) + '\n```'
    expect(parseCheckerVerdict(fenced).status).toBe('pass')
  })

  it('非 JSON 抛 CheckerVerdictParseError', () => {
    expect(() => parseCheckerVerdict('结论：通过')).toThrow(CheckerVerdictParseError)
  })

  it('status 词表外抛错', () => {
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, status: 'ok' })))
      .toThrow(/status 非法/)
  })

  it('summary 缺失或为空抛错', () => {
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, summary: undefined })))
      .toThrow(/summary/)
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, summary: '  ' })))
      .toThrow(/summary/)
  })

  it('issues 非数组或元素非法抛错', () => {
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, issues: 'none' })))
      .toThrow(/issues 必须是数组/)
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, issues: [{ severity: 'huge', description: 'x' }] })))
      .toThrow(/severity 非法/)
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, issues: [{ severity: 'major' }] })))
      .toThrow(/description/)
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, issues: [{ severity: 'major', description: 'x', anchor: 3 }] })))
      .toThrow(/anchor/)
  })

  it('legal_basis 非字符串数组抛错', () => {
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, legal_basis: 'A22.3' })))
      .toThrow(/legal_basis/)
    expect(() => parseCheckerVerdict(JSON.stringify({ ...valid, legal_basis: [22] })))
      .toThrow(/legal_basis/)
  })

  it('REQUIRED_FIELDS 是 verdict 必填字段的单一来源', () => {
    expect(CHECKER_VERDICT_REQUIRED_FIELDS).toEqual(['status', 'summary', 'issues'])
  })
})
