import { describe, expect, it } from 'vitest'
import { readFirstStateText } from '../src/atoms/state-text.ts'

describe('readFirstStateText', () => {
  it('returns the first non-empty string with the key that supplied it', () => {
    expect(readFirstStateText({ first: undefined, second: '文本' }, ['first', 'second'], '正文')).toEqual({
      kind: 'text',
      key: 'second',
      text: '文本',
    })
  })

  it('skips empty strings and reports a missing value when no key carries text', () => {
    expect(readFirstStateText({ first: '  ' }, ['first', 'second'], '正文')).toEqual({
      kind: 'missing',
      reason: '未提供正文（first / second）',
    })
  })

  it('reports a type error instead of treating a non-string value as missing', () => {
    expect(readFirstStateText({ first: 42 }, ['first'], '正文')).toEqual({
      kind: 'error',
      reason: 'state.first 不是字符串',
    })
  })
})
