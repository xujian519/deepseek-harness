import { describe, expect, it } from 'vitest'
import { validateWorkflowManifest } from '@deepseek-ai/dsh-patent-core'
import {
  builtinPatentManifests,
  patentInfringementManifest,
  patentInventivenessManifest,
  patentInvalidationManifest,
  patentOaResponseManifest,
  patentReexaminationManifest,
} from '@deepseek-ai/dsh-patent-workflow'

/** 内置 manifest 目录的完整 id 集（新增作业须在此显式登记）。 */
const EXPECTED_MANIFEST_IDS = [
  'patent_disclosure_v1',
  'patent_infringement_v1',
  'patent_invalidation_v1',
  'patent_inventiveness_v1',
  'patent_novelty_v1',
  'patent_oa_response_v1',
  'patent_patentability_v1',
  'patent_reexamination_v1',
]

const stageOf = (manifestId: string, stageId: string): string | undefined => {
  const manifest = builtinPatentManifests.find(m => m.id === manifestId)
  return manifest?.stages.find(s => s.id === stageId)?.guidance
}

describe('内置 manifest 的阶段法律指引（guidance）', () => {
  it('OA 答复：parse 定为确定性原子；draft 含驳回类型对照表、策略决策树与 A33 限制', () => {
    const manifest = builtinPatentManifests.find(m => m.id === 'patent_oa_response_v1')
    const parse = manifest?.stages.find(s => s.id === 'parse')
    expect(parse?.guidance).toBeUndefined()
    const draft = stageOf('patent_oa_response_v1', 'draft')
    expect(draft).toContain('26.3')
    expect(draft).toContain('22.2')
    expect(draft).toContain('单独对比')
    expect(draft).toContain('最核心的驳回理由')
    expect(draft).toContain('纯争辩')
    expect(draft).toContain('放弃答复')
    expect(draft).toContain('A33')
    expect(draft).toContain('禁止编造实验数据')
  })

  it('创造性：closest 缺证据推断规则，diff 技术问题纪律，hint 软件与组合方案边界条件', () => {
    const closest = stageOf('patent_inventiveness_v1', 'closest')
    expect(closest).toContain('边界条件')
    expect(closest).toContain('简单变体')
    const diff = stageOf('patent_inventiveness_v1', 'diff')
    expect(diff).toContain('区别于说明书记载的发明目的')
    const hint = stageOf('patent_inventiveness_v1', 'hint')
    expect(hint).toContain('简单重组')
    expect(hint).toContain('相反教导')
  })

  it('侵权 report 含等同三限制与风险等级输出要求', () => {
    const report = stageOf('patent_infringement_v1', 'report')
    expect(report).toContain('禁止反悔')
    expect(report).toContain('捐献')
    expect(report).toContain('现有技术抗辩')
    expect(report).toContain('手段-功能-效果')
    expect(report).toContain('风险等级')
  })

  it('全部内置 manifest 通过校验且已声明的 guidance 均非空', () => {
    for (const manifest of builtinPatentManifests) {
      validateWorkflowManifest(manifest)
      for (const stage of manifest.stages) {
        if (stage.guidance !== undefined) expect(stage.guidance.trim()).not.toBe('')
      }
    }
    // 批次二声明了 guidance 的三个 manifest 在目录中且可按 id 检索
    for (const id of ['patent_oa_response_v1', 'patent_inventiveness_v1', 'patent_infringement_v1']) {
      expect(builtinPatentManifests.some(m => m.id === id)).toBe(true)
    }
  })

  it('模块级导出的 manifest 与目录中的实例一致', () => {
    const pairs = [
      [patentOaResponseManifest, 'patent_oa_response_v1'],
      [patentInventivenessManifest, 'patent_inventiveness_v1'],
      [patentInfringementManifest, 'patent_infringement_v1'],
      [patentInvalidationManifest, 'patent_invalidation_v1'],
      [patentReexaminationManifest, 'patent_reexamination_v1'],
    ] as const
    for (const [manifest, id] of pairs) {
      expect(manifest.id).toBe(id)
      expect(builtinPatentManifests.find(entry => entry.id === id)).toBe(manifest)
    }
  })

  it('目录覆盖八个作业且 id 唯一', () => {
    const ids = builtinPatentManifests.map(manifest => manifest.id)
    expect([...ids].sort()).toEqual(EXPECTED_MANIFEST_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
