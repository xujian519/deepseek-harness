import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { EvidenceEngine } from '@deepseek-ai/dsh-patent-core'
import type { RuleSet } from '@deepseek-ai/dsh-patent-core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { PatentToolError } from '../src/error.ts'
import { createDraftClaimsTool, draftClaims, renderDraftClaims, validateClaims, type DraftedClaim } from '../src/tool/draft-claims.ts'
import { createDraftSpecificationTool, draftSpecification } from '../src/tool/draft-specification.ts'
import { createEvaluateEvidenceTool } from '../src/tool/evaluate-evidence.ts'
import { createPatentEvalTool, evaluatePatentContent } from '../src/tool/patent-eval.ts'
import { createRuleCheckTool } from '../src/tool/rule-check.ts'
import { createClaimChartBuildTool } from '../src/tool/claim-chart-build.ts'
import { createKnowledgeNoteSaveTool, noteDocumentId } from '../src/tool/knowledge-note-save.ts'
import {
  createRecognizeChemicalStructureTool,
  renderChemicalStructure,
} from '../src/tool/recognize-chemical-structure.ts'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'

const signal = new AbortController().signal

async function ctxWith(...tools: ToolDefinition[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  for (const t of tools) ctx.tools.register(t)
  return ctx
}

function execute(ctx: Context, name: string, args: unknown, label: string) {
  return ctx.tools.execute({ signal, callId: ToolCallId(label), name, arguments: args })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('')
}

function jsonModel(json: string): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta' as const, text: json }
      yield { type: 'done' as const }
    },
  }
}

