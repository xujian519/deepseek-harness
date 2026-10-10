import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BASELINE_PATH,
  diffDivergences,
  diffRowSets,
  loadPresets,
  parseBaseline,
  presetDivergences,
  presetRowBlocks,
  presetRowSetGaps,
  renderBaseline,
} from './verify-preset-divergence.ts'

const root = resolve(import.meta.dirname, '..')

describe('presetRowBlocks', () => {
  it('runs each block to the line before the next row id', () => {
    const blocks = presetRowBlocks([
      '- insert:',
      '    - id: first',
      "      name: '@deepseek-ai/dsh-one'",
      '',
      '      # trailing comment of first',
      '    - id: second',
      "      name: '@deepseek-ai/dsh-two'",
      '',
    ].join('\n'))
    expect([...blocks.keys()]).toEqual(['first', 'second'])
    expect(blocks.get('first')).toBe([
      '    - id: first',
      "      name: '@deepseek-ai/dsh-one'",
      '',
      '      # trailing comment of first',
    ].join('\n'))
    expect(blocks.get('second')).toBe([
      '    - id: second',
      "      name: '@deepseek-ai/dsh-two'",
      '',
    ].join('\n'))
  })

  it('keeps nested rows as their own blocks', () => {
    const blocks = presetRowBlocks([
      '    - id: group',
      '      group: true',
      '      config:',
      '        - id: child',
      "          name: '@deepseek-ai/dsh-child'",
      '',
    ].join('\n'))
    expect([...blocks.keys()]).toEqual(['group', 'child'])
  })

  it('fails loud on a repeated row id', () => {
    expect(() => presetRowBlocks('    - id: a\n    - id: a\n')).toThrow(/appears twice/)
  })
})

describe('presetDivergences', () => {
  it('reports an id whose block differs across the presets carrying it', () => {
    const divergences = presetDivergences([
      { file: 'a.patch.yml', source: '    - id: persona\n      prefix: A\n' },
      { file: 'b.patch.yml', source: '    - id: persona\n      prefix: B\n' },
    ])
    const hashes = divergences.get('persona')
    expect([...(hashes?.keys() ?? [])]).toEqual(['a.patch.yml', 'b.patch.yml'])
    expect(new Set(hashes?.values()).size).toBe(2)
  })

  it('stays silent for identical blocks and for an id one preset alone carries', () => {
    const shared = '    - id: tool-fs\n'
    expect(presetDivergences([
      { file: 'a.patch.yml', source: shared },
      { file: 'b.patch.yml', source: shared },
      { file: 'c.patch.yml', source: '    - id: only-here\n' },
    ])).toEqual(new Map())
  })
})

describe('diffDivergences', () => {
  const current = (id: string, hash: string): ReadonlyMap<string, ReadonlyMap<string, string>> =>
    new Map([[id, new Map([['a.patch.yml', hash], ['b.patch.yml', 'other00000']])]])

  it('reports an id the baseline does not record', () => {
    expect(diffDivergences({ rows: {}, rowSets: {} }, current('persona', 'aaaa000000'))).toEqual({
      added: ['persona'],
      changed: [],
      stale: [],
    })
  })

  it('reports a recorded block whose hash changed', () => {
    const baseline = { rows: { persona: { 'a.patch.yml': 'aaaa000000', 'b.patch.yml': 'other00000' } }, rowSets: {} }
    expect(diffDivergences(baseline, current('persona', 'bbbb111111'))).toEqual({
      added: [],
      changed: [{ id: 'persona', detail: 'a.patch.yml changed from aaaa000000 to bbbb111111' }],
      stale: [],
    })
  })

  it('reports a preset that entered or left a recorded row', () => {
    const entered = diffDivergences(
      { rows: { persona: { 'b.patch.yml': 'other00000' } }, rowSets: {} },
      current('persona', 'aaaa000000'),
    )
    expect(entered.changed).toEqual([{ id: 'persona', detail: 'a.patch.yml entered the row with aaaa000000' }])
    const left = diffDivergences(
      { rows: { persona: { 'a.patch.yml': 'aaaa000000', 'b.patch.yml': 'other00000', 'c.patch.yml': 'cccc222222' } }, rowSets: {} },
      current('persona', 'aaaa000000'),
    )
    expect(left.changed).toEqual([{ id: 'persona', detail: 'c.patch.yml left the row' }])
  })

  it('reports a baseline entry that no longer diverges', () => {
    expect(diffDivergences({ rows: { persona: { 'a.patch.yml': 'aaaa000000' } }, rowSets: {} }, new Map())).toEqual({
      added: [],
      changed: [],
      stale: ['persona'],
    })
  })
})

