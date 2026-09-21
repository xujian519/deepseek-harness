import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  loadPatternCorpus,
  loadPatternStore,
  parsePatternFile,
  patternKeywords,
  PatternStore,
} from '../src/pattern-store.ts'
import { PatternAssetError } from '../src/types.ts'
import { makePattern } from './fixtures/patterns.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Write a corpus of YAML files into a fresh temporary directory. */
async function writeCorpus(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-writing-patterns-'))
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content)
  return root
}

const MINIMAL = [
  'id: p1',
  'name: P1',
  'category: claim_drafting',
  'summary: S1',
  'steps:',
  '  - order: 1',
  '    name: Step',
  '    instruction: Do it',
  '',
].join('\n')

describe('packaged pattern corpus', () => {
  it('loads every shipped seed pattern', () => {
    const store = loadPatternStore()
    expect(store.size).toBe(10)
    expect(store.all().map(pattern => pattern.id)).toEqual([
      'wp-claim-dependent-layering',
      'wp-claim-utility-model',
      'wp-disclosure-pfe',
      'wp-embodiment-writing',
      'wp-ipc-strategy',
      'wp-oa-clarity-support',
      'wp-oa-inventiveness-3step',
      'wp-oa-novelty-separate',
      'wp-spec-background',
      'wp-spec-invention-content',
    ])
  })

  it('parses the authored fields of a seed pattern', () => {
    const pattern = loadPatternStore().get('wp-oa-inventiveness-3step')
    expect(pattern).toMatchObject({
      name: '创造性三步法 OA 答复框架',
      category: 'oa_inventiveness',
      quality: 0.95,
      version: 1,
    })
    expect(pattern?.steps.map(step => step.order)).toEqual([1, 2, 3])
    expect(pattern?.dos).toHaveLength(2)
    expect(pattern?.donts).toHaveLength(3)
    expect(pattern?.context).toContain('专利法第22条第3款')
  })

  it('indexes patterns by category and by sub-category', () => {
    const store = loadPatternStore()
    expect(store.byCategory('oa_inventiveness').map(pattern => pattern.id)).toEqual(['wp-oa-inventiveness-3step'])
    expect(store.byCategory('claim_drafting')).toHaveLength(2)
    expect(store.byCategory('background').map(pattern => pattern.id)).toEqual(['wp-spec-background'])
    expect(store.byCategory('invalidation')).toEqual([])
    expect(store.get('no-such-pattern')).toBeUndefined()
  })

  it('extracts searchable keywords and skips one-character entries', () => {
    const pattern = makePattern({ id: 'p1', name: 'A', dos: [{ rule: '规则' }], donts: [{ rule: '禁' }] })
    expect(patternKeywords(pattern)).toEqual(['claim_drafting', '规则'])
  })
})

describe('lexical search', () => {
  it('scores a term hit in the name above a hit in the summary and keeps the best first', () => {
    const store = loadPatternStore()
    expect(store.search('三步法', { limit: 5 }).map(pattern => pattern.id))
      .toEqual(['wp-oa-inventiveness-3step'])
  })

  it('multiplies the score by the pattern quality', () => {
    // Ids are chosen so that an unweighted tie would sort the low-quality
    // pattern first; only the quality weight can put `b-high` ahead.
    const store = new PatternStore([
      makePattern({ id: 'a-low', name: '共同术语', quality: 0.5 }),
      makePattern({ id: 'b-high', name: '共同术语', quality: 1 }),
    ])
    expect(store.search('共同术语', { limit: 5 }).map(pattern => pattern.id)).toEqual(['b-high', 'a-low'])
  })

  it('breaks an equal score by ascending id', () => {
    const store = new PatternStore([
      makePattern({ id: 'b', name: '共同术语' }),
      makePattern({ id: 'a', name: '共同术语' }),
    ])
    expect(store.search('共同术语', { limit: 5 }).map(pattern => pattern.id)).toEqual(['a', 'b'])
  })

  it('returns the candidates unscored when the query has no term', () => {
    const store = loadPatternStore()
    expect(store.search('', { limit: 3 }).map(pattern => pattern.id)).toEqual([
      'wp-claim-dependent-layering',
      'wp-claim-utility-model',
      'wp-disclosure-pfe',
    ])
    expect(store.search('   ', { category: 'claim_drafting', limit: 5 }).map(pattern => pattern.id)).toEqual([
      'wp-claim-dependent-layering',
      'wp-claim-utility-model',
    ])
  })

  it('restricts the search to a category and caps the result', () => {
    const store = loadPatternStore()
    expect(store.search('权利要求', { limit: 2 })).toHaveLength(2)
    expect(store.search('权利要求', { category: 'oa_novelty', limit: 5 }).map(pattern => pattern.id))
      .toEqual(['wp-oa-novelty-separate'])
    expect(store.search('权利要求', { category: 'disclosure', limit: 5 })).toEqual([])
  })

  it('returns nothing when no term is contained anywhere', () => {
    expect(loadPatternStore().search('zzzz', { limit: 5 })).toEqual([])
  })
})

