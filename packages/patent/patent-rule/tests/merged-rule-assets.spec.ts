import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateText, loadPatentFullRuleSet, loadRuleSetFromFile, patentAssetDir } from '@deepseek-ai/dsh-patent-rule'

/** 并入资产的来源对照表：规则 id → 上游文件（Mady domains/rules/data/rules/）。 */
const MERGED_RULE_SOURCES: Record<string, string> = {
  'CON-COMP-0103': 'compliance-enforceable.yaml',
  'CON-COMP-0106': 'compliance-enforceable.yaml',
  'EX-SRC-001': 'patent-examination-rules.yaml',
  'EX-NOV-001': 'patent-examination-rules.yaml',
  'EX-DIS-001': 'patent-examination-rules.yaml',
  'EX-SPEC-003': 'patent-examination-rules.yaml',
  'EX-INV-004': 'patent-examination-rules.yaml',
  'P-NOV-001': 'patent-core-rules.yaml',
  'P-NOV-002': 'patent-core-rules.yaml',
  'P-NOV-003': 'patent-core-rules.yaml',
  'P-UTL-001': 'patent-core-rules.yaml',
  'JD-INF-001': 'patent-judgment-rules.yaml',
  'JD-INF-006': 'patent-judgment-rules.yaml',
  'IPC-C12-DIS-001': 'patent-ipc-rules.yaml',
}

/**
 * 未并入的上游条目（并入硬边界）：上游无可字面匹配的载荷、或与本仓既有规则等价、
 * 或载荷为正确表述中的论证用词（字面禁令会误伤）。理由见
 * `.agents/notes/implemented/architecture/2026-09-21-mady-rule-asset-merge-boundary.md`。
 */
const NOT_MERGED_RULE_IDS = [
  'INF-SCOPE-002',
  'INF-DET-001',
  'INF-ALL-ELEMENTS',
  'CON-202',
  'CON-304',
  'PR-FMT-001',
  'CLA-002',
  'EX-CLM-003',
  'EX-CLM-006',
  'EX-NOV-002',
  'AMD-001',
  'amd-001',
  'NOV-001',
  'INV-001',
  'DIS-001',
  'RES-001',
  'P-INV-005',
  'PR-INV-001',
  'JD-DEF-006',
  'IPC-H02-INV-001',
]

