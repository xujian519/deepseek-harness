import { describe, expect, it } from 'vitest'
import {
  LookupStageHandler,
  compileSignal,
  globalAtomRegistry,
  registerBuiltinAtoms,
  signalMatches,
  type WorkflowManifest,
  type WorkflowStage,
} from '@deepseek-ai/dsh-patent-core'
import { builtinPatentManifests } from '@deepseek-ai/dsh-patent-workflow'

const manifestOf = (id: string): WorkflowManifest => {
  const manifest = builtinPatentManifests.find(m => m.id === id)
  if (manifest === undefined) throw new Error(`未知内置 manifest: ${id}`)
  return manifest
}

/** 阶段 id → 阶段定义。 */
const stageOf = (manifestId: string, stageId: string): WorkflowStage | undefined =>
  manifestOf(manifestId).stages.find(s => s.id === stageId)

/** 阶段 id → 在 manifest 中的位次（同 id 只出现一次，由 manifest 校验保证）。 */
const indexOf = (manifestId: string, stageId: string): number =>
  manifestOf(manifestId).stages.findIndex(s => s.id === stageId)

describe('内置 manifest 的确定性原子接线', () => {
  it('声明 atom 的阶段不携带 guidance（原子阶段不经 executor，guidance 会成死数据）', () => {
    for (const manifest of builtinPatentManifests) {
      for (const stage of manifest.stages) {
        if (stage.atom === undefined) continue
        expect(stage.guidance).toBeUndefined()
      }
    }
  })

  it('OA 答复：parse 交 oa-parse 原子，不再由模型解析', () => {
    const parse = stageOf('patent_oa_response_v1', 'parse')
    expect(parse?.atom).toBe('oa-parse')
    expect(parse?.params).toBeUndefined()
  })

  it('无效答复：grounds 原子排在 parse 之后、claim-chart 之前，程序取无效理由表', () => {
    const grounds = stageOf('patent_invalidation_v1', 'grounds')
    expect(grounds?.atom).toBe('grounds')
    expect(grounds?.params).toEqual({ ground_program: 'invalidation' })
    expect(indexOf('patent_invalidation_v1', 'parse')).toBeLessThan(indexOf('patent_invalidation_v1', 'grounds'))
    expect(indexOf('patent_invalidation_v1', 'grounds')).toBeLessThan(
      indexOf('patent_invalidation_v1', 'claim-chart'),
    )
  })

  it('无效宣告与复审：同骨架，确定性阶段的程序口径各自取值（不串用）', () => {
    const expectations = [
      { manifestId: 'patent_invalidation_v1', program: 'invalidation', chartMode: 'invalidity' },
      { manifestId: 'patent_reexamination_v1', program: 'reexamination', chartMode: 'reexamination' },
    ]
    for (const { manifestId, program, chartMode } of expectations) {
      const grounds = stageOf(manifestId, 'grounds')
      expect(grounds?.atom).toBe('grounds')
      expect(grounds?.params).toEqual({ ground_program: program })
      expect(stageOf(manifestId, 'claim-chart')?.params).toEqual({ chart_mode: chartMode })
      expect(indexOf(manifestId, 'parse')).toBeLessThan(indexOf(manifestId, 'grounds'))
      expect(indexOf(manifestId, 'grounds')).toBeLessThan(indexOf(manifestId, 'claim-chart'))
    }
  })

  it('侵权比对：coverage 原子排在 claim-chart 之后、report 之前', () => {
    expect(stageOf('patent_infringement_v1', 'coverage')?.atom).toBe('coverage')
    expect(indexOf('patent_infringement_v1', 'claim-chart')).toBeLessThan(
      indexOf('patent_infringement_v1', 'coverage'),
    )
    expect(indexOf('patent_infringement_v1', 'coverage')).toBeLessThan(
      indexOf('patent_infringement_v1', 'report'),
    )
    // OA 答复与新颖性不带 coverage：这两种作业没有对比文件侧的要素级网格可核验。
    for (const id of ['patent_oa_response_v1', 'patent_novelty_v1']) {
      expect(stageOf(id, 'coverage')).toBeUndefined()
    }
  })

  it('披露：citation-check 原子接在新颖性之后，报告消费校验产出', () => {
    expect(stageOf('patent_disclosure_v1', 'citation_check')?.atom).toBe('citation-check')
    expect(indexOf('patent_disclosure_v1', 'novelty')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'citation_check'),
    )
    expect(indexOf('patent_disclosure_v1', 'citation_check')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'report'),
    )
    expect(stageOf('patent_disclosure_v1', 'report')?.consumes).toContain('citation_check')
  })

  it('披露：time-baseline 与 prior-art-filter 夹在关键词、检索与新颖性之间', () => {
    expect(stageOf('patent_disclosure_v1', 'time_baseline')?.atom).toBe('time-baseline')
    expect(stageOf('patent_disclosure_v1', 'prior_art_filter')?.atom).toBe('prior-art-filter')
    expect(indexOf('patent_disclosure_v1', 'generate_keywords')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'time_baseline'),
    )
    expect(indexOf('patent_disclosure_v1', 'time_baseline')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'search'),
    )
    expect(indexOf('patent_disclosure_v1', 'search')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'prior_art_filter'),
    )
    expect(indexOf('patent_disclosure_v1', 'prior_art_filter')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'novelty'),
    )
  })

  it('披露与可专利性：eligibility 接在预处理/解析之后，报告与布局消费筛查结论', () => {
    expect(stageOf('patent_disclosure_v1', 'eligibility')?.atom).toBe('eligibility')
    expect(stageOf('patent_disclosure_v1', 'eligibility')?.consumes).toBeUndefined()
    expect(indexOf('patent_disclosure_v1', 'preprocess')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'eligibility'),
    )
    expect(indexOf('patent_disclosure_v1', 'eligibility')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'extract_problem'),
    )
    expect(stageOf('patent_disclosure_v1', 'report')?.consumes).toContain('eligibility')

    expect(stageOf('patent_patentability_v1', 'eligibility')?.atom).toBe('eligibility')
    expect(stageOf('patent_patentability_v1', 'eligibility')?.consumes).toBeUndefined()
    expect(indexOf('patent_patentability_v1', 'parse')).toBeLessThan(
      indexOf('patent_patentability_v1', 'eligibility'),
    )
    expect(indexOf('patent_patentability_v1', 'eligibility')).toBeLessThan(
      indexOf('patent_patentability_v1', 'claim-chart'),
    )
    expect(stageOf('patent_patentability_v1', 'draft')?.consumes).toContain('eligibility')
  })

  it('新颖性：time-baseline 接在 parse 之后，原子检索排在其后，对比与结论消费时间基准', () => {
    expect(stageOf('patent_novelty_v1', 'time_baseline')?.atom).toBe('time-baseline')
    expect(stageOf('patent_novelty_v1', 'time_baseline')?.params).toBeUndefined()
    expect(indexOf('patent_novelty_v1', 'parse')).toBeLessThan(
      indexOf('patent_novelty_v1', 'time_baseline'),
    )
    expect(indexOf('patent_novelty_v1', 'time_baseline')).toBeLessThan(
      indexOf('patent_novelty_v1', 'search'),
    )
    expect(stageOf('patent_novelty_v1', 'search')?.atom).toBe('search')
    expect(stageOf('patent_novelty_v1', 'search')?.consumes).toBeUndefined()
    expect(stageOf('patent_novelty_v1', 'compare')?.consumes).toContain('time_baseline')
    expect(stageOf('patent_novelty_v1', 'conclude')?.consumes).toContain('time_baseline')
  })

  it('新颖性：原子检索产出 prior_art，公开日过滤与引用校验串起检索、对比与结论', () => {
    expect(stageOf('patent_novelty_v1', 'generate_keywords')?.atom).toBe('keywords')
    expect(stageOf('patent_novelty_v1', 'search')?.atom).toBe('search')
    expect(stageOf('patent_novelty_v1', 'prior_art_filter')?.atom).toBe('prior-art-filter')
    expect(stageOf('patent_novelty_v1', 'citation_check')?.atom).toBe('citation-check')
    expect(indexOf('patent_novelty_v1', 'time_baseline')).toBeLessThan(
      indexOf('patent_novelty_v1', 'generate_keywords'),
    )
    expect(indexOf('patent_novelty_v1', 'generate_keywords')).toBeLessThan(
      indexOf('patent_novelty_v1', 'search'),
    )
    expect(indexOf('patent_novelty_v1', 'search')).toBeLessThan(
      indexOf('patent_novelty_v1', 'prior_art_filter'),
    )
    expect(indexOf('patent_novelty_v1', 'prior_art_filter')).toBeLessThan(
      indexOf('patent_novelty_v1', 'compare'),
    )
    expect(stageOf('patent_novelty_v1', 'compare')?.consumes).toContain('prior_art_filter')
    expect(stageOf('patent_novelty_v1', 'conclude')?.consumes).toContain('prior_art_filter')
    expect(indexOf('patent_novelty_v1', 'conclude')).toBeLessThan(
      indexOf('patent_novelty_v1', 'citation_check'),
    )
    expect(indexOf('patent_novelty_v1', 'citation_check')).toBeLessThan(
      indexOf('patent_novelty_v1', 'legal_gaps'),
    )
  })

  it('创造性：时间基准、原子检索与公开日过滤接在三步法之前，引用校验接在结论之后', () => {
    expect(stageOf('patent_inventiveness_v1', 'time_baseline')?.atom).toBe('time-baseline')
    expect(stageOf('patent_inventiveness_v1', 'generate_keywords')?.atom).toBe('keywords')
    expect(stageOf('patent_inventiveness_v1', 'search')?.atom).toBe('search')
    expect(stageOf('patent_inventiveness_v1', 'prior_art_filter')?.atom).toBe('prior-art-filter')
    expect(stageOf('patent_inventiveness_v1', 'citation_check')?.atom).toBe('citation-check')
    expect(indexOf('patent_inventiveness_v1', 'parse')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'time_baseline'),
    )
    expect(indexOf('patent_inventiveness_v1', 'time_baseline')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'generate_keywords'),
    )
    expect(indexOf('patent_inventiveness_v1', 'generate_keywords')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'search'),
    )
    expect(indexOf('patent_inventiveness_v1', 'search')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'prior_art_filter'),
    )
    expect(indexOf('patent_inventiveness_v1', 'prior_art_filter')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'closest'),
    )
    expect(stageOf('patent_inventiveness_v1', 'closest')?.consumes).toEqual([
      'parse', 'time_baseline', 'search', 'prior_art_filter',
    ])
    expect(stageOf('patent_inventiveness_v1', 'conclude')?.consumes).toContain('prior_art_filter')
    expect(indexOf('patent_inventiveness_v1', 'conclude')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'citation_check'),
    )
    expect(indexOf('patent_inventiveness_v1', 'citation_check')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'legal_gaps'),
    )
  })

  it('可专利性：时间基准与原子检索接在解析之后，过滤结果供 claim chart 派生对比文件', () => {
    expect(stageOf('patent_patentability_v1', 'time_baseline')?.atom).toBe('time-baseline')
    expect(stageOf('patent_patentability_v1', 'generate_keywords')?.atom).toBe('keywords')
    expect(stageOf('patent_patentability_v1', 'search')?.atom).toBe('search')
    expect(stageOf('patent_patentability_v1', 'prior_art_filter')?.atom).toBe('prior-art-filter')
    const order = [
      'parse',
      'time_baseline',
      'eligibility',
      'generate_keywords',
      'search',
      'prior_art_filter',
      'claim-chart',
    ]
    for (let i = 1; i < order.length; i += 1) {
      expect(indexOf('patent_patentability_v1', order[i - 1]!)).toBeLessThan(
        indexOf('patent_patentability_v1', order[i]!),
      )
    }
    expect(stageOf('patent_patentability_v1', 'draft')?.consumes).toEqual(
      expect.arrayContaining(['time_baseline', 'prior_art_filter']),
    )
  })

  it('新颖性：conflicting_application 只读解析与时间基准，不消费检索结果（C-02）', () => {
    registerBuiltinAtoms()
    const stage = stageOf('patent_novelty_v1', 'conflicting_application')
    expect(stage?.atom).toBe('conflicting-application')
    // 原子直接读 state；consumes 只属于收口阶段。
    expect(stage?.consumes).toBeUndefined()
    expect(indexOf('patent_novelty_v1', 'parse')).toBeLessThan(
      indexOf('patent_novelty_v1', 'conflicting_application'),
    )
    expect(indexOf('patent_novelty_v1', 'conflicting_application')).toBeLessThan(
      indexOf('patent_novelty_v1', 'compare'),
    )
    expect(stageOf('patent_novelty_v1', 'conclude')?.consumes).toContain('conflicting_application')

    const atom = globalAtomRegistry.lookup('conflicting-application')
    expect(atom?.inputSchema).toContain('conflicting_applications')
    expect(atom?.inputSchema).not.toContain('prior_art')
    expect(atom?.inputSchema).not.toContain('search')
  })

  it('新颖性：numeric-range 接在对比之后、结论之前，结论消费核验产出', () => {
    expect(stageOf('patent_novelty_v1', 'numeric_range')?.atom).toBe('numeric-range')
    expect(stageOf('patent_novelty_v1', 'numeric_range')?.consumes).toBeUndefined()
    expect(indexOf('patent_novelty_v1', 'compare')).toBeLessThan(
      indexOf('patent_novelty_v1', 'numeric_range'),
    )
    expect(indexOf('patent_novelty_v1', 'numeric_range')).toBeLessThan(
      indexOf('patent_novelty_v1', 'conclude'),
    )
    expect(stageOf('patent_novelty_v1', 'conclude')?.consumes).toContain('numeric_range')
  })

  it('citation-check 读取检索结果与结论，报告阶段消费校验产出（C-02）', () => {
    registerBuiltinAtoms()
    const atom = globalAtomRegistry.lookup('citation-check')
    expect(atom?.inputSchema).toContain('prior_art')
    expect(atom?.inputSchema).toContain('conclude')
    expect(stageOf('patent_disclosure_v1', 'citation_check')?.atom).toBe('citation-check')
    expect(stageOf('patent_disclosure_v1', 'report')?.consumes).toContain('citation_check')
  })

  it('无效与复审不带 coverage 阶段：单篇全覆盖结论由 claim-chart 阶段随图表给出', () => {
    // 无效/复审的覆盖判定口径与侵权不同，且这两个 manifest 也由 recap 路径执行——recap 不
    // 执行原子，多一个只能由原子产出的阶段会让每次 recap 运行都报未完成。
    for (const id of ['patent_invalidation_v1', 'patent_reexamination_v1']) {
      expect(stageOf(id, 'coverage')).toBeUndefined()
    }
  })
})

