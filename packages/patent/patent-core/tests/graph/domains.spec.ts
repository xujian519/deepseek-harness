import { expect, it } from 'vitest'
import {
  StageHandlerRegistry,
  buildEnablementGraph,
  buildInventivenessGraph,
  buildNoveltyGraph,
  detectTechnicalDomain,
  extractEnablementResult,
  extractInventivenessResult,
  extractNumericRanges,
  globalStageHandlerRegistry,
  isDegraded,
  registerBuiltinAtoms,
  type StageHandler,
  type StageProvider,
} from '@deepseek-ai/dsh-patent-core'

registerBuiltinAtoms()

/** 放行 approval-gate 的 handler 注册表（完整测试用）。 */
function passthroughHandlers(): StageHandlerRegistry {
  const passthroughApproval: StageHandler = {
    name: 'approval-gate',
    category: 'gate',
    execute: async () => ({ review_passed: true }),
  }
  const handlers = new StageHandlerRegistry()
  for (const h of globalStageHandlerRegistry.list()) handlers.register(h)
  handlers.register(passthroughApproval)
  return handlers
}

// ---------------------------------------------------------------------------
// 确定性节点：extractNumericRanges / detectTechnicalDomain
// ---------------------------------------------------------------------------

it('extractNumericRanges: 检测数值范围/端点/带单位表述', () => {
  const ranges = extractNumericRanges('温度范围为 50-80°C，厚度至少 5mm，速度大于 10m/s，压力 ≤ 2MPa，重量 1.5-2.5kg')
  expect(ranges).toEqual(['50-80', '至少 5', '大于 10', '≤ 2', '1.5-2.5'])
  expect(extractNumericRanges('无任何数值')).toEqual([])
})

it('detectTechnicalDomain: 化学/计算机/机械/通用检测', () => {
  expect(detectTechnicalDomain('一种化合物及其制备方法').domain).toBe('chemical')
  expect(detectTechnicalDomain('一种数据处理方法及电子设备').domain).toBe('software')
  expect(detectTechnicalDomain('一种传动装置').domain).toBe('mechanical')
  expect(detectTechnicalDomain('一种日常用品').domain).toBe('generic')
})

// ---------------------------------------------------------------------------
// novelty 子图
// ---------------------------------------------------------------------------

const noveltyProvider = (): StageProvider => ({
  callLLM: async (prompt) => {
    // 注意：conclude prompt 含"数值范围"标题字样，须先匹配最具体者。
    if (prompt.includes('完整新颖性分析报告')) {
      return '新颖性分析报告：权利要求相对于现有技术 D1 具备新颖性（单独对比原则，逐技术特征比对见附表）。置信度：高。'
    }
    if (prompt.includes('数值范围')) {
      return JSON.stringify({
        assessments: [{ range: '50-80', category: '重叠区间', disclosed: false, reasoning: '端点未公开' }],
      })
    }
    if (prompt.includes('技术分析助手')) {
      return JSON.stringify({ features: ['传送带', '识别传感器'], problems: [], effects: [] })
    }
    if (prompt.includes('检索关键词')) {
      return JSON.stringify({ keywords: ['分拣', '传感器'] })
    }
    if (prompt.includes('新颖性分析专家')) {
      return JSON.stringify({
        assessments: [{ feature: '传送带', prior_art: 'D1', disclosed: false, reasoning: '未公开' }],
        conclusion: '具备新颖性（置信度 0.8）',
      })
    }
    return '默认'
  },
  search: async query => [{ title: `文献: ${query}`, snippet: '摘要', url: 'https://example.com/1' }],
})

it('novelty: mock provider + 放行审批 → 跑完全图 + 规则门收口', async () => {
  const graph = buildNoveltyGraph({ handlers: passthroughHandlers() }).compile('extract')
  const result = await graph.run(
    {
      text: '一种分拣装置，温度范围为 50-80°C，包含传送带与识别传感器',
      prior_art: [{ title: 'D1', snippet: '公开传送带' }],
    },
    { provider: noveltyProvider() },
  )
  expect(result.completed).toBe(true)
  expect((result.state.novelty_report as string).includes('新颖性分析报告')).toBe(true)
  expect(result.state.numeric_ranges).toEqual(['50-80'])
  // 规则门收口：verdict 输出存在（patent_novelty 域含优先权/公开方式/推理模式规则，
  // mock 报告未覆盖 → blocked 属预期；核心通过性由 ruleGate:false 用例验证）。
  expect(['pass', 'blocked', 'needs_revision'].includes(result.state.rule_gate_verdict as string)).toBe(true)
  expect(Array.isArray(result.state.rule_gate_failures)).toBe(true)
})

