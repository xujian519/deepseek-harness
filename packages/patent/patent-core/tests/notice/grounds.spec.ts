import { describe, expect, it } from 'vitest'
import {
  detectPatentSubject,
  identifyDesignGrounds,
  identifyInvalidationGrounds,
  identifyReexaminationGrounds,
} from '../../src/notice/grounds.ts'

// 关键词表转写自 Mady domains/workflows/patent/invalidation_parse.go:61-75、
// domains/workflows/patent/reexamination.go:486-503 与
// domains/workflows/design/design_invalidation.go:29-54（MIT，同作者）；
// 两处偏离按本模块的口径核对：无命中时不造默认理由、实用新型不删除创造性理由。

describe('identifyInvalidationGrounds', () => {
  it('五条法定理由逐条识别', () => {
    expect(identifyInvalidationGrounds('权利要求1不具备新颖性，不符合专利法第22条第2款')).toEqual([
      { ground: 'novelty', article: '专利法第22条第2款', label: '新颖性无效（不具备新颖性）' },
    ])
    expect(identifyInvalidationGrounds('相对于对比文件1和2的结合不具备创造性')).toEqual([
      { ground: 'inventiveness', article: '专利法第22条第3款', label: '创造性无效（不具备创造性）' },
    ])
    expect(identifyInvalidationGrounds('说明书公开不充分，本领域技术人员无法实现')).toEqual([
      { ground: 'disclosure', article: '专利法第26条第3款', label: '公开不充分无效' },
    ])
    expect(identifyInvalidationGrounds('权利要求2的保护范围不清楚')).toEqual([
      {
        ground: 'claim-clarity',
        article: '专利法第26条第4款',
        label: '权利要求不清楚/得不到支持无效',
      },
    ])
    expect(identifyInvalidationGrounds('修改超出原说明书的记载范围')).toEqual([
      { ground: 'amendment', article: '专利法第33条', label: '修改超范围无效' },
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

  it('公开不充分的三种写法都命中', () => {
    // 上游两表只收"公开充分""充分公开"，正文最常见的"公开不充分"漏检。
    expect(identifyInvalidationGrounds('说明书公开不充分').map(ground => ground.ground)).toEqual([
      'disclosure',
    ])
    expect(identifyInvalidationGrounds('说明书公开充分').map(ground => ground.ground)).toEqual([
      'disclosure',
    ])
    expect(identifyInvalidationGrounds('说明书充分公开').map(ground => ground.ground)).toEqual([
      'disclosure',
    ])
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
    expect(grounds[1]).toEqual({
      ground: 'utility-model-subject-matter',
      article: '专利法第2条第3款',
      label: '实用新型客体缺陷',
    })
  })

  it('创造性理由不因实用新型而被剔除', () => {
    // 上游在实用新型下删除创造性理由且未给出依据；本模块保留，类型由 detectPatentSubject 单独输出。
    const text = '本实用新型相对于对比文件1和2的结合不具备创造性。'
    expect(identifyReexaminationGrounds(text).map(ground => ground.ground)).toEqual([
      'inventiveness',
    ])
    expect(detectPatentSubject(text)).toBe('utility-model')
  })

  it('无命中时返回空数组', () => {
    expect(identifyReexaminationGrounds('请求撤销驳回决定。')).toEqual([])
  })
})

describe('identifyDesignGrounds', () => {
  it('三条理由逐条识别', () => {
    expect(identifyDesignGrounds('本外观设计属于现有设计')).toEqual([
      { ground: 'not-prior-design', article: '专利法第23条第1款', label: '外观设计不属于现有设计' },
    ])
    expect(identifyDesignGrounds('该申请构成抵触申请')).toEqual([
      { ground: 'conflicting-application', article: '专利法第23条第2款', label: '外观设计抵触申请' },
    ])
    expect(identifyDesignGrounds('与在先的商标权冲突')).toEqual([
      {
        ground: 'prior-right-conflict',
        article: '专利法第23条第3款',
        label: '外观设计与在先合法权利冲突',
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
