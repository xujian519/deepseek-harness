import { describe, expect, it } from 'vitest'
import { createOverlapIndex, textOverlap, topicOverlap, type ComparableEntry } from '../src/support.ts'

/** Two transcribed entries, one untranscribed, and the pairs they share. */
const entries: ComparableEntry[] = [
  { label: '第 1 条', topics: ['转送', '指定期限'], text: '合议组应当将有关文件转送有关当事人，并指定答复期限。' },
  { label: '第 2 条', topics: ['无效宣告'], text: '有关当事人可以在无效宣告程序中转送有关文件。' },
  { label: '第 3 条', topics: ['未转录'], text: null },
]

describe('overlap index', () => {
  it('counts only the entries that carry text', () => {
    expect(createOverlapIndex(entries).documents).toBe(2)
  })

  it('weights a pair by how many entries carry it', () => {
    const index = createOverlapIndex([
      { label: 'a', topics: [], text: '甲乙丙' },
      { label: 'b', topics: [], text: '甲乙丁' },
    ])
    // 甲乙 occurs in both entries, 乙丙 in one: with 戊 carried by neither, the
    // proposition built on the repeated pair scores lower.
    const repeated = textOverlap(index, '甲乙戊', '甲乙丙')
    const distinctive = textOverlap(index, '乙丙戊', '甲乙丙')
    expect(repeated).toBeLessThan(distinctive)
    expect(textOverlap(index, '甲乙', '甲乙丙')).toBe(1)
  })
})

describe('text overlap', () => {
  const index = createOverlapIndex(entries)

  it('carries a verbatim proposition in full', () => {
    expect(textOverlap(index, '应当将有关文件转送有关当事人', entries[0]?.text ?? '')).toBe(1)
  })

  it('ignores layout whitespace, punctuation, and full-width forms', () => {
    expect(textOverlap(index, '合议组：应当将有关文件，转送有关当事人。', entries[0]?.text ?? '')).toBe(1)
    expect(textOverlap(index, '合议组: 应当将有关文件, 转送有关当事人.', entries[0]?.text ?? '')).toBe(1)
  })

  it('scores an empty proposition as nothing', () => {
    expect(textOverlap(index, '   ', entries[0]?.text ?? '')).toBe(0)
  })

  it('scores a one-character proposition as nothing against a longer entry', () => {
    // A single character has no pair to compare, and one character is not a
    // proposition: it never counts as support.
    expect(textOverlap(index, '转', entries[0]?.text ?? '')).toBe(0)
    expect(textOverlap(createOverlapIndex([{ label: 'a', topics: [], text: '转' }]), '转', '转')).toBe(1)
  })

  it('does not require the text to be in the index', () => {
    const partial = textOverlap(index, '合议组转送文件', '合议组应当转送文件')
    expect(partial).toBeGreaterThan(0.5)
    expect(partial).toBeLessThan(1)
  })

  it('scores a proposition no entry carries as nothing', () => {
    expect(textOverlap(index, '专利复审委员会', entries[0]?.text ?? '')).toBe(0)
  })
})

describe('topic overlap', () => {
  it('accepts a proposition that names a topic', () => {
    expect(topicOverlap(['转送', '指定期限'], '本件应适用转送规则')).toBe(true)
  })

  it('accepts a proposition a topic names', () => {
    expect(topicOverlap(['指定期限不得延长'], '指定期限')).toBe(true)
  })

  it('accepts an empty proposition as naming nothing', () => {
    expect(topicOverlap(['转送'], '   ')).toBe(false)
  })

  it('reports a proposition no topic names', () => {
    expect(topicOverlap(['转送'], '公开不充分')).toBe(false)
  })
})
