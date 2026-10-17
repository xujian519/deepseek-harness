import { describe, expect, it } from 'vitest'
import {
  detectPatentSubject,
  identifyDesignGrounds,
  identifyInvalidationGrounds,
  identifyReexaminationGrounds,
  type GroundFinding,
} from '../../src/notice/grounds.ts'

// 关键词表转写自 Mady domains/workflows/patent/invalidation_parse.go:61-75、
// domains/workflows/patent/reexamination.go:486-503 与
// domains/workflows/design/design_invalidation.go:29-54（MIT，同作者）；
// 偏离按本模块的口径核对：无命中时不造默认理由、实用新型不删除创造性理由、
// 无效理由表补齐客体与其他条款、宽词收窄为成短语形式。

/** 只比较理由、法条与标签；命中片段由专门的用例断言。 */
function groundsOf(findings: readonly GroundFinding<string>[]): GroundFinding<string>[] {
  return findings.map(({ ground, article, label }) => ({ ground, article, label, matched: '' }))
}

describe('identifyInvalidationGrounds', () => {
  it('五条基础法定理由逐条识别', () => {
    expect(groundsOf(identifyInvalidationGrounds('权利要求1不具备新颖性，不符合专利法第22条第2款'))).toEqual([
      { ground: 'novelty', article: '专利法第22条第2款', label: '新颖性无效（不具备新颖性）', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('相对于对比文件1和2的结合不具备创造性'))).toEqual([
      { ground: 'inventiveness', article: '专利法第22条第3款', label: '创造性无效（不具备创造性）', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('说明书公开不充分，本领域技术人员无法实现'))).toEqual([
      { ground: 'disclosure', article: '专利法第26条第3款', label: '公开不充分无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('权利要求2的保护范围不清楚'))).toEqual([
      {
        ground: 'claim-clarity',
        article: '专利法第26条第4款',
        label: '权利要求不清楚/得不到支持无效',
        matched: '',
      },
    ])
    expect(groundsOf(identifyInvalidationGrounds('修改超出原说明书的记载范围'))).toEqual([
      { ground: 'amendment', article: '专利法第33条', label: '修改超范围无效', matched: '' },
    ])
  })

  it('客体、实用性与实施细则条款逐条识别', () => {
    expect(groundsOf(identifyInvalidationGrounds('权利要求1不属于专利法第2条规定的技术方案'))).toEqual([
      { ground: 'subject-matter-art2', article: '专利法第2条', label: '不属于专利法第2条规定客体的无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('该方案违反社会公德，不符合专利法第5条'))).toEqual([
      { ground: 'subject-matter-art5', article: '专利法第5条', label: '违反法律、社会公德或妨害公共利益无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('属于智力活动的规则和方法，不符合专利法第25条'))).toEqual([
      { ground: 'subject-matter-art25', article: '专利法第25条', label: '属于不授予专利权的范围无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('权利要求1不具备实用性，不符合专利法第22条第4款'))).toEqual([
      { ground: 'utility', article: '专利法第22条第4款', label: '实用性无效（不具备实用性）', matched: '' },
    ])
    expect(
      groundsOf(identifyInvalidationGrounds('独立权利要求缺少解决技术问题的必要技术特征，不符合专利法实施细则第23条第2款')),
    ).toEqual([
      { ground: 'necessary-features', article: '专利法实施细则第23条第2款', label: '缺少必要技术特征无效', matched: '' },
    ])
    // 2024-01-20 施行的细则把必要技术特征移到第 23 条第 2 款；此前出件的通知书仍写旧条号。
    expect(
      groundsOf(identifyInvalidationGrounds('独立权利要求缺少解决技术问题的必要技术特征，不符合专利法实施细则第20条第2款')),
    ).toEqual([
      { ground: 'necessary-features', article: '专利法实施细则第23条第2款', label: '缺少必要技术特征无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('分案申请超出了原申请的记载范围，不符合实施细则第49条'))).toEqual([
      { ground: 'divisional-amendment', article: '专利法实施细则第49条', label: '分案申请超范围无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('分案申请超出了原申请的记载范围，不符合实施细则第43条第1款'))).toEqual([
      { ground: 'divisional-amendment', article: '专利法实施细则第49条', label: '分案申请超范围无效', matched: '' },
    ])
    expect(groundsOf(identifyInvalidationGrounds('该专利与在先专利属于同样的发明创造，不符合专利法第9条'))).toEqual([
      { ground: 'double-patenting', article: '专利法第9条', label: '同样的发明创造重复授权无效', matched: '' },
    ])
  })

  it('多条理由按表序返回', () => {
    const text = '第33条的修改超出原说明书；权利要求1不具备新颖性；权利要求2不具备创造性。'
    expect(identifyInvalidationGrounds(text).map(ground => ground.ground)).toEqual([
      'novelty',
      'inventiveness',
      'amendment',
    ])
  })

  it('只命中缺陷表述，不把正面表述当理由', () => {
    // 上游两表只收"公开充分""充分公开"，正文最常见的"公开不充分"漏检；
    // "公开充分"本身是专利权人的正面主张，不是公开不充分缺陷。
    expect(identifyInvalidationGrounds('说明书公开不充分').map(ground => ground.ground)).toEqual([
      'disclosure',
    ])
    expect(identifyInvalidationGrounds('说明书未充分公开').map(ground => ground.ground)).toEqual([
      'disclosure',
    ])
    expect(identifyInvalidationGrounds('说明书公开充分，请求人的无效理由不成立')).toEqual([])
  })

  it('裸条号不跨法命中', () => {
    // 实施细则第5/9/22/25 条不是专利法第5/9/22/25 条；裸条号前出现另一部法律名时不命中。
    expect(identifyInvalidationGrounds('请求人主张专利法实施细则第5条关于送达的规定')).toEqual([])
    expect(identifyInvalidationGrounds('依据专利法实施细则第9条')).toEqual([])
    expect(identifyInvalidationGrounds('依据专利法实施细则第25条')).toEqual([])
    expect(identifyInvalidationGrounds('依据专利法实施细则第22条第3款')).toEqual([])
    // 同一段前文出现另一部法律，不影响后一处带专利法条号的命中。
    expect(
      identifyInvalidationGrounds('经专利法实施细则第5条送达；权利要求1不具备新颖性，不符合专利法第22条第2款')
        .map(ground => ground.ground),
    ).toEqual(['novelty'])
  })

  it('条款简写与大小写写法都命中', () => {
    expect(identifyInvalidationGrounds('见 A33').map(ground => ground.ground)).toEqual([
      'amendment',
    ])
    expect(identifyInvalidationGrounds('适用 a33').map(ground => ground.ground)).toEqual([
      'amendment',
    ])
    expect(identifyInvalidationGrounds('依据 22.2').map(ground => ground.ground)).toEqual([
      'novelty',
    ])
    expect(identifyInvalidationGrounds('依据 22.4').map(ground => ground.ground)).toEqual([
      'utility',
    ])
  })

  it('条款号省略时按实词命中', () => {
    // "超出了原说明书……的范围"不含"超出原"（出了原 与 超出原 不同），上游该条只在
    // 条款号同时出现时才命中。
    expect(identifyInvalidationGrounds('权利要求1的修改超出了原说明书和权利要求书记载的范围').map(g => g.ground)).toEqual([
      'amendment',
    ])
    expect(identifyInvalidationGrounds('权利要求得不到说明书支持').map(g => g.ground)).toEqual([
      'claim-clarity',
    ])
  })

  it('宽词收窄：日常用词不再命中 26.4', () => {
    // 上游表收"清楚""支持"两个无边界词：请求书里"证据1可以支持上述主张""事实清楚"
    // 都会命中 26.4，把请求人没主张的理由写进识别结果。
    const novelOnly = '请求人认为权利要求1不具备新颖性，不符合专利法第22条第2款。证据1可以支持上述主张，事实清楚。'
    expect(identifyInvalidationGrounds(novelOnly).map(g => g.ground)).toEqual(['novelty'])
    const defense = '请求人的证据不能支持其主张，权利要求1清楚且得到说明书支持，请求维持专利权有效。'
    expect(identifyInvalidationGrounds(defense)).toEqual([])
  })

  it('反向命中修正："能够实现"不再判为公开不充分', () => {
    // "本领域技术人员能够实现"描述的是公开充分，作为公开不充分缺陷的关键词方向相反。
    expect(identifyInvalidationGrounds('说明书对技术方案作出了清楚完整的说明，本领域技术人员能够实现')).toEqual([])
    expect(identifyInvalidationGrounds('本领域技术人员无法实现该技术方案').map(g => g.ground)).toEqual([
      'disclosure',
    ])
  })

  it('命中片段给出原文，长文两侧截断', () => {
    const short = identifyInvalidationGrounds('权利要求1不具备新颖性')
    expect(short[0]?.matched).toBe('权利要求1不具备新颖性')

    const long = `${'前'.repeat(50)}权利要求1不具备新颖性${'后'.repeat(80)}`
    const matched = identifyInvalidationGrounds(long)[0]?.matched ?? ''
    expect(matched.startsWith('…')).toBe(true)
    expect(matched.endsWith('…')).toBe(true)
    expect(matched).toContain('权利要求1不具备新颖性')
    expect(matched.length).toBeLessThan(long.length)
  })

  it('无命中时返回空数组，不造默认理由', () => {
    expect(identifyInvalidationGrounds('请求人主张专利权应被宣告无效。')).toEqual([])
  })
})

describe('identifyReexaminationGrounds', () => {
  it('六条理由逐条识别', () => {
    const grounds = identifyReexaminationGrounds(
      '驳回决定以专利法第2条第3款不属于实用新型客体为由驳回，并指出公开不充分。',
    )
    expect(grounds.map(ground => ground.ground)).toEqual([
      'disclosure',
      'utility-model-subject-matter',
    ])
    expect(groundsOf([grounds[1] as GroundFinding<string>])).toEqual([
      {
        ground: 'utility-model-subject-matter',
        article: '专利法第2条第3款',
        label: '实用新型客体缺陷',
        matched: '',
      },
    ])
  })

  it('创造性理由不因实用新型而被剔除', () => {
    // 上游在实用新型下删除创造性理由且未给出依据；本模块保留，类型由 detectPatentSubject 单独输出。
    const text = '本实用新型相对于对比文件1和2的结合不具备创造性。'
    expect(identifyReexaminationGrounds(text).map(ground => ground.ground)).toEqual([
      'inventiveness',
    ])
    expect(detectPatentSubject(text)).toBe('utility-model')
  })

  it('宽词同样收窄：日常用词不命中 26.4', () => {
    expect(identifyReexaminationGrounds('驳回理由不能支持其结论，本申请清楚。')).toEqual([])
  })

  it('无命中时返回空数组', () => {
    expect(identifyReexaminationGrounds('请求撤销驳回决定。')).toEqual([])
  })
})

describe('identifyDesignGrounds', () => {
  it('三条理由逐条识别', () => {
    expect(groundsOf(identifyDesignGrounds('本外观设计属于现有设计'))).toEqual([
      { ground: 'not-prior-design', article: '专利法第23条第1款', label: '外观设计不属于现有设计', matched: '' },
    ])
    expect(groundsOf(identifyDesignGrounds('该申请构成抵触申请'))).toEqual([
      { ground: 'conflicting-application', article: '专利法第23条第2款', label: '外观设计抵触申请', matched: '' },
    ])
    expect(groundsOf(identifyDesignGrounds('与在先的商标权冲突'))).toEqual([
      {
        ground: 'prior-right-conflict',
        article: '专利法第23条第3款',
        label: '外观设计与在先合法权利冲突',
        matched: '',
      },
    ])
  })

  it('多条理由按表序返回', () => {
    const text = '与在先著作权冲突，且不属于现有设计，同时构成抵触申请。'
    expect(identifyDesignGrounds(text).map(ground => ground.ground)).toEqual([
      'not-prior-design',
      'conflicting-application',
      'prior-right-conflict',
    ])
  })

  it('无命中时返回空数组', () => {
    expect(identifyDesignGrounds('请求宣告本外观设计专利权无效。')).toEqual([])
  })
})

describe('detectPatentSubject', () => {
  it('正文写明类型时按正文', () => {
    expect(detectPatentSubject('本实用新型的说明书')).toBe('utility-model')
    expect(detectPatentSubject('本发明涉及一种装置')).toBe('invention')
  })

  it('正文同时出现两种表述时实用新型优先', () => {
    expect(detectPatentSubject('本发明与现有实用新型的对比')).toBe('utility-model')
  })

  it('正文未写明类型时按客体缺陷理由推断', () => {
    const text = '权利要求的技术方案不属于专利法第2条第3款规定的客体。'
    const grounds = identifyReexaminationGrounds(text)
    expect(grounds.map(ground => ground.ground)).toEqual(['utility-model-subject-matter'])
    expect(detectPatentSubject(text, grounds)).toBe('utility-model')
  })

  it('无任何信号时为 undetermined，不默认按发明处理', () => {
    const grounds = identifyReexaminationGrounds('不符合22条第2款')
    expect(grounds.map(ground => ground.ground)).toEqual(['novelty'])
    expect(detectPatentSubject('不符合22条第2款', grounds)).toBe('undetermined')
  })

  it('不传理由时也能判定', () => {
    expect(detectPatentSubject('本发明涉及一种装置')).toBe('invention')
  })
})
