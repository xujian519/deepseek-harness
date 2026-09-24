/**
 * src/patent/patent-core/tests — 六族规则的正例与反例（#239）。
 *
 * DESIGN / PRIORITY / PUBACC / SUBJECT / REASON-CREATIVITY / REASON-CLAIMS 六族此前
 * 不出现于任何用例，而总量断言只锁「71 条」这一个数字，单族判据漂移无信号。每条
 * 规则在此给出两段文本：判据要素齐全的应通过，缺少一项的应以该规则本身报出。文本
 * 按规则声明的 `requiredElements` / `pathElements` 撰写，因此要素表被删项、换词或
 * 改 checkType 都会让对应用例失败。
 *
 * `REASON-CREATIVITY-01B`（公知常识证据支撑）不在表中：它只声明 `requiredElements`，
 * 而 `patent_inventiveness` 分派读 `stepElements`，其 `stepElements` / `pathElements` /
 * `customCheck` 全空，因此该规则对任何文本都不报出——见 #262。
 */
import { describe, expect, it } from 'vitest'
import { RuleEngine, defaultPatentRules } from '@deepseek-ai/dsh-patent-core'

const engine = new RuleEngine()
engine.registerMany(defaultPatentRules())

/** 以单条规则评估文本：空数组 = 通过，否则是该规则的失败结果。 */
function evaluateOne(ruleId: string, text: string): string[] {
  const rule = engine.get(ruleId)
  if (rule === undefined) throw new TypeError(`规则 ${ruleId} 未注册`)
  return engine.evaluate(text, { rules: [rule] }).map(result => result.ruleId)
}

/** 一条规则的两段文本：要素齐全 vs 缺一项。 */
interface FamilyCase {
  /** 用例标题里的族名。 */
  family: string
  /** 规则 id。 */
  id: string
  /** 判据要素齐全：该规则不应报出。 */
  satisfied: string
  /** 缺少一项判据要素：应以该规则报出。 */
  missing: string
}

