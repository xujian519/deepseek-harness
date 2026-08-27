import { describe, expect, it } from 'vitest'
import {
  APPROVAL_GRANTED_KEY,
  AtomRegistry,
  AtomRegistryError,
  InterruptStageError,
  ListAtoms,
  LookupStageHandler,
  RegisterAtom,
  StageHandlerRegistry,
  evidenceCoverage,
  globalAtomRegistry,
  isApprovalGateHandler,
  isInterruptStageError,
  registerBuiltinAtoms,
  searchAtom,
  type StageHandler,
  type StageProvider,
} from '@deepseek-ai/dsh-patent-core'

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

describe('registry', () => {
  it('AtomRegistry 注册/查询/同名覆盖/分类列表', () => {
    const reg = new AtomRegistry()
    reg.register(searchAtom)
    expect(reg.lookup('search')?.category).toBe('search')
    expect(reg.listByCategory('search').map(a => a.name)).toEqual(['search'])

    // 同名覆盖（对齐 Mady 覆盖语义）
    reg.register({ name: 'search', description: '覆盖版', category: 'search', inputSchema: [], outputSchema: [] })
    expect(reg.lookup('search')?.description).toBe('覆盖版')

    // 缺少 name 抛错
    expect(() => { reg.register({ name: '', description: 'x', category: 'search', inputSchema: [], outputSchema: [] }) })
      .toThrow(AtomRegistryError)
  })

  it('StageHandlerRegistry 注册/查询/同名覆盖', () => {
    const reg = new StageHandlerRegistry()
    const h: StageHandler = { name: 't', category: 'search', execute: async () => ({ ok: '1' }) }
    reg.register(h)
    expect(reg.lookup('t')).toBe(h)
    const h2: StageHandler = { name: 't', category: 'search', execute: async () => ({ ok: '2' }) }
    reg.register(h2)
    expect(reg.lookup('t')).toBe(h2)
  })

  it('registerBuiltinAtoms 注册 11 个内置原子与 handler', () => {
    registerBuiltinAtoms()
    const names = ListAtoms().map(a => a.name).sort()
    expect(names).toEqual([
      'approval-gate',
      'claim-chart',
      'compare',
      'draft-claims',
      'extract',
      'groundedness',
      'keywords',
      'merge',
      'novelty',
      'reasoning',
      'search',
    ])
    for (const name of names) {
      expect(LookupStageHandler(name)).toBeDefined()
    }
    expect(globalAtomRegistry.list().length).toBeGreaterThanOrEqual(10)
  })
})

// ---------------------------------------------------------------------------
// 内置 handler 行为
// ---------------------------------------------------------------------------

const provider: StageProvider = {
  callLLM: async (prompt) => {
    if (prompt.includes('提取')) {
      return JSON.stringify({ features: ['特征A', '特征B'], problems: ['问题1'], effects: [] })
    }
    if (prompt.includes('对比范围')) {
      return JSON.stringify({
        claim_chart: [{ feature: 'F1', prior_art_match: '', identical: false }],
        diff_features: ['F1'],
      })
    }
    return '推理结论'
  },
  search: async query => [{ title: `文献: ${query}`, snippet: '摘要', url: 'https://example.com/1' }],
}

