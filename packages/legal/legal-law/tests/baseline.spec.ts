import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findLegalArticle,
  LegalLawBaselineError,
  legalLawNames,
  loadLegalLawBaselines,
  loadLegalLawBaselinesAsync,
  parseLegalLawBaseline,
} from '../src/baseline.ts'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Create a temporary directory holding the given files. */
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'legal-law-'))
  tempDirs.push(dir)
  for (const [fileName, content] of Object.entries(files)) writeFileSync(join(dir, fileName), content)
  return dir
}

const CIVIL_CODE = [
  'law: 民法典',
  'document: 中华人民共和国民法典',
  'revision: null',
  'maxArticle: 1260',
  'maxVerifiedOn: 2026-10-23',
  'articles:',
  '  - article: 143',
  '    topics: [民事法律行为, 有效条件]',
  '    text: 具备下列条件的民事法律行为有效：（一）行为人具有相应的民事行为能力；',
  '    sourceDoc: 官方全文',
  '    verifiedOn: 2026-10-23',
  '  - article: 577',
  '    topics: [违约责任]',
  '    text: null',
  '    sourceDoc: null',
  '    verifiedOn: null',
].join('\n')

/** Parse a fixture expected to fail, returning the error for assertions. */
function parseFailing(source: string): LegalLawBaselineError {
  try {
    parseLegalLawBaseline(source, 'fixture.yaml')
  } catch (error) {
    if (error instanceof LegalLawBaselineError) return error
    throw error
  }
  throw new Error('expected the parse to fail')
}

describe('parseLegalLawBaseline', () => {
  it('parses a valid index and sorts articles by number', () => {
    const baseline = parseLegalLawBaseline([
      'law: 民法典',
      'document: 中华人民共和国民法典',
      'revision: 2020 年通过',
      'maxArticle: 1260',
      'maxVerifiedOn: 2026-10-23',
      'maxSource: fixture',
      'articles:',
      '  - article: 577',
      '    topics: [违约责任]',
      '    text: null',
      '    sourceDoc: null',
      '    verifiedOn: null',
      '  - article: 143',
      '    topics: [民事法律行为]',
      '    paragraphs: [1, 2]',
      '    text: 条文内容',
      '    sourceDoc: 官方全文',
      '    verifiedOn: 2026-10-23',
    ].join('\n'), 'test.yaml')

    expect(baseline.law).toBe('民法典')
    expect(baseline.document).toBe('中华人民共和国民法典')
    expect(baseline.revision).toBe('2020 年通过')
    expect(baseline.maxArticle).toBe(1260)
    expect(baseline.articles).toHaveLength(2)
    expect(baseline.articles[0]!.article).toBe(143)
    expect(baseline.articles[1]!.article).toBe(577)
    expect(baseline.articles[0]!.paragraphs).toEqual([1, 2])
  })

  it('accepts any non-empty law name (dynamic expansion)', () => {
    // LegalLawName is now `string` to support dynamic expansion; any non-empty name is accepted
    const baseline = parseLegalLawBaseline([
      'law: 刑法',
      'document: 中华人民共和国刑法',
      'articles:',
      '  - article: 1',
      '    topics: [test]',
    ].join('\n'), 'test.yaml')
    expect(baseline.law).toBe('刑法')
  })

  it('rejects an empty law name', () => {
    const error = parseFailing([
      'law: ""',
      'document: 空名称法律',
      'articles:',
      '  - article: 1',
      '    topics: [test]',
    ].join('\n'))
    expect(error).toBeInstanceOf(LegalLawBaselineError)
  })

  it('rejects a file with no articles', () => {
    const error = parseFailing([
      'law: 民法典',
      'document: 中华人民共和国民法典',
      'articles: []',
    ].join('\n'))
    expect(error.message).toContain('至少一个 article')
  })

  it('rejects duplicate article numbers', () => {
    const error = parseFailing([
      'law: 民法典',
      'document: 中华人民共和国民法典',
      'articles:',
      '  - article: 1',
      '    topics: [test]',
      '    text: null',
      '    sourceDoc: null',
      '    verifiedOn: null',
      '  - article: 1',
      '    topics: [test2]',
      '    text: null',
      '    sourceDoc: null',
      '    verifiedOn: null',
    ].join('\n'))
    expect(error.message).toContain('重复')
  })

  it('rejects text without sourceDoc or verifiedOn', () => {
    const error = parseFailing([
      'law: 民法典',
      'document: 中华人民共和国民法典',
      'articles:',
      '  - article: 1',
      '    topics: [test]',
      '    text: 条文',
      '    sourceDoc: null',
      '    verifiedOn: null',
    ].join('\n'))
    expect(error.message).toContain('sourceDoc')
  })
})

