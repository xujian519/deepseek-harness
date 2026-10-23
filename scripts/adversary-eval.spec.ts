import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseOaRetroJsonl, validateOaRetroDataset } from './patent-oa-retro.ts'

const SUBSET = fileURLToPath(new URL('./fixtures/patent-oa-retro/subset.jsonl', import.meta.url))

function readSubset(): unknown[] {
  return parseOaRetroJsonl(readFileSync(SUBSET, 'utf8'))
}

describe('adversary evaluation subset', () => {
  it('parses and passes the anonymization and structure validator', () => {
    const result = validateOaRetroDataset(readSubset(), { minCases: 5 })
    expect(result.errors).toEqual([])
    expect(result.cases).toBe(5)
    expect(result.disputes).toBe(7)
  })

  it('covers four statutes and claim positions 1 through 5', () => {
    const result = validateOaRetroDataset(readSubset(), { minCases: 5 })
    expect(Object.keys(result.byStatute).sort()).toEqual(['A22.2', 'A22.3', 'A26.4', 'A33'])
    const claimPositions = Object.keys(result.byClaim).map(Number).sort((a, b) => a - b)
    expect(claimPositions).toEqual([1, 2, 3, 5])
  })

  it('keeps each case tied to a real second OA with at least one dispute', () => {
    for (const record of readSubset()) {
      const caseData = record as {
        id: string
        secondOa?: { text?: unknown; disputes?: unknown }
        claims?: unknown
      }
      expect(caseData.secondOa?.text, caseData.id).toEqual(expect.any(String))
      expect(Array.isArray(caseData.secondOa?.disputes), caseData.id).toBe(true)
      expect((caseData.secondOa?.disputes as unknown[]).length, caseData.id).toBeGreaterThan(0)
      expect(caseData.claims, caseData.id).toEqual(expect.any(String))
    }
  })
})
