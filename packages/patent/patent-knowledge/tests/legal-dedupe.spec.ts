import { describe, expect, it } from 'vitest'
import { dedupeByLawName } from '@deepseek-ai/dsh-patent-knowledge'

describe('dedupeByLawName', () => {
  it('keeps the first occurrence of each name (caller sorts by publish desc)', () => {
    const rows = [
      { name: '专利法', version: '2020' },
      { name: '著作权法', version: '2020' },
      { name: '专利法', version: '2008' },
    ]
    const deduped = dedupeByLawName(rows, 10)
    expect(deduped).toHaveLength(2)
    expect(deduped[0]).toEqual({ name: '专利法', version: '2020' })
    expect(deduped[1]).toEqual({ name: '著作权法', version: '2020' })
  })

  it('truncates to limit', () => {
    expect(dedupeByLawName([{ name: 'a' }, { name: 'b' }, { name: 'c' }], 2)).toHaveLength(2)
  })

  it('returns empty for empty input', () => {
    expect(dedupeByLawName([], 10)).toEqual([])
  })
})