describe('draft_claims deeper paths', () => {
  it('builds each technical-domain template and a prior-art preamble', () => {
    const mechanical = draftClaims({ invention_name: '壳体装置', technical_features: ['壳体'] })
    expect(mechanical.tech_domain).toBe('mechanical')
    const electrical = draftClaims({ invention_name: '电源装置', tech_domain: 'electrical', technical_features: ['电路'] })
    expect(electrical.claims[0]?.text).toContain('其特征在于，包括：')
    const chemical = draftClaims({ invention_name: '组合物', tech_domain: 'chemical', technical_features: ['组分'] })
    expect(chemical.claims[0]?.text).toContain('其特征在于，包含：')
    const software = draftClaims({ invention_name: '识别方法', tech_domain: 'software', technical_features: ['算法'] })
    expect(software.claims[0]?.text).toContain('包括以下步骤：')
    const withPrior = draftClaims({
      invention_name: '装置',
      tech_domain: 'mechanical',
      technical_features: ['特征A'],
      prior_art: '现有技术公开了装置结构；',
    })
    expect(withPrior.claims[0]?.text).toContain('其特征在于，还包括：特征A。')
    expect(withPrior.claims[0]?.text).not.toContain('；；')
  })

  it('falls back to the general template for missing features and long names', () => {
    const empty = draftClaims({ invention_name: '装置', technical_features: [] })
    expect(empty.claims[0]?.text).toContain('缺少必要技术特征')
    expect(empty.warnings[0]).toContain('未提供必要技术特征')
    const longName = draftClaims({ invention_name: '一'.repeat(30), technical_features: ['a'] })
    expect(longName.warnings[0]).toContain('超过 25 字')
  })

  it('auto-detects the domain and honors an explicit general hint', () => {
    expect(draftClaims({ invention_name: '带齿轮的装置', technical_features: ['a'] }).tech_domain).toBe('mechanical')
    expect(draftClaims({ invention_name: 'x', tech_domain: 'general', technical_features: ['a'] }).tech_domain).toBe('general')
  })

  it('flags vague terms and claim limits in dependent claims through the tool render', async () => {
    const ctx = await ctxWith(createDraftClaimsTool())
    const result = await execute(ctx, 'draft_claims', {
      invention_name: '装置',
      patent_type: 'utility_model',
      technical_features: ['特征A'],
      optional_features: ['优选地 约 10% 的附加特征', ...Array.from({ length: 10 }, (_, i) => `附加特征${i + 1}`)],
    }, 'dc-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('形式校验违规')
    expect(text(result)).toContain('（引用 1）')
    expect(text(result)).toContain('claim_limit')
  })

  it('renders the missing-features warning through the tool', async () => {
    const ctx = await ctxWith(createDraftClaimsTool())
    const result = await execute(ctx, 'draft_claims', {
      invention_name: '装置',
      technical_features: [],
    }, 'dc-3')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('## 警告')
  })

  it('renders a violation without a claim number or suggestion', () => {
    const out = renderDraftClaims({
      invention_name: '装置',
      tech_domain: 'mechanical',
      claims: [{ number: 1, type: 'independent', text: '一种装置。' }],
      violations: [{ rule: 'bare', severity: 'warning', message: '裸违规' }],
      warnings: [],
    })
    expect(out).toContain('裸违规')
    expect(out).not.toContain('权1')
  })

  it('validates crafted claim sets covering each formal rule', () => {
    const claims: DraftedClaim[] = [
      { number: 2, type: 'independent', text: '一种装置，其特征在于，包括：壳体' },
      { number: 1, type: 'dependent', refersTo: 1, text: '根据权利要求1所述的装置，约 10% 的优选特征。' },
    ]
    const violations = validateClaims(claims)
    const rules = violations.map(v => v.rule)
    expect(rules).toContain('numbering')
    expect(rules).toContain('period')
    expect(rules).toContain('clarity')
    expect(rules).toContain('circular_reference')
  })

  it('rejects illustration references in claims', () => {
    const claims: DraftedClaim[] = [
      { number: 1, type: 'independent', text: '如图1所示的装置。' },
    ]
    const violations = validateClaims(claims)
    expect(violations.map(v => v.rule)).toContain('no_illustration')
  })
})

describe('draft_specification deeper paths', () => {
  it('assembles a fully-specified draft', () => {
    const out = draftSpecification({
      title: '一种装置',
      tech_domain: 'mechanical',
      technical_problem: '精度不足',
      technical_solution: '采用新型结构',
      beneficial_effects: '精度提升',
      background: '现有装置精度不足。',
      drawing_descriptions: ['图1为本发明的整体结构示意图', '俯视图'],
      embodiments: ['实施例1：结构细节', '实施例2：变体'],
    })
    const content = out.sections.find(s => s.name === '发明内容')
    expect(content?.placeholder).toBe(false)
    expect(content?.content).toContain('要解决的技术问题是：精度不足')
    const drawings = out.sections.find(s => s.name === '附图说明')
    expect(drawings?.content).toContain('图2为俯视图')
    const embodiments = out.sections.find(s => s.name === '具体实施方式')
    expect(embodiments?.content).toContain('实施例1：结构细节')
  })

  it('placeholder-flagged sections and drawing/embodiment hints', () => {
    const out = draftSpecification({ title: '装置', has_drawings: true })
    const content = out.sections.find(s => s.name === '发明内容')
    expect(content?.placeholder).toBe(true)
    const drawings = out.sections.find(s => s.name === '附图说明')
    expect(drawings?.content).toContain('按图序逐图说明')
  })

  it('auto-generates drawing descriptions from figure analysis with electrical detail', () => {
    const out = draftSpecification({
      title: '装置',
      figure_analysis: [
        {
          figureDescription: '图1为电路原理图；',
          electrical: { components: [{ ref: '3', name: '电容', value: '10μF' }, { ref: '4', name: '电阻' }] },
        },
        { figureDescription: '图2为结构图。' },
        { figureDescription: '图3为示意图；图中：1-壳体；', electrical: { components: [{ ref: '1', name: '壳体' }] } },
        { figureDescription: '   ', electrical: { components: [{ ref: '7', name: '连接器' }] } },
      ],
    })
    const drawings = out.sections.find(s => s.name === '附图说明')
    expect(drawings?.content).toContain('图中：3-电容（10μF）；4-电阻；')
    expect(drawings?.content).toContain('图1为电路原理图；图中：7-连接器；')
    expect(out.warnings.some(w => w.includes('自动生成'))).toBe(true)
  })

  it('warns for an over-25-char title and renders the warning', async () => {
    const out = draftSpecification({ title: '一'.repeat(26) })
    expect(out.warnings[0]).toContain('超过 25 字')
    const ctx = await ctxWith(createDraftSpecificationTool())
    const result = await execute(ctx, 'draft_specification', { title: '二'.repeat(30) }, 'ds-3')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('## 警告')
  })

  it('warns for a utility model without drawings and auto-detects the domain', () => {
    const out = draftSpecification({ title: '装置', patent_type: 'utility_model', technical_solution: '包含电路' })
    expect(out.warnings.some(w => w.includes('附图'))).toBe(true)
    expect(out.tech_domain).toBe('electrical')
  })

  it('renders the warnings section through the tool', async () => {
    const ctx = await ctxWith(createDraftSpecificationTool())
    const result = await execute(ctx, 'draft_specification', { title: '装置', patent_type: 'utility_model' }, 'ds-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('## 警告')
  })
})

describe('evaluate_evidence deeper paths', () => {
  function makeEngine(over: Record<string, unknown> = {}): EvidenceEngine {
    return {
      judge: () => ({
        spanId: 'span-1',
        overallScore: 0.85,
        confidence: 0.9,
        relevanceJudgment: { dimension: 'relevance', score: 0.9, level: 'high', reasoning: 'r' },
        legalityJudgment: { dimension: 'legality', score: 0.8, level: 'high', reasoning: 'r' },
        authenticityJudgment: { dimension: 'authenticity', score: 0.7, level: 'medium', reasoning: 'r' },
        typeSpecificJudgment: { public_use: { elements: 4 } },
        reasoning: 'reasoning',
        flaggedIssues: [{ type: 'EVI-013', description: '公知常识未论证', severity: 'warning' }],
        rulesApplied: [
          { ruleId: 'EVI-001', name: 'n', action: 'block', severity: 'error', satisfied: true, pendingInputs: [], failedConditions: [] },
          { ruleId: 'EVI-011', name: 'm', action: 'block', severity: 'error', satisfied: false, pendingInputs: ['notarized', 'translated'], failedConditions: [] },
        ],
        ...over,
      }),
      assessBurdenOfProof: () => ({ burdenHolder: 'h', standard: 's', hasShifted: true, reasoning: 'r' }),
    } as unknown as EvidenceEngine
  }

  it('carries every external guard field into the judgment and renders all sections', async () => {
    const tool = createEvaluateEvidenceTool({ engine: makeEngine() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'evaluate_evidence', {
      snippet: 's',
      sourceUri: 'web:https://example.com',
      docVersion: '2023-01-02',
      contentHash: 'abc',
      direction: 'contradicting',
      claimRefs: ['c1'],
      evidenceType: 'internet_publication',
      filingDate: '2020-01-01',
      caseType: 'invalidation',
      notarized: true,
      legalized: true,
      translated: true,
      witnessDisclosed: true,
      isWellKnown: false,
      isUncontested: false,
      deadlineDefined: true,
      submissionWithinDeadline: true,
      collectionLegal: true,
      supportingCount: 3,
      contradictingCount: 0,
      custodyChainTraceable: true,
      integrityVerified: true,
    }, 'ev-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('举证责任')
    expect(text(result)).toContain('已转移')
    expect(text(result)).toContain('适用规则')
    expect(text(result)).toContain('待外部输入')
    expect(text(result)).toContain('问题:')
  })

  it('renders without burden/rules/flags and falls back to low judgments', async () => {
    const engine = makeEngine({
      relevanceJudgment: undefined,
      legalityJudgment: undefined,
      authenticityJudgment: undefined,
      typeSpecificJudgment: undefined,
      flaggedIssues: [],
      rulesApplied: [],
    })
    const tool = createEvaluateEvidenceTool({ engine })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'evaluate_evidence', { snippet: 's' }, 'ev-3')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('相关性: 0 (low)')
  })

  it('loads the default engine when only rule dirs are injected', async () => {
    const tool = createEvaluateEvidenceTool({ ruleDirs: [] })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'evaluate_evidence', { snippet: 's' }, 'ev-4')
    expect(result.isError).toBe(false)
  })

  it('loads the default engine with no deps at all', async () => {
    const tool = createEvaluateEvidenceTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'evaluate_evidence', { snippet: 's' }, 'ev-5')
    expect(result.isError).toBe(false)
  })
})

describe('patent_eval deeper paths', () => {
  it('renders failing dimensions without details through the tool', async () => {
    const tool = createPatentEvalTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_eval', { mode: 'report', content: '短' }, 'pe-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('❌')
  })

  it('runs comprehensive evaluation with required citations', async () => {
    const out = evaluatePatentContent(
      'comprehensive',
      ['## 技术领域', '## 背景技术', '## 发明内容', '## 技术方案', '## 有益效果', '## 附图说明', '## 具体实施方式', '## 法律依据', '## 分析结论', '## 权利要求', '步骤1 步骤2 步骤3 步骤4 步骤5', '关键词1 关键词2 关键词3', '第二十二条第三款 第3条'].join('\n'),
      ['第二十二条第三款'],
    )
    expect(out.mode).toBe('comprehensive')
    expect(out.score).toBeGreaterThan(0)
    expect(out.details['引用合规性']).toBeDefined()
  })

  it('passes required citations through the tool execute', async () => {
    const tool = createPatentEvalTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_eval', {
      mode: 'citations',
      content: '第二十二条第三款',
      required_citations: ['第二十二条第三款'],
    }, 'pe-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('引用合规性')
  })

  it('defaults absent content to an empty string through the tool', async () => {
    const tool = createPatentEvalTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'patent_eval', { mode: 'retrieval' }, 'pe-3')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('0 个关键词')
  })

  it('handles unknown modes by returning an empty-detail report', () => {
    const out = evaluatePatentContent('bogus' as never, '', [])
    expect(out).toMatchObject({ mode: 'bogus', score: 0, passed: false, details: {} })
  })

  it('scores workflow step counts at every threshold', () => {
    const one = evaluatePatentContent('workflow', '步骤1', [])
    expect(one.details['流程完整性']?.score).toBe(0.3)
    const three = evaluatePatentContent('workflow', '步骤1\n步骤2\n步骤3', [])
    expect(three.details['流程完整性']?.score).toBe(0.6)
    const five = evaluatePatentContent('workflow', '步骤1\n步骤2\n步骤3\n步骤4\n步骤5', [])
    expect(five.details['流程完整性']?.score).toBe(1)
    const none = evaluatePatentContent('workflow', '没有步骤标记', [])
    expect(none.details['流程完整性']?.score).toBe(0)
  })

  it('scores retrieval keyword counts at every threshold', () => {
    const two = evaluatePatentContent('retrieval', 'a b', [])
    expect(two.details['关键词覆盖']?.score).toBe(0.5)
    const none = evaluatePatentContent('retrieval', '   ', [])
    expect(none.details['关键词覆盖']?.score).toBe(0)
    expect(none.details['关键词覆盖']?.passed).toBe(false)
  })

  it('scores citation coverage with and without a required list', () => {
    const withList = evaluatePatentContent('citations', '第二十二条第三款', ['第二十二条第三款', '第二十二条第二款'])
    expect(withList.details['引用合规性']?.score).toBe(0.5)
    const freeForm = evaluatePatentContent('citations', '依据第22条第3款 驳回理由', [])
    expect(freeForm.details['引用合规性']?.score).toBe(1)
    expect(freeForm.details['引用格式']?.score).toBe(1)
    const bare = evaluatePatentContent('citations', '涉及第X条的情况', [])
    expect(bare.details['引用合规性']?.score).toBe(0.3)
    expect(bare.details['引用格式']?.score).toBe(0.3)
  })

  it('scores content sufficiency across every length band', () => {
    const bands: Array<[string, number]> = [
      ['短'.repeat(30), 0.1],
      ['中'.repeat(120), 0.3],
      ['长'.repeat(300), 0.5],
      ['更'.repeat(700), 0.7],
      ['巨'.repeat(1200), 0.6],
      [`巨\n\n${'分'.repeat(1200)}\n\n${'段'.repeat(1200)}`, 1],
    ]
    for (const [content, expected] of bands) {
      const out = evaluatePatentContent('report', content, [])
      expect(out.details['内容充分性']?.score).toBe(expected)
    }
  })
})