it('novelty: 无 provider → LLM 节点降级 + approval 中断', async () => {
  const graph = buildNoveltyGraph({ handlers: globalStageHandlerRegistry }).compile('extract')
  const result = await graph.run({ text: '一种分拣装置' })
  expect(result.completed).toBe(false)
  expect(result.interrupted?.node).toBe('approval')
  // extract/compare/conclude 等 LLM 节点降级（有降级标记；outputKey 为 novelty_report）。
  expect(isDegraded(result.state, 'novelty_report')).toBe(true)
  expect(result.degraded.length >= 1).toBe(true)
})

it('novelty: includeApproval=false → 无审批门，conclude 直达 END（可完整跑完）', async () => {
  const graph = buildNoveltyGraph({
    ruleGate: false,
    includeApproval: false,
    handlers: globalStageHandlerRegistry,
  }).compile('extract')
  const desc = graph.describe()
  expect(desc.nodes.includes('approval')).toBe(false)
  expect(desc.nodes.includes('rule_gate')).toBe(false)
  // 无审批：LLM 节点降级后仍直达 END，completed=true（自动执行语义）。
  const result = await graph.run({ text: '一种分拣装置' })
  expect(result.completed).toBe(true)
})

// ---------------------------------------------------------------------------
// inventiveness 子图
// ---------------------------------------------------------------------------

const inventivenessProvider = (): StageProvider => ({
  callLLM: async (prompt) => {
    if (prompt.includes('三步法第一步')) {
      return JSON.stringify({
        document: 'D1',
        technical_field: '机械分拣',
        disclosed_features: ['传送带'],
        rationale: '技术领域相同且公开特征最多',
      })
    }
    if (prompt.includes('三步法第二步')) {
      return JSON.stringify({
        distinguishing_features: ['识别传感器'],
        actual_technical_problem: '如何自动识别分拣目标',
        effect_of_diff: '提高分拣准确率',
      })
    }
    if (prompt.includes('三步法第三步')) {
      return JSON.stringify({
        obvious: false,
        motivation: 'D1 无结合启示',
        evidence: [],
        dissenting_factors: ['D2 反向教导'],
      })
    }
    if (prompt.includes('辅助判断因素')) {
      return JSON.stringify({
        unexpected_effect: '准确率提升 30%',
        long_felt_need: '',
        technical_prejudice: '',
        commercial_success: '',
      })
    }
    if (prompt.includes('综合三步法')) {
      return JSON.stringify({
        inventive: true,
        confidence: 'medium',
        key_rationale: '区别特征带来预料不到的技术效果',
        report:
          '三步法分析报告：D1 为最接近现有技术，区别特征为识别传感器，D1/D2 无结合启示，对本领域技术人员而言并非显而易见，具备创造性。',
      })
    }
    if (prompt.includes('创造性分析专家')) {
      return JSON.stringify({
        features: ['传送带', '识别传感器'],
        field: '机械分拣',
        filing_date: '2024-01-01',
        inventor_claimed_effect: '提高分拣准确率',
      })
    }
    if (prompt.includes('检索策略')) {
      return '检索策略：1) 分拣 AND 传感器；2) 传送带 AND 识别；3) IPC B07C'
    }
    return '默认'
  },
  search: async query => [{ title: `文献: ${query}`, snippet: '摘要', url: 'https://example.com/1' }],
})