describe('presetRowSetGaps', () => {
  it('reports each preset against the one carrying the most row ids', () => {
    const presets = [
      { file: 'wide.patch.yml', source: '- id: a\n- id: b\n- id: c\n' },
      { file: 'narrow.patch.yml', source: '- id: a\n' },
    ]
    expect(presetRowSetGaps(presets)).toEqual({
      reference: 'wide.patch.yml',
      gaps: new Map([['narrow.patch.yml', ['b', 'c']], ['wide.patch.yml', []]]),
    })
  })
})

describe('diffRowSets', () => {
  const current = { reference: 'wide.patch.yml', gaps: new Map([['narrow.patch.yml', ['b', 'c']]]) }

  it('reports a gap the baseline does not record', () => {
    expect(diffRowSets({ 'narrow.patch.yml': ['b'] }, current))
      .toEqual({ added: [{ file: 'narrow.patch.yml', id: 'c' }], stale: [] })
  })

  it('reports a recorded gap whose row the preset carries again', () => {
    expect(diffRowSets({ 'narrow.patch.yml': ['b', 'c', 'd'] }, current))
      .toEqual({ added: [], stale: [{ file: 'narrow.patch.yml', id: 'd' }] })
  })
})

describe('baseline document', () => {
  it('round-trips with sorted keys', () => {
    const rendered = renderBaseline(
      new Map([
        ['persona', new Map([['b.patch.yml', 'bbbb111111'], ['a.patch.yml', 'aaaa000000']])],
        ['agent-instructions', new Map([['a.patch.yml', 'cccc222222']])],
      ]),
      { reference: 'a.patch.yml', gaps: new Map([['b.patch.yml', ['persona']]]) },
    )
    expect(rendered.indexOf('agent-instructions')).toBeLessThan(rendered.indexOf('persona'))
    expect(rendered.indexOf('a.patch.yml')).toBeLessThan(rendered.indexOf('b.patch.yml'))
    expect(parseBaseline(rendered)).toEqual({
      rows: {
        'agent-instructions': { 'a.patch.yml': 'cccc222222' },
        persona: { 'a.patch.yml': 'aaaa000000', 'b.patch.yml': 'bbbb111111' },
      },
      rowSets: { 'b.patch.yml': ['persona'] },
    })
  })

  it('fails loud on a document missing either record', () => {
    expect(() => parseBaseline('{"nope": 1}')).toThrow(/rows and rowSets records/)
    expect(() => parseBaseline('{"rows": {}}')).toThrow(/rows and rowSets records/)
  })
})

describe('shipped preset divergence baseline', () => {
  it('records every current divergence and nothing else', () => {
    const current = presetDivergences(loadPresets(root))
    expect(current.size).toBeGreaterThan(0)
    const baseline = parseBaseline(readFileSync(resolve(root, BASELINE_PATH), 'utf8'))
    expect(diffDivergences(baseline, current)).toEqual({ added: [], changed: [], stale: [] })
    expect(diffRowSets(baseline.rowSets, presetRowSetGaps(loadPresets(root))))
      .toEqual({ added: [], stale: [] })
  })
})
