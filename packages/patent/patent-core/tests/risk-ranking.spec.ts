import { describe, expect, it } from 'vitest'
import {
  RuleEngine,
  SEVERITY_WEIGHTS,
  STATUTE_WEIGHTS,
  type RankedRiskItem,
  type RuleCheckResult,
} from '@deepseek-ai/dsh-patent-core'
import { LevelMust } from '@deepseek-ai/dsh-patent-core'

// =============================================================================
// 风险排序（rankResults）
// =============================================================================

/** 合成失败结果。 */
function makeFailure(
  ruleId: string,
  severity: 'critical' | 'major' | 'minor',
  level: 0 | 1 | 2 = LevelMust,
): RuleCheckResult {
  return {
    ruleId,
    ruleName: ruleId,
    passed: false,
    level,
    severity,
    message: `${ruleId} 失败`,
    fixSuggestion: '修复建议',
  }
}

describe('rankResults: 边界情况', () => {
  it('零发现：空输入返回空数组', () => {
    const engine = new RuleEngine()
    const ranked = engine.rankResults([])
    expect(ranked).toEqual([])
  })

  it('passed 结果不参与排序', () => {
    const engine = new RuleEngine()
    const passed: RuleCheckResult = {
      ruleId: 'rule-passed',
      ruleName: '通过规则',
      passed: true,
      level: LevelMust,
      severity: 'critical',
      message: '',
      fixSuggestion: '',
    }
    const ranked = engine.rankResults([passed])
    expect(ranked).toEqual([])
  })
})

describe('rankResults: 风险分数计算', () => {
  it('单项上限：statuteWeight 不超过 10，severityWeight 不超过 3', () => {
    expect(Math.max(...Object.values(STATUTE_WEIGHTS))).toBeLessThanOrEqual(10)
    expect(Math.max(...Object.values(SEVERITY_WEIGHTS))).toBeLessThanOrEqual(3)
  })

  it('风险分数公式：statuteWeight × evidenceMultiplier × severityWeight', () => {
    const engine = new RuleEngine()
    const results = [makeFailure('rule-A22.2-novelty', 'critical')]
    const statuteMap = { 'rule-A22.2-novelty': 'A22.2' }
    // adversaryConfidence=0.5 → evidenceMultiplier=2
    const ranked = engine.rankResults(results, statuteMap, undefined, 0.5)
    expect(ranked.length).toBe(1)
    // A22.2 weight=10, multiplier=2, severity=critical(3) → 10*2*3=60
    expect(ranked[0]?.riskScore).toBe(60)
  })

  it('evidenceMultiplier 映射：confidence 0 → 1, 1 → 3', () => {
    const engine = new RuleEngine()
    const results = [makeFailure('rule-A22.3-test', 'major')]
    const statuteMap = { 'rule-A22.3-test': 'A22.3' }

    const ranked0 = engine.rankResults(results, statuteMap, undefined, 0)
    // A22.3 weight=8, multiplier=1, severity=major(2) → 8*1*2=16
    expect(ranked0[0]?.riskScore).toBe(16)

    const ranked1 = engine.rankResults(results, statuteMap, undefined, 1)
    // A22.3 weight=8, multiplier=3, severity=major(2) → 8*3*2=48
    expect(ranked1[0]?.riskScore).toBe(48)
  })

  it('默认权重：未映射法条使用 5', () => {
    const engine = new RuleEngine()
    const results = [makeFailure('rule-unknown', 'minor')]
    const statuteMap = { 'rule-unknown': 'A99.99' } // 未定义法条
    const ranked = engine.rankResults(results, statuteMap, undefined, 0.5)
    // weight=5, multiplier=2, severity=minor(1) → 5*2*1=10
    expect(ranked[0]?.riskScore).toBe(10)
  })
})

