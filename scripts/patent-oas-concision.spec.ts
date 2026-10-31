/**
 * `patent-oas` 篇幅观测的验收测试。
 *
 * 这些数字将来要进回归读数,所以每条口径都要有负例:「表格不计入正文」「空节怎么算」
 * 「重复句的阈值」都是会被人质疑的判定,测试里固定它们的含义,免得下一次改动把它悄悄改掉。
 */

import { describe, expect, it } from 'vitest'
import { OA_RESPONSE_DRAFT_BUDGET } from '@deepseek-ai/dsh-patent-workflow'
import {
  DELIVERABLE_BUDGETS,
  budgetOf,
  formatConcision,
  observeConcision,
  type ConcisionObservation,
} from './patent-oas-concision.ts'

/** 一段普通答复正文:一个文书标题、两个小节、两段实体内容。 */
const PROSE = [
  '# 意见陈述书',
  '',
  '## 一、总体立场',
  '本申请具备创造性。',
  '',
  '## 二、对比文件',
  'D1 未公开图像采集模块。',
].join('\n')

describe('observeConcision', () => {
  it('只计正文:标记与空白剔除,标题计入字符', () => {
    // 「意见陈述书」5 + 「一、总体立场」6 + 「本申请具备创造性。」9 + 「二、对比文件」6
    // + 「D1未公开图像采集模块。」12 = 38
    expect(observeConcision(PROSE).proseChars).toBe(38)
  })

  it('段落只数实体块,一级标题只算文书标题不算小节', () => {
    const observation = observeConcision(PROSE)
    expect(observation.paragraphs).toBe(2)
    expect(observation.sections).toBe(2)
    expect(observation.emptySections).toBe(0)
  })

  it('表格整行剔除:三张对照表的字不占答复正文的篇幅', () => {
    const withTable = [
      '# 答复',
      '',
      '正文一句话。',
      '',
      '| 要素 | 结论 |',
      '| --- | --- |',
      '| F1 | 未公开 |',
    ].join('\n')
    const observation = observeConcision(withTable)
    // 「答复」2 + 「正文一句话。」6
    expect(observation.proseChars).toBe(8)
    expect(observation.paragraphs).toBe(1)
    // 一级标题只算文书标题:这份交付物没有小节
    expect(observation.sections).toBe(0)
  })

  it('HTML 表格同样剔除:交付物是 markdown 还是 html 都不该改口径', () => {
    const withHtmlTable = [
      '# 答复',
      '',
      '<table>',
      '<tr><td>要素</td><td>结论</td></tr>',
      '</table>',
      '',
      '正文一句话。',
    ].join('\n')
    expect(observeConcision(withHtmlTable).proseChars).toBe(8)
  })

  it('空节:标题之后紧接着下一个标题', () => {
    const withEmpty = [
      '# 答复',
      '',
      '## 一、新颖性',
      '',
      '## 二、创造性',
      '本申请具备创造性。',
    ].join('\n')
    const observation = observeConcision(withEmpty)
    expect(observation.sections).toBe(2)
    expect(observation.emptySections).toBe(1)
    expect(observation.paragraphs).toBe(1)
  })

  it('小节里只有一张表不算空节:表就是这一节的结论', () => {
    const tableOnlySection = [
      '# 答复',
      '',
      '## 一、修改对照',
      '',
      '| 权项 | 修改 |',
      '| --- | --- |',
      '| 1 | 不修改 |',
      '',
      '## 二、结论',
      '本次不修改权利要求。',
    ].join('\n')
    const observation = observeConcision(tableOnlySection)
    expect(observation.sections).toBe(2)
    expect(observation.emptySections).toBe(0)
  })

  it('父节下直接排子节不算空节:内容在子节里', () => {
    const nested = [
      '# 答复',
      '',
      '## 一、关于第三十三条',
      '',
      '### 1.1 事实前提',
      '第一次答复未修改申请文件。',
      '',
      '### 1.2 逐处核对',
      '逐处核对如下。',
    ].join('\n')
    const observation = observeConcision(nested)
    expect(observation.sections).toBe(3)
    expect(observation.emptySections).toBe(0)
  })

  it('重复句按去重后的句数计,短句重复不算', () => {
    const repeated = [
      '# 答复',
      '',
      '本申请权利要求1具备创造性,理由如下。',
      '中间隔一句无关的话。',
      '本申请权利要求1具备创造性,理由如下。',
      '',
      '如上。',
      '如上。',
    ].join('\n')
    expect(observeConcision(repeated).repeatedSentences).toBe(1)
  })

  it('围栏代码块整段跳过:块内的 # 不是标题', () => {
    const fenced = ['# 答复', '', '```', '## 不是标题', '```', '', '正文。'].join('\n')
    const observation = observeConcision(fenced)
    expect(observation.sections).toBe(0)
    // 「答复」2 + 「正文。」3；围栏与其内容都不计
    expect(observation.proseChars).toBe(5)
  })

  it('有预算时算出超出量,未超为 0', () => {
    expect(observeConcision(PROSE, 30)).toMatchObject({ budget: 30, overBudget: 8 })
    expect(observeConcision(PROSE, 100)).toMatchObject({ budget: 100, overBudget: 0 })
  })

  it('没有预算只计量,不写 budget / overBudget 两个键', () => {
    const observation = observeConcision(PROSE)
    expect(observation).not.toHaveProperty('budget')
    expect(observation).not.toHaveProperty('overBudget')
  })

  it('空交付物:各项归零而不是抛错', () => {
    expect(observeConcision('')).toEqual({
      proseChars: 0,
      paragraphs: 0,
      sections: 0,
      emptySections: 0,
      repeatedSentences: 0,
    })
  })
})

