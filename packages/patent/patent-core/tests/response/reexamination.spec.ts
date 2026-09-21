import { describe, expect, it } from 'vitest'
import { identifyReexaminationGrounds, type GroundFinding, type ReexaminationGround } from '../../src/notice/grounds.ts'
import {
  AMENDMENT_COMPARISON_TABLE,
  AMENDMENT_NON_EXTENSION_BASIS,
  AMENDMENT_NON_EXTENSION_ITEMS,
  CHALLENGE_QUESTIONS,
  GROUND_ARGUMENT_ACTIONS,
  TECH_COMPARISON_TABLE,
  buildReexaminationPreparation,
} from '../../src/response/reexamination.ts'

// 准备段取自 Mady domains/workflows/patent/reexamination_prepare.go（MIT，同作者）；
// 偏离项：A33 段不区分有无该理由、占位行不出、建议性文字归技能层、口审两段以显式开关控制。

/** 复审理由的完整键集（无效五条 + 实用新型客体）。 */
const ALL_GROUNDS: readonly ReexaminationGround[] = [
  'novelty',
  'inventiveness',
  'disclosure',
  'claim-clarity',
  'amendment',
  'utility-model-subject-matter',
]

/** 复审理由的键集与两张表的键集一致。 */
function reasons(text: string): GroundFinding<ReexaminationGround>[] {
  return identifyReexaminationGrounds(text)
}