describe('case-feature match', () => {
  it('scores the case type against the category', () => {
    const store = loadPatternStore()
    const matched = store.match({ caseType: 'oa', limit: 10 })
    expect(matched).toHaveLength(3)
    expect(new Set(matched.map(pattern => pattern.category))).toEqual(
      new Set(['oa_inventiveness', 'oa_novelty', 'oa_clarity']),
    )
  })

  it('scores feature hits in the name, the summary, and step names', () => {
    const store = new PatternStore([
      makePattern({ id: 'a-name', name: '含术语' }),
      makePattern({ id: 'b-summary', summary: '含术语' }),
      makePattern({ id: 'c-step', steps: [{ order: 1, name: '含术语', instruction: 'x' }] }),
      makePattern({ id: 'd-none', name: '不相关', summary: '不相关' }),
    ])
    // A step name is both a feature hit (+1.5) and a keyword of the pattern,
    // whose presence in the query adds 1 more.
    expect(store.match({ features: ['含术语'], limit: 5 }).map(pattern => pattern.id))
      .toEqual(['a-name', 'c-step', 'b-summary'])
  })

  it('adds a keyword point for a pattern keyword contained in the query', () => {
    const withKeyword = makePattern({ id: 'a', name: '共同', dos: [{ rule: '术语' }] })
    const withoutKeyword = makePattern({ id: 'b', summary: '术语' })
    const store = new PatternStore([withKeyword, withoutKeyword])
    // `a` scores 1 for the do-rule keyword contained in the query; `b` scores 2
    // for the summary hit and nothing else.
    expect(store.match({ features: ['术语'], limit: 5 }).map(pattern => pattern.id)).toEqual(['b', 'a'])
  })

  it('scores keywords contained in the query and caps the result', () => {
    const store = loadPatternStore()
    expect(store.match({ caseType: 'oa', features: ['创造性'], limit: 1 }))
      .toHaveLength(1)
    expect(store.match({ caseType: 'oa', features: ['创造性'], limit: 10 })[0]?.id)
      .toBe('wp-oa-inventiveness-3step')
  })

  it('ignores blank features and returns nothing without any signal', () => {
    const store = loadPatternStore()
    expect(store.match({ features: [''], limit: 5 })).toEqual([])
    expect(store.match({ caseType: '  ', limit: 5 })).toEqual([])
    expect(store.match({ limit: 5 })).toEqual([])
  })
})

