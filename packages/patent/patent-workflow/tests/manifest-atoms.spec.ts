import { describe, expect, it } from 'vitest'
import { type WorkflowManifest, type WorkflowStage } from '@deepseek-ai/dsh-patent-core'
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

  it('侵权比对：coverage 原子排在 claim-chart 之后、report 之前，不覆盖其它模式', () => {
    expect(stageOf('patent_infringement_v1', 'coverage')?.atom).toBe('coverage')
    expect(indexOf('patent_infringement_v1', 'claim-chart')).toBeLessThan(
      indexOf('patent_infringement_v1', 'coverage'),
    )
    expect(indexOf('patent_infringement_v1', 'coverage')).toBeLessThan(
      indexOf('patent_infringement_v1', 'report'),
    )
    // 其它四个作业不带 coverage：无效/复审/OA 答复/新颖性的覆盖判定口径不同（单独对比）。
    for (const id of [
      'patent_oa_response_v1',
      'patent_invalidation_v1',
      'patent_reexamination_v1',
      'patent_novelty_v1',
    ]) {
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

  it('OA 答复：draft 消费解析结果与 claim-chart（描述里的"消费"由 consumes 兑现）', () => {
    expect(stageOf('patent_oa_response_v1', 'draft')?.consumes).toEqual(['parse', 'claim-chart'])
  })

  it('创造性：三步法后一阶段消费前一阶段的产出', () => {
    expect(stageOf('patent_inventiveness_v1', 'closest')?.consumes).toEqual(['parse', 'search'])
    expect(stageOf('patent_inventiveness_v1', 'diff')?.consumes).toEqual(['closest'])
    expect(stageOf('patent_inventiveness_v1', 'hint')?.consumes).toEqual(['diff'])
    expect(stageOf('patent_inventiveness_v1', 'conclude')?.consumes).toEqual(['diff', 'hint', 'secondary'])
  })

  it('无效宣告与复审：收口阶段同时消费理由识别结果与要素网格', () => {
    for (const manifestId of ['patent_invalidation_v1', 'patent_reexamination_v1']) {
      expect(stageOf(manifestId, 'novelty')?.consumes).toEqual(['grounds', 'claim-chart'])
      expect(stageOf(manifestId, 'inventiveness')?.consumes).toEqual(['grounds', 'claim-chart'])
    }
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
