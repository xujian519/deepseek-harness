import { describe, expect, it } from 'vitest'
import { toRecord, toSearchResult } from '@deepseek-ai/dsh-patent-knowledge'
import type { LawRow } from '@deepseek-ai/dsh-patent-knowledge'

const row: LawRow = {
  id: '专利法_20201017',
  level: '法律',
  name: '专利法',
  filename: '专利法.txt',
  publish: '2020-10-17',
  expired: 0,
  category_id: 1,
  subtitle: null,
  valid_from: '2021-06-01',
  content: '全文',
  category_name: '民法商法',
  fts_rank: -12.5,
}

describe('legal row-mapper', () => {
  it('maps null columns to undefined and passes values through', () => {
    const r = toRecord(row)
    expect(r.id).toBe('专利法_20201017')
    expect(r.level).toBe('法律')
    expect(r.expired).toBe(0)
    expect(r.categoryId).toBe(1)
    expect(r.categoryName).toBe('民法商法')
    expect(r.subtitle).toBeUndefined()
    expect(r.validFrom).toBe('2021-06-01')
    expect(r.content).toBe('全文')
  })

  it('scores toSearchResult from fts_rank', () => {
    const r = toSearchResult(row)
    expect(r.score).toBe(-12.5)
    expect(r.name).toBe('专利法')
  })

  it('falls back to score 0 without fts_rank', () => {
    const r = toSearchResult({ ...row, fts_rank: undefined })
    expect(r.score).toBe(0)
  })
})