describe('corpus loading is fail-loud', () => {
  it('reports an unreadable directory', () => {
    expect(() => loadPatternCorpus(join(tmpdir(), 'dsh-writing-patterns-absent')))
      .toThrow(/无法读取写作模式资产目录/)
  })

  it('reports a directory without a pattern file', async () => {
    const dir = await writeCorpus({ 'notes.md': '# not a pattern' })
    expect(() => loadPatternCorpus(dir)).toThrow(/目录下没有 \.yaml 写作模式资产/)
  })

  it('ignores a non-YAML file beside a valid pattern', async () => {
    const dir = await writeCorpus({ 'p1.yaml': MINIMAL, 'README.md': '# corpus' })
    expect(loadPatternCorpus(dir)).toHaveLength(1)
  })

  it('reports a YAML syntax error', async () => {
    const dir = await writeCorpus({ 'p1.yaml': 'id: [unclosed\n' })
    expect(() => loadPatternCorpus(dir)).toThrow(/YAML 解析失败/)
  })

  it('reports a root that is not a mapping', async () => {
    const dir = await writeCorpus({ 'p1.yaml': '- one\n- two\n' })
    expect(() => loadPatternCorpus(dir)).toThrow(/根节点 必须是映射/)
  })

  it('reports a patterns list that is not a list, and an empty one', async () => {
    const scalar = await writeCorpus({ 'p1.yaml': 'patterns: nope\n' })
    expect(() => loadPatternCorpus(scalar)).toThrow(/`patterns` 必须是模式数组/)
    const empty = await writeCorpus({ 'p1.yaml': 'patterns: []\n' })
    expect(() => loadPatternCorpus(empty)).toThrow(/`patterns` 列表为空/)
  })

  it('loads every pattern of a list document', async () => {
    const dir = await writeCorpus({
      'p1.yaml': [
        'patterns:',
        '  - id: a',
        '    name: A',
        '    category: disclosure',
        '    summary: SA',
        '  - id: b',
        '    name: B',
        '    category: embodiment',
        '    summary: SB',
        '',
      ].join('\n'),
    })
    expect(loadPatternCorpus(dir).map(pattern => pattern.id)).toEqual(['a', 'b'])
  })

  it('reports a missing required field, naming its position in the document', async () => {
    const dir = await writeCorpus({ 'p1.yaml': 'name: A\ncategory: disclosure\nsummary: S\n' })
    expect(() => loadPatternCorpus(dir)).toThrow(/根节点\.id 必须是非空字符串/)
  })

  it('reports an unknown category with the known set', async () => {
    const dir = await writeCorpus({ 'p1.yaml': 'id: a\nname: A\ncategory: oa_inventivness\nsummary: S\n' })
    expect(() => loadPatternCorpus(dir)).toThrow(/不是已知类目：oa_inventivness/)
  })

  it('reports a mistyped nested field', async () => {
    const bad = await writeCorpus({ 'p1.yaml': MINIMAL.replace('- order: 1', '- order: zero') })
    expect(() => loadPatternCorpus(bad)).toThrow(/根节点\.steps\[0\]\.order 必须是正整数/)
    const missing = await writeCorpus({ 'p1.yaml': MINIMAL.replace('    instruction: Do it\n', '') })
    expect(() => loadPatternCorpus(missing)).toThrow(/根节点\.steps\[0\]\.instruction 必须是非空字符串/)
  })

  it('reports a sub-category that is not a string', async () => {
    const dir = await writeCorpus({ 'p1.yaml': `${MINIMAL}sub_category: [x]\n` })
    expect(() => loadPatternCorpus(dir)).toThrow(/根节点\.sub_category 必须是字符串/)
  })

  it('reports a duplicated pattern id across files', async () => {
    const dir = await writeCorpus({ 'a.yaml': MINIMAL, 'b.yaml': MINIMAL })
    expect(() => loadPatternCorpus(dir)).toThrow(/模式 id "p1" 与 a\.yaml 重复/)
  })

  it('reports an unreadable asset file', () => {
    expect(() => parsePatternFile(tmpdir())).toThrow(/无法读取写作模式资产/)
  })
})

describe('corpus normalization', () => {
  it('fills the default quality for an absent or zero value', async () => {
    const absent = await writeCorpus({ 'p1.yaml': MINIMAL })
    expect(loadPatternCorpus(absent)[0]?.quality).toBe(0.8)
    const zero = await writeCorpus({ 'p1.yaml': `${MINIMAL}quality: 0\n` })
    expect(loadPatternCorpus(zero)[0]?.quality).toBe(0.8)
  })

  it('rejects a quality outside the unit range', async () => {
    const high = await writeCorpus({ 'p1.yaml': `${MINIMAL}quality: 1.5\n` })
    expect(() => loadPatternCorpus(high)).toThrow(/quality 必须在 0 与 1 之间：1\.5/)
    const negative = await writeCorpus({ 'p1.yaml': `${MINIMAL}quality: -0.5\n` })
    expect(() => loadPatternCorpus(negative)).toThrow(/quality 必须在 0 与 1 之间：-0\.5/)
    const textual = await writeCorpus({ 'p1.yaml': `${MINIMAL}quality: high\n` })
    expect(() => loadPatternCorpus(textual)).toThrow(/quality 必须是数字/)
  })

  it('rejects a version that is not a positive integer', async () => {
    const dir = await writeCorpus({ 'p1.yaml': `${MINIMAL}version: 0\n` })
    expect(() => loadPatternCorpus(dir)).toThrow(/version 必须是正整数/)
  })

  it('treats an empty optional string as absent and keeps a filled one', async () => {
    const dir = await writeCorpus({
      'a.yaml': `${MINIMAL}context: ''\nsub_category: ''\nsource_ref: ''\n`,
      'b.yaml': 'id: p2\nname: P2\ncategory: spec_drafting\nsummary: S2\nsub_category: background\nsource_ref: 指南\n',
    })
    const patterns = loadPatternCorpus(dir)
    expect(patterns[0]).not.toHaveProperty('context')
    expect(patterns[0]).not.toHaveProperty('subCategory')
    expect(patterns[0]).not.toHaveProperty('sourceRef')
    expect(patterns[1]).toMatchObject({ subCategory: 'background', sourceRef: '指南' })
  })

  it('reports the asset path and keeps the error type', async () => {
    const dir = await writeCorpus({ 'p1.yaml': 'patterns: nope\n' })
    try {
      loadPatternCorpus(dir)
      throw new Error('expected the load to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(PatternAssetError)
      expect((error as PatternAssetError).source).toBe(join(dir, 'p1.yaml'))
      expect((error as PatternAssetError).name).toBe('PatternAssetError')
    }
  })
})