describe('buildReexaminationPreparation', () => {
  it('默认不开庭：只有对比表与 A33 论证两段', () => {
    const prep = buildReexaminationPreparation(reasons('权利要求1不具备新颖性，不符合专利法第22条第2款'))
    expect(prep.oralHearing).toBe(false)
    expect(prep.sections.map(section => section.id)).toEqual(['tech-comparison', 'amendment-non-extension'])
    expect(prep.grounds).toEqual(['novelty'])
  })

  it('开庭时补出质疑预演与口审时间线', () => {
    const prep = buildReexaminationPreparation(
      reasons('权利要求1不具备创造性，不符合专利法第22条第3款；说明书公开不充分，不符合专利法第26条第3款'),
      { oralHearing: true },
    )
    expect(prep.sections.map(section => section.id)).toEqual([
      'tech-comparison',
      'amendment-non-extension',
      'challenge-rehearsal',
      'hearing-timeline',
    ])
  })

  it('无修改超范围理由时对比表不含修改前后对照表', () => {
    const prep = buildReexaminationPreparation(reasons('权利要求2的保护范围不清楚'))
    const [section] = prep.sections
    expect(section).toEqual({ id: 'tech-comparison', title: '对比表', tables: [TECH_COMPARISON_TABLE] })
  })

  it('有修改超范围理由时补出修改前后对照表', () => {
    const prep = buildReexaminationPreparation(reasons('修改超出原说明书的记载范围'))
    const [section] = prep.sections
    expect(section).toEqual({
      id: 'tech-comparison',
      title: '对比表',
      tables: [TECH_COMPARISON_TABLE, AMENDMENT_COMPARISON_TABLE],
    })
  })

  it('A33 段给出必填项与依据，依据不写未核验的细则条号', () => {
    const prep = buildReexaminationPreparation(reasons('权利要求1不具备新颖性'))
    const a33 = prep.sections.find(section => section.id === 'amendment-non-extension')
    expect(a33).toEqual({
      id: 'amendment-non-extension',
      title: '修改不超范围论证',
      items: AMENDMENT_NON_EXTENSION_ITEMS,
      basis: AMENDMENT_NON_EXTENSION_BASIS,
    })
    expect(AMENDMENT_NON_EXTENSION_ITEMS).toHaveLength(5)
    expect(AMENDMENT_NON_EXTENSION_ITEMS[4]).toContain('未超出原说明书和权利要求书记载的范围')
    expect(AMENDMENT_NON_EXTENSION_BASIS[0]).toContain('专利法第33条')
    expect(AMENDMENT_NON_EXTENSION_BASIS[1]).toContain('复审阶段修改范围')
  })

  it('质疑预演按理由逐条给出问题', () => {
    const prep = buildReexaminationPreparation(
      reasons('权利要求1不具备新颖性，不符合专利法第22条第2款；权利要求1也不具备新颖性'),
      { oralHearing: true },
    )
    const rehearsal = prep.sections.find(section => section.id === 'challenge-rehearsal')
    expect(rehearsal).toEqual({
      id: 'challenge-rehearsal',
      title: '合议组质疑预演',
      challenges: [
        {
          ground: 'novelty',
          label: '新颖性缺陷',
          questions: CHALLENGE_QUESTIONS.novelty,
        },
      ],
    })
    expect(prep.grounds).toEqual(['novelty'])
  })

  it('重复理由只保留一条', () => {
    const finding: GroundFinding<ReexaminationGround> = {
      ground: 'novelty',
      article: '专利法第22条第2款',
      label: '新颖性缺陷',
    }
    const prep = buildReexaminationPreparation([finding, finding], { oralHearing: true })
    expect(prep.grounds).toEqual(['novelty'])
    const rehearsal = prep.sections.find(section => section.id === 'challenge-rehearsal')
    if (rehearsal?.id !== 'challenge-rehearsal') throw new Error('质疑预演段缺失')
    expect(rehearsal.challenges).toHaveLength(1)
  })

  it('口审时间线四阶段，理由陈述阶段按理由展开', () => {
    const prep = buildReexaminationPreparation(
      reasons('权利要求1不具备新颖性；权利要求1不具备创造性'),
      { oralHearing: true },
    )
    const timeline = prep.sections.find(section => section.id === 'hearing-timeline')
    if (timeline?.id !== 'hearing-timeline') throw new Error('口审时间线段缺失')
    expect(timeline.phases.map(phase => phase.name)).toEqual([
      '开场',
      '复审理由陈述',
      '合议组提问与应答',
      '总结陈述',
    ])
    expect(timeline.phases.map(phase => phase.minutes)).toEqual(['3-5 分钟', '10-15 分钟', '15-20 分钟', '5 分钟'])
    const [, reasonPhase] = timeline.phases
    expect(reasonPhase?.steps).toEqual([
      '新颖性缺陷——论证新颖性',
      '创造性缺陷——论证创造性',
    ])
  })

  it('实用新型客体理由也有质疑预演与陈述动作', () => {
    const prep = buildReexaminationPreparation(
      reasons('权利要求的技术方案不属于专利法第2条第3款规定的客体'),
      { oralHearing: true },
    )
    expect(prep.grounds).toEqual(['utility-model-subject-matter'])
    const rehearsal = prep.sections.find(section => section.id === 'challenge-rehearsal')
    if (rehearsal?.id !== 'challenge-rehearsal') throw new Error('质疑预演段缺失')
    expect(rehearsal.challenges[0]?.questions).toEqual(CHALLENGE_QUESTIONS['utility-model-subject-matter'])
  })

  it('无理由时只给两段骨架且理由为空', () => {
    const prep = buildReexaminationPreparation(reasons('请求人请求撤销驳回决定'))
    expect(prep.grounds).toEqual([])
    expect(prep.sections.map(section => section.id)).toEqual(['tech-comparison', 'amendment-non-extension'])
  })

  it('两张表与陈述动作覆盖全部复审理由', () => {
    expect(Object.keys(CHALLENGE_QUESTIONS).sort()).toEqual([...ALL_GROUNDS].sort())
    expect(Object.keys(GROUND_ARGUMENT_ACTIONS).sort()).toEqual([...ALL_GROUNDS].sort())
    for (const ground of ALL_GROUNDS) {
      expect(CHALLENGE_QUESTIONS[ground].length).toBeGreaterThan(0)
      expect(GROUND_ARGUMENT_ACTIONS[ground]).not.toBe('')
    }
  })
})
