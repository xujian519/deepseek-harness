import { describe, expect, it } from 'vitest'
import { fromInverted, decodeEntities, snippet, stripTags } from '../../../src/runtime/shared/text.ts'

describe('text helpers', () => {
  it('decodeEntities decodes named, hex, and decimal entities', () => {
    expect(decodeEntities('a &amp; b &lt; c &gt; d &quot;q&quot; &apos;e&apos;')).toBe("a & b < c > d \"q\" 'e'")
    expect(decodeEntities('&#x41;&#66;&#67;')).toBe('ABC')
    expect(decodeEntities('&#65;&#98;')).toBe('Ab')
    expect(decodeEntities('&nbsp;')).toBe(' ')
  })

  it('decodeEntities leaves unknown entities untouched', () => {
    expect(decodeEntities('&unknown; &amp;')).toBe('&unknown; &')
  })

  it('stripTags removes JATS tags and collapses whitespace', () => {
    expect(stripTags('<jats:p>Attention is  all   you need</jats:p>')).toBe('Attention is all you need')
    expect(stripTags('<p>a &amp; b</p>')).toBe('a & b')
    expect(stripTags(undefined)).toBeUndefined()
    expect(stripTags('<p>  </p>')).toBeUndefined()
  })

  it('snippet truncates at word boundary with ellipsis', () => {
    const text = 'word '.repeat(100).trim()
    const out = snippet(text, 50)!
    expect(out.endsWith('…')).toBe(true)
    expect(out.length <= 54).toBe(true)
  })

  it('snippet returns short text unchanged and undefined for empty', () => {
    expect(snippet('hello world')).toBe('hello world')
    expect(snippet(undefined)).toBeUndefined()
    expect(snippet('<b></b>')).toBeUndefined()
  })

  it('fromInverted rebuilds OpenAlex abstract from inverted index', () => {
    const index = { the: [0], quick: [1], brown: [2], fox: [3] }
    expect(fromInverted(index)).toBe('the quick brown fox')
  })

  it('fromInverted tolerates out-of-order positions and gaps', () => {
    const index = { fox: [3], quick: [1], the: [0] }
    expect(fromInverted(index)).toBe('the quick fox')
    expect(fromInverted({ a: [0], b: [5] })).toBe('a b')
  })

  it('fromInverted returns undefined for null/empty', () => {
    expect(fromInverted(undefined)).toBeUndefined()
    expect(fromInverted(null)).toBeUndefined()
    expect(fromInverted({})).toBeUndefined()
  })
})