describe('内置 manifest 的收口阶段依赖声明', () => {
  it('consumes 只引用本 manifest 中位次更早的阶段', () => {
    for (const manifest of builtinPatentManifests) {
      for (const stage of manifest.stages) {
        for (const upstream of stage.consumes ?? []) {
          const upstreamIndex = manifest.stages.findIndex(s => s.id === upstream)
          expect(upstreamIndex).toBeGreaterThanOrEqual(0)
          expect(upstreamIndex).toBeLessThan(manifest.stages.findIndex(s => s.id === stage.id))
        }
      }
    }
  })

  it('OA 答复：response-plan 交确定性原子，排 claim-chart 之后、draft 之前', () => {
    const plan = stageOf('patent_oa_response_v1', 'response-plan')
    expect(plan?.atom).toBe('response-plan')
    expect(plan?.guidance).toBeUndefined()
    expect(indexOf('patent_oa_response_v1', 'claim-chart')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'response-plan'),
    )
    expect(indexOf('patent_oa_response_v1', 'response-plan')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'draft'),
    )
  })

  it('OA 答复：draft 消费解析结果、claim-chart 与答复计划（描述里的"消费"由 consumes 兑现）', () => {
    expect(stageOf('patent_oa_response_v1', 'draft')?.consumes).toEqual(['parse', 'claim-chart', 'response-plan'])
  })

  it('OA 答复：response-check 接在 draft 之后、approval 之前，原子直接读解析结果', () => {
    const check = stageOf('patent_oa_response_v1', 'response_check')
    expect(check?.atom).toBe('response-check')
    expect(check?.consumes).toBeUndefined()
    expect(indexOf('patent_oa_response_v1', 'draft')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'response_check'),
    )
    expect(indexOf('patent_oa_response_v1', 'response_check')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'approval'),
    )
  })

  it('OA 答复：amendment-basis 接在 response-check 之后、approval 之前，原子直接读修改稿', () => {
    const check = stageOf('patent_oa_response_v1', 'amendment_basis')
    expect(check?.atom).toBe('amendment-basis')
    expect(check?.consumes).toBeUndefined()
    expect(indexOf('patent_oa_response_v1', 'response_check')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'amendment_basis'),
    )
    expect(indexOf('patent_oa_response_v1', 'amendment_basis')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'approval'),
    )
  })

  it('OA 答复：legal-gaps 接在修改依据之后、approval 之前，按答复清单汇总法条', () => {
    const stage = stageOf('patent_oa_response_v1', 'legal_gaps')
    expect(stage?.atom).toBe('legal-gaps')
    expect(stage?.consumes).toBeUndefined()
    expect(stage?.params).toEqual({ profile: 'oa-response' })
    expect(indexOf('patent_oa_response_v1', 'amendment_basis')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'legal_gaps'),
    )
    expect(indexOf('patent_oa_response_v1', 'legal_gaps')).toBeLessThan(
      indexOf('patent_oa_response_v1', 'approval'),
    )
  })

  it('创造性：三步法后一阶段消费前一阶段的产出', () => {
    expect(stageOf('patent_inventiveness_v1', 'closest')?.consumes).toEqual([
      'parse', 'time_baseline', 'search', 'prior_art_filter',
    ])
    expect(stageOf('patent_inventiveness_v1', 'diff')?.consumes).toEqual(['closest'])
    expect(stageOf('patent_inventiveness_v1', 'hint')?.consumes).toEqual(['diff', 'problem_check'])
    expect(stageOf('patent_inventiveness_v1', 'conclude')?.consumes).toEqual([
      'diff',
      'problem_check',
      'hint',
      'secondary',
      'prior_art_filter',
    ])
  })

  it('创造性：problem-check 夹在 diff 与 hint 之间，hint 消费校验产出', () => {
    expect(stageOf('patent_inventiveness_v1', 'problem_check')?.atom).toBe('problem-check')
    expect(stageOf('patent_inventiveness_v1', 'problem_check')?.consumes).toBeUndefined()
    expect(indexOf('patent_inventiveness_v1', 'diff')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'problem_check'),
    )
    expect(indexOf('patent_inventiveness_v1', 'problem_check')).toBeLessThan(
      indexOf('patent_inventiveness_v1', 'hint'),
    )
  })

  it('披露与可专利性：说明书草案接在撰写阶段之后，spec-check 跑 spec 模式', () => {
    const cases = [
      { manifestId: 'patent_disclosure_v1', draftStage: 'draft_claims', claimsKey: 'claims_draft' },
      { manifestId: 'patent_patentability_v1', draftStage: 'draft', claimsKey: 'draft' },
    ]
    for (const { manifestId, draftStage, claimsKey } of cases) {
      const draftSpecification = stageOf(manifestId, 'draft_specification')
      expect(draftSpecification?.atom).toBe('draft-specification')
      expect(draftSpecification?.consumes).toBeUndefined()
      expect(indexOf(manifestId, draftStage)).toBeLessThan(indexOf(manifestId, 'draft_specification'))
      expect(indexOf(manifestId, 'draft_specification')).toBeLessThan(indexOf(manifestId, 'spec_check'))
      expect(stageOf(manifestId, 'spec_check')?.params).toEqual({
        mode: 'spec',
        text_key: 'specification',
        claims_key: claimsKey,
      })
    }
  })

  it('新颖性/披露/创造性/可专利性：legal-gaps 接在各自确定性检查之后，按案件类型选清单', () => {
    const cases = [
      { manifestId: 'patent_novelty_v1', profile: 'novelty', after: 'conclude', before: 'approval' },
      { manifestId: 'patent_disclosure_v1', profile: 'disclosure', after: 'slop_clean' },
      { manifestId: 'patent_inventiveness_v1', profile: 'inventiveness', after: 'conclude', before: 'approval' },
      { manifestId: 'patent_patentability_v1', profile: 'patentability', after: 'spec_check', before: 'approval' },
    ]
    for (const { manifestId, profile, after, before } of cases) {
      const stage = stageOf(manifestId, 'legal_gaps')
      expect(stage?.atom).toBe('legal-gaps')
      expect(stage?.consumes).toBeUndefined()
      expect(stage?.params).toEqual({ profile })
      expect(indexOf(manifestId, after)).toBeLessThan(indexOf(manifestId, 'legal_gaps'))
      if (before !== undefined) {
        expect(indexOf(manifestId, 'legal_gaps')).toBeLessThan(indexOf(manifestId, before))
      } else {
        expect(indexOf(manifestId, 'legal_gaps')).toBe(manifestOf(manifestId).stages.length - 1)
      }
    }
  })

  it('无效宣告与复审：收口阶段同时消费理由识别结果与要素网格', () => {
    for (const manifestId of ['patent_invalidation_v1', 'patent_reexamination_v1']) {
      expect(stageOf(manifestId, 'novelty')?.consumes).toEqual(['grounds', 'claim-chart'])
      expect(stageOf(manifestId, 'inventiveness')?.consumes).toEqual(['grounds', 'claim-chart'])
    }
  })

  it('无效宣告与复审：evidence-check 接在创造性之后、审批之前，原子直接读证据清单', () => {
    for (const manifestId of ['patent_invalidation_v1', 'patent_reexamination_v1']) {
      const stage = stageOf(manifestId, 'evidence-check')
      expect(stage?.atom).toBe('evidence-check')
      expect(stage?.consumes).toBeUndefined()
      expect(indexOf(manifestId, 'inventiveness')).toBeLessThan(indexOf(manifestId, 'evidence-check'))
      expect(indexOf(manifestId, 'evidence-check')).toBeLessThan(indexOf(manifestId, 'approval'))
    }
    const atom = globalAtomRegistry.lookup('evidence-check')
    expect(atom?.inputSchema).toContain('evidence')
    expect(atom?.inputSchema).toContain('evidence_deadline')
  })

  it('无效宣告与复审：citation-check 接在证据审查之后、审批之前，读取新颖性与创造性结论', () => {
    for (const manifestId of ['patent_invalidation_v1', 'patent_reexamination_v1']) {
      const stage = stageOf(manifestId, 'citation-check')
      expect(stage?.atom).toBe('citation-check')
      expect(stage?.consumes).toBeUndefined()
      expect(stage?.params).toEqual({ ref_text_keys: ['novelty', 'inventiveness'] })
      expect(indexOf(manifestId, 'evidence-check')).toBeLessThan(indexOf(manifestId, 'citation-check'))
      expect(indexOf(manifestId, 'citation-check')).toBeLessThan(indexOf(manifestId, 'approval'))
    }
  })

  it('无效宣告与复审：legal-gaps 接在引用校验之后、审批之前，按程序选清单', () => {
    const expectations = [
      { manifestId: 'patent_invalidation_v1', profile: 'invalidation' },
      { manifestId: 'patent_reexamination_v1', profile: 'reexamination' },
    ]
    for (const { manifestId, profile } of expectations) {
      const stage = stageOf(manifestId, 'legal_gaps')
      expect(stage?.atom).toBe('legal-gaps')
      expect(stage?.consumes).toBeUndefined()
      expect(stage?.params).toEqual({ profile })
      expect(indexOf(manifestId, 'citation-check')).toBeLessThan(indexOf(manifestId, 'legal_gaps'))
      expect(indexOf(manifestId, 'legal_gaps')).toBeLessThan(indexOf(manifestId, 'approval'))
    }
  })

  it('侵权比对：legal-gaps 接在报告之后、审批之前，按侵权清单汇总', () => {
    const stage = stageOf('patent_infringement_v1', 'legal_gaps')
    expect(stage?.atom).toBe('legal-gaps')
    expect(stage?.consumes).toBeUndefined()
    expect(stage?.params).toEqual({ profile: 'infringement' })
    expect(indexOf('patent_infringement_v1', 'report')).toBeLessThan(
      indexOf('patent_infringement_v1', 'legal_gaps'),
    )
    expect(indexOf('patent_infringement_v1', 'legal_gaps')).toBeLessThan(
      indexOf('patent_infringement_v1', 'approval'),
    )
  })

  it('侵权比对：report 消费要素网格与覆盖核验结论', () => {
    expect(stageOf('patent_infringement_v1', 'report')?.consumes).toEqual(['parse', 'claim-chart', 'coverage'])
  })

  it('声明的收口阶段都是未声明 atom 的阶段（原子阶段由 handler 直接读 state）', () => {
    for (const manifest of builtinPatentManifests) {
      for (const stage of manifest.stages) {
        if (stage.consumes === undefined) continue
        expect(stage.atom).toBeUndefined()
      }
    }
  })
})