describe('rankResults: 排序稳定性', () => {
  it('按 riskScore 降序排列', () => {
    const engine = new RuleEngine()
    const results = [
      makeFailure('rule-A33-minor', 'minor'),
      makeFailure('rule-A22.2-critical', 'critical'),
      makeFailure('rule-A22.3-major', 'major'),
    ]
    const statuteMap = {
      'rule-A33-minor': 'A33',
      'rule-A22.2-critical': 'A22.2',
      'rule-A22.3-major': 'A22.3',
    }
    const ranked = engine.rankResults(results, statuteMap, undefined, 0.5)
    expect(ranked.map(r => r.riskScore)).toEqual([60, 32, 12])
  })

  it('同分排序：按 tie-breaker（claimCount → severity → id）', () => {
    const engine = new RuleEngine()
    const results = [
      makeFailure('rule-A22.3-a', 'major'),
      makeFailure('rule-A22.3-b', 'major'),
      makeFailure('rule-A22.3-c', 'major'),
    ]
    const statuteMap = {
      'rule-A22.3-a': 'A22.3',
      'rule-A22.3-b': 'A22.3',
      'rule-A22.3-c': 'A22.3',
    }
    const claimCountMap = {
      'rule-A22.3-a': 1,
      'rule-A22.3-b': 2,
      'rule-A22.3-c': 2,
    }
    const ranked = engine.rankResults(results, statuteMap, claimCountMap, 0.5)
    // 同分（16）：先按 claimCount 降序（2,2,1），再按 severity（同），最后按 id 升序
    expect(ranked.map(r => r.id)).toEqual(['rule-A22.3-b', 'rule-A22.3-c', 'rule-A22.3-a'])
  })

  it('全阻断：所有结果都是 critical 时正确排序', () => {
    const engine = new RuleEngine()
    const results = [
      makeFailure('rule-A22.2-1', 'critical'),
      makeFailure('rule-A22.2-2', 'critical'),
      makeFailure('rule-A22.3-1', 'critical'),
    ]
    const statuteMap = {
      'rule-A22.2-1': 'A22.2',
      'rule-A22.2-2': 'A22.2',
      'rule-A22.3-1': 'A22.3',
    }
    const ranked = engine.rankResults(results, statuteMap, undefined, 0.5)
    // A22.2 critical: 10*2*3=60, A22.3 critical: 8*2*3=48
    expect(ranked[0]?.riskScore).toBe(60)
    expect(ranked[1]?.riskScore).toBe(60)
    expect(ranked[2]?.riskScore).toBe(48)
    // 同分按 id 升序
    expect(ranked[0]?.id).toBe('rule-A22.2-1')
    expect(ranked[1]?.id).toBe('rule-A22.2-2')
  })
})

describe('rankResults: 输出结构', () => {
  it('RankedRiskItem 包含全部必需字段', () => {
    const engine = new RuleEngine()
    const results = [makeFailure('rule-A22.3-test', 'major')]
    const statuteMap = { 'rule-A22.3-test': 'A22.3' }
    const claimCountMap = { 'rule-A22.3-test': 3 }
    const ranked = engine.rankResults(results, statuteMap, claimCountMap, 0.8)
    expect(ranked.length).toBe(1)
    const item: RankedRiskItem = ranked[0]!
    expect(item.id).toBe('rule-A22.3-test')
    expect(item.statute).toBe('A22.3')
    expect(item.riskScore).toBeGreaterThan(0)
    expect(item.claimCount).toBe(3)
    expect(item.severity).toBe('major')
    expect(item.source).toBe('rule-engine')
    expect(item.detail).toContain('rule-A22.3-test')
  })

  it('从 ruleId 自动提取法条编号', () => {
    const engine = new RuleEngine()
    const results = [makeFailure('rule-A22.2-novelty-check', 'critical')]
    const ranked = engine.rankResults(results) // 不提供 statuteMap
    expect(ranked[0]?.statute).toBe('A22.2')
  })
})

describe('STATUTE_WEIGHTS 和 SEVERITY_WEIGHTS 常量', () => {
  it('STATUTE_WEIGHTS 包含常见法条', () => {
    expect(STATUTE_WEIGHTS).toHaveProperty('A22.2')
    expect(STATUTE_WEIGHTS).toHaveProperty('A22.3')
    expect(STATUTE_WEIGHTS).toHaveProperty('A26.4')
    expect(STATUTE_WEIGHTS).toHaveProperty('A33')
  })

  it('SEVERITY_WEIGHTS 包含三个等级', () => {
    expect(SEVERITY_WEIGHTS).toHaveProperty('critical')
    expect(SEVERITY_WEIGHTS).toHaveProperty('major')
    expect(SEVERITY_WEIGHTS).toHaveProperty('minor')
    expect(SEVERITY_WEIGHTS['critical']).toBe(3)
    expect(SEVERITY_WEIGHTS['major']).toBe(2)
    expect(SEVERITY_WEIGHTS['minor']).toBe(1)
  })
})
