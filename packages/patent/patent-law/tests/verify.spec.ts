import { describe, expect, it } from 'vitest'
import { loadLawBaselines } from '../src/baseline.ts'
import {
  DEFAULT_CITATION_POLICY,
  renderCitationFindings,
  renderCitationRows,
  resolveCitationPolicy,
  verifyCitation,
  verifyCitations,
} from '../src/verify.ts'
import type { ArticleEntry, CitationPolicySet, LawBaseline, LawName, LawReference, SectionEntry } from '../src/types.ts'

const VERIFIED_ARTICLE: ArticleEntry = {
  article: 22,
  paragraphs: [1, 2, 3],
  topics: ['新颖性', '创造性'],
  text: '现行条文',
  sourceDoc: '主席令第五十五号',
  verifiedOn: '2026-01-01',
}

const UNVERIFIED_ARTICLE: ArticleEntry = {
  article: 5,
  topics: ['期限'],
  text: null,
  sourceDoc: null,
  verifiedOn: null,
}

const VERIFIED_SECTION: SectionEntry = {
  path: '第二部分第四章3.2',
  topics: ['创造性', '三步法'],
  text: '指南正文',
  sourceDoc: '审查指南 2023',
  verifiedOn: '2026-01-01',
}

const UNVERIFIED_SECTION: SectionEntry = {
  path: '第五部分第七章2.1',
  topics: ['期限'],
  text: null,
  sourceDoc: null,
  verifiedOn: null,
}

/** A statute with a verified ceiling and one verified plus one unverified article. */
function statute(overrides: Partial<LawBaseline> = {}): LawBaseline {
  return {
    law: '专利法',
    document: '中华人民共和国专利法',
    revision: null,
    maxArticle: 82,
    maxVerifiedOn: '2026-01-01',
    maxSource: 'fixture',
    articles: [VERIFIED_ARTICLE, UNVERIFIED_ARTICLE],
    sections: [],
    ...overrides,
  }
}

/** The index under test: a verified ceiling, an unverified ceiling, and the guideline. */
function baselines(): Map<LawName, LawBaseline> {
  return new Map<LawName, LawBaseline>([
    ['专利法', statute()],
    ['专利法实施细则', statute({
      law: '专利法实施细则',
      maxArticle: null,
      maxVerifiedOn: null,
      articles: [UNVERIFIED_ARTICLE],
    })],
    ['专利审查指南', {
      law: '专利审查指南',
      document: '专利审查指南',
      revision: null,
      maxArticle: null,
      maxVerifiedOn: null,
      maxSource: null,
      articles: [],
      sections: [VERIFIED_SECTION, UNVERIFIED_SECTION],
    }],
  ])
}

/** The verified article with its paragraph list removed. */
function withoutParagraphs(entry: ArticleEntry): ArticleEntry {
  const copy: ArticleEntry = { ...entry }
  delete copy.paragraphs
  return copy
}

/** Build a statute reference for the fixtures. */
function articleRef(article: number, paragraph?: number, law: '专利法' | '专利法实施细则' = '专利法'): LawReference {
  return {
    kind: 'law-article',
    law,
    article,
    ...(paragraph === undefined ? {} : { paragraph }),
    raw: `${law}第${article}条`,
  }
}

/** Build a guideline reference for the fixtures. */
function sectionRef(path: string): LawReference {
  return { kind: 'guideline-section', law: '专利审查指南', path, raw: `审查指南${path}` }
}

describe('verifyCitation on statutes', () => {
  it('passes an article whose text is verified', () => {
    const finding = verifyCitation(articleRef(22), baselines())
    expect(finding.decision).toBe('valid')
    expect(finding.reason).toContain('主席令第五十五号')
  })

  it('passes a proposition the verified article supports and reports one it does not', () => {
    expect(verifyCitation(articleRef(22), baselines(), { proposition: '不具备创造性' }).decision).toBe('valid')
    const mismatch = verifyCitation(articleRef(22), baselines(), { proposition: '说明书充分公开' })
    expect(mismatch.decision).toBe('mismatch')
    expect(mismatch.reason).toContain('新颖性')
  })

  it('reports a cited paragraph the verified article does not have', () => {
    const finding = verifyCitation(articleRef(22, 9), baselines())
    expect(finding.decision).toBe('mismatch')
    expect(finding.reason).toContain('共 3 款')
  })

  it('skips the paragraph check when the entry does not list its paragraphs', () => {
    const index = new Map<LawName, LawBaseline>([['专利法', statute({
      articles: [withoutParagraphs(VERIFIED_ARTICLE)],
    })]])
    expect(verifyCitation(articleRef(22, 9), index).decision).toBe('valid')
  })

  it('reports an indexed article whose text has not been transcribed', () => {
    const finding = verifyCitation(articleRef(5, undefined, '专利法实施细则'), baselines())
    expect(finding.decision).toBe('unverified')
    expect(finding.reason).toContain('尚未转录核验')
  })

  it('reports an article beyond a verified ceiling as out of range', () => {
    const finding = verifyCitation(articleRef(99), baselines())
    expect(finding.decision).toBe('out-of-range')
    expect(finding.reason).toContain('共 82 条')
  })

  it('only reports an unverified ceiling as unverified, never as out of range', () => {
    const index = new Map<LawName, LawBaseline>([['专利法', statute({ maxVerifiedOn: null })]])
    const finding = verifyCitation(articleRef(99), index)
    expect(finding.decision).toBe('unverified')
    expect(finding.reason).toContain('该上限本身尚未核验')
  })

  it('reports an article the index does not hold', () => {
    expect(verifyCitation(articleRef(78), baselines()).decision).toBe('not-indexed')
  })

  it('reports a law this deployment does not index', () => {
    const finding = verifyCitation(articleRef(22), new Map<LawName, LawBaseline>())
    expect(finding.decision).toBe('not-indexed')
    expect(finding.reason).toContain('没有随包索引')
  })
})

