import { describe, expect, it } from 'vitest'
import { parseOfficeAction } from '../../src/notice/office-action.ts'
import { buildResponsePlan } from '../../src/response/plan.ts'

// 逐权项修改对照表取自 Mady domains/workflows/patent/oa_response.go:120-200（MIT，同作者）；
// 偏离项：逐权项出行（上游只按最靠前的权项编号判动作）、修改对象不明时报缺口、无理由时不造骨架。

/** 创造性 + 不清楚的混合通知书。 */
const MIXED = '审查员认为，权利要求1不具备创造性，不符合专利法第22条第3款的规定；'
  + '权利要求2的保护范围不清楚，不符合专利法第26条第4款的规定。'

describe('buildResponsePlan', () => {
  it('逐理由给出策略与必答段落', () => {
    const plan = buildResponsePlan(parseOfficeAction(MIXED), { independentClaims: [1] })
    expect(plan.strategySummary).toBe('创造性→争辩、不清楚→修改')
    expect(plan.sections).toEqual([
      {
        ground: 'inventiveness',
        strategy: 'argument',
        sections: ['最接近的现有技术', '区别技术特征与实际解决的技术问题', '技术启示（非显而易见）'],
      },
      {
        ground: 'clarity',
        strategy: 'amendment',
        sections: ['修改内容与理由', '修改后用语含义唯一确定'],
      },
    ])
  })

  it('修改对照表逐权项出行并按独立/从属取动作', () => {
    const plan = buildResponsePlan(parseOfficeAction(MIXED), { independentClaims: [1] })
    expect(plan.amendmentRows).toEqual([
      {
        claim: 1,
        kind: 'independent',
        ground: 'clarity',
        action: 'clarify',
        basis: '专利法第26条第4款（清楚）',
      },
      {
        claim: 2,
        kind: 'dependent',
        ground: 'clarity',
        action: 'adjust-reference',
        basis: '专利法第26条第4款（清楚）',
      },
    ])
    expect(plan.claimsToAmend).toEqual([1, 2])
    expect(plan.claimsMentioned).toEqual([1, 2])
    expect(plan.gaps).toEqual([])
  })

  it('争辩型理由不产生修改行', () => {
    const plan = buildResponsePlan(parseOfficeAction('权利要求1不具备新颖性，不符合专利法第22条第2款'), {
      independentClaims: [1],
    })
    expect(plan.amendmentRows).toEqual([])
    expect(plan.claimsToAmend).toEqual([])
    expect(plan.claimsMentioned).toEqual([1])
    // 只有争辩型理由时不报"修改对象不明"与"缺独立权利要求"。
    expect(plan.gaps).toEqual([])
  })

  it('未识别到条款时报缺口且不产出段落', () => {
    const plan = buildResponsePlan(parseOfficeAction('本通知书随文送达，请核实。'), { independentClaims: [1] })
    expect(plan.sections).toEqual([])
    expect(plan.amendmentRows).toEqual([])
    expect(plan.strategySummary).toBe('综合答复')
    expect(plan.gaps).toEqual([
      {
        kind: 'no-ground-detected',
        ground: null,
        detail: '通知书未识别到具体驳回条款（rejectionType=other），答复依据须人工判读',
      },
    ])
  })

  it('修改类理由未抽出权项时报缺口而不兜底权利要求1', () => {
    const plan = buildResponsePlan(
      parseOfficeAction('修改超出原说明书和权利要求书记载的范围，不符合专利法第33条的规定。'),
      { independentClaims: [1] },
    )
    expect(plan.amendmentRows).toEqual([])
    expect(plan.gaps).toEqual([
      {
        kind: 'amendment-ground-without-claims',
        ground: 'scope',
        detail: '修改超范围须修改权利要求，但通知书未抽出权项编号，修改对象须人工确认',
      },
    ])
  })

  it('涉及权项中没有独立权利要求时报缺口', () => {
    const plan = buildResponsePlan(parseOfficeAction('权利要求2和权利要求3的保护范围不清楚'), {
      independentClaims: [1],
    })
    expect(plan.claimsToAmend).toEqual([2, 3])
    expect(plan.gaps).toEqual([
      {
        kind: 'independent-claim-absent',
        ground: null,
        detail: '修改类驳回涉及的权项（2、3）中没有独立权利要求被点出，'
          + '修改动作按从属权利要求取值，请确认独立权利要求是否也需要修改',
      },
    ])
  })

  it('未给出独立权利要求编号时全部按从属处理并报缺口', () => {
    const plan = buildResponsePlan(parseOfficeAction(MIXED), { independentClaims: [] })
    expect(plan.amendmentRows.map(row => row.kind)).toEqual(['dependent', 'dependent'])
    expect(plan.gaps.map(gap => gap.kind)).toEqual(['independent-claim-absent'])
  })

  it('多理由命中同一权项时逐理由出行', () => {
    const notice = parseOfficeAction(
      '权利要求1不具备创造性，不符合专利法第22条第3款；权利要求1的保护范围不清楚，不符合专利法第26条第4款。',
    )
    const plan = buildResponsePlan(notice, { independentClaims: [1] })
    expect(plan.amendmentRows.map(row => row.ground)).toEqual(['clarity'])
    expect(plan.sections.map(section => section.ground)).toEqual(['inventiveness', 'clarity'])
  })
})
