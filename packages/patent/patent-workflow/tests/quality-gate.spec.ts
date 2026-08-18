import { describe, expect, it } from 'vitest'
import {
  PATENT_APPROVAL_KEYWORDS,
  PATENT_DISCLAIMER,
  PATENT_RISK_KEYWORDS,
  formatCitationWarnings,
  processPatentOutput,
  verifyCitations,
  type CitationReport,
  type CitationSource,
} from '@deepseek-ai/dsh-patent-workflow'

function counts(report: CitationReport): Record<string, number> {
  return {
    total: report.total,
    valid: report.valid,
    unknown: report.unknown,
    unverifiable: report.unverifiable,
    suspect: report.suspect,
    invalid: report.invalid,
  }
}

describe('verifyCitations — R1 existence gate', () => {
  it('marks an article beyond the statute maximum as invalid', () => {
    const report = verifyCitations('根据专利法第九十九条规定处理。')
    expect(counts(report)).toMatchObject({ total: 1, invalid: 1 })
    expect(report.flagged[0]).toMatchObject({ raw: '专利法第九十九条', statute: '专利法', article: 99, verdict: 'invalid' })
    expect(report.flagged[0]!.reason).toContain('共 82 条')
  })

  it('an implementation-detail statute without a maximum skips R1 (unknown topic)', () => {
    const report = verifyCitations('根据专利法实施细则第一百条的规定。')
    expect(counts(report)).toMatchObject({ total: 1, unknown: 1 })
  })

  it('an unknown article in the table is admitted as unknown (放行)', () => {
    const report = verifyCitations('专利法第四条')
    expect(counts(report)).toMatchObject({ total: 1, unknown: 1 })
  })

  it('respects an injected source maximum', () => {
    const source: CitationSource = {
      maxArticle: () => 50,
      topics: () => undefined,
    }
    const report = verifyCitations('根据专利法第六十条处理。', source)
    expect(counts(report)).toMatchObject({ total: 1, invalid: 1 })
  })

  it('falls back to the default table when the source leaves lookups open', () => {
    const source: CitationSource = {
      maxArticle: () => undefined,
      topics: () => undefined,
    }
    const report = verifyCitations('根据专利法第九十九条处理。', source)
    expect(counts(report)).toMatchObject({ total: 1, invalid: 1 })
  })
})

describe('verifyCitations — R2 context relevance', () => {
  it('a purpose mentioning the statute topic is valid', () => {
    const report = verifyCitations('根据专利法第二十二条，本方案具备新颖性。')
    expect(counts(report)).toMatchObject({ total: 1, valid: 1 })
    expect(report.flagged).toEqual([])
  })

  it('a purpose matching a foreign article is suspect (cross match)', () => {
    const report = verifyCitations('根据专利法第二十二条，涉及遗传资源的发明创造不属于授权客体。')
    expect(counts(report)).toMatchObject({ total: 1, suspect: 1 })
    expect(report.flagged[0]!.verdict).toBe('suspect')
    expect(report.flagged[0]!.reason).toContain('遗传资源')
  })

  it('an invalidation-ground article ignores the 无效宣告 keyword in cross matching', () => {
    // 22 ∈ INVALIDATION_GROUNDS：无效宣告 不再作为张冠李戴证据，最终宽松转述放行。
    const report = verifyCitations('根据专利法第二十二条，适用无效宣告。')
    expect(counts(report)).toMatchObject({ total: 1, unverifiable: 1 })
  })

  it('a non-invalidation article still flags 无效宣告 as cross matching', () => {
    const report = verifyCitations('根据专利法第十一条，无效宣告程序中的行为应当受到严格的审查与规范管理。')
    expect(counts(report)).toMatchObject({ total: 1, suspect: 1 })
    expect(report.flagged[0]!.reason).toContain('无效宣告')
  })

  it('a long purpose display is truncated in the suspect reason', () => {
    const report = verifyCitations('根据专利法第二十二条，关于遗传资源相关的发明创造是否能够获得授权应当审慎评估。')
    expect(report.flagged[0]!.reason).toContain('…')
  })

  it('a checkable purpose matching nothing stays unverifiable (宽松转述放行)', () => {
    const report = verifyCitations('根据专利法第二十二条，本案情况特殊。')
    expect(counts(report)).toMatchObject({ total: 1, unverifiable: 1 })
  })

  it('a citation without any purpose declaration is unverifiable (放行)', () => {
    const report = verifyCitations('专利法第二十二条')
    expect(counts(report)).toMatchObject({ total: 1, unverifiable: 1 })
  })
})

