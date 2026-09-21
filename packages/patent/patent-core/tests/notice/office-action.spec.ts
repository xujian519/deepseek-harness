import { describe, expect, it } from 'vitest'
import {
  REJECTION_ORDER,
  REJECTION_PATTERNS,
  detectRejectionType,
  detectRejectionTypes,
  extractAffectedClaims,
  extractCitations,
  extractExaminerArguments,
  formatOfficeActionSummary,
  parseOfficeAction,
  type ParsedOfficeAction,
} from '../../src/notice/office-action.ts'
import {
  CITATION_CASES,
  CLAIM_CASES,
  REJECTION_TYPE_CASES,
  REJECTION_TYPES_CASES,
} from '../fixtures/from-mady/office-action.ts'

// 上游四张用例表在 tests/fixtures/from-mady/office-action.ts（含上游路径与提交）；
// 本文件另测本模块的偏离项：相关性只在有标注时给出、引用文献填同句权项、论点按码位截取、
// 公开不充分的三种写法、权项区间与编号上限。

describe('detectRejectionType', () => {
  it.each(REJECTION_TYPE_CASES)('$name', ({ text, want }) => {
    expect(detectRejectionType(text)).toBe(want)
  })

  it('多类型时取原文首次出现的一个', () => {
    expect(detectRejectionType('权利要求1不清楚，权利要求2不具备新颖性')).toBe('clarity')
  })
})

describe('detectRejectionTypes', () => {
  it.each(REJECTION_TYPES_CASES)('$name', ({ text, want }) => {
    expect(detectRejectionTypes(text)).toEqual(want)
  })

  it('顺序表覆盖全部可识别类型且无重复', () => {
    expect([...REJECTION_ORDER].sort()).toEqual(Object.keys(REJECTION_PATTERNS).sort())
    expect(new Set(REJECTION_ORDER).size).toBe(REJECTION_ORDER.length)
  })
})

describe('extractCitations', () => {
  it.each(CITATION_CASES)('$name', ({ text, want }) => {
    expect(extractCitations(text).map(citation => citation.documentNumber)).toEqual(want)
  })

  it('识别括号标注的相关性', () => {
    const text = '对比文件1：CN101234567A（X类）公开了权利要求1-3的技术方案。'
    expect(extractCitations(text)).toEqual([
      { documentNumber: 'CN101234567A', relevancy: 'X', claimsAffected: [1, 2, 3] },
    ])
  })

  it('识别圆括号标注的相关性，且不跨文献号安到邻篇上', () => {
    const text = 'US2009012345A（Y）与CN101234567A的结合破坏创造性。'
    expect(extractCitations(text)).toEqual([
      { documentNumber: 'US2009012345A', relevancy: 'Y', claimsAffected: [] },
      { documentNumber: 'CN101234567A', claimsAffected: [] },
    ])
  })

  it('未标注相关性时不填该字段', () => {
    const citations = extractCitations('对比文件CN101234567A公开了区别技术特征。')
    expect(citations).toHaveLength(1)
    expect(citations[0]).toEqual({ documentNumber: 'CN101234567A', claimsAffected: [] })
    expect(Object.keys(citations[0] ?? {})).toEqual(['documentNumber', 'claimsAffected'])
  })

  it('标注字母不在闭集内时视为未标注', () => {
    const [citation] = extractCitations('对比文件CN101234567A（R）为新近公开。')
    expect(citation?.relevancy).toBeUndefined()
  })

  it('标注写在文献号之前时不识别', () => {
    const [citation] = extractCitations('(X) CN101234567A公开了该技术方案。')
    expect(citation?.relevancy).toBeUndefined()
  })

  it('权项取同句共现，跨句不串', () => {
    const text = 'CN101234567A公开了权利要求1的技术方案。权利要求2-3相对于CN109876543B不具备创造性。'
    expect(extractCitations(text)).toEqual([
      { documentNumber: 'CN101234567A', claimsAffected: [1] },
      { documentNumber: 'CN109876543B', claimsAffected: [2, 3] },
    ])
  })

  it('本文书自身号码的指代不入引用文献，紧邻对照的引用仍保留', () => {
    expect(extractCitations('本申请公开号CN117000000A，对比文件CN112345678A公开了权利要求1的特征。'))
      .toEqual([{ documentNumber: 'CN112345678A', claimsAffected: [1] }])
    expect(extractCitations('CN117000000A（本申请）与CN112345678A的区别在于加热结构。'))
      .toEqual([{ documentNumber: 'CN112345678A', claimsAffected: [] }])
    expect(extractCitations('本申请与CN112345678A的区别在于加热结构。'))
      .toEqual([{ documentNumber: 'CN112345678A', claimsAffected: [] }])
  })
})

describe('extractAffectedClaims', () => {
  it.each(CLAIM_CASES)('$name', ({ text, want }) => {
    expect(extractAffectedClaims(text)).toEqual(want)
  })

  it('区间过宽时按笔误忽略，只留单号', () => {
    expect(extractAffectedClaims('权利要求1-500均不具备新颖性')).toEqual([1])
  })

  it('超过编号上限的权项不进入结果', () => {
    expect(extractAffectedClaims('权利要求1000未记载于说明书')).toEqual([])
  })

  it('起始号大于结束号时不展开', () => {
    expect(extractAffectedClaims('第5-3项')).toEqual([])
  })

  it('页与段区间不被当成权项', () => {
    expect(extractAffectedClaims('对比文件1的说明书第2-3页公开了该结构。')).toEqual([])
    expect(extractAffectedClaims('参见说明书第3至5段的记载。')).toEqual([])
    expect(extractAffectedClaims('第2-3页与第4-6项分别对应不同内容')).toEqual([4, 5, 6])
  })
})

