/**
 * 规则资产评审样本（可执行版）——nuo 规则激活评审的结论在此钉成可执行判据。
 *
 * 评审结论（判定 + 依据 + 样本）只活在文档里会腐烂；每条样本独立成一个 `it` 后，
 * 负控制可逐条对名（哪条判据转红 = 哪处注入生效），且相邻样本应保持绿（证明判据有区分度）。
 *
 * 本轮样本对应 issue #357（规则资产语义增强 3 项）：
 *   ① X-REF-003 全角/大小写变体漏报 → 补关键词（addKeywords 补丁）
 *   ② EX-SEL-004 误伤合法安防主题 → 开否定语境 + 4 个紧邻前缀词
 *   ③ EX-INV-007 / IPC-GEN-INV-002 重复 → 后者降 log（同一问题只留一条用户可见意见）
 * 另含两条「域词不外溢」样本：证明 additionalNegationWords 是**逐规则**的，
 * 把它们塞进全局词表会让其它规则的判定转红。
 */

import { describe, expect, it } from 'vitest'
import { evaluateText, loadPatentFullRuleSet, RuleOutputGate } from '@deepseek-ai/dsh-patent-rule'

/** 判定一段文本命中的规则 id 集合。 */
function hitIds(text: string): string[] {
  const { ruleSet } = loadPatentFullRuleSet()
  return evaluateText(text, ruleSet).violations.map(v => v.ruleId)
}

/** 判定规则对一段文本的处置级别（未命中为 undefined）。 */
function hitAction(text: string, ruleId: string): string | undefined {
  const { ruleSet } = loadPatentFullRuleSet()
  return evaluateText(text, ruleSet).violations.find(v => v.ruleId === ruleId)?.action
}

