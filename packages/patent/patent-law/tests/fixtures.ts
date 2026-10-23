/**
 * Shared test fixtures for patent-law tests.
 *
 * Provides reusable baseline objects (articles, sections, statute, guideline)
 * to avoid duplication across citator.spec.ts, rule-lock.spec.ts, etc.
 */

import type { ArticleEntry, LawBaseline, LawName, SectionEntry } from '../src/types.ts'

export const VERIFIED_ARTICLE_22: ArticleEntry = {
  article: 22,
  paragraphs: [1, 2, 3],
  topics: ['新颖性', '创造性'],
  text: '授予专利权的发明，应当具备新颖性、创造性和实用性。',
  sourceDoc: '主席令第五十五号',
  verifiedOn: '2026-01-01',
}

export const UNVERIFIED_ARTICLE_5: ArticleEntry = {
  article: 5,
  topics: ['期限'],
  text: null,
  sourceDoc: null,
  verifiedOn: null,
}

export const VERIFIED_SECTION: SectionEntry = {
  path: '第二部分第四章3.2',
  topics: ['创造性', '三步法'],
  text: '三步法：确定最接近的现有技术→确定区别特征→判断是否显而易见。',
  sourceDoc: '审查指南 2023',
  verifiedOn: '2026-01-01',
}

export const STALE_SECTION: SectionEntry = {
  path: '第二部分第四章3.2.1.1',
  topics: ['技术启示'],
  text: '旧版正文',
  sourceDoc: '审查指南 2010',
  verifiedOn: '2020-01-01',
}

export const UNVERIFIED_SECTION: SectionEntry = {
  path: '第五部分第七章2.1',
  topics: ['期限'],
  text: null,
  sourceDoc: null,
  verifiedOn: null,
}

/** A statute baseline with a verified article ceiling. */
export function statuteBaseline(overrides: Partial<LawBaseline> = {}): LawBaseline {
  return {
    law: '专利法',
    document: '中华人民共和国专利法',
    revision: null,
    supersededBy: null,
    staleSections: [],
    versions: [],
    maxArticle: 82,
    maxVerifiedOn: '2026-01-01',
    maxSource: 'fixture',
    articles: [VERIFIED_ARTICLE_22, UNVERIFIED_ARTICLE_5],
    sections: [],
    ...overrides,
  }
}

/** The guideline baseline with a stale section and a version override. */
export function guidelineBaseline(overrides: Partial<LawBaseline> = {}): LawBaseline {
  return {
    law: '专利审查指南',
    document: '专利审查指南',
    revision: null,
    supersededBy: null,
    staleSections: [{ path: '第二部分第四章3.2.1.1', reason: '2023 年修订版已修改该节' }],
    versions: [],
    maxArticle: null,
    maxVerifiedOn: null,
    maxSource: null,
    articles: [],
    sections: [VERIFIED_SECTION, STALE_SECTION, UNVERIFIED_SECTION],
    ...overrides,
  }
}

/** The full index under test. */
export function testBaselines(): Map<LawName, LawBaseline> {
  return new Map<LawName, LawBaseline>([
    ['专利法', statuteBaseline()],
    ['专利法实施细则', statuteBaseline({
      law: '专利法实施细则',
      maxArticle: null,
      maxVerifiedOn: null,
      articles: [UNVERIFIED_ARTICLE_5],
    })],
    ['专利审查指南', guidelineBaseline()],
  ])
}
