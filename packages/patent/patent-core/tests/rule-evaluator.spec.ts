import { expect, it } from 'vitest'
import {
  DEFAULT_RULE_EVALUATOR_ID,
  createDefaultRuleEvaluator,
  evaluateRuleGate,
  ruleGateNode,
  type RuleCheckResult,
  type RuleEvaluator,
  type RuleGateAssessment,
  type RuleGateRequest,
} from '@deepseek-ai/dsh-patent-core'

const NOVELTY_VIOLATION = '结合多份对比文件结合，可认定本申请不具备新颖性。'

// ---------------------------------------------------------------------------
// 默认 checker 评估器
// ---------------------------------------------------------------------------

it('createDefaultRuleEvaluator: 声明规则域并执行域过滤', () => {
  const evaluator = createDefaultRuleEvaluator()
  expect(evaluator.id).toBe(DEFAULT_RULE_EVALUATOR_ID)
  expect(evaluator.domains).toContain('patent_novelty')
  expect(evaluator.domains).toContain('patent_spec')
  expect(evaluator.domains).not.toContain('')

  const one = evaluator.evaluate({ text: NOVELTY_VIOLATION, domains: ['patent_novelty'] })
  expect(one.verdict).toBe('blocked')
  expect(one.failures.map(failure => failure.ruleId)).toContain('NOVELTY-SINGLE-COMPARISON')

  const two = evaluator.evaluate({ text: NOVELTY_VIOLATION, domains: ['patent_novelty', 'patent_spec'] })
  expect(two.evaluatedRules).toBeGreaterThan(one.evaluatedRules)
})

it('createDefaultRuleEvaluator: 合规文本 → pass 且零失败', () => {
  const evaluator = createDefaultRuleEvaluator()
  const assessment = evaluator.evaluate({
    text:
      '侵权分析：将被控方案与权利要求1的技术特征逐一比对（全面覆盖原则），特征A构成等同替换；' +
      '同时审查审查过程修改，不存在禁止反悔情形，亦不适用捐献规则。',
    domains: ['patent_infringement'],
  })
  expect(assessment.failures).toEqual([])
  expect(assessment.verdict).toBe('pass')
  expect(assessment.evaluatedRules).toBe(4)
})

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

  const delta = await ruleGateNode(['patent_novelty'], { evaluator })({
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