describe('规则资产评审样本（#357）', () => {
  // -------------------------------------------------------------------------
  // ① X-REF-003：占位案例案号的 12 种拼写（3 案号族 × 4 拼写）
  //    原 asset 只有「半角大写」3 条 ⇒ 另 9 种为漏报（issue #357 第 1 项）。
  // -------------------------------------------------------------------------

  /** 补丁新增的 9 个变体：每个变体 = `addKeywords` 里的一条 OR 备选。 */
  const NEW_VARIANTS: ReadonlyArray<{ label: string; text: string }> = [
    { label: '最高法知民终 · 全角大写', text: '参见（202X）最高法知民终999号判决。' },
    { label: '最高法知民终 · 半角小写', text: '参见(202x)最高法知民终999号判决。' },
    { label: '最高法知民终 · 全角小写', text: '参见（202x）最高法知民终999号判决。' },
    { label: '京73民初 · 全角大写', text: '参见（202X）京73民初888号判决。' },
    { label: '京73民初 · 半角小写', text: '参见(202x)京73民初888号判决。' },
    { label: '京73民初 · 全角小写', text: '参见（202x）京73民初888号判决。' },
    { label: '最高法知行终 · 全角大写', text: '参见（202X）最高法知行终77号判决。' },
    { label: '最高法知行终 · 半角小写', text: '参见(202x)最高法知行终77号判决。' },
    { label: '最高法知行终 · 全角小写', text: '参见（202x）最高法知行终77号判决。' },
  ]

  for (const sample of NEW_VARIANTS) {
    it(`X-REF-003 命中占位案号变体（#357 补漏报）：${sample.label}`, () => {
      expect(hitIds(sample.text)).toContain('X-REF-003')
    })
  }

  it('X-REF-003 半角大写占位案号仍命中（拼写覆盖不得回退）', () => {
    // 本用例是**行为回归**：只要「半角大写」这种拼写仍被覆盖即可通过——不区分由基础资产
    // 条目覆盖还是由补丁 OR 组覆盖（两者**有意**重叠：OR 组自包含，故基础条目被重新移植
    // 改写时变体覆盖不会失守）。"补丁是增补而非替换" 由 patent-full-rule-set.spec.ts 的
    // 补丁落地用例按结构钉住。
    for (const text of [
      '参见(202X)最高法知民终999号判决。',
      '参见(202X)京73民初888号判决。',
      '参见(202X)最高法知行终77号判决。',
    ]) {
      expect(hitIds(text)).toContain('X-REF-003')
    }
  })

  it('X-REF-003 误拦面不扩大：真实案号（数字年份）全/半角均放行', () => {
    for (const text of [
      '参见（2020）最高法知民终123号判决。',
      '参见(2020)最高法知民终123号判决。',
      '参见（2019）京73民初1234号判决。',
      '参见（2021）最高法知行终959号判决。',
    ]) {
      expect(hitIds(text)).not.toContain('X-REF-003')
    }
  })

  // -------------------------------------------------------------------------
  // ② EX-SEL-004：合法安防主题放行（4 个领域放行词各承重）
  // -------------------------------------------------------------------------

  /**
   * 应放行的合法安防/检测主题：前 4 条各对应 `additionalNegationWords` 里的一个词，
   * 且该词紧接在被命中词之前（组成一个复合技术主题）；后 2 条走默认否定词表的 24 字
   * 窗口——第 5 条里「避免」与「克隆人」相隔「使用」，第 6 条承重的是 `negationContext`
   * 开关本身（原 asset 未开该开关，连默认词表也用不上）。两组证明两条豁免通道各自独立生效。
   */
  const EX_SEL_004_EXEMPT: ReadonlyArray<{ label: string; text: string }> = [
    { label: '裸「防」：防窃听装置', text: '本发明提供一种防窃听装置。' },
    { label: '裸「反」：反窃听系统', text: '本发明提供一种反窃听系统。' },
    { label: '「抑制」：抑制赌博行为', text: '本发明用于抑制赌博行为的方法。' },
    { label: '「检测」（前置）：检测窃听行为', text: '本发明涉及用于检测窃听行为的设备。' },
    { label: '默认词表仍叠加生效：避免…克隆人', text: '文中应避免使用克隆人相关表述。' },
    { label: '默认词表（开关承重）：防止窃听', text: '本方案用于防止窃听。' },
  ]

  for (const sample of EX_SEL_004_EXEMPT) {
    it(`EX-SEL-004 放行合法主题（#357 补误伤）：${sample.label}`, () => {
      expect(hitIds(sample.text)).not.toContain('EX-SEL-004')
    })
  }

  it('EX-SEL-004 放行面不外溢：真实违规主题仍命中', () => {
    for (const text of ['本装置可用于赌博。', '本方法使用克隆人胚胎。', '该系统用于窃听他人通话。']) {
      expect(hitIds(text)).toContain('EX-SEL-004')
    }
  })

  it('EX-SEL-004 紧邻前缀不放行远距离命中（并入 24 字窗口时这些红线会被静默放行）', () => {
    // 放行词是**紧邻前缀**语义：只在与命中词相邻时构成复合主题（「防」+「窃听」）。
    // 曾被并入 negationContext 的 24 字窗口，于是下列文本里的「检测/防/抑制/反」把
    // 十几字之外的违规命中一并放行——公序良俗是 critical 红线，静默放行不可接受。
    // 窗口版对每一条都返回"有否定语境"，故此用例是紧邻语义的回归判据。
    for (const text of [
      '本系统通过检测用户行为，诱导其参与赌博。',
      '本装置防范风险，可用于赌博。',
      '本发明涉及抑制噪声的电路，也能用于赌博网站。',
      '该设备反向兼容，适用于造假凭证。',
    ]) {
      expect(hitIds(text)).toContain('EX-SEL-004')
    }
  })

  it('EX-SEL-004 已登记非对称性：豁免只查命中位置之前，后缀式「窃听检测」仍命中', () => {
    // 豁免（默认词表的 24 字窗口与领域词的紧邻前缀）都只看命中位置**之前**，
    // 故「窃听检测方法」中的「检测」不构成豁免。这是有意保留的语义（改它等于把豁免
    // 扩成双向，会同步放大所有否定语境规则的放行面）。此断言把该非对称性钉成显式事实，
    // 将来若引入后置语境豁免，此用例应改为断言放行。
    expect(hitIds('本发明涉及窃听检测方法。')).toContain('EX-SEL-004')
  })

  // -------------------------------------------------------------------------
  // ③ EX-INV-007 / IPC-GEN-INV-002：重复项只留一条用户可见意见
  // -------------------------------------------------------------------------

  const DUP_PAIR = ['EX-INV-007', 'IPC-GEN-INV-002'] as const

  for (const sample of [
    { label: '中文', text: '该论述存在事后诸葛亮之嫌。' },
    { label: '英文', text: 'This reasoning is hindsight.' },
  ]) {
    it(`去重(#357)：${sample.label}样本在输出门禁只产出一条该问题的提示`, () => {
      const { ruleSet } = loadPatentFullRuleSet()
      const gate = new RuleOutputGate(ruleSet)
      const result = gate.process(sample.text)

      // 用户可见（warn 级）的只剩一条
      const visible = result.warnHits.filter(id => (DUP_PAIR as readonly string[]).includes(id))
      expect(visible).toEqual(['EX-INV-007'])

      // 重复项本身未消失，只是降为 log（record-only，不改文本、不挂审批）
      expect(hitAction(sample.text, 'IPC-GEN-INV-002')).toBe('log')
      expect(result.needsApproval).toBe(false)
    })
  }

  // -------------------------------------------------------------------------
  // ④ 域词不外溢：additionalNegationWords 是逐规则的，不是全局共享词表
  //    若把「防/反/抑制/检测」塞进 DEFAULT_NEGATION_WORDS，下面两条会转红。
  // -------------------------------------------------------------------------

  it('域禁词不外溢：PAT-RISK-001 的「侵权」不被「检测」前缀豁免', () => {
    // 「检测」若是全局否定词，「经检测，该产品构成侵权」会被判为否定语境而漏报风险结论。
    expect(hitIds('经检测，该产品构成侵权。')).toContain('PAT-RISK-001')
  })

  it('域禁词不外溢：PAT-ABS-001 的「绝对」不被「反」前缀豁免', () => {
    // 「反」若是全局否定词，「反对绝对化表述」会被判为否定语境而漏报。
    expect(hitIds('反对绝对化表述。')).toContain('PAT-ABS-001')
  })
})
