import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadActivationOverrides,
  loadPatentComplianceRuleSet,
  loadPatentElectricalRuleSet,
  loadPatentFullRuleSet,
  selectGateRules,
} from '@deepseek-ai/dsh-patent-rule'

const COMPLIANCE = 'compliance.yaml'
const ELECTRICAL = 'electrical-section-h.yaml'
const OVERRIDES = 'activation-overrides.yaml'

/** 搭建一个 rulesDir 夹具：patent/ 下写指定文件。 */
function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'patent-compliance-'))
  const patentDir = join(root, 'patent')
  mkdirSync(patentDir)
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(patentDir, name), content, 'utf8')
  }
  return root
}

const GOOD_RULE = '  - id: C1\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n'

describe('patent compliance loading', () => {
  it('loadPatentComplianceRuleSet surfaces non-fatal rule warnings from the asset', () => {
    const root = makeFixture({
      [COMPLIANCE]: 'rules:\n' + GOOD_RULE + '  - severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["y"] }\n',
    })
    const loaded = loadPatentComplianceRuleSet(root)
    expect(loaded.source).not.toBeNull()
    expect(loaded.ruleSet.rules.length).toBe(1)
    expect(loaded.warnings.some(w => w.includes('缺少 id'))).toBe(true)
  })

  it('loadPatentElectricalRuleSet merges base and electrical assets', () => {
    const root = makeFixture({
      [COMPLIANCE]: 'version: "1.0"\nrules:\n' + GOOD_RULE,
      [ELECTRICAL]: 'version: "2.0"\nrules:\n  - id: E1\n    name: e\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["e"] }\n',
    })
    const loaded = loadPatentElectricalRuleSet(root)
    expect(loaded.ruleSet.rules.map(r => r.id).sort()).toEqual(['C1', 'E1'])
    expect(loaded.ruleSet.version).toBe('1.0')
    expect(loaded.source).toContain(COMPLIANCE)
    expect(loaded.source).toContain(ELECTRICAL)
    expect(loaded.warnings.length).toBe(0)
  })

  it('loadPatentElectricalRuleSet falls back to the electrical version', () => {
    const root = makeFixture({
      [COMPLIANCE]: 'rules:\n' + GOOD_RULE,
      [ELECTRICAL]: 'version: "3.0"\nrules:\n  - id: E1\n    name: e\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["e"] }\n',
    })
    const loaded = loadPatentElectricalRuleSet(root)
    expect(loaded.ruleSet.version).toBe('3.0')
  })

  it('loadPatentElectricalRuleSet defaults the merged version when neither asset declares one', () => {
    const root = makeFixture({
      [COMPLIANCE]: 'rules:\n' + GOOD_RULE,
      [ELECTRICAL]: 'rules:\n  - id: E1\n    name: e\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["e"] }\n',
    })
    const loaded = loadPatentElectricalRuleSet(root)
    expect(loaded.ruleSet.version).toBe('1.0')
  })

  it('loadPatentElectricalRuleSet falls back to base when the electrical asset is missing', () => {
    const root = makeFixture({ [COMPLIANCE]: 'rules:\n' + GOOD_RULE })
    const loaded = loadPatentElectricalRuleSet(root)
    expect(loaded.ruleSet.rules.map(r => r.id)).toEqual(['C1'])
    expect(loaded.source).toContain(COMPLIANCE)
    expect(loaded.source).not.toContain(ELECTRICAL)
  })

  it('loadPatentElectricalRuleSet returns the base result when compliance is missing', () => {
    const loaded = loadPatentElectricalRuleSet('/nonexistent/rules-root')
    expect(loaded.source).toBeNull()
    expect(loaded.ruleSet.rules.length).toBe(0)
    expect(loaded.warnings.some(w => w.includes('门禁降级为放行'))).toBe(true)
  })

  it('loadActivationOverrides reports parse errors, bad entries, and unreadable files', () => {
    const root = makeFixture({ [OVERRIDES]: 'overrides: [\n' })
    const broken = loadActivationOverrides(root)
    expect(broken.warnings.some(w => w.includes('激活覆盖文件解析失败'))).toBe(true)

    writeFileSync(join(root, 'patent', OVERRIDES), 'foo: bar\n', 'utf8')
    const noOverrides = loadActivationOverrides(root)
    expect(noOverrides.source).not.toBeNull()
    expect(noOverrides.byId.size).toBe(0)
    expect(noOverrides.warnings.length).toBe(0)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: 42\n', 'utf8')
    const badValue = loadActivationOverrides(root)
    expect(badValue.byId.size).toBe(0)
    expect(badValue.warnings.some(w => w.includes('覆盖值必须是对象'))).toBe(true)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { action: detonate }\n', 'utf8')
    const badAction = loadActivationOverrides(root)
    expect(badAction.byId.size).toBe(0)
    expect(badAction.warnings.some(w => w.includes('非法 action'))).toBe(true)

    // check 级字段非法值：补丁整条跳过（fail-safe，不应用半截补丁）。四种非法形态各一：
    // 非数组 / 空数组 / 元素全为空串的数组 / 非布尔开关。
    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { addKeywords: "x" }\n', 'utf8')
    const badKeywords = loadActivationOverrides(root)
    expect(badKeywords.byId.size).toBe(0)
    expect(badKeywords.warnings.some(w => w.includes('addKeywords 必须是非空字符串数组'))).toBe(true)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { additionalNegationWords: [] }\n', 'utf8')
    const emptyWords = loadActivationOverrides(root)
    expect(emptyWords.byId.size).toBe(0)
    expect(emptyWords.warnings.some(w => w.includes('additionalNegationWords 必须是非空字符串数组'))).toBe(true)

    // 元素全为空串的数组与空数组同责：空串被 word.length > 0 守卫丢弃，豁免不了任何命中，
    // 与资产解析器（RuleLoader.parseCheck）判据一致。带首尾空白的元素则整表保留——它按
    // 字面参与匹配，会生效，拒绝它会连带丢弃作者真正写下的放行词。
    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { additionalNegationWords: [""] }\n', 'utf8')
    const blankWords = loadActivationOverrides(root)
    expect(blankWords.byId.size).toBe(0)
    expect(blankWords.warnings.some(w => w.includes('additionalNegationWords 必须是非空字符串数组'))).toBe(true)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { additionalNegationWords: ["防 ", "反"] }\n', 'utf8')
    const paddedWords = loadActivationOverrides(root)
    expect(paddedWords.byId.get('ID1')?.additionalNegationWords).toEqual(['防 ', '反'])
    expect(paddedWords.warnings.length).toBe(0)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { negationContext: "yes" }\n', 'utf8')
    const badFlag = loadActivationOverrides(root)
    expect(badFlag.byId.size).toBe(0)
    expect(badFlag.warnings.some(w => w.includes('negationContext 必须是布尔值'))).toBe(true)

    writeFileSync(join(root, 'patent', OVERRIDES), 'overrides:\n  ID1: { action: review }\n', 'utf8')
    const valid = loadActivationOverrides(root)
    expect(valid.byId.get('ID1')?.action).toBe('review')
    expect(valid.warnings.length).toBe(0)

    rmSync(join(root, 'patent', OVERRIDES))
    mkdirSync(join(root, 'patent', OVERRIDES))
    try {
      const unreadable = loadActivationOverrides(root)
      expect(unreadable.source).toBeNull()
      expect(unreadable.byId.size).toBe(0)
      expect(unreadable.warnings.some(w => w.includes('激活覆盖文件加载失败'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('selectGateRules drops the version when the rule set has none', () => {
    const gateRules = selectGateRules({ rules: [] })
    expect(gateRules.version).toBeUndefined()
    expect(gateRules.rules).toEqual([])
  })

  it('loadPatentFullRuleSet returns the base result when compliance is missing', () => {
    const loaded = loadPatentFullRuleSet('/nonexistent/rules-root')
    expect(loaded.source).toBeNull()
    expect(loaded.ruleSet.rules.length).toBe(0)
    expect(loaded.warnings.some(w => w.includes('门禁降级为放行'))).toBe(true)
  })
})