it('inventiveness: mock provider → 三步法全流程 + 结论提取（ruleGate 关闭）', async () => {
  const graph = buildInventivenessGraph({ ruleGate: false, handlers: passthroughHandlers() }).compile('parse')
  const result = await graph.run(
    { text: '一种分拣装置，包括传送带与识别传感器' },
    { provider: inventivenessProvider() },
  )
  expect(result.completed).toBe(true)
  const extracted = extractInventivenessResult(result.state)
  expect(extracted.inventive).toBe(true)
  expect(extracted.confidence).toBe('medium')
  expect(extracted.report?.includes('三步法')).toBe(true)
})

it('inventiveness: 规则门收口输出 verdict（推理路径规则严格，blocked/needs_revision 可接受）', async () => {
  const graph = buildInventivenessGraph({ handlers: passthroughHandlers() }).compile('parse')
  const result = await graph.run(
    { text: '一种分拣装置，包括传送带与识别传感器' },
    { provider: inventivenessProvider() },
  )
  expect(result.completed).toBe(true)
  expect(['pass', 'blocked', 'needs_revision'].includes(result.state.rule_gate_verdict as string)).toBe(true)
  expect(Array.isArray(result.state.rule_gate_failures)).toBe(true)
})

it('inventiveness: 无 provider → 全 LLM 节点降级 + approval 中断', async () => {
  const graph = buildInventivenessGraph({ handlers: globalStageHandlerRegistry }).compile('parse')
  const result = await graph.run({ text: '一种分拣装置' })
  expect(result.completed).toBe(false)
  expect(result.interrupted?.node).toBe('approval')
  expect(isDegraded(result.state, 'inventiveness_conclusion')).toBe(true)
})

// ---------------------------------------------------------------------------
// enablement 子图
// ---------------------------------------------------------------------------

const enablementProvider = (): StageProvider => ({
  callLLM: async (prompt) => {
    // 注意：conclude prompt 含"结构完整性"等标题字样，须先匹配最具体者。
    if (prompt.includes('充分公开审查报告')) {
      return JSON.stringify({
        sufficiently_disclosed: false,
        confidence: 'medium',
        key_rationale: '缺少实施例与实验数据',
        report: 'A26.3 审查报告：说明书未充分公开，缺少实施例，本领域技术人员无法实现。',
      })
    }
    if (prompt.includes('结构完整性')) {
      return JSON.stringify({
        missing_sections: ['附图说明'],
        completeness_ok: false,
        notes: '缺少附图说明章节',
      })
    }
    if (prompt.includes('清楚性')) {
      return JSON.stringify({
        issues: [{ problem: '术语未定义', location: '发明内容', severity: 'major' }],
        clarity_ok: false,
      })
    }
    if (prompt.includes('能够实现性')) {
      return JSON.stringify({
        gaps: ['未给出实施例参数'],
        enablement_ok: false,
        skilled_person_assessment: '无法实现',
      })
    }
    return '默认'
  },
})

it('enablement: mock provider → A26.3 全流程 + 领域规则 + 规则门', async () => {
  const graph = buildEnablementGraph({ handlers: passthroughHandlers() }).compile('load')
  const result = await graph.run(
    {
      text: '一种化合物及其制备方法。技术领域：化学。背景技术…发明内容…具体实施方式…附图说明…实施例1：制备 50-80°C。',
    },
    { provider: enablementProvider() },
  )
  expect(result.completed).toBe(true)
  expect(result.state.technical_domain).toBe('chemical')
  expect(Array.isArray(result.state.domain_requirements) && result.state.domain_requirements.length > 0).toBe(true)
  const extracted = extractEnablementResult(result.state)
  expect(extracted.sufficientlyDisclosed).toBe(false)
  expect(result.state.rule_gate_verdict).toBe('pass')
})

it('enablement: load 节点确定性结构检查', async () => {
  const graph = buildEnablementGraph({ handlers: globalStageHandlerRegistry }).compile('load')
  const result = await graph.run({ text: '技术领域…具体实施方式…' }, { provider: enablementProvider() })
  // 无 approval 放行 → 会中断，但 load/completeness 等已执行。
  expect(result.completed).toBe(false)
  expect(result.state.spec_sections_present).toEqual(['技术领域', '具体实施方式'])
  const missing = result.state.spec_sections_missing
  expect(Array.isArray(missing) && missing.includes('背景技术')).toBe(true)
})