describe('extractExaminerArguments', () => {
  it('取句末标点前的一句', () => {
    const text = '审查员认为，本申请的权利要求1不具备创造性。第二段与论证无关。'
    expect(extractExaminerArguments(text)).toEqual(['审查员认为，本申请的权利要求1不具备创造性。'])
  })

  it('过短的片段不进结果', () => {
    const text = '所以。审查员认为，权利要求1不具备创造性。'
    expect(extractExaminerArguments(text)).toEqual(['审查员认为，权利要求1不具备创造性。'])
  })

  it('最多五条', () => {
    const text = [
      '审查员认为，权利要求1不具备创造性。',
      '对比文件1公开了区别特征。',
      '本领域技术人员容易想到该手段。',
      '因此该权利要求不具备创造性。',
      '所以该技术方案显而易见。',
      '综上，本申请不具备创造性。',
    ].join('')
    const arguments_ = extractExaminerArguments(text)
    expect(arguments_).toHaveLength(5)
    expect(arguments_.join('')).not.toContain('综上')
  })

  it('无标记时为空', () => {
    expect(extractExaminerArguments('这是一段普通文字，没有任何起始标记。')).toEqual([])
  })

  it('超窗且无句末标点时截到窗尾，且不切出半个字符', () => {
    const text = `审查员认为${'𠀀'.repeat(300)}`
    const snippet = extractExaminerArguments(text)[0]!
    expect(Array.from(snippet)).toHaveLength(200)
    expect(hasUnpairedSurrogate(snippet)).toBe(false)
  })
})

describe('parseOfficeAction', () => {
  it('单一创造性驳回', () => {
    const text = `审查员认为第1-3项权利要求不具备创造性，不符合专利法22条第3款的规定。
对比文件CN101234567A（X类）公开了区别技术特征。`
    const parsed = parseOfficeAction(text)
    expect(parsed.rejectionType).toBe('inventiveness')
    expect(parsed.rejectionTypes).toEqual(['inventiveness'])
    expect(parsed.affectedClaims).toEqual([1, 2, 3])
    expect(parsed.citations).toEqual([
      { documentNumber: 'CN101234567A', relevancy: 'X', claimsAffected: [] },
    ])
    expect(parsed.examinerArguments).toHaveLength(2)
  })

  it('多类型混合驳回', () => {
    const text = `权利要求1-3相对于对比文件1（CN123456A）不具备新颖性，不符合专利法第22条第2款的规定。
权利要求4相对于对比文件1和对比文件2（US789012B）的结合不具备创造性，不符合专利法第22条第3款的规定。
权利要求5不清楚，不符合专利法第26条第4款的规定。`
    const parsed = parseOfficeAction(text)
    expect(parsed.rejectionTypes).toEqual(['novelty', 'inventiveness', 'clarity'])
    expect(parsed.rejectionType).toBe('novelty')
    expect(parsed.affectedClaims).toEqual([1, 2, 3, 4, 5])
    expect(parsed.citations.map(citation => citation.documentNumber)).toEqual([
      'CN123456A',
      'US789012B',
    ])
  })

  it('无关文本不产出任何事实', () => {
    expect(parseOfficeAction('本通知书随文送达，请核实。')).toEqual({
      rejectionType: 'other',
      rejectionTypes: [],
      citations: [],
      affectedClaims: [],
      examinerArguments: [],
    })
  })
})

describe('formatOfficeActionSummary', () => {
  it('逐行呈现类型、权项、文献与论点', () => {
    const parsed: ParsedOfficeAction = {
      rejectionType: 'inventiveness',
      rejectionTypes: ['inventiveness', 'clarity'],
      citations: [
        { documentNumber: 'CN101234567A', relevancy: 'X', claimsAffected: [] },
        { documentNumber: 'US789012B', claimsAffected: [] },
      ],
      affectedClaims: [1, 2, 3],
      examinerArguments: ['审查员认为该方案显而易见。'],
    }
    expect(formatOfficeActionSummary(parsed)).toBe(
      [
        '驳回类型: 创造性（专利法第22条第3款）、不清楚（专利法第26条第4款）',
        '影响权利要求: 1, 2, 3',
        '引用文献: CN101234567A（X 类）、US789012B',
        '审查员论点: 审查员认为该方案显而易见。',
      ].join('\n'),
    )
  })

  it('无类型、无权项、无文献时不留空行，也不以某一类型兜底', () => {
    const parsed: ParsedOfficeAction = {
      rejectionType: 'other',
      rejectionTypes: [],
      citations: [],
      affectedClaims: [],
      examinerArguments: [],
    }
    expect(formatOfficeActionSummary(parsed)).toBe(
      ['驳回类型: 未识别到具体驳回条款', '影响权利要求: 无', '引用文献: 无'].join('\n'),
    )
  })
})

/**
 * 是否存在未成对的代理码元（半个字符）。
 * @param text - 待检查文本。
 * @returns 存在半个字符时为 true。
 */
function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}