describe('rule_check default scopes', () => {
  it('runs the bundled compliance rules without injected loaders', async () => {
    const tool = createRuleCheckTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: 'x', scope: 'patent' }, 'rc-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('rule_check(patent)')
  })

  it('defaults the scope to patent through the tool', async () => {
    const ctx = await ctxWith(createRuleCheckTool())
    const result = await execute(ctx, 'rule_check', { text: 'x' }, 'rc-1b')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('rule_check(patent)')
  })

  it('assembles an injected pack with header, warnings, and per-rule rendering', async () => {
    const ruleSet = {
      rules: [
        { id: 'p1', name: '规则一', severity: 'block', action: 'block', check: { type: 'keyword_blocklist', keywords: ['禁止'] }, legalBasis: '专利法 A2' },
      ],
    } as unknown as RuleSet
    const pack = () => ({
      ruleSet,
      sources: ['base'],
      warnings: ['清单缺失，回退 base'],
      layers: new Map([['r1', 'base'], ['r2', 'domain:mechanical']]),
      manifestPath: null,
      manifestMtimeMs: null,
    })
    const tool = createRuleCheckTool({ pack, synonyms: () => new Map() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: '含禁止词', scope: 'pack' }, 'rc-2')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('规则分层')
    expect(text(result)).toContain('加载警告')
    expect(text(result)).toContain('p1')
    expect(text(result)).toContain('依据：专利法 A2')

    // 第二次调用走缓存命中路径。
    const again = await execute(ctx, 'rule_check', { text: '含禁止词', scope: 'pack' }, 'rc-3')
    expect(again.isError).toBe(false)
  })

  it('runs the electrical scope through an injected loader', async () => {
    const ruleSet = { rules: [{ id: 'e1', name: '电学规则', severity: 'block', action: 'block', check: { type: 'keyword_blocklist', keywords: ['电路'] } }] } as unknown as RuleSet
    const tool = createRuleCheckTool({ loader: scope => (scope === 'patent-electrical' ? ruleSet : { rules: [] }) })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: '电路', scope: 'patent-electrical' }, 'rc-4')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('e1')
  })

  it('loads the bundled electrical, full, and unknown scopes without a loader', async () => {
    const ctx = await ctxWith(createRuleCheckTool())
    const electrical = await execute(ctx, 'rule_check', { text: 'x', scope: 'patent-electrical' }, 'rc-5')
    expect(electrical.isError).toBe(false)
    const full = await execute(ctx, 'rule_check', { text: 'x', scope: 'patent-full' }, 'rc-6')
    expect(full.isError).toBe(false)
    const unknown = await execute(ctx, 'rule_check', { text: 'x', scope: 'bogus' }, 'rc-7')
    expect(unknown.isError).toBe(true)
  })

  it('loads the default layered pack without an injected pack loader', async () => {
    const tool = createRuleCheckTool({ synonyms: () => new Map() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: 'x', scope: 'pack' }, 'rc-8')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('rule_check(pack)')
  })

  it('renders a structural violation without evidence', async () => {
    const ruleSet = {
      rules: [
        {
          id: 's1',
          name: '结构规则',
          severity: 'block',
          action: 'block',
          check: { type: 'structural_analysis', minConfidence: 1, requiresAll: [{ element: '结构', patterns: ['结构完整'] }] },
        },
      ],
    } as unknown as RuleSet
    const tool = createRuleCheckTool({ loader: () => ruleSet, synonyms: () => new Map() })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'rule_check', { text: '无结构内容', scope: 'patent' }, 'rc-9')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('s1')
    expect(text(result)).not.toContain('命中「')
  })
})