describe('loadLegalLawBaselines', () => {
  it('loads every YAML file in a directory', () => {
    const dir = fixtureDir({
      'civil-code.yaml': CIVIL_CODE,
      'civil-procedure-law.yaml': CIVIL_CODE.replace('law: 民法典', 'law: 民事诉讼法').replace('document: 中华人民共和国民法典', 'document: 中华人民共和国民事诉讼法'),
    })
    const baselines = loadLegalLawBaselines(dir)
    expect(baselines.size).toBe(2)
    expect(baselines.has('民法典')).toBe(true)
    expect(baselines.has('民事诉讼法')).toBe(true)
  })

  it('rejects duplicate law names across files', () => {
    const dir = fixtureDir({
      'a.yaml': CIVIL_CODE,
      'b.yaml': CIVIL_CODE,
    })
    expect(() => loadLegalLawBaselines(dir)).toThrow(LegalLawBaselineError)
  })

  it('fails on an empty directory', () => {
    const dir = fixtureDir({})
    expect(() => loadLegalLawBaselines(dir)).toThrow(LegalLawBaselineError)
  })

  it('loads the same index asynchronously', async () => {
    const dir = fixtureDir({
      'civil-code.yaml': CIVIL_CODE,
      'civil-procedure-law.yaml': CIVIL_CODE.replace('law: 民法典', 'law: 民事诉讼法').replace('document: 中华人民共和国民法典', 'document: 中华人民共和国民事诉讼法'),
    })
    const baselines = await loadLegalLawBaselinesAsync(dir)
    expect(baselines.size).toBe(2)
    expect(baselines.has('民事诉讼法')).toBe(true)
  })

  it('rejects duplicate law names while loading asynchronously', async () => {
    const dir = fixtureDir({ 'a.yaml': CIVIL_CODE, 'b.yaml': CIVIL_CODE })
    await expect(loadLegalLawBaselinesAsync(dir)).rejects.toThrow(LegalLawBaselineError)
  })

  it('reports the names added by a load', async () => {
    const dir = fixtureDir({
      'accounting.yaml': CIVIL_CODE
        .replace('law: 民法典', 'law: 会计法')
        .replace('document: 中华人民共和国民法典', 'document: 中华人民共和国会计法'),
    })
    await loadLegalLawBaselinesAsync(dir)
    expect(legalLawNames()).toContain('会计法')
    expect(Object.isFrozen(legalLawNames())).toBe(true)
  })

  // Loading 7,900+ YAML files takes minutes under coverage instrumentation.
  it('loads the packaged index without errors', () => {
    // Loading 7900+ YAML files takes time
    const baselines = loadLegalLawBaselines()
    expect(baselines.size).toBeGreaterThanOrEqual(4)
    expect(baselines.has('民法典')).toBe(true)
    expect(baselines.has('民事诉讼法')).toBe(true)
    expect(baselines.has('劳动合同法')).toBe(true)
    expect(baselines.has('公司法')).toBe(true)
  }, 180_000)
})

describe('findLegalArticle', () => {
  it('returns the entry when the article exists', () => {
    const baseline = parseLegalLawBaseline(CIVIL_CODE, 'test.yaml')
    const entry = findLegalArticle(baseline, 143)
    expect(entry).toBeDefined()
    expect(entry!.article).toBe(143)
    expect(entry!.topics).toContain('民事法律行为')
  })

  it('returns undefined for an unindexed article', () => {
    const baseline = parseLegalLawBaseline(CIVIL_CODE, 'test.yaml')
    expect(findLegalArticle(baseline, 999)).toBeUndefined()
  })
})
