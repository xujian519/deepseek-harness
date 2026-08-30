import { describe, expect, it } from 'vitest'
import { assertPositiveFinite, assertPositiveInteger, isRecord } from '@deepseek-ai/dsh-value'

describe('isRecord', () => {
  it('accepts plain objects and nested records', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ type: 'image', count: 2 })).toBe(true)
    expect(isRecord({ nested: { deep: true } })).toBe(true)
  })

  it('accepts non-plain objects: the guard owns the object shape, not the prototype', () => {
    expect(isRecord(new Date())).toBe(true)
    expect(isRecord(new Map())).toBe(true)
    expect(isRecord(/re/)).toBe(true)
    class InstanceBox { value = 1 }
    expect(isRecord(new InstanceBox())).toBe(true)
  })

  it('rejects null, arrays, primitives, and functions', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord(['entry'])).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord('text')).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(() => {})).toBe(false)
  })

  it('narrows the value so properties can be read as unknown', () => {
    const value: unknown = { kind: 'response' }
    if (!isRecord(value)) throw new Error('expected a record')
    expect(value.kind).toBe('response')
  })
})

describe('assertPositiveInteger', () => {
  it('accepts integers >= 1 and narrows unknown to number', () => {
    const value: unknown = 3
    assertPositiveInteger('maxDepth', value)
    expect(value + 1).toBe(4)
    assertPositiveInteger('one', 1)
  })

  it('throws a TypeError naming the label for non-integers and values below 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => { assertPositiveInteger('limit', bad) }).toThrow(TypeError)
      expect(() => { assertPositiveInteger('limit', bad) }).toThrow('limit must be a positive integer')
    }
  })

  it('throws for non-number values, including numeric strings and null', () => {
    for (const bad of ['1', null, undefined, true, { value: 1 }]) {
      expect(() => { assertPositiveInteger('retries', bad) }).toThrow('retries must be a positive integer')
    }
  })
})

describe('assertPositiveFinite', () => {
  it('accepts positive finite numbers, including non-integers, and narrows unknown to number', () => {
    const value: unknown = 1.5
    assertPositiveFinite('graceMs', value)
    expect(value + 1).toBe(2.5)
    assertPositiveFinite('one', 1)
  })

  it('throws a TypeError naming the label for zero, negatives, infinities, and non-numbers', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
      expect(() => { assertPositiveFinite('graceMs', bad) }).toThrow(TypeError)
      expect(() => { assertPositiveFinite('graceMs', bad) }).toThrow('graceMs must be a positive finite number')
    }
  })
})