describe('claim_chart_build success paths', () => {
  const chartJson = JSON.stringify({
    elements: [{ id: '1a', claimNo: 1, kind: 'element', text: '一种装置' }, { id: '1b', claimNo: 1, kind: 'element', text: '包括壳体' }],
    rows: [{ elementId: '1a', targetId: 'D1', quote: '对比方案', pinCite: '[D1 段[0032]]', mapping: 'not-found' }],
  })

  it('builds a chart with a gap list and persisted paths', async () => {
    const original = process.cwd()
    const temp = await mkdtemp(join(tmpdir(), 'dsh-claim-chart-'))
    try {
      process.chdir(temp)
      const sourcePath = join(temp, 'd1.txt')
      await writeFile(sourcePath, '对比文件D1：[0032] 对比方案公开了特征。')
      const tool = createClaimChartBuildTool({ model: jsonModel(chartJson) })
      const ctx = await ctxWith(tool)
      const result = await execute(ctx, 'claim_chart_build', {
        mode: 'invalidity',
        claim_text: '1. 一种装置，包括壳体。',
        targets: [{ id: 'D1', kind: 'prior-art', title: '对比文件1', source_path: sourcePath }],
        case_id: 'case-1',
      }, 'cc-3')
      expect(result.isError).toBe(false)
      if (result.isError) throw new Error('expected success')
      expect(text(result)).toContain('- 1a→D1（not-found）')
      expect(text(result)).toContain('落盘')
    } finally {
      process.chdir(original)
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('builds a gap-free chart when no targets are mapped', async () => {
    const tool = createClaimChartBuildTool({
      model: jsonModel(JSON.stringify({
        elements: [{ id: '1a', claimNo: 1, kind: 'element', text: '一种装置' }],
        rows: [],
      })),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'claim_chart_build', {
      mode: 'patentability',
      claim_text: '1. 一种装置。',
      targets: [],
    }, 'cc-4')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('无 gap（全部要素已映射）。')
  })

  it('maps targets without optional title or source path', async () => {
    const tool = createClaimChartBuildTool({
      model: jsonModel(JSON.stringify({
        elements: [{ id: '1a', claimNo: 1, kind: 'element', text: '一种装置' }],
        rows: [{ elementId: '1a', targetId: 'P', quote: '', pinCite: '', mapping: 'literal' }],
      })),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'claim_chart_build', {
      mode: 'infringement',
      claim_text: '1. 一种装置。',
      targets: [{ id: 'P', kind: 'accused-product' }],
    }, 'cc-6')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('无 gap（全部要素已映射）。')
  })

  it('fails loud when the model output keeps failing validation', async () => {
    const tool = createClaimChartBuildTool({
      model: jsonModel(JSON.stringify({ elements: [{ id: 'x', claimNo: 9, kind: 'e', text: '不存在' }], rows: [] })),
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'claim_chart_build', {
      mode: 'invalidity',
      claim_text: '1. 一种装置。',
      targets: [],
    }, 'cc-5')
    expect(result.isError).toBe(true)
  })
})

describe('knowledge_note_save', () => {
  it('persists a note and derives a deterministic id', async () => {
    const written: unknown[] = []
    const tool = createKnowledgeNoteSaveTool({
      writeNote: async (note) => {
        written.push(note)
        return { saved: true, path: '/tmp/notes/x.md' }
      },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'knowledge_note_save', { title: 'OA 答复要点', content: '正文', project: '案1' }, 'kn-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('已沉淀笔记')
    const note = written[0] as { documentId: string; title: string; project: string }
    expect(note.documentId).toBe(noteDocumentId('案1', 'OA 答复要点', '正文'))
    expect(note.project).toBe('案1')
  })

  it('skips duplicates and empty content', async () => {
    const tool = createKnowledgeNoteSaveTool({
      writeNote: async () => ({ saved: false, reason: 'duplicate' as const }),
    })
    const ctx = await ctxWith(tool)
    const dup = await execute(ctx, 'knowledge_note_save', { title: 't', content: 'c' }, 'kn-2')
    expect(text(dup)).toContain('已存在')
    const empty = await execute(ctx, 'knowledge_note_save', { title: '   ', content: 'c' }, 'kn-3')
    expect(empty.isError).toBe(false)
    expect(text(empty)).toContain('跳过')
  })

  it('rejects oversized fields and wraps write failures', async () => {
    const tool = createKnowledgeNoteSaveTool({
      writeNote: async () => { throw new Error('disk full') },
    })
    const ctx = await ctxWith(tool)
    const longTitle = await execute(ctx, 'knowledge_note_save', { title: 't'.repeat(201), content: 'c' }, 'kn-4')
    expect(longTitle.isError).toBe(true)
    const longContent = await execute(ctx, 'knowledge_note_save', { title: 't', content: 'c'.repeat(20001) }, 'kn-4b')
    expect(longContent.isError).toBe(true)
    const failed = await execute(ctx, 'knowledge_note_save', { title: 't', content: 'c' }, 'kn-5')
    expect(failed.isError).toBe(true)
  })

  it('wraps a non-Error write failure as tool_execution_failed', async () => {
    const tool = createKnowledgeNoteSaveTool({
      writeNote: async () => { throw 'boom-string' },
    })
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'knowledge_note_save', { title: 't', content: 'c' }, 'kn-5b')
    expect(result.isError).toBe(true)
  })

  it('propagates the setup_required stub from an unwired writer', async () => {
    const tool = createKnowledgeNoteSaveTool({
      writeNote: async () => { throw new PatentToolError('setup_required', '未接线', {}) },
    })
    await expect(tool.execute({ title: 't', content: 'c' }, { signal } as never)).rejects.toMatchObject({
      code: 'setup_required',
    })
  })
})

describe('recognize_chemical_structure', () => {
  it('rejects an image mode without a path and a text mode without text', async () => {
    const tool = createRecognizeChemicalStructureTool()
    await expect(tool.execute({ mode: 'image' }, { signal } as never)).rejects.toMatchObject({ code: 'invalid_tool_input' })
    await expect(tool.execute({ mode: 'text', text: '  ' }, { signal } as never)).rejects.toMatchObject({ code: 'invalid_tool_input' })
  })

  it('returns the canonical unavailable result in auto mode', async () => {
    const tool = createRecognizeChemicalStructureTool()
    const ctx = await ctxWith(tool)
    const result = await execute(ctx, 'recognize_chemical_structure', { image_path: 'mol.png', text: 'CCO' }, 'cs-1')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    expect(text(result)).toContain('化学结构识别不可用')
    expect(text(result)).toContain('rdkit 未安装')
  })

  it('dispatches auto mode on image-only and text-only input', async () => {
    const tool = createRecognizeChemicalStructureTool()
    const imageOnly = await tool.execute({ image_path: 'mol.png' }, { signal } as never)
    expect(imageOnly).toMatchObject({ imagePath: 'mol.png', usable: false })
    expect(imageOnly).not.toHaveProperty('sourceText')
    const textOnly = await tool.execute({ text: 'CCO' }, { signal } as never)
    expect(textOnly).toMatchObject({ sourceText: 'CCO', usable: false })
    expect(textOnly).not.toHaveProperty('imagePath')
  })

  it('renders the usable-result prose with candidates', () => {
    const out = renderChemicalStructure({
      kind: 'structure',
      candidates: [
        { smiles: 'CCO', confidence: 0.9, valid: true },
        { smiles: 'CC', confidence: 0.5, valid: false, validationError: 'bad' },
      ],
      chosenIndex: 0,
      canonicalSmiles: 'CCO',
      formula: 'C2H6O',
      names: ['乙醇'],
      confidence: 0.9,
      warnings: ['需人工核对'],
      needHumanReview: true,
      usable: true,
      modelUsed: 'm',
    })
    expect(out).toContain('化学结构识别结果（structure，置信度 0.90）')
    expect(out).toContain('名称：乙醇')
    expect(out).toContain('规范化 SMILES：CCO')
    expect(out).toContain('- CCO（valid，置信度 0.90）')
    expect(out).toContain('需人工复核')
  })

  it('renders a bare usable result with unknown reason and no sections', () => {
    const out = renderChemicalStructure({
      kind: 'formula',
      candidates: [],
      chosenIndex: -1,
      confidence: 0,
      names: [],
      warnings: [],
      needHumanReview: false,
      usable: true,
      modelUsed: 'm',
    })
    expect(out).toContain('化学结构识别结果（formula，置信度 0.00）')
  })

  it('renders an unavailable result without warnings as an unknown reason', () => {
    const out = renderChemicalStructure({
      kind: 'structure',
      candidates: [],
      chosenIndex: -1,
      confidence: 0,
      names: [],
      warnings: [],
      needHumanReview: true,
      usable: false,
      modelUsed: 'm',
    })
    expect(out).toContain('未知原因')
  })
})
