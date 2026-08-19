import { describe, expect, it } from 'vitest'
import { stripCodeFence, tryParseJson } from '@deepseek-ai/dsh-patent-core'

describe('stripCodeFence', () => {
  it('strips a ```json fence', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips a plain ``` fence', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('returns the raw string when no fence is present', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })
})

describe('tryParseJson', () => {
  it('parses a plain JSON object', () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses a fenced JSON object', () => {
    expect(tryParseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('returns undefined for non-JSON', () => {
    expect(tryParseJson('这不是 JSON')).toBeUndefined()
  })

  it('returns undefined for arrays (object-shaped only)', () => {
    expect(tryParseJson('[1,2,3]')).toBeUndefined()
  })

  it('returns undefined for scalar values', () => {
    expect(tryParseJson('42')).toBeUndefined()
    expect(tryParseJson('"hi"')).toBeUndefined()
    expect(tryParseJson('null')).toBeUndefined()
  })
})
