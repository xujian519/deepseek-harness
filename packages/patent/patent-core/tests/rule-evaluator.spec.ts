import { expect, it } from 'vitest'
import {
  evaluateRuleGate,
  requireRuleEvaluator,
  ruleGateNode,
  type RuleCheckResult,
  type RuleEvaluator,
  type RuleGateAssessment,
  type RuleGateRequest,
} from '@deepseek-ai/dsh-patent-core'

// ---------------------------------------------------------------------------
// 规则门 fail-closed 语义
// ---------------------------------------------------------------------------

function stubEvaluator(overrides: Partial<RuleEvaluator> = {}): RuleEvaluator {
  return {
    id: 'test:evaluator',
    evaluate: () => ({ verdict: 'pass', failures: [], evaluatedRules: 1 }),
    ...overrides,
  }
}

function failureOf(verdict: RuleGateAssessment): RuleCheckResult {
  const failure = verdict.failures[0]
  if (failure === undefined) throw new Error('expected one gate failure')
  return failure
}

it('evaluateRuleGate: 空领域 → fail-closed', () => {
  const assessment = evaluateRuleGate(stubEvaluator(), { text: 'x', domains: [] })
  expect(assessment.verdict).toBe('blocked')
  expect(assessment.evaluatedRules).toBe(0)
  const failure = failureOf(assessment)
  expect(failure.ruleId).toBe('RULE-GATE-NO-DOMAINS')
  expect(failure.level).toBe(0)
  expect(failure.severity).toBe('critical')
})

it('evaluateRuleGate: 评估器未声明的领域 → fail-closed', () => {
  const evaluator = stubEvaluator({ domains: ['patent_novelty'] })
  const assessment = evaluateRuleGate(evaluator, { text: 'x', domains: ['patent_novelty', 'patent_foo'] })
  expect(assessment.verdict).toBe('blocked')
  const failure = failureOf(assessment)
  expect(failure.ruleId).toBe('RULE-GATE-UNKNOWN-DOMAIN')
  expect(failure.message).toContain('patent_foo')
  expect(failure.message).not.toContain('patent_novelty')
})

it('evaluateRuleGate: 未限制领域的评估器 → 原样返回结论', () => {
  const expected: RuleGateAssessment = { verdict: 'needs_revision', failures: [], evaluatedRules: 3 }
  const evaluator = stubEvaluator({ evaluate: () => expected })
  expect(evaluateRuleGate(evaluator, { text: 'x', domains: ['patent_any'] })).toBe(expected)
})

it('evaluateRuleGate: 评估器抛错 → fail-closed（Error 与非 Error）', () => {
  const throwingError = stubEvaluator({
    evaluate: () => {
      throw new Error('规则资产损坏')
    },
  })
  const fromError = evaluateRuleGate(throwingError, { text: 'x', domains: ['patent_novelty'] })
  expect(fromError.verdict).toBe('blocked')
  expect(failureOf(fromError).ruleId).toBe('RULE-GATE-EVALUATOR-ERROR')
  expect(failureOf(fromError).message).toContain('规则资产损坏')

  const throwingValue = stubEvaluator({
    evaluate: () => {
      throw '规则资产离线'
    },
  })
  const fromValue = evaluateRuleGate(throwingValue, { text: 'x', domains: ['patent_novelty'] })
  expect(failureOf(fromValue).message).toContain('规则资产离线')
})

it('evaluateRuleGate: 零规则参与 → fail-closed', () => {
  const evaluator = stubEvaluator({
    evaluate: () => ({ verdict: 'pass', failures: [], evaluatedRules: 0 }),
  })
  const assessment = evaluateRuleGate(evaluator, { text: 'x', domains: ['patent_novelty'] })
  expect(assessment.verdict).toBe('blocked')
  expect(failureOf(assessment).ruleId).toBe('RULE-GATE-EMPTY-RULESET')
})

// ---------------------------------------------------------------------------
// ruleGateNode：文本汇总、评估器注入与审计键
// ---------------------------------------------------------------------------

it('ruleGateNode: 注入评估器接收汇总文本与领域，审计键写入 delta', async () => {
  const requests: RuleGateRequest[] = []
  const failure: RuleCheckResult = {
    ruleId: 'TEST-RULE',
    ruleName: '测试规则',
    passed: false,
    level: 2,
    severity: 'minor',
    message: '测试失败',
    fixSuggestion: '测试建议',
  }
  const evaluator: RuleEvaluator = {
    id: 'test:injected',
    domains: ['patent_novelty'],
    evaluate: (request) => {
      requests.push(request)
      return { verdict: 'needs_revision', failures: [failure], evaluatedRules: 5 }
    },
  }

  const delta = await ruleGateNode(['patent_novelty'], evaluator)({
    state: {
      novelty_report: '新颖性分析报告',
      rule_gate_verdict: 'pass',
      rule_gate_domains: ['patent_novelty'],
      rule_gate_failures: [],
      rule_gate_evaluator: 'stale',
      rule_gate_rules_evaluated: 1,
      rule_gate_text_length: 8,
      novelty_report__degradation: { reason: 'llm_unavailable', message: '降级', severity: 'warning' },
      _meta: 'ignored',
    },
  })

  expect(requests).toEqual([{ text: '## novelty_report\n新颖性分析报告', domains: ['patent_novelty'] }])
  expect(delta).toEqual({
    rule_gate_verdict: 'needs_revision',
    rule_gate_domains: ['patent_novelty'],
    rule_gate_failures: ['TEST-RULE'],
    rule_gate_evaluator: 'test:injected',
    rule_gate_rules_evaluated: 5,
    rule_gate_text_length: '## novelty_report\n新颖性分析报告'.length,
  })
})

// ---------------------------------------------------------------------------
// requireRuleEvaluator：启用规则门却未注入评估器 → 构图期报错
// ---------------------------------------------------------------------------

it('requireRuleEvaluator: 返回注入的评估器', () => {
  const evaluator = stubEvaluator()
  expect(requireRuleEvaluator({ ruleEvaluator: evaluator })).toBe(evaluator)
})

it('requireRuleEvaluator: 缺少评估器 → 报错指向注入方式与关闭开关', () => {
  expect(() => requireRuleEvaluator({})).toThrow(/未注入 ruleEvaluator/)
  expect(() => requireRuleEvaluator({})).toThrow(/createCheckerRuleEvaluator/)
  expect(() => requireRuleEvaluator({})).toThrow(/ruleGate: false/)
})