describe('verifyCitations — citation scanning mechanics', () => {
  it('an enumeration continuation makes the purpose belong to the list, not this citation', () => {
    const report = verifyCitations('专利法第二十二条、第二十三条规定了新颖性与创造性的条件。')
    // 第22条 被枚举判定跳过；第23条 主题表未覆盖 → unknown。
    expect(counts(report)).toMatchObject({ total: 2, unknown: 1 })
    expect(report.unverifiable).toBeGreaterThanOrEqual(1)
  })

  it('every occurrence of the raw citation is scanned before the first checkable purpose wins', () => {
    const report = verifyCitations('根据专利法第二十二条具备新颖性。专利法第二十二条再次出现。')
    expect(counts(report)).toMatchObject({ total: 1, valid: 1 })
  })

  it('a connector-only purpose is empty and skipped', () => {
    const report = verifyCitations('专利法第二十二条规定')
    expect(counts(report)).toMatchObject({ total: 1, unverifiable: 1 })
  })

  it('an unparseable article number is skipped', () => {
    const report = verifyCitations('根据专利法第d条处理。')
    expect(counts(report)).toMatchObject({ total: 0 })
  })

  it('duplicate raw citations are counted once', () => {
    const report = verifyCitations('专利法第二十二条。专利法第二十二条。')
    expect(counts(report)).toMatchObject({ total: 1, unverifiable: 1 })
  })

  it('an implementation-detail citation with a matching purpose is valid', () => {
    const report = verifyCitations('根据专利法实施细则第四十二条提出分案申请。')
    expect(counts(report)).toMatchObject({ total: 1, valid: 1 })
  })

  it('a citation introduced by an enumeration connector inherits the loose purpose', () => {
    const report = verifyCitations('根据专利法第二十二条和实施细则第四十二条处理。')
    expect(report.total).toBe(2)
    expect(report.valid).toBe(0)
  })

  it('a bare citation resolves its statute from the preceding sentence window', () => {
    const report = verifyCitations('先有实施细则，再看按第四十二条办理分案申请。')
    expect(counts(report)).toMatchObject({ total: 1, valid: 1 })
  })
})

describe('formatCitationWarnings', () => {
  it('renders a markdown warning block for flagged citations', () => {
    const report = verifyCitations('根据专利法第九十九条处理。')
    const warnings = formatCitationWarnings(report)
    expect(warnings).toContain('⚠️ 引用核验提示')
    expect(warnings).toContain('- 「专利法第九十九条」：')
  })

  it('returns an empty string when nothing is flagged', () => {
    const report = verifyCitations('根据专利法第二十二条，本方案具备新颖性。')
    expect(formatCitationWarnings(report)).toBe('')
  })
})

describe('processPatentOutput — absolute phrases and citation gate wiring', () => {
  it('flags absolute phrasing and appends the mitigation hint', () => {
    const info = processPatentOutput('本方案绝对可行，必然成功。')
    expect(info.absolutePhrasesHit).toEqual(['绝对', '必然'])
    expect(info.text).toContain('绝对化表述')
    expect(info.text).toContain('限定性表述')
  })

  it('a negated absolute phrase is not reported', () => {
    const info = processPatentOutput('本方案不构成绝对的保证。')
    expect(info.absolutePhrasesHit).toEqual([])
  })

  it('appends the citation warning block when a citation is flagged', () => {
    const info = processPatentOutput('根据专利法第九十九条处理。')
    expect(info.citationReport.invalid).toBe(1)
    expect(info.text).toContain('引用核验提示')
  })

  it('enableCitationGate: false skips citation verification entirely', () => {
    const info = processPatentOutput('根据专利法第九十九条处理。', { enableCitationGate: false })
    expect(info.citationReport.total).toBe(0)
    expect(info.citationReport.flagged).toEqual([])
    expect(info.text).not.toContain('引用核验提示')
  })

  it('a text already carrying the disclaimer is not double-injected', () => {
    const info = processPatentOutput('本分析不构成正式法律意见。存在侵权风险需评估。')
    expect(info.riskKeywordsHit).toContain('侵权')
    expect(info.disclaimerInjected).toBe(false)
    expect((info.text.match(/不构成正式法律意见/g) ?? []).length).toBe(1)
  })

  it('custom keywords and disclaimer are honored', () => {
    const info = processPatentOutput('命中自定义词', {
      riskKeywords: ['自定义词'],
      disclaimer: '自定义免责声明',
    })
    expect(info.riskKeywordsHit).toEqual(['自定义词'])
    expect(info.text).toContain('自定义免责声明')
  })

  it('custom approval keywords drive needsApproval', () => {
    const info = processPatentOutput('需要审批的结论', { approvalKeywords: ['需要审批'] })
    expect(info.approvalKeywordsHit).toEqual(['需要审批'])
    expect(info.needsApproval).toBe(true)
  })

  it('default keyword tables are exported for consumers', () => {
    expect(PATENT_RISK_KEYWORDS).toContain('侵权')
    expect(PATENT_APPROVAL_KEYWORDS).toContain('最终建议')
    expect(PATENT_DISCLAIMER).toContain('不构成正式法律意见')
  })
})