const cases: readonly FamilyCase[] = [
  // 外观设计对比（整体视觉效果 / 产品种类 / 设计特征 / 直接模仿 / 多设计框架）
  {
    family: 'DESIGN',
    id: 'DESIGN-01',
    satisfied: '本外观设计与对比设计的整体视觉效果相近。',
    missing: '本外观设计与对比设计的产品种类相同，形状与图案相近。',
  },
  {
    family: 'DESIGN',
    id: 'DESIGN-02',
    satisfied: '经认定，本外观设计与对比设计的产品种类相同。',
    missing: '本外观设计与对比设计在形状与图案上构成相近。',
  },
  {
    family: 'DESIGN',
    id: 'DESIGN-03',
    satisfied: '本外观设计的设计特征在于顶部弧形凹槽。',
    missing: '本外观设计与对比设计在整体视觉效果上相近，形状与图案存在差异。',
  },
  {
    family: 'DESIGN',
    id: 'DESIGN-04',
    satisfied: '被控设计对本外观设计构成直接模仿，仅存在局部差异。',
    missing: '被控设计对本外观设计构成直接模仿。',
  },
  {
    family: 'DESIGN',
    id: 'DESIGN-05',
    satisfied: '对多项设计逐项对比，逐一说明每项外观设计的异同。',
    missing: '对多项设计的异同作了说明。',
  },
  // 优先权（日期认定 / 转让 / 有效性 / 时间基准 / 部分优先权）
  {
    family: 'PRIORITY',
    id: 'PRIORITY-01',
    satisfied: '本申请主张优先权，优先权日为2024年3月1日。',
    missing: '本申请于2024年3月1日提交。',
  },
  {
    family: 'PRIORITY',
    id: 'PRIORITY-02',
    satisfied: '优先权的转让手续齐备，已办理著录项目变更。',
    missing: '优先权的有效性经审查成立。',
  },
  {
    family: 'PRIORITY',
    id: 'PRIORITY-03',
    satisfied: '经审查，优先权主张的有效性成立。',
    missing: '优先权主张符合首次申请的要求。',
  },
  {
    family: 'PRIORITY',
    id: 'PRIORITY-04',
    satisfied: '以优先权日作为现有技术的判断基准，该日早于本申请的申请日。',
    missing: '以2024年3月1日作为判断基准。',
  },
  {
    family: 'PRIORITY',
    id: 'PRIORITY-05',
    satisfied: '本案适用部分优先权，涉及多项优先权。',
    missing: '本案的优先权主张成立。',
  },
  // 公开方式（出版物 / 使用 / 互联网 / 公开日 / 保密）
  {
    family: 'PUBACC',
    id: 'PUBACC-01',
    satisfied: '该技术方案经期刊论文构成出版物公开。',
    missing: '该技术方案在展会上公开。',
  },
  {
    family: 'PUBACC',
    id: 'PUBACC-02',
    satisfied: '该产品在展会上销售，构成使用公开。',
    missing: '该产品的销售记录可查。',
  },
  {
    family: 'PUBACC',
    id: 'PUBACC-03',
    satisfied: '该方案在网站上发布，构成互联网公开。',
    missing: '该方案已在论坛发布。',
  },
  {
    family: 'PUBACC',
    id: 'PUBACC-04',
    satisfied: '核实该文献的公开日早于本申请的申请日。',
    missing: '核实该文献的公开发布时间较早。',
  },
  {
    family: 'PUBACC',
    id: 'PUBACC-05',
    satisfied: '双方之间存在保密义务，技术内容处于保密状态。',
    missing: '双方之间存在合作关系。',
  },
  // 保护客体（技术方案 / 技术问题 / 技术手段 / 排除客体 / 技术效果）
  {
    family: 'SUBJECT',
    id: 'SUBJECT-01',
    satisfied: '本方案构成技术方案，其利用了自然规律。',
    missing: '本方案利用自然规律解决散热问题。',
  },
  {
    family: 'SUBJECT',
    id: 'SUBJECT-02',
    satisfied: '本方案所要解决的技术问题是散热效率低。',
    missing: '本方案解决了散热效率低的缺陷。',
  },
  {
    family: 'SUBJECT',
    id: 'SUBJECT-03',
    satisfied: '本方案采用的技术手段是增设散热鳍片。',
    missing: '本方案增设散热鳍片以散热。',
  },
  {
    family: 'SUBJECT',
    id: 'SUBJECT-04',
    satisfied: '科学发现与智力活动规则均被排除，本申请属于可专利客体。',
    missing: '本申请属于技术方案。',
  },
  {
    family: 'SUBJECT',
    id: 'SUBJECT-05',
    satisfied: '本方案产生了提高散热效率的技术效果。',
    missing: '本方案提高了散热效率。',
  },
  // 创造性推理路径（多文件结合 / 技术启示 / 惯用手段 / 用途限定 / 预料不到）
  {
    family: 'REASON-CREATIVITY',
    id: 'REASON-CREATIVITY-02',
    satisfied: '以对比文件1为最接近的现有技术，区别技术特征为A，存在结合动机。',
    missing: '以对比文件1为最接近的现有技术，区别技术特征为A，故该方案显而易见。',
  },
  {
    family: 'REASON-CREATIVITY',
    id: 'REASON-CREATIVITY-03',
    satisfied: '对比文件给出了技术启示，该方案显而易见，本领域技术人员容易想到。',
    missing: '该方案显而易见，本领域技术人员容易想到。',
  },
  {
    family: 'REASON-CREATIVITY',
    id: 'REASON-CREATIVITY-04',
    satisfied: '该区别属于惯用技术手段，且众所周知。',
    missing: '该区别属于惯用技术手段。',
  },
  {
    family: 'REASON-CREATIVITY',
    id: 'REASON-CREATIVITY-05',
    satisfied: '用途特征对产品本身构成限定，创造性判断需结合该用途。',
    missing: '用途特征对产品本身构成限定。',
  },
  {
    family: 'REASON-CREATIVITY',
    id: 'REASON-CREATIVITY-06',
    satisfied: '该效果属于预料不到的技术效果，构成创造性的辅助判断依据。',
    missing: '该方案产生了有益效果。',
  },
  // 权利要求推理路径（不支持 / 功能性限定 / 充分公开 / 实验数据）
  {
    family: 'REASON-CLAIMS',
    id: 'REASON-CLAIMS-02',
    satisfied: '权利要求以说明书为依据，其概括范围合理，保护范围清楚。',
    missing: '权利要求以说明书为依据，保护范围清楚。',
  },
  {
    family: 'REASON-CLAIMS',
    id: 'REASON-CLAIMS-03',
    satisfied: '该功能性限定应结合具体实施方式解释，其保护范围以实施例为限。',
    missing: '该功能性限定应结合具体实施方式解释。',
  },
  {
    family: 'REASON-CLAIMS',
    id: 'REASON-CLAIMS-04',
    satisfied: '说明书充分公开，本领域技术人员能够实现该技术方案。',
    missing: '说明书充分公开，本领域技术人员能够实现。',
  },
  {
    family: 'REASON-CLAIMS',
    id: 'REASON-CLAIMS-05',
    satisfied: '说明书提供实验数据，证实该效果，满足充分公开的要求。',
    // 反例的第二步取 `可实施`，因为 `能够实现` 同时也是第三步（充分公开）的同义词。
    missing: '说明书提供实验数据，本方案可实施。',
  },
]

describe('checker 六族判据：要素齐全通过，缺一项以该规则报出', () => {
  it.each(cases)('$family $id', ({ id, satisfied, missing }) => {
    expect(evaluateOne(id, satisfied)).toEqual([])
    expect(evaluateOne(id, missing)).toEqual([id])
  })
})
