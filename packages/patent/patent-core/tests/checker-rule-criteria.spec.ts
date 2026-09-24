/**
 * src/patent/patent-core/tests — 六族之外各规则的判据正反例（#239 续）。
 *
 * `checker-families.spec.ts` 覆盖 DESIGN / PRIORITY / PUBACC / SUBJECT / REASON-CREATIVITY /
 * REASON-CLAIMS 六族；本文件补齐其余此前不出现于任何用例的规则：侵权、无效、复审与
 * 说明书/权利要求检查的单条规则，以及判据按 `pathElements` 逐步骤判定的推理路径规则。
 *
 * 每条规则给两段文本——判据齐全的应通过，缺一项的应以该规则本身报出。文本按规则的声明
 * 撰写，因此判据表被删项、换词，或判据被搬到该 checkType 不读的字段，对应用例就会红。
 * 声明字段与引擎读取面的对应关系（`engine.ts` 的 `evaluateRule` 分派）：`patent_novelty`
 * / `patent_infringement` / `patent_public_access` / `patent_subject_matter` /
 * `patent_amendment_scope` / `patent_design_comparison` 读 `requiredElements`；
 * `patent_disclosure` 与 `patent_spec` 读 `requiredAspects`；`patent_claim_analysis` 读
 * `dimensions`；`patent_inventiveness` 读 `stepElements`；`pathElements` 是所有 checkType
 * 的后置校验。
 *
 * `REASON-CREATIVITY-01B` 与 `INVENTIVENESS-TECHNICAL-PROBLEM` 曾把判据写在 `requiredElements`，
 * 而 `patent_inventiveness` 分派不读该字段，因此对任何文本都不报出（#262）。两条判据已改到本
 * checkType 会走的字段：前者是条件式的「援引公知常识时须有证据」，关键词可见性判定不了，
 * 改由 `customCheck` 表达并在本文件单列用例；后者是「须写明实际解决的技术问题」，写进
 * `pathElements`，作为下表一行（区别技术特征的可见性已由 `INVENTIVENESS-THREE-STEP` 把守）。
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

/** 一条规则的判据文本对：齐全 vs 缺一项（缺项侧不得含被缺要素的任何同义写法）。 */
interface CriterionCase {
  /** 判据所在的声明字段，同时是引擎读取该字段的检查器名。 */
  field: 'requiredElements' | 'requiredAspects' | 'dimensions' | 'stepElements' | 'pathElements'
  /** 规则 id。 */
  id: string
  /** 判据齐全：该规则不应报出。 */
  satisfied: string
  /** 缺少一项判据：应以该规则报出。 */
  missing: string
}

