import { describe, expect, it } from 'vitest'
import { deepEqualJson, isJsonValue } from '@deepseek-ai/dsh-util-values'

describe('deepEqualJson', () => {
  it('reads an own `__proto__` key as a key the other record lacks', () => {
    // JSON.parse creates an own data property, so this value is inside the JSON
    // domain the helper documents; `in` would see the inherited prototype
    // accessor instead and report these two records equal.
    const own: unknown = JSON.parse('{"__proto__":{}}')
    const other: unknown = JSON.parse('{"other":1}')
    expect(isJsonValue(own)).toBe(true)
    expect(deepEqualJson(own, other)).toBe(false)
    expect(deepEqualJson(other, JSON.parse('{"other":1}'))).toBe(true)
  })
})