describe('verifyCitation on guideline sections', () => {
  it('passes a verified section and reports a mismatching proposition', () => {
    expect(verifyCitation(sectionRef('第二部分第四章3.2'), baselines()).decision).toBe('valid')
    const mismatch = verifyCitation(sectionRef('第二部分第四章3.2'), baselines(), { proposition: '外观设计相同判断' })
    expect(mismatch.decision).toBe('mismatch')
  })

  it('reports an indexed section whose content has not been transcribed', () => {
    const finding = verifyCitation(sectionRef('第五部分第七章2.1'), baselines())
    expect(finding.decision).toBe('unverified')
    expect(finding.reason).toContain('尚未转录核验')
  })

  it('reports a section the index does not hold', () => {
    expect(verifyCitation(sectionRef('第九部分第九章9.9'), baselines()).decision).toBe('not-indexed')
  })
})

describe('verifyCitations', () => {
  it('decides every reference in a text, in order', () => {
    const findings = verifyCitations('依据专利法第22条第3款与专利法第99条。', baselines())
    expect(findings.map(finding => finding.decision)).toEqual(['valid', 'out-of-range'])
  })

  it('returns nothing for text without a reference', () => {
    expect(verifyCitations('本案未引用条文。', baselines())).toEqual([])
  })
})

describe('resolveCitationPolicy', () => {
  const policies: CitationPolicySet = {
    mismatch: 'warn',
    outOfRange: 'block',
    notIndexed: 'allow',
    unverified: 'warn',
  }
  const reference = articleRef(22)

  it('maps each decision to its policy and always allows a valid citation', () => {
    expect(resolveCitationPolicy({ raw: 'r', reference, decision: 'valid', reason: '' }, policies)).toBe('allow')
    expect(resolveCitationPolicy({ raw: 'r', reference, decision: 'mismatch', reason: '' }, policies)).toBe('warn')
    expect(resolveCitationPolicy({ raw: 'r', reference, decision: 'out-of-range', reason: '' }, policies)).toBe('block')
    expect(resolveCitationPolicy({ raw: 'r', reference, decision: 'not-indexed', reason: '' }, policies)).toBe('allow')
    expect(resolveCitationPolicy({ raw: 'r', reference, decision: 'unverified', reason: '' }, policies)).toBe('warn')
  })

  it('blocks a mismatch or an out-of-range citation by default', () => {
    expect(DEFAULT_CITATION_POLICY).toEqual({
      mismatch: 'block',
      outOfRange: 'block',
      notIndexed: 'warn',
      unverified: 'warn',
    })
  })
})

describe('rendering', () => {
  it('renders each finding with the law reference and its treatment', () => {
    const report = renderCitationFindings(verifyCitations('依据专利法第22条第3款。', baselines()), DEFAULT_CITATION_POLICY)
    expect(report).toContain('| 《专利法》第二十二条第三款 | 已核验 | 放行 |')
    expect(report.split('\n')).toHaveLength(3)
  })

  it('renders a blocked citation with the written form of its reference', () => {
    const report = renderCitationFindings(verifyCitations('依据专利法第99条。', baselines()), DEFAULT_CITATION_POLICY)
    expect(report).toContain('| 《专利法》第九十九条 | 条号超出有效范围 | 拦截 |')
  })

  it('states that no citation was found instead of reporting success', () => {
    expect(renderCitationRows([])).toContain('未在文本中识别到法条引用')
  })
})

