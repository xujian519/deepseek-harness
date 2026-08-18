import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkSynonymRequirements,
  evaluateText,
  hasNegationContext,
  loadSynonymsAsset,
  matchKeyword,
  parseRuleSetFromYaml,
  parseSynonyms,
} from '@deepseek-ai/dsh-patent-rule'

describe('synonym engine', () => {
  it('parseSynonyms parses a YAML synonym table', () => {
    const { synonyms, warnings } = parseSynonyms(
      `
synonyms:
  新颖性:
    - 新创性
    - 未公开
  创造性:
    - 非显而易见
`,
    )
    expect(warnings.length).toBe(0)
    expect(synonyms.get('新颖性')).toEqual(['新创性', '未公开'])
    expect(synonyms.get('创造性')).toEqual(['非显而易见'])
  })

  it('parseSynonyms skips bad entries with a warning', () => {
    const { synonyms, warnings } = parseSynonyms(
      `
synonyms:
  新颖性: 不是数组
  创造性:
    - 非显而易见
`,
    )
    expect(synonyms.size).toBe(1)
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('loadSynonymsAsset loads the packaged synonym asset', () => {
    const { synonyms, source, warnings } = loadSynonymsAsset()
    expect(source).not.toBeNull()
    expect(synonyms.size).toBeGreaterThanOrEqual(40)
    expect(synonyms.has('新颖性')).toBe(true)
    expect(synonyms.has('单独对比')).toBe(true)
    expect(warnings.length).toBe(0)
  })

  it('matchKeyword matches a synonym', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  新颖性:\n    - 新创性\n')
    expect(matchKeyword('本方案具有新创性', '新颖性', synonyms)).toBe('新创性')
    expect(matchKeyword('本方案具有新颖性', '新颖性', synonyms)).toBe('新颖性')
  })

  it('matchKeyword exempts negation context (不具有)', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  新颖性:\n    - 新创性\n')
    expect(matchKeyword('本方案不具有新颖性', '新颖性', synonyms)).toBeNull()
    expect(matchKeyword('本方案不符合创造性要求', '创造性', synonyms)).toBeNull()
  })

  it('matchKeyword exempts 不具备/未具备 (common OA phrasing)', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  创造性:\n    - 非显而易见\n')
    expect(matchKeyword('权利要求1不具备创造性', '创造性', synonyms)).toBeNull()
    expect(matchKeyword('权利要求1未具备创造性', '创造性', synonyms)).toBeNull()
  })

  it('matchKeyword does not let a first negated hit block a later affirmative hit', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  新颖性:\n    - 新创性\n')
    expect(matchKeyword('本申请不具有新颖性；但审查意见承认其具备新颖性', '新颖性', synonyms)).toBe('新颖性')
  })

  it('matchKeyword is case-insensitive on Latin synonym-table keys', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  inventive step:\n    - 创造性步骤\n')
    expect(matchKeyword('该方案具有创造性步骤', 'inventive step', synonyms)).toBe('创造性步骤')
  })

  it('hasNegationContext respects negation patterns and sentence boundaries', () => {
    expect(hasNegationContext('该方案无法证明新颖性', 7)).toBe(true)
    expect(hasNegationContext('本方案不具有新颖性', 6)).toBe(true)
    expect(hasNegationContext('该方案没有公开其结构。新颖性另述', 11)).toBe(false)
    const far = '未发现'.padEnd(80, '字') + '新颖性'
    expect(hasNegationContext(far, far.length - 3)).toBe(false)
  })

  it('checkSynonymRequirements reports all elements hit (including synonyms)', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  单独对比:\n    - 一一对比\n  三步法:\n    - 最接近的现有技术\n')
    const result = checkSynonymRequirements(
      '本案采用一一对比原则，从最接近的现有技术出发分析创造性',
      [
        { element: 'single_comparison', keywords: ['单独对比'] },
        { element: 'three_step', keywords: ['三步法'] },
      ],
      synonyms,
    )
    expect(result.confidence).toBe(1)
    expect(result.missing).toEqual([])
  })

  it('checkSynonymRequirements reports missing elements', () => {
    const { synonyms } = parseSynonyms('synonyms:\n  单独对比:\n    - 一一对比\n  三步法:\n    - 最接近的现有技术\n')
    const result = checkSynonymRequirements(
      '本案仅对单个文件进行了比对',
      [{ element: 'single_comparison', keywords: ['单独对比'] }],
      synonyms,
    )
    expect(result.confidence).toBe(0)
    expect(result.missing).toEqual(['single_comparison'])
  })

  it('evaluateText synonym_match flags missing elements', () => {
    const { ruleSet } = parseRuleSetFromYaml(
      `
rules:
  - id: SYN-001
    name: 三步法完整性检查
    domain: patent
    severity: major
    action: warn
    check:
      type: synonym_match
      minConfidence: 1
      requirements:
        - element: closest_prior_art
          keywords: [三步法, 最接近的现有技术]
        - element: distinguishing_features
          keywords: [区别技术特征]
`,
    )
    const { synonyms } = parseSynonyms('synonyms:\n  三步法:\n    - 最接近的现有技术\n  区别技术特征:\n    - 区别特征\n')
    expect(evaluateText('从最接近的现有技术出发，确定区别技术特征', ruleSet, synonyms).violations.length).toBe(0)
    const bad = evaluateText('仅分析了最接近的现有技术，缺少区别技术特征', ruleSet, synonyms)
    expect(bad.violations.length).toBe(1)
    expect(bad.violations[0]?.ruleId).toBe('SYN-001')
    expect(bad.violations[0]?.message).toMatch(/缺失 distinguishing_features/)
  })

  it('evaluateText synonym_match exempts negated wording', () => {
    const { ruleSet } = parseRuleSetFromYaml(
      `
rules:
  - id: SYN-002
    name: 新颖性要素检查
    domain: patent
    severity: major
    action: warn
    check:
      type: synonym_match
      minConfidence: 1
      requirements:
        - element: novelty
          keywords: [新颖性]
`,
    )
    const { synonyms } = parseSynonyms('synonyms:\n  新颖性:\n    - 新创性\n')
    expect(evaluateText('本方案不具有新颖性', ruleSet, synonyms).violations.length).toBe(1)
  })

  it('evaluateText degrades to pure keyword match without a synonym table', () => {
    const { ruleSet } = parseRuleSetFromYaml(
      `
rules:
  - id: SYN-003
    name: 同义词检查
    domain: patent
    severity: minor
    action: warn
    check:
      type: synonym_match
      minConfidence: 1
      requirements:
        - element: novelty
          keywords: [新颖性]
`,
    )
    expect(evaluateText('本方案具有新创性', ruleSet).violations.length).toBe(1)
  })

  it('RuleLoader intercepts invalid synonym_match requirements', () => {
    const { issues } = parseRuleSetFromYaml(
      `
rules:
  - id: SYN-BAD
    name: 坏规则
    domain: patent
    severity: minor
    action: warn
    check:
      type: synonym_match
      requirements: 不是数组
`,
    )
    expect(issues.some(i => i.message.includes('synonym_match 需要非空 requirements'))).toBe(true)
  })

  it('parseSynonyms reports YAML errors and non-object documents', () => {
    const badYaml = parseSynonyms('synonyms: [', 'bad.yaml')
    expect(badYaml.warnings.some(w => w.includes('同义词 YAML 解析失败'))).toBe(true)
    expect(badYaml.synonyms.size).toBe(0)
    const list = parseSynonyms('- a\n- b')
    expect(list.warnings.some(w => w.includes('顶层必须是对象'))).toBe(true)
    const noMap = parseSynonyms('foo: bar')
    expect(noMap.warnings.some(w => w.includes('缺少 synonyms 映射'))).toBe(true)
  })

  it('checkSynonymRequirements passes an empty requirement list', () => {
    const result = checkSynonymRequirements('任意文本', [], new Map())
    expect(result.confidence).toBe(1)
    expect(result.missing).toEqual([])
    expect(result.matched).toEqual([])
  })

  it('loadSynonymsAsset degrades to an empty table when assets are missing', () => {
    const { synonyms, source, warnings } = loadSynonymsAsset('/nonexistent/rules-root')
    expect(source).toBeNull()
    expect(synonyms.size).toBe(0)
    expect(warnings.some(w => w.includes('未找到同义词资产'))).toBe(true)
  })

  it('loadSynonymsAsset reports a read failure on unreadable asset files', () => {
    const root = mkdtempSync(join(tmpdir(), 'synonyms-'))
    const patentDir = join(root, 'patent')
    mkdirSync(patentDir)
    mkdirSync(join(patentDir, 'synonyms.yaml'))
    try {
      const { synonyms, source, warnings } = loadSynonymsAsset(root)
      expect(source).toBeNull()
      expect(synonyms.size).toBe(0)
      expect(warnings.some(w => w.includes('同义词资产加载失败'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