describe('budgetOf', () => {
  it('答复任务取 manifest 里的篇幅预算,其余任务没有预算', () => {
    expect(budgetOf('oa-answer')).toBe(OA_RESPONSE_DRAFT_BUDGET.total)
    expect(budgetOf('claim-drafting')).toBeUndefined()
    expect(DELIVERABLE_BUDGETS).not.toHaveProperty('claim-drafting')
  })
})

describe('formatConcision', () => {
  /** 造一条篇幅观测。 */
  function observation(proseChars: number, extras: Partial<ConcisionObservation> = {}): ConcisionObservation {
    return { proseChars, paragraphs: 3, sections: 2, emptySections: 0, repeatedSentences: 1, ...extras }
  }

  it('只看终局轮,逐次读数并排,预算与超次数写在括号里', () => {
    const line = formatConcision({
      cases: [{
        caseId: 'oa-answer',
        rounds: [
          { round: 1, concision: [observation(9000)] },
          {
            round: 2,
            concision: [
              observation(3840, { budget: 4000, overBudget: 0 }),
              observation(4310, { budget: 4000, overBudget: 310 }),
            ],
          },
        ],
      }],
    })
    expect(line).toContain('oa-answer 终局 正文 3840／4310 字')
    expect(line).toContain('预算 4000,超 1/2 次')
    expect(line).not.toContain('9000')
  })

  it('没有预算的任务写明「无预算」而不是省略括注', () => {
    const line = formatConcision({ cases: [{ caseId: 'x', rounds: [{ round: 1, concision: [observation(1200)] }] }] })
    expect(line).toContain('(无预算)')
  })

  it('单轮 case 的读数记在 case 上,同样能读出来', () => {
    const line = formatConcision({
      cases: [
        { caseId: 'claim-drafting', concision: [observation(1200)] },
        { caseId: 'oa-answer', rounds: [{ round: 1, concision: [observation(3900, { budget: 4000, overBudget: 0 })] }] },
      ],
    })
    expect(line).toContain('claim-drafting 终局 正文 1200 字')
    expect(line).toContain('oa-answer 终局 正文 3900 字')
  })

  it('没有任何篇幅观测时返回 undefined:旧记录不该伪造一行读数', () => {
    expect(formatConcision({ cases: [{ caseId: 'oa-answer', rounds: [{ round: 1 }] }] }))
      .toBeUndefined()
    expect(formatConcision({ cases: [] })).toBeUndefined()
  })
})