describe('PFIE 一致性阶段：确定性原子与回退信号闭环', () => {
  registerBuiltinAtoms()

  it('consistency 交 pfe-consistency 原子，其主输出命中本阶段声明的回退信号', async () => {
    const consistency = stageOf('patent_disclosure_v1', 'consistency')!
    expect(consistency.atom).toBe('pfe-consistency')
    const handler = LookupStageHandler('pfe-consistency')!
    const out = await handler.execute({
      state: { pfe_triples: [{ id: 'T1', problem: 'P1', features: [], effects: [] }] },
    })
    const signal = compileSignal(consistency.retry!.whenOutputMatches)
    expect(signalMatches(String(out.pfe_consistency_summary), signal)).toBe(true)
  })

  it('承接完整时不触发回退（否则每轮都会白跑一次回退重做）', async () => {
    const consistency = stageOf('patent_disclosure_v1', 'consistency')!
    const handler = LookupStageHandler('pfe-consistency')!
    const out = await handler.execute({
      state: { pfe_triples: [{ id: 'T1', problem: '如何在装配后定位', features: ['F1'], effects: ['E1'] }] },
    })
    const signal = compileSignal(consistency.retry!.whenOutputMatches)
    expect(signalMatches(String(out.pfe_consistency_summary), signal)).toBe(false)
  })

  it('extract_insight 在 merge 之前，且回退目标 extract_problem 在它之前（回退后四元组整体重算）', () => {
    expect(indexOf('patent_disclosure_v1', 'extract_insight')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'merge'),
    )
    expect(indexOf('patent_disclosure_v1', 'extract_problem')).toBeLessThan(
      indexOf('patent_disclosure_v1', 'extract_insight'),
    )
  })

  it('consistency 声明 atom 时不再声明 consumes（原子直接读 state，consumes 会是死数据）', () => {
    expect(stageOf('patent_disclosure_v1', 'consistency')?.consumes).toBeUndefined()
  })
})
