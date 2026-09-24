import { describe, expect, it } from 'vitest'
import { LruCache } from '@deepseek-ai/dsh-patent-knowledge/src/shared/lru-cache.ts'

describe('LruCache', () => {
  it('evicts the least recently used entry once the bound is passed', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    expect(cache.has('a')).toBe(false)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.size).toBe(2)
  })

  it('refreshes recency on a hit, so the read entry survives the next eviction', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    cache.set('c', 3)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('does not refresh recency for has, and keeps a cached undefined distinct from a miss', () => {
    const cache = new LruCache<string, number | undefined>(2)
    cache.set('missing', undefined)
    expect(cache.has('missing')).toBe(true)
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.has('absent')).toBe(false)
    expect(cache.get('absent')).toBeUndefined()
  })

  it('replaces an existing key without growing past the bound', () => {
    const cache = new LruCache<string, number>(1)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe(2)
  })

  it('clears every entry', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('a', 1)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.has('a')).toBe(false)
  })

  it('rejects a capacity that cannot hold one entry', () => {
    expect(() => new LruCache<string, number>(0)).toThrow(RangeError)
    expect(() => new LruCache<string, number>(1.5)).toThrow(RangeError)
  })
})
