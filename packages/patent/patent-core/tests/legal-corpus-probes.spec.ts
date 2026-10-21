import { describe, expect, it } from 'vitest'
import {
  deriveAllElementsCoverage,
  type ChartRow,
  type ClaimElement,
} from '@deepseek-ai/dsh-patent-core'

describe('legal corpus probes', () => {
  describe('A5 all-elements coverage', () => {
    it.fails('空要素表不应给出“不落入保护范围”的实质结论', () => {
      expect(deriveAllElementsCoverage([], '产品A', []).outcome).not.toBe('not-covered')
    })

    it.fails('任一权利要求被全部覆盖时整体结论不应是 not-covered', () => {
      const elements: ClaimElement[] = [
        { id: '1a', claimNo: 1, text: 'a', kind: 'limitation' },
        { id: '2a', claimNo: 2, text: 'b', kind: 'limitation' },
        { id: '2b', claimNo: 2, text: 'c', kind: 'limitation' },
      ]
      const rows: ChartRow[] = ['1a', '2a'].map(elementId => ({
        elementId,
        targetId: '产品A',
        quote: 'q',
        pinCite: 'p',
        mapping: 'literal',
        state: 'literal',
        verified: true,
      }))
      expect(deriveAllElementsCoverage(rows, '产品A', elements).outcome).not.toBe('not-covered')
    })
  })
})
