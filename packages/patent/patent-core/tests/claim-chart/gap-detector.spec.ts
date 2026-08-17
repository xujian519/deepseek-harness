import { expect, it } from 'vitest'
import { detectGaps } from '@deepseek-ai/dsh-patent-core'
import type { ChartRow } from '@deepseek-ai/dsh-patent-core'

function row(elementId: string, targetId: string, mapping: ChartRow['mapping']): ChartRow {
  return { elementId, targetId, quote: '', pinCite: '', mapping, state: mapping, verified: false }
}

it('无缺口时返回空列表', () => {
  const rows = [row('1a', 'D1', 'literal'), row('1b', 'D1', 'anticipation')]
  expect(detectGaps(rows)).toEqual([])
})

it('聚合缺口并按优先级排序（not-found > needs-evidence > partial）', () => {
  const rows = [
    row('1a', 'D1', 'partial'),
    row('1b', 'D1', 'needs-evidence'),
    row('1c', 'D1', 'not-found'),
    row('1c', 'D2', 'literal'),
  ]
  const gaps = detectGaps(rows)
  expect(gaps.map(g => `${g.elementId}:${g.mapping}`)).toEqual(['1c:not-found', '1b:needs-evidence', '1a:partial'])
})

it('缺口条目带建议动作', () => {
  const gaps = detectGaps([row('1a', 'D1', 'not-found'), row('1b', 'D1', 'needs-evidence')])
  expect(gaps[0]!.suggestion).toBe('补充检索或论证等同替换')
  expect(gaps[1]!.suggestion).toBe('证据固化（全文引用/附图标记）')
})