describe('entries without a recorded source', () => {
  /** A verified article and section that carry no source document. */
  const withoutSource = new Map<LawName, LawBaseline>([
    ['专利法', statute({
      articles: [{ ...VERIFIED_ARTICLE, sourceDoc: null }],
    })],
    ['专利审查指南', {
      law: '专利审查指南',
      document: '专利审查指南',
      revision: null,
      maxArticle: null,
      maxVerifiedOn: null,
      maxSource: null,
      articles: [],
      sections: [{ ...VERIFIED_SECTION, sourceDoc: null }],
    }],
  ])

  it('reports the missing source instead of an empty one', () => {
    expect(verifyCitation(articleRef(22), withoutSource).reason).toContain('未标注')
    expect(verifyCitation(sectionRef('第二部分第四章3.2'), withoutSource).reason).toContain('未标注')
  })
})

describe('proposition reporting', () => {
  it('truncates a long proposition in the reason', () => {
    const proposition = '区别技术特征'.repeat(10)
    const finding = verifyCitation(articleRef(22), baselines(), { proposition })
    expect(finding.decision).toBe('mismatch')
    expect(finding.reason).toContain('…')
  })
})

describe('the packaged index', () => {
  it('decides a shipped statute citation against its transcribed text', () => {
    const shipped = loadLawBaselines()
    expect(verifyCitation(articleRef(22), shipped).decision).toBe('valid')
    expect(verifyCitation(articleRef(22, undefined, '专利法实施细则'), shipped).decision).toBe('valid')
    // A verified article ceiling turns a fabricated number into a blocked
    // decision instead of a report that nothing here can say.
    expect(verifyCitation(articleRef(99), shipped).decision).toBe('out-of-range')
    // An article that exists but is not indexed is a gap in the index, not a
    // claim that the number does not exist.
    expect(verifyCitation(articleRef(50), shipped).decision).toBe('not-indexed')
  })

  it('decides a proposition against the article the index attaches those topics to', () => {
    const shipped = loadLawBaselines()
    const cases = [
      // 实施细则第 42 条 holds the recusal rule; 分案申请 is 第 48 条.
      [42, '初步审查、实质审查、复审和无效宣告程序中审查人员应当回避', 'valid'],
      [42, '分案申请应当在原申请的基础上提出', 'mismatch'],
      // 第 62 条 holds the patentability-evaluation report; 复审请求 is 第 65 条.
      [62, '专利权评价报告请求书应当写明专利申请号或者专利号', 'valid'],
      [62, '复审请求书应当说明理由', 'mismatch'],
      // 第 114 条 holds the registration fee; 印花税 is not a fee the schedule charges.
      [114, '办理登记手续时应当缴纳授予专利权当年的年费', 'valid'],
    ] as const
    for (const [article, proposition, decision] of cases) {
      expect(verifyCitation(articleRef(article, undefined, '专利法实施细则'), shipped, { proposition }).decision)
        .toBe(decision)
    }
  })

  it('leaves the guideline index awaiting transcription', () => {
    const shipped = loadLawBaselines()
    const sections = shipped.get('专利审查指南')?.sections ?? []
    expect(sections.length).toBeGreaterThan(0)
    expect(sections.every(section => section.text === null && section.verifiedOn === null)).toBe(true)
    expect(verifyCitation(sectionRef('第二部分第四章3.2.1.1'), shipped).decision).toBe('unverified')
  })

  it('holds the sections the 2023 revision numbers rather than the repository\u2019s earlier labels', () => {
    const shipped = loadLawBaselines()
    // 2023 指南把「技术领域」放在 2.2.2（2.2.1 是名称），第九章第 2 节写作「2」而不是
    // 「2.0」，第一部分第一章第 2 节没有子节。
    expect(verifyCitation(sectionRef('第二部分第二章2.2.2'), shipped).decision).toBe('unverified')
    expect(verifyCitation(sectionRef('第二部分第九章2'), shipped).decision).toBe('unverified')
    expect(verifyCitation(sectionRef('第二部分第二章2.2.1'), shipped).decision).toBe('not-indexed')
    expect(verifyCitation(sectionRef('第二部分第九章2.0'), shipped).decision).toBe('not-indexed')
    expect(verifyCitation(sectionRef('第一部分第一章2.3'), shipped).decision).toBe('not-indexed')
  })

  it('attaches each guideline topic list to the section it indexes', () => {
    const shipped = loadLawBaselines()
    const topics = (path: string): string[] | undefined =>
      shipped.get('专利审查指南')?.sections.find(section => section.path === path)?.topics
    // 这些行原先挂的是别节的标签：2.3 是说明书附图而不是说明书撰写要求，
    // 2.1 是现有技术而不是章名，4.1 是审查的文本而不是答复。
    expect(topics('第二部分第二章2.3')).toEqual(['附图', '附图标记'])
    expect(topics('第二部分第三章2.1')).toEqual(['现有技术'])
    expect(topics('第二部分第八章4.1')).toEqual(['审查文本', '主动修改'])
    expect(topics('第四部分第三章4.4')).toEqual(['无效宣告', '审查方式'])
    expect(topics('第五部分第七章2.1')).toEqual(['期限', '起算日'])
  })
})
