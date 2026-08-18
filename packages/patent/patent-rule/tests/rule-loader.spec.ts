import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyRuleOverrides,
  asRecord,
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

  it('asRecord returns null for non-object values', () => {
    expect(asRecord('str')).toBeNull()
    expect(asRecord([1, 2])).toBeNull()
    expect(asRecord(null)).toBeNull()
    expect(asRecord(undefined)).toBeNull()
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
  })

  it('parseRuleSetFromYaml rejects a non-object top level', () => {
    const { issues } = parseRuleSetFromYaml('- just\n- a list')
    expect(issues.some(i => i.message.includes('顶层必须是对象'))).toBe(true)
  })

  it('parseRuleSetFromYaml rejects a document without a rules field', () => {
    const { issues } = parseRuleSetFromYaml('version: "1.0"\n')
    expect(issues.some(i => i.message.includes('缺少 rules 字段'))).toBe(true)
  })

  it('parseRuleSetFromYaml skips non-object rule entries', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml('rules:\n  - 42\n  - id: OK\n    name: ok\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n')
    expect(ruleSet.rules.length).toBe(1)
    expect(ruleSet.rules[0]?.id).toBe('OK')
    expect(issues.length).toBe(0)
  })

  it('parseRuleSetFromYaml rejects rules missing a name', () => {
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: NO-NAME\n    severity: major\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
    )
    expect(issues.some(i => i.message.includes('缺少 name'))).toBe(true)
  })

  it('parseRuleSetFromYaml defaults a missing action to warn and rejects invalid actions', () => {
    const { ruleSet } = parseRuleSetFromYaml(
      'rules:\n  - id: NO-ACTION\n    name: n\n    severity: minor\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
    )
    expect(ruleSet.rules[0]?.action).toBe('warn')
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: BAD-ACTION\n    name: n\n    severity: minor\n    action: detonate\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
    )
    expect(issues.some(i => i.message.includes('action 必须是'))).toBe(true)
  })

  it('parseRuleSetFromYaml rejects a non-object check', () => {
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: C1\n    name: n\n    severity: minor\n    action: warn\n    check: 42\n',
    )
    expect(issues.some(i => i.message.includes('check 必须是对象'))).toBe(true)
  })

  it('parseRuleSetFromYaml rejects unknown check types', () => {
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: C2\n    name: n\n    severity: minor\n    action: warn\n    check: { type: telepathy }\n',
    )
    expect(issues.some(i => i.message.includes('未知检查类型'))).toBe(true)
  })

  it('keyword_blocklist rejects non-array, non-string, and empty keywords', () => {
    const nonArray = parseRuleSetFromYaml(
      'rules:\n  - id: K1\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: "x" }\n',
    )
    expect(nonArray.issues.some(i => i.message.includes('需要非空 keywords'))).toBe(true)
    const mixed = parseRuleSetFromYaml(
      'rules:\n  - id: K2\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x", 42] }\n',
    )
    expect(mixed.issues.some(i => i.message.includes('需要非空 keywords'))).toBe(true)
    const empty = parseRuleSetFromYaml(
      'rules:\n  - id: K3\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: [] }\n',
    )
    expect(empty.issues.some(i => i.message.includes('需要非空 keywords'))).toBe(true)
  })

  it('keyword_blocklist keeps a valid severityIfFound override', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      'rules:\n  - id: SIF\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"], severityIfFound: "critical" }\n',
    )
    expect(issues.length).toBe(0)
    const rule = ruleSet.rules[0]
    expect(rule?.check.type).toBe('keyword_blocklist')
    if (rule?.check.type === 'keyword_blocklist') {
      expect(rule.check.severityIfFound).toBe('critical')
      expect(rule.check.negationContext).toBe(false)
    }
  })

  it('pattern_analysis accepts numeric minMatches through the loader', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      'rules:\n  - id: PM\n    name: n\n    severity: minor\n    action: warn\n    check: { type: pattern_analysis, patterns: ["实施例"], minMatches: 2 }\n',
    )
    expect(issues.length).toBe(0)
    const rule = ruleSet.rules[0]
    expect(rule?.check.type).toBe('pattern_analysis')
    if (rule?.check.type === 'pattern_analysis') {
      expect(rule.check.patterns).toEqual(['实施例'])
      expect(rule.check.minMatches).toBe(2)
    }
  })

  it('pattern_analysis defaults minMatches to 1 through the loader', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      'rules:\n  - id: PM-DEF\n    name: n\n    severity: minor\n    action: warn\n    check: { type: pattern_analysis, patterns: ["实施例"] }\n',
    )
    expect(issues.length).toBe(0)
    const rule = ruleSet.rules[0]
    expect(rule?.check.type).toBe('pattern_analysis')
    if (rule?.check.type === 'pattern_analysis') {
      expect(rule.check.minMatches).toBe(1)
    }
  })

  it('pattern_analysis rejects non-array patterns', () => {
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: PN\n    name: n\n    severity: minor\n    action: warn\n    check: { type: pattern_analysis, patterns: "abc" }\n',
    )
    expect(issues.some(i => i.message.includes('需要非空 patterns'))).toBe(true)
  })

  it('structural_analysis rejects missing or empty requiresAll', () => {
    const { issues } = parseRuleSetFromYaml(
      'rules:\n  - id: SA\n    name: n\n    severity: minor\n    action: warn\n    check: { type: structural_analysis, requiresAll: [] }\n',
    )
    expect(issues.some(i => i.message.includes('需要非空 requiresAll'))).toBe(true)
  })

  it('structural_analysis rejects non-object and malformed requiresAll elements', () => {
    const nonObject = parseRuleSetFromYaml(
      'rules:\n  - id: S1\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: structural_analysis\n      requiresAll:\n        - just-a-string\n',
    )
    expect(nonObject.issues.some(i => i.message.includes('requiresAll 元素需要 element'))).toBe(true)
    const badElement = parseRuleSetFromYaml(
      'rules:\n  - id: S2\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: structural_analysis\n      requiresAll:\n        - element: 42\n          patterns: ["x"]\n',
    )
    expect(badElement.issues.some(i => i.message.includes('requiresAll 元素需要 element'))).toBe(true)
  })

  it('citation_analysis rejects missing statutes and bad statute definitions', () => {
    const missing = parseRuleSetFromYaml(
      'rules:\n  - id: CA1\n    name: n\n    severity: minor\n    action: warn\n    check: { type: citation_analysis }\n',
    )
    expect(missing.issues.some(i => i.message.includes('需要非空 statutes'))).toBe(true)
    const badDef = parseRuleSetFromYaml(
      'rules:\n  - id: CA2\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: citation_analysis\n      statutes:\n        专利法: { max: "78" }\n',
    )
    expect(badDef.issues.some(i => i.message.includes('需要 max 数字'))).toBe(true)
  })

  it('citation_analysis parses numeric topic keys and validates topics shape', () => {
    const ok = parseRuleSetFromYaml(
      'rules:\n  - id: CT1\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: citation_analysis\n      statutes:\n        专利法:\n          max: 78\n          topics:\n            "2": [新颖性, 创造性]\n            "not-a-number": [其他]\n',
    )
    expect(ok.issues.length).toBe(0)
    const rule = ok.ruleSet.rules[0]
    if (rule?.check.type === 'citation_analysis') {
      expect(rule.check.statutes['专利法']?.max).toBe(78)
      expect(rule.check.statutes['专利法']?.topics?.[2]).toEqual(['新颖性', '创造性'])
      // 非数字条号被跳过，仅保留可解析的键
      expect(Object.keys(rule.check.statutes['专利法']?.topics ?? {})).toEqual(['2'])
    }
    const bad = parseRuleSetFromYaml(
      'rules:\n  - id: CT2\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: citation_analysis\n      statutes:\n        专利法:\n          max: 78\n          topics:\n            "2": 不是数组\n',
    )
    expect(bad.issues.some(i => i.message.includes('topics 需为 条号→词数组'))).toBe(true)
    const nonObject = parseRuleSetFromYaml(
      'rules:\n  - id: CT3\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: citation_analysis\n      statutes:\n        专利法:\n          max: 78\n          topics: just-a-string\n',
    )
    expect(nonObject.issues.some(i => i.message.includes('topics 需为 条号→词数组'))).toBe(true)
  })

  it('synonym_match rejects malformed requirement entries', () => {
    const nonObject = parseRuleSetFromYaml(
      'rules:\n  - id: Y2\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: synonym_match\n      requirements:\n        - just-a-string\n',
    )
    expect(nonObject.issues.some(i => i.message.includes('requirements 元素需要 element'))).toBe(true)
    const badElement = parseRuleSetFromYaml(
      'rules:\n  - id: Y3\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: synonym_match\n      requirements:\n        - element: 42\n          keywords: ["x"]\n',
    )
    expect(badElement.issues.some(i => i.message.includes('requirements 元素需要 element'))).toBe(true)
  })

  it('synonym_match accepts requirements without minConfidence', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      'rules:\n  - id: YN\n    name: n\n    severity: minor\n    action: warn\n    check:\n      type: synonym_match\n      requirements:\n        - element: novelty\n          keywords: [新颖性]\n',
    )
    expect(issues.length).toBe(0)
    const rule = ruleSet.rules[0]
    expect(rule?.check.type).toBe('synonym_match')
    if (rule?.check.type === 'synonym_match') {
      expect(rule.check.requirements[0]?.element).toBe('novelty')
      expect(rule.check.minConfidence).toBe(1)
    }
  })

  it('map-form rule sets skip invalid rules and keep valid ones', () => {
    const { ruleSet, issues } = parseRuleSetFromYaml(
      'rules:\n  good:\n    id: G1\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n  bad:\n    id: B1\n    name: n\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: 42 }\n',
    )
    expect(ruleSet.rules.length).toBe(1)
    expect(ruleSet.rules[0]?.id).toBe('G1')
    expect(issues.some(i => i.message.includes('需要非空 keywords'))).toBe(true)
  })

  it('validateRuleSet reports duplicates without a source', () => {
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
    const issues = validateRuleSet(set)
    expect(issues.some(i => i.message.includes('重复的规则 id'))).toBe(true)
    expect(issues[0]?.source).toBeUndefined()
  })

  it('applyRuleOverrides preserves the rule-set version when present', () => {
    const base = parseRuleSetFromYaml(
      'version: "2.0"\nrules:\n  - id: A1\n    name: a\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
    ).ruleSet
    const merged = applyRuleOverrides(base, new Map([['A1', { action: 'log' }]]))
    expect(merged.version).toBe('2.0')
    expect(merged.rules[0]?.action).toBe('log')
  })
})
