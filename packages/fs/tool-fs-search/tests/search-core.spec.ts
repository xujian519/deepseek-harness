/**
 * Unit tests for the `grep` inline retention pass (`src/search-core.ts`): the
 * cap keeps the first `maxMatches` previewed matches while counting every parsed
 * match, and the per-line preview work follows the cap rather than the match
 * count, so a search with tens of thousands of matches previews no line it
 * discards.
 */

import { describe, expect, it } from 'vitest'
import type { GrepMatch } from '../src/search-core.ts'
import { previewLine, retainGrepMatches } from '../src/search-core.ts'

/** Matches whose `line` reads are counted, so a test can bound the preview work. */
function countedMatches(count: number): { matches: GrepMatch[]; lineReads: () => number } {
  let reads = 0
  const matches = Array.from({ length: count }, (_, index): GrepMatch => ({
    path: `dir/file-${index % 8}.ts`,
    lineNumber: index + 1,
    get line(): string {
      reads += 1
      return `const value${index} = ${index}`
    },
  }))
  return { matches, lineReads: () => reads }
}

describe('retainGrepMatches', () => {
  it('keeps the first matches with their previews and counts the rest as omitted', () => {
    const { matches } = countedMatches(5)
    const retained = retainGrepMatches(matches, 2, 2000)
    expect(retained.kept).toBe(2)
    expect(retained.seen).toBe(5)
    expect(retained.truncated).toBe(true)
    expect(retained.omitted).toEqual({ kind: 'exact', count: 3 })
    expect(retained.items.map(item => item.line)).toEqual(['const value0 = 0', 'const value1 = 1'])
  })

  it('previews only the matches it keeps, so preview work follows the cap and not the match count', () => {
    const small = countedMatches(4)
    const large = countedMatches(4000)
    expect(retainGrepMatches(small.matches, 2, 2000).kept).toBe(2)
    expect(retainGrepMatches(large.matches, 2, 2000).kept).toBe(2)
    // Guards against a regression to previewing every parsed match: the
    // 4000-match list would then read a thousand times as many lines, because
    // each previewed match reads its line once for the copy and once to preview.
    expect(large.lineReads()).toBe(small.lineReads())
  })

  it('reports no omission when the parsed matches fit the cap', () => {
    const { matches } = countedMatches(2)
    const retained = retainGrepMatches(matches, 2, 2000)
    expect(retained.seen).toBe(2)
    expect(retained.truncated).toBe(false)
    expect(retained.omitted).toEqual({ kind: 'none' })
  })

  it('bounds each kept preview to the per-line byte budget', () => {
    const retained = retainGrepMatches([{ path: 'a.ts', lineNumber: 1, line: 'aéaéaéaé' }], 10, 7)
    expect(retained.items[0]?.line).toBe(previewLine('aéaéaéaé', 7))
    expect(retained.items[0]?.line).toBe('aéaéa (line truncated)')
  })
})