describe('builtin handlers', () => {
  it('SearchHandler：有 provider 产出 prior_art 与 search_summary', async () => {
    const h = LookupStageHandler('search')!
    const out = await h.execute({ state: { query: '分拣装置', max_results: '3' }, provider })
    expect(Array.isArray(out.prior_art)).toBe(true)
    expect((out.prior_art as unknown[]).length).toBe(1)
    expect(String(out.search_summary)).toMatch(/检索到 1 篇/)
  })

  it('SearchHandler：无 provider 或空查询时降级返回 _error（不抛错）', async () => {
    const h = LookupStageHandler('search')!
    const noProvider = await h.execute({ state: { query: 'x' }, provider: {} })
    expect(String(noProvider._error)).toMatch(/未配置检索器/)
    const emptyQuery = await h.execute({ state: {}, provider })
    expect(String(emptyQuery._error)).toMatch(/查询条件为空/)
  })

  it('ExtractHandler：JSON 输出回填 features/problems/effects', async () => {
    const h = LookupStageHandler('extract')!
    const out = await h.execute({ state: { text: '一种自动化分拣装置', extraction_type: '技术特征抽取' }, provider })
    expect(out.features).toEqual(['特征A', '特征B'])
    expect(out.problems).toEqual(['问题1'])
    expect(String(out.extraction_result)).toContain('特征A')
  })

  it('ExtractHandler：LLM 输出非 JSON 时保留原文（不中断）', async () => {
    const h = LookupStageHandler('extract')!
    const badProvider: StageProvider = { callLLM: async () => '这不是 JSON' }
    const out = await h.execute({ state: { text: 'x' }, provider: badProvider })
    expect(out.extraction_result).toBe('这不是 JSON')
    expect(out.features).toBeUndefined()
  })

  it('CompareHandler：产出 claim_chart 与 diff_features', async () => {
    const h = LookupStageHandler('compare')!
    const out = await h.execute({
      state: { claim: '特征 F1', prior_art: [{ title: 'D1', snippet: '含 F1' }] },
      provider,
    })
    expect(Array.isArray(out.claim_chart)).toBe(true)
    expect((out.claim_chart as unknown[]).length).toBe(1)
    expect(out.diff_features).toEqual(['F1'])
  })

  it('ReasoningHandler：无显式输入时拼接状态为上下文', async () => {
    const h = LookupStageHandler('reasoning')!
    const out = await h.execute({ state: { claim_chart: '对比表', conclusion_ctx: '上文' }, provider })
    expect(out.conclusion).toBe('推理结论')
    expect(out.reasoning_output).toBe('推理结论')
  })

  it('ApprovalGateHandler：抛 InterruptStageError（不返回）', async () => {
    const h = LookupStageHandler('approval-gate')!
    await expect(h.execute({ state: { review_context: '请人工确认新颖性结论' } })).rejects.toSatisfy((err: unknown) => {
      expect(isInterruptStageError(err)).toBe(true)
      expect((err as InterruptStageError).stageId).toBe('approval-gate')
      expect((err as InterruptStageError).data.guardrail_level).toBe('high')
      return true
    })
  })

  it('ApprovalGateHandler：state 含放行标记时直接放行（不中断）', async () => {
    const h = LookupStageHandler('approval-gate')!
    const out = await h.execute({
      state: { review_context: '请人工确认', [APPROVAL_GRANTED_KEY]: { 1720000000000: true } },
    })
    expect(out).toEqual({})
  })

  it('isApprovalGateHandler：按 name 契约识别审批门', () => {
    const gate = LookupStageHandler('approval-gate')!
    expect(isApprovalGateHandler(gate)).toBe(true)
    const extract = LookupStageHandler('extract')!
    expect(isApprovalGateHandler(extract)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// groundedness / keywords / novelty
// ---------------------------------------------------------------------------

const groundednessProvider: StageProvider = {
  callLLM: async (prompt) => {
    if (prompt.includes('打分规则')) {
      return JSON.stringify({
        scores: [
          { feature: '散热鳍片', score: 0.95, reason: '原文第3段明确记载' },
          { feature: 'AI 自适应', score: 0.3, reason: '原文未记载，仅推断' },
        ],
        feedback: '散热鳍片依据充分；AI 自适应需补充原文支持',
      })
    }
    if (prompt.includes('检索关键词')) {
      return JSON.stringify({ keywords: ['散热鳍片', '散热结构', '换热器'] })
    }
    if (prompt.includes('对比范围')) {
      return JSON.stringify({
        assessments: [
          { feature: '散热鳍片', prior_art: 'D1', disclosed: true, reasoning: 'D1 公开相同结构' },
          { feature: 'AI 自适应', prior_art: '', disclosed: false, reasoning: 'D1-D3 均未公开' },
        ],
        conclusion: '区别特征为 AI 自适应，具备新颖性（置信度 high）',
      })
    }
    return '推理结论'
  },
}

describe('groundedness / keywords / novelty', () => {
  it('GroundednessHandler：批量打分并汇总低分特征', async () => {
    const h = LookupStageHandler('groundedness')!
    const out = await h.execute({
      state: { features: ['散热鳍片', 'AI 自适应'], source_text: '本发明通过散热鳍片提升散热效率。' },
      provider: groundednessProvider,
    })
    expect(out.low_confidence_features).toEqual(['AI 自适应'])
    expect(String(out.groundedness_feedback)).toMatch(/低依据特征 1 个/)
    expect(String(out.groundedness_result)).toMatch(/0\.3/)
  })

  it('GroundednessHandler：无特征跳过；无 LLM 降级；LLM 失败 fail-open', async () => {
    const h = LookupStageHandler('groundedness')!
    const empty = await h.execute({ state: { features: [], source_text: 'x' }, provider: groundednessProvider })
    expect(String(empty.groundedness_result)).toMatch(/skipped/)
    const noLlm = await h.execute({ state: { features: ['F1'], source_text: 'x' }, provider: {} })
    expect(String(noLlm._error)).toMatch(/未配置 LLM/)
    const failing: StageProvider = { callLLM: async () => { throw new Error('timeout') } }
    const failOpen = await h.execute({ state: { features: ['F1'], source_text: 'x' }, provider: failing })
    expect(String(failOpen.groundedness_result)).toMatch(/skipped/)
    expect(String(failOpen.groundedness_feedback)).toMatch(/LLM 调用失败/)
  })

  it('GroundednessHandler：setup_required 配置错误向上传播（fail loud，不降级）', async () => {
    const h = LookupStageHandler('groundedness')!
    const failing: StageProvider = {
      callLLM: async () => {
        throw Object.assign(new Error('未配置 LLM provider/model（Config.provider/model 未设置）'), { code: 'setup_required' })
      },
    }
    await expect(
      h.execute({ state: { features: ['F1'], source_text: 'x' }, provider: failing }),
    ).rejects.toThrow(/未配置 LLM/)
  })

  it('KeywordsHandler：生成检索关键词写入 keywords 键', async () => {
    const h = LookupStageHandler('keywords')!
    const out = await h.execute({ state: { extraction_result: '散热鳍片结构' }, provider: groundednessProvider })
    expect(out.keywords).toEqual(['散热鳍片', '散热结构', '换热器'])
  })

  it('KeywordsHandler：无 LLM 或输入为空时降级', async () => {
    const h = LookupStageHandler('keywords')!
    const noLlm = await h.execute({ state: { extraction_result: 'x' }, provider: {} })
    expect(String(noLlm._error)).toMatch(/未配置 LLM/)
    const emptyInput = await h.execute({ state: {}, provider: groundednessProvider })
    expect(String(emptyInput._error)).toMatch(/输入为空/)
  })

  it('NoveltyHandler：结合 prior_art 逐特征判定并标注证据覆盖', async () => {
    const h = LookupStageHandler('novelty')!
    const out = await h.execute({
      state: {
        features: ['散热鳍片', 'AI 自适应'],
        prior_art: [
          { title: 'D1', snippet: '公开散热鳍片结构' },
          { title: 'D2', snippet: '公开换热器' },
          { title: 'D3', snippet: '公开散热材料' },
        ],
      },
      provider: groundednessProvider,
    })
    expect(out.evidence_coverage).toBe('full')
    expect(String(out.novelty_conclusion)).toMatch(/具备新颖性/)
    expect(String(out.novelty_result)).toMatch(/AI 自适应/)
  })

  it('NoveltyHandler：无证据降级为 none；无 LLM 降级', async () => {
    const h = LookupStageHandler('novelty')!
    const noEvidence = await h.execute({ state: { features: ['F1'], prior_art: [] }, provider: groundednessProvider })
    expect(noEvidence.evidence_coverage).toBe('none')
    const noLlm = await h.execute({ state: { features: ['F1'] }, provider: {} })
    expect(String(noLlm._error)).toMatch(/未配置 LLM/)
    const noFeatures = await h.execute({ state: { prior_art: [] }, provider: groundednessProvider })
    expect(String(noFeatures._error)).toMatch(/无特征可评估/)
  })

  it('evidenceCoverage 分级：0→none / 1-2→partial / ≥3→full', () => {
    expect(evidenceCoverage(0)).toBe('none')
    expect(evidenceCoverage(1)).toBe('partial')
    expect(evidenceCoverage(2)).toBe('partial')
    expect(evidenceCoverage(3)).toBe('full')
  })
})

// ---------------------------------------------------------------------------
// extract 分键 / merge / draft-claims
// ---------------------------------------------------------------------------

describe('extract 分键 / merge / draft-claims', () => {
  it('ExtractHandler：output_key 分键——只写对应键，互不覆盖', async () => {
    const h = LookupStageHandler('extract')!
    const problems = await h.execute({ state: { text: 'x', output_key: 'problems' }, provider })
    expect(problems.problems).toEqual(['问题1'])
    expect(problems.features).toBeUndefined()
    const features = await h.execute({ state: { text: 'x', output_key: 'features' }, provider })
    expect(features.features).toEqual(['特征A', '特征B'])
    expect(features.problems).toBeUndefined()
    const effects = await h.execute({ state: { text: 'x', output_key: 'effects' }, provider })
    expect(effects.effects).toEqual([])
    expect(effects.features).toBeUndefined()
  })

  it('ExtractHandler：无 output_key 保持旧行为（全量写）', async () => {
    const h = LookupStageHandler('extract')!
    const out = await h.execute({ state: { text: 'x' }, provider })
    expect(out.features).toEqual(['特征A', '特征B'])
    expect(out.problems).toEqual(['问题1'])
    expect(out.effects).toEqual([])
  })

  it('MergeHandler：PFE 按索引配对为三元组', async () => {
    const h = LookupStageHandler('merge')!
    const out = await h.execute({
      state: { problems: ['问题1', '问题2'], features: ['特征A', '特征B'], effects: ['效果1', '效果2'] },
    })
    const triples = out.pfe_triples as Array<{ id: string; problem: string; features: string[]; effects: string[] }>
    expect(triples.length).toBe(2)
    expect(triples[0]!.problem).toBe('问题1')
    expect(triples[0]!.features).toEqual(['特征A'])
    expect(triples[0]!.effects).toEqual(['效果1'])
    expect(triples[1]!.id).toBe('T2')
    expect(String(out.merge_result)).toMatch(/2 个问题 \/ 2 个特征 \/ 2 个效果/)
  })

  it('MergeHandler：多余特征并入末组；无问题时构造单一三元组', async () => {
    const h = LookupStageHandler('merge')!
    const extra = await h.execute({ state: { problems: ['P1'], features: ['F1', 'F2'], effects: [] } })
    const triples = extra.pfe_triples as Array<{ features: string[] }>
    expect(triples[0]!.features).toEqual(['F1', 'F2'])
    const noProblem = await h.execute({ state: { problems: [], features: ['F1'], effects: ['E1'] } })
    const single = noProblem.pfe_triples as Array<{ problem: string; features: string[] }>
    expect(single.length).toBe(1)
    expect(single[0]!.problem).toBe('')
    expect(single[0]!.features).toEqual(['F1'])
  })

  it('MergeHandler：三路全空时降级（不抛错）', async () => {
    const h = LookupStageHandler('merge')!
    const out = await h.execute({ state: {} })
    expect(String(out._error)).toMatch(/三路提取结果均为空/)
  })

  const claimsProvider: StageProvider = {
    callLLM: async () =>
      JSON.stringify({
        claims: ['1. 一种散热装置，包括散热鳍片…', '2. 根据权利要求1所述的散热装置，其特征是…'],
        notes: '独立权利要求含必要技术特征',
      }),
  }

  it('DraftClaimsHandler：产出权利要求草稿（逐条拼接）', async () => {
    const h = LookupStageHandler('draft-claims')!
    const out = await h.execute({
      state: { merge_result: 'PFE 融合：1 个问题 / 1 个特征 / 1 个效果', novelty_conclusion: '具备新颖性' },
      provider: claimsProvider,
    })
    expect(String(out.claims_draft)).toMatch(/^1\. 一种散热装置/)
    expect(String(out.claims_draft)).toMatch(/\n\n2\. /)
  })

  it('DraftClaimsHandler：无 LLM 或输入为空时降级', async () => {
    const h = LookupStageHandler('draft-claims')!
    const noLlm = await h.execute({ state: { merge_result: 'x' }, provider: {} })
    expect(String(noLlm._error)).toMatch(/未配置 LLM/)
    const empty = await h.execute({ state: {}, provider: claimsProvider })
    expect(String(empty._error)).toMatch(/输入为空/)
  })

  it('DraftClaimsHandler：slop_revision_hint 注入上一轮反套话评审意见', async () => {
    const h = LookupStageHandler('draft-claims')!
    let captured = ''
    const capturingProvider: StageProvider = {
      callLLM: async (prompt) => {
        captured = prompt
        return JSON.stringify({ claims: ['1. 一种散热装置，包括散热鳍片…'], notes: '修订后' })
      },
    }
    await h.execute({
      state: { merge_result: 'x', slop_revision_hint: '命中套话表述：填充词「进一步地」 → （删除）' },
      provider: capturingProvider,
    })
    expect(captured).toMatch(/上一轮反套话评审意见/)
    expect(captured).toMatch(/进一步地/)
    expect(captured).not.toMatch(/通过线|总分/)
    await h.execute({ state: { merge_result: 'x' }, provider: capturingProvider })
    expect(captured).not.toMatch(/上一轮反套话评审意见/)
  })
})

// ---------------------------------------------------------------------------
// ModelPort 桥接：provider.llm 缺省 callLLM 时经端口路由
// ---------------------------------------------------------------------------

describe('ModelPort bridge', () => {
  it('LLM handler 经 provider.llm 端口路由（收集 delta 文本）', async () => {
    const portProvider: StageProvider = {
      llm: {
        stream: async function* () {
          yield { type: 'delta', text: '推理' }
          yield { type: 'delta', text: '结论' }
          yield { type: 'done' }
        },
      },
    }
    const h = LookupStageHandler('reasoning')!
    const out = await h.execute({ state: { reasoning_prompt: '分析' }, provider: portProvider })
    expect(out.conclusion).toBe('推理结论')
  })

  it('callLLM 与 llm 均缺失时降级（提示两个接缝）', async () => {
    const h = LookupStageHandler('reasoning')!
    const out = await h.execute({ state: { reasoning_prompt: '分析' }, provider: {} })
    expect(String(out._error)).toMatch(/未配置 LLM/)
  })
})

it('RegisterAtom：登记到全局注册表（同名覆盖语义）', () => {
  const atom = { name: 'search', description: '覆盖版注册', category: 'search' as const, inputSchema: [], outputSchema: [] }
  RegisterAtom(atom)
  expect(ListAtoms().map(a => a.name)).toContain('search')
  expect(globalAtomRegistry.lookup('search')).toBe(atom)
})
