import { expect, it } from 'vitest'
import {
  RuleEngine,
  aggregate,
  defaultPatentRules,
  inventivenessRules,
  type RuleCheckResult,
} from '@deepseek-ai/dsh-patent-core'

const engine = new RuleEngine()
engine.registerMany(inventivenessRules())

/** 过滤出原子化 INV 规则失败项（INVENTIVENESS-PROBLEM-* 前缀）。 */
function atomicFailures(failures: readonly RuleCheckResult[]): RuleCheckResult[] {
  return failures.filter(f => f.ruleId.startsWith('INVENTIVENESS-PROBLEM-'))
}

/** 构造一段含指定"实际解决的技术问题"的创造性分析文本（三步法关键词齐全）。 */
function analysisText(problem: string): string {
  return (
    '创造性分析：最接近的现有技术为D1；区别技术特征为X；' + `实际解决的技术问题为：${problem}；` + '技术启示判断：无。'
  )
}

// =============================================================================
// INV07 技术问题不得包含解决手段（Must → blocked）
// =============================================================================

it('INV07: 技术问题包含解决手段 → 阻断', () => {
  const failures = engine.evaluate(analysisText('通过设置限位凸台防止位移'), { rules: inventivenessRules() })
  const binding = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-SOLUTION-BINDING')
  expect(binding).toBeTruthy()
  expect(binding!.level).toBe(0)
  expect(binding!.message).toMatch(/解决手段/)
  expect(aggregate(failures)).toBe('blocked')
})

it('INV07: 合规技术问题（不含手段）→ 不触发', () => {
  const failures = engine.evaluate(analysisText('如何在部件装配后提供可靠的轴向定位'), {
    rules: inventivenessRules(),
  })
  const binding = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-SOLUTION-BINDING')
  expect(binding).toBeUndefined()
})

// =============================================================================
// INV08 技术问题单一因果（Should → blocked）
// =============================================================================

it('INV08: 技术问题复合因果 → 阻断', () => {
  const failures = engine.evaluate(analysisText('温度过高导致芯片损坏，使得整机宕机'), {
    rules: inventivenessRules(),
  })
  const multi = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-MULTI-CAUSAL')
  expect(multi).toBeTruthy()
  expect(multi!.level).toBe(1)
  expect(multi!.message).toMatch(/因果/)
  expect(aggregate(failures)).toBe('blocked')
})

// =============================================================================
// INV09 技术问题可测效果（Quality → 累计，单条不阻断）
// =============================================================================

it('INV09: 技术问题缺少可测指标 → 质量提示（单条不阻断）', () => {
  const failures = engine.evaluate(analysisText('提高可靠性'), { rules: inventivenessRules() })
  const unmeasured = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-UNMEASURED')
  expect(unmeasured).toBeTruthy()
  expect(unmeasured!.level).toBe(2)
  expect(aggregate(failures)).toBe('pass') // 单条 Quality 不足 3 条 → pass
})

// =============================================================================
// 提取不到即放行（与现有 INVENTIVENESS-THREE-STEP 分工，不双重惩罚）
// =============================================================================

it("INV: 文本无'实际解决的技术问题'表述 → 三条均放行", () => {
  // 复用现有 checker.spec.ts 的 inventiveness 通过用例文本。
  const text =
    '创造性分析（三步法）：首先确定最接近的现有技术为D1；' +
    '其次，权利要求1相对于D1的区别技术特征为X；' +
    '最后，D2给出了将X应用于D1的技术启示，故不具备创造性。'
  const failures = engine.evaluate(text, { rules: inventivenessRules() })
  expect(atomicFailures(failures)).toEqual([])
})

// =============================================================================
// Graph 形态（collectStateText 拼入的 inventiveness_diff JSON）
// =============================================================================

it('INV: Graph 形态（actual_technical_problem JSON 字段）→ 同样命中', () => {
  const text =
    '## inventiveness_parse\n{"features":["液冷管路"],"field":"散热"}\n' +
    '## inventiveness_diff\n' +
    '{"distinguishing_features":["液冷管路布局"],"actual_technical_problem":"通过设置限位凸台防止位移","effect_of_diff":"可靠定位"}'
  const failures = engine.evaluate(text, { rules: inventivenessRules() })
  const binding = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-SOLUTION-BINDING')
  expect(binding).toBeTruthy()
})

it('INV: JSON 转义引号（\\"）→ 正确还原并命中', () => {
  const text = '## inventiveness_diff\n' + '{"actual_technical_problem":"通过设置\\"限位凸台\\"防止位移"}'
  const failures = engine.evaluate(text, { rules: inventivenessRules() })
  const binding = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-SOLUTION-BINDING')
  expect(binding).toBeTruthy()
})

// =============================================================================
// 协同与回归
// =============================================================================

it('INV: 合法技术问题 → 阻断级规则不触发，质量级提示触发', () => {
  const failures = engine.evaluate(analysisText('如何在部件装配后提供可靠的轴向定位'), {
    rules: inventivenessRules(),
  })
  const binding = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-SOLUTION-BINDING')
  const multi = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-MULTI-CAUSAL')
  expect(binding).toBeUndefined()
  expect(multi).toBeUndefined()
  const unmeasured = failures.find(f => f.ruleId === 'INVENTIVENESS-PROBLEM-UNMEASURED')
  expect(unmeasured).toBeTruthy()
})

it('INV: defaultPatentRules 全量评估（现有三步法文本）→ 不新增原子化失败', () => {
  const local = new RuleEngine()
  local.registerMany(defaultPatentRules())
  const text =
    '创造性分析（三步法）：首先确定最接近的现有技术为D1；' +
    '其次，权利要求1相对于D1的区别技术特征为X；' +
    '最后，D2给出了将X应用于D1的技术启示，故不具备创造性。'
  const failures = local.evaluate(text, { domain: 'patent_inventiveness' })
  expect(atomicFailures(failures)).toEqual([])
})
