import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadRuleSetDir,
  loadRuleSetFromFile,
  mergeRuleSets,
  parseRuleSetFromYaml,
  validateRuleSet,
} from '@deepseek-ai/dsh-patent-rule'

const ARRAY_YAML = `
version: "1.0"
rules:
  - id: CON-101
    name: 发明定义-技术方案三要素
    domain: patent
    phase: 申请前
    severity: critical
    action: block
    legalBasis: 专利法第二条第二款
    check:
      type: structural_analysis
      requiresAll:
        - element: technical_means
          patterns: ["装置|设备|系统"]
        - element: technical_effect
          patterns: ["提高|改善"]
      minConfidence: 0.5
`

const MAP_YAML = `
rules:
  subject_matter_excluded_art5:
    id: CON-102
    name: 违法排除
    severity: critical
    action: block
    check:
      type: keyword_blocklist
      keywords: ["赌博|博彩"]
      negationContext: true
`

describe('RuleLoader', () => {
  it('parseRuleSetFromYaml parses array form', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(ARRAY_YAML, 'array.yaml')
    expect(issues.length).toBe(0)
    expect(ruleSet.rules.length).toBe(1)
    const rule = ruleSet.rules[0]
    expect(rule?.id).toBe('CON-101')
    expect(rule?.domain).toBe('patent')
    expect(rule?.phase).toBe('申请前')
    expect(rule?.legalBasis).toBe('专利法第二条第二款')
    expect(rule?.check.type).toBe('structural_analysis')
    if (rule?.check.type === 'structural_analysis') {
      expect(rule.check.requiresAll.length).toBe(2)
      expect(rule.check.minConfidence).toBe(0.5)
    }
  })

  it('parseRuleSetFromYaml parses map form (BCIP style)', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(MAP_YAML, 'map.yaml')
    expect(issues.length).toBe(0)
    expect(ruleSet.rules.length).toBe(1)
    const rule = ruleSet.rules[0]
    expect(rule?.id).toBe('CON-102')
    expect(rule?.check.type).toBe('keyword_blocklist')
    if (rule?.check.type === 'keyword_blocklist') {
      expect(rule.check.negationContext).toBe(true)
    }
  })

  it('parseRuleSetFromYaml reports invalid severity and missing id', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-X
    name: bad
    severity: "fatal"
    action: block
    check: { type: keyword_blocklist, keywords: ["x"] }
  - name: no-id
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["y"] }
`,
    )
    expect(issues.some(i => i.message.includes('severity'))).toBe(true)
    expect(issues.some(i => i.message.includes('缺少 id'))).toBe(true)
  })

  it('parseRuleSetFromYaml rejects invalid regex in pattern_analysis', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-P
    name: bad regex
    severity: major
    action: warn
    check: { type: pattern_analysis, patterns: ["("] }
`,
    )
    expect(issues.some(i => i.message.includes('非法正则'))).toBe(true)
  })

  it('parseRuleSetFromYaml rejects nested-quantifier regex (ReDoS guard)', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-REDOS
    name: redos
    severity: major
    action: warn
    check: { type: pattern_analysis, patterns: ["(a+)+"] }
`,
    )
    expect(issues.some(i => i.message.includes('灾难性回溯'))).toBe(true)
  })

  it('parseRuleSetFromYaml applies the ReDoS guard to structural_analysis patterns too', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-REDOS-S
    name: redos structural
    severity: major
    action: warn
    check:
      type: structural_analysis
      requiresAll:
        - element: tech
          patterns: ["(x*)*"]
`,
    )
    expect(issues.some(i => i.message.includes('灾难性回溯'))).toBe(true)
  })

  it('parseRuleSetFromYaml reports duplicate ids', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-DUP
    name: a
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["x"] }
  - id: CON-DUP
    name: b
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["y"] }
`,
    )
    expect(issues.some(i => i.message.includes('重复的规则 id'))).toBe(true)
  })

  it('loadRuleSetFromFile reads a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-test-'))
    const path = join(dir, 'test.yaml')
    writeFileSync(path, ARRAY_YAML, 'utf8')
    const loaded = loadRuleSetFromFile(path)
    expect(loaded.ruleSet.rules.length).toBe(1)
    expect(loaded.warnings.length).toBe(0)
  })

  it('loadRuleSetFromFile keeps valid rules when only a rule is missing id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-test-'))
    const path = join(dir, 'mixed.yaml')
    writeFileSync(
      path,
      `
rules:
  - id: CON-OK
    name: good
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["x"] }
  - name: no-id
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["y"] }
`,
      'utf8',
    )
    const loaded = loadRuleSetFromFile(path)
    expect(loaded.ruleSet.rules.length).toBe(1)
    expect(loaded.ruleSet.rules[0]?.id).toBe('CON-OK')
    expect(loaded.warnings.some(w => w.message.includes('缺少 id'))).toBe(true)
  })

  it('parseRuleSetFromYaml ignores invalid severityIfFound values', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      `
rules:
  - id: CON-S
    name: s
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["x"], severityIfFound: "catastrophic" }
`,
    )
    expect(issues.length).toBe(0)
    const rule = ruleSet.rules[0]
    expect(rule?.check.type).toBe('keyword_blocklist')
    if (rule?.check.type === 'keyword_blocklist') {
      expect(rule.check.severityIfFound).toBeUndefined()
    }
  })

  it('loadRuleSetFromFile throws on structurally invalid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-test-'))
    const path = join(dir, 'bad.yaml')
    writeFileSync(path, 'rules: [not an object', 'utf8')
    expect(() => loadRuleSetFromFile(path)).toThrow(/加载失败/)
  })

  it('loadRuleSetDir skips broken files with warnings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rule-test-'))
    writeFileSync(join(dir, 'a.yaml'), ARRAY_YAML, 'utf8')
    writeFileSync(join(dir, 'broken.yaml'), 'rules: {', 'utf8')
    writeFileSync(join(dir, 'notes.md'), 'not a rule file', 'utf8')
    const { ruleSets, warnings } = loadRuleSetDir(dir)
    expect(ruleSets.length).toBe(1)
    expect(warnings.some(w => w.source?.endsWith('broken.yaml'))).toBe(true)
    expect(warnings.some(w => w.source?.endsWith('notes.md'))).toBe(false)
  })

  it('loadRuleSetDir returns warning when directory missing', () => {
    const { ruleSets, warnings } = loadRuleSetDir('/nonexistent/rules')
    expect(ruleSets.length).toBe(0)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('mergeRuleSets overrides by id with later wins', () => {
    const first = parseRuleSetFromYaml(ARRAY_YAML).ruleSet
    const second = parseRuleSetFromYaml(
      `
rules:
  - id: CON-101
    name: 覆盖版
    severity: minor
    action: log
    check: { type: keyword_blocklist, keywords: ["x"] }
`,
    ).ruleSet
    const merged = mergeRuleSets([first, second])
    expect(merged.rules.length).toBe(1)
    expect(merged.rules[0]?.name).toBe('覆盖版')
  })

  it('validateRuleSet detects duplicates', () => {
    const set = parseRuleSetFromYaml(
      `
rules:
  - id: D1
    name: a
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["x"] }
  - id: D1
    name: b
    severity: major
    action: warn
    check: { type: keyword_blocklist, keywords: ["y"] }
`,
    ).ruleSet
    const issues = validateRuleSet(set, 'dup.yaml')
    expect(issues.some(i => i.message.includes('重复的规则 id'))).toBe(true)
  })
})