describe('merged rule assets', () => {
  it('current-law.yaml holds the three current-statute bans', () => {
    const loaded = loadRuleSetFromFile(join(patentAssetDir(), 'current-law.yaml'))
    expect(loaded.warnings).toEqual([])
    expect(loaded.ruleSet.rules.map(r => r.id)).toEqual([
      'LAW-TIMELIMIT-001',
      'LAW-EQUIV-BASIS-001',
      'LAW-UM-SUBJECT-001',
    ])
  })

  it('mady-gap-rules.yaml holds exactly the traced merge set', () => {
    const loaded = loadRuleSetFromFile(join(patentAssetDir(), 'mady-gap-rules.yaml'))
    expect(loaded.warnings).toEqual([])
    expect(new Set(loaded.ruleSet.rules.map(r => r.id))).toEqual(new Set(Object.keys(MERGED_RULE_SOURCES)))
  })

  it('merged rules are review-downgraded: no block action, severities stay in the closed set', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const merged = ruleSet.rules.filter(
      rule => rule.id in MERGED_RULE_SOURCES || rule.id.startsWith('LAW-'),
    )
    expect(merged.length).toBe(Object.keys(MERGED_RULE_SOURCES).length + 3)
    for (const rule of merged) {
      expect(rule.action).not.toBe('block')
      expect(['critical', 'major', 'minor']).toContain(rule.severity)
    }
  })

  it('merged rules are part of the patent-full scope', () => {
    const ids = new Set(loadPatentFullRuleSet().ruleSet.rules.map(r => r.id))
    for (const id of [...Object.keys(MERGED_RULE_SOURCES), 'LAW-TIMELIMIT-001', 'LAW-EQUIV-BASIS-001', 'LAW-UM-SUBJECT-001']) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('not-merged upstream ids stay out of the rule set (merge boundary)', () => {
    const ids = new Set(loadPatentFullRuleSet().ruleSet.rules.map(r => r.id))
    for (const id of NOT_MERGED_RULE_IDS) {
      expect(ids.has(id)).toBe(false)
    }
  })

  it('current-law bans reject the superseded statement and pass the current one', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const hits = (text: string, id: string): boolean =>
      evaluateText(text, ruleSet).violations.some(v => v.ruleId === id)

    expect(hits('侵权诉讼时效为两年，自权利人知道之日起算。', 'LAW-TIMELIMIT-001')).toBe(true)
    expect(hits('持续侵权应追究起诉前两年的损失。', 'LAW-TIMELIMIT-001')).toBe(true)
    expect(hits('侵权诉讼时效为三年，自权利人知道或应当知道之日起算。', 'LAW-TIMELIMIT-001')).toBe(false)

    expect(hits('依据法释〔2001〕17号，该特征构成等同。', 'LAW-EQUIV-BASIS-001')).toBe(true)
    expect(hits('依据（2001）17号，该特征构成等同。', 'LAW-EQUIV-BASIS-001')).toBe(true)
    expect(hits('依据法释〔2009〕20号第17条，该特征构成等同。', 'LAW-EQUIV-BASIS-001')).toBe(false)

    expect(hits('实用新型的保护客体见专利法第二条第二款。', 'LAW-UM-SUBJECT-001')).toBe(true)
    expect(hits('实用新型的保护客体见专利法第二条第三款。', 'LAW-UM-SUBJECT-001')).toBe(false)
    // 两款并列（第二款定义发明、第三款定义实用新型）是正确表述，不命中。
    expect(hits('专利法第二条第二款定义发明，第二条第三款定义实用新型，二者保护客体不同。', 'LAW-UM-SUBJECT-001')).toBe(false)
    expect(hits('第二条第二款所定义的实用新型，其保护客体为产品形状构造。', 'LAW-UM-SUBJECT-001')).toBe(true)
  })

  it('merged bans fire on the vague/placeholder wording only', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const hits = (text: string, id: string): boolean =>
      evaluateText(text, ruleSet).violations.some(v => v.ruleId === id)

    expect(hits('根据相关法律，该行为构成侵权。', 'CON-COMP-0103')).toBe(true)
    expect(hits('根据专利法第十一条，该行为构成侵权。', 'CON-COMP-0103')).toBe(false)
    expect(hits('对比文件D0公开了该技术特征。', 'EX-SRC-001')).toBe(true)
    expect(hits('对比文件CN103456789A公开了该技术特征。', 'EX-SRC-001')).toBe(false)
  })

  it('merged completeness rules report missing elements and pass complete text', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const hits = (text: string, id: string): boolean =>
      evaluateText(text, ruleSet).violations.some(v => v.ruleId === id)

    expect(hits('综上，该方案不具备新颖性。', 'CON-COMP-0106')).toBe(true)
    expect(hits('综上，依据对比文件1公开的实施例，该方案不具备新颖性。', 'CON-COMP-0106')).toBe(false)

    expect(hits('实用性分析：本方案能够在产业上制造。', 'P-UTL-001')).toBe(true)
    expect(hits('实用性分析：本方案能够在产业上制造和使用。', 'P-UTL-001')).toBe(false)
    // 五部分缺两项 → 违规；缺一项（无附图时的附图说明）→ 放行
    expect(
      hits('技术领域：…；发明内容：…；具体实施方式：…', 'EX-DIS-001'),
    ).toBe(true)
    expect(
      hits('技术领域：…；背景技术：…；发明内容：…；具体实施方式：…', 'EX-DIS-001'),
    ).toBe(false)
    expect(
      hits('技术领域：…；背景技术：…；发明内容：…；附图说明：…；具体实施方式：…', 'EX-DIS-001'),
    ).toBe(false)
  })
})