const cases: readonly CriterionCase[] = [
  // 新颖性特征覆盖：要求的全部技术特征须与对比文件逐一比对
  {
    field: 'requiredElements',
    id: 'NOVELTY-FEATURE-COVERAGE',
    satisfied: '逐一比对权利要求的技术特征与对比文件。',
    missing: '逐一比对权利要求与对比文件。',
  },
  // 等同侵权：被控方案的区别特征以等同手段替换
  {
    field: 'requiredElements',
    id: 'INFRINGEMENT-EQUIVALENCE',
    satisfied: '被控方案以等同手段替换对应特征，构成等同侵权。',
    missing: '被控方案以相同手段替换对应特征。',
  },
  // 禁止反悔：审查过程中的修改与陈述限制了等同范围
  {
    field: 'requiredElements',
    id: 'INFRINGEMENT-ESTOPPEL',
    satisfied: '审查过程中的修改导致放弃部分范围，适用禁止反悔。',
    missing: '审查过程中的修改已记录在案。',
  },
  // 捐献规则：说明书中披露却未主张的方案视为捐献
  {
    field: 'requiredElements',
    id: 'INFRINGEMENT-DEDICATION',
    satisfied: '该方案在说明书中披露却未写入权利要求，故适用捐献规则。',
    missing: '该方案在说明书中披露并已写入权利要求。',
  },
  // 无效新颖性单独对比：既要比对新颖性，又要限定单份对比文件；单份由 singleComparison 禁语把守
  {
    field: 'requiredElements',
    id: 'INVALID-NOVELTY-SINGLE-COMPARISON',
    satisfied: '每项权利要求与单份对比文件逐一比对，得出新颖性结论。',
    missing: '每项权利要求单独比对，得出新颖性结论。',
  },
  // 对比文件公开日核实：须落到优先权日这一时间基准
  {
    field: 'requiredElements',
    id: 'INVALID-PRIORITY-DATE-CHECK',
    satisfied: '核实对比文件的公开日早于涉案专利的优先权日。',
    missing: '核实对比文件的公开日。',
  },
  // 新证据关联性：每份新证据须说明其与驳回理由的关系
  {
    field: 'requiredElements',
    id: 'REEXAM-NEW-EVIDENCE',
    satisfied: '新证据与驳回理由直接相关。',
    missing: '补充材料与驳回理由直接相关。',
  },
  // 四相同标准：技术方案与技术效果均须比对
  {
    field: 'requiredElements',
    id: 'REASON-NOVELTY-01B',
    satisfied: '就技术方案与技术效果逐项比对四要素。',
    missing: '就技术方案逐项比对四要素。',
  },
  // 互联网公开认定：声明的「网络公开」是「互联网公开」的同义写法（synonymMap 单向），
  // 因此缺失侧去掉「网络公开」即可观测，而「互联网公开」用任一写法都能命中
  {
    field: 'requiredElements',
    id: 'REASON-NOVELTY-02B',
    satisfied: '认定该页面构成互联网公开，网络公开日明确。',
    missing: '认定该页面构成互联网公开，公开日明确。',
  },
  // 非可专利客体排除：三类排除客体逐项论证
  {
    field: 'requiredElements',
    id: 'REASON-OTHER-01B',
    satisfied: '逐项排除科学发现、智力活动规则与疾病诊断方法。',
    missing: '已逐项审查保护客体。',
  },

  // 充分公开：两个维度的同义关系单向（synonymMap 中「充分公开」含「能够实现」），
  // 缺失侧去掉「能够实现」，此时「充分公开」仍以本字写法命中
  {
    field: 'requiredAspects',
    id: 'DISCLOSURE-SUFFICIENCY',
    satisfied: '说明书充分公开本方案，使本领域技术人员能够实现。',
    missing: '说明书充分公开了本方案。',
  },
  // 发明内容三段式：技术问题-技术方案-有益效果
  {
    field: 'requiredAspects',
    id: 'SPEC-CONTENT-TRIPLE',
    satisfied: '发明内容写明要解决的技术问题、技术方案与有益效果。',
    missing: '发明内容写明要解决的技术问题与技术方案。',
  },
  // 实施例存在性
  {
    field: 'requiredAspects',
    id: 'SPEC-EMBODIMENTS',
    satisfied: '说明书记载了至少一个实施例。',
    missing: '说明书记载了具体实施方式。',
  },
  // 效果数据与实施例对应
  {
    field: 'requiredAspects',
    id: 'SPEC-EFFECT-DATA',
    satisfied: '有益效果由实施例中的实验数据支撑。',
    missing: '有益效果以定性方式描述。',
  },
  // 附图标记一致性（有附图时）
  {
    field: 'requiredAspects',
    id: 'SPEC-DRAWING-MARKS',
    satisfied: '具体实施方式引用附图，并标注附图标记。',
    missing: '具体实施方式描述了各部件的连接关系。',
  },

  // 权利要求清楚性与支持
  {
    field: 'dimensions',
    id: 'CLAIM-CLARITY-SUPPORT',
    satisfied: '权利要求保护范围清楚，且以说明书为依据。',
    missing: '权利要求保护范围清楚。',
  },
  // 必要技术特征完整性与一致性
  {
    field: 'dimensions',
    id: 'CLAIM-ESSENTIAL-FEATURES',
    satisfied: '独立权利要求包含必要技术特征，与说明书记载一致。',
    missing: '独立权利要求包含必要技术特征。',
  },
  // 复审理由范围：清楚性 + 与驳回决定的一致性
  {
    field: 'dimensions',
    id: 'REEXAM-GROUNDS-SCOPE',
    satisfied: '复审理由清楚，与驳回决定逐条对应。',
    missing: '复审理由清楚。',
  },

  // 无效组合动机：三步法三步齐备（引擎要求 stepElements 满三步才校验）
  {
    field: 'stepElements',
    id: 'INVALID-COMBINATION-MOTIVATION',
    satisfied: '以最接近的现有技术为起点，确定区别技术特征，并论证存在组合动机。',
    missing: '以最接近的现有技术为起点，确定区别技术特征。',
  },

  // 实际解决技术问题：三步法第二步须写明实际解决的技术问题（区别技术特征的可见性由
  // INVENTIVENESS-THREE-STEP 把守，此处不重复）
  {
    field: 'pathElements',
    id: 'INVENTIVENESS-TECHNICAL-PROBLEM',
    satisfied: '以最接近的现有技术为起点确定区别技术特征，并写明本发明实际解决的技术问题。',
    missing: '以最接近的现有技术为起点确定区别技术特征，并进一步论证技术启示。',
  },
  // 公开方式判断：公开方式 + 时间基准两步
  {
    field: 'pathElements',
    id: 'REASON-NOVELTY-02A',
    satisfied: '现有技术的公开方式为出版物，公开日为申请日前一天。',
    missing: '现有技术的公开方式为出版物。',
  },
  // 抵触申请：构成要件 + 仅用于新颖性判断
  {
    field: 'pathElements',
    id: 'REASON-NOVELTY-03A',
    satisfied: '该对比文件构成抵触申请，仅用于新颖性判断。',
    missing: '该对比文件构成抵触申请。',
  },
  // 优先权审查：优先权 → 申请日 → 现有技术时间基准三步
  {
    field: 'pathElements',
    id: 'REASON-NOVELTY-03B',
    satisfied: '优先权有效，申请日符合形式要求，现有技术的判断以优先权日为准。',
    missing: '优先权有效，申请日符合形式要求。',
  },
  // 保护客体：技术方案认定 → 自然规律 → 可专利主题三步
  {
    field: 'pathElements',
    id: 'REASON-OTHER-01A',
    satisfied: '该方案利用自然规律解决技术问题，构成技术方案，因而属于可专利主题。',
    missing: '该方案利用自然规律解决技术问题，属于技术方案。',
  },
  // 修改超范围：超范围判断 → 直接且毫无疑义 → 原申请文件三步
  {
    field: 'pathElements',
    id: 'REASON-OTHER-02A',
    satisfied: '本次修改是否超范围，应从原说明书和原权利要求出发，判断能否直接且毫无疑义地确定。',
    missing: '本次修改应从原说明书和原权利要求出发，判断能否直接且毫无疑义地确定。',
  },
  // 优先权程序：优先权转让 → 申请日 → 转让文件三步
  {
    field: 'pathElements',
    id: 'REASON-OTHER-02B',
    satisfied: '优先权转让在申请日之前完成，转让文件齐备。',
    missing: '优先权转让文件齐备。',
  },
  // 实用性：实用性 → 能够制造/使用 → 积极效果三步
  {
    field: 'pathElements',
    id: 'REASON-OTHER-03',
    satisfied: '本方案具有实用性，能够制造和使用，并产生积极效果。',
    missing: '本方案具有实用性，能够制造和使用。',
  },
]

describe('checker 六族之外各规则：判据齐全通过，缺一项以该规则报出', () => {
  it.each(cases)('$field $id', ({ id, satisfied, missing }) => {
    expect(evaluateOne(id, satisfied)).toEqual([])
    expect(evaluateOne(id, missing)).toEqual([id])
  })

  it('REASON-CREATIVITY-01B：条件式判据只在援引公知常识时要求证据', () => {
    const id = 'REASON-CREATIVITY-01B'
    // 未援引公知常识：不报出（该步缺失由 REASON-CREATIVITY-01A 的三步法路径把守）
    expect(evaluateOne(id, '该区别是常规选择，无需创造性劳动。')).toEqual([])
    // 援引且给出证据：不报出
    expect(evaluateOne(id, '该区别属于公知常识，教科书中有明确记载。')).toEqual([])
    // 援引而无证据：以该规则报出
    expect(evaluateOne(id, '该区别属于公知常识，无需创造性劳动。')).toEqual([id])
  })

  it('覆盖表里没有重复的规则 id', () => {
    const ids = cases.map(entry => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
