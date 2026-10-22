import { describe, expect, it } from 'vitest'
import { ExtractHandler, type StageProvider } from '@deepseek-ai/dsh-patent-core'

/** 构造只返回指定 JSON 文本的 provider，并捕获本次请求的 schema。 */
function providerFor(
  raw: string,
  captured: { schema?: unknown; prompt?: string } = {},
): StageProvider {
  return {
    callLLM: async (prompt, opts) => {
      captured.prompt = prompt
      captured.schema = opts?.jsonSchema
      return raw
    },
  }
}

describe('extract 分键输出', () => {
  it('output_key=problems：只要求 problems，写入 state.problems', async () => {
    const captured: { schema?: unknown; prompt?: string } = {}
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'problems' },
      provider: providerFor(JSON.stringify({ problems: ['问题1'] }), captured),
    })

    expect(out.problems).toEqual(['问题1'])
    expect(out.features).toBeUndefined()
    expect(out._error).toBeUndefined()
    expect(captured.schema).toMatchObject({ required: ['problems'] })
    expect(captured.prompt).toContain('"problems"')
  })

  it('output_key=effects：只要求 effects，写入 state.effects', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'effects' },
      provider: providerFor(JSON.stringify({ effects: ['效果1'] })),
    })

    expect(out.effects).toEqual(['效果1'])
    expect(out.features).toBeUndefined()
    expect(out._error).toBeUndefined()
  })

  it('output_key=insight：只要求 insight，写入 state.insight', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'insight' },
      provider: providerFor(JSON.stringify({ insight: ['认知1'] })),
    })

    expect(out.insight).toEqual(['认知1'])
    expect(out.features).toBeUndefined()
    expect(out._error).toBeUndefined()
  })

  it('output_key=features：接受 features-only 输出', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features' },
      provider: providerFor(JSON.stringify({ features: ['特征A'] })),
    })

    expect(out.features).toEqual(['特征A'])
    expect(out._error).toBeUndefined()
  })

  it('无 output_key：保持全量模式，schema 仍要求 features', async () => {
    const captured: { schema?: unknown; prompt?: string } = {}
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置' },
      provider: providerFor(
        JSON.stringify({ features: ['特征A'], problems: ['问题1'], effects: [] }),
        captured,
      ),
    })

    expect(out.features).toEqual(['特征A'])
    expect(out.problems).toEqual(['问题1'])
    expect(out.effects).toEqual([])
    expect(captured.schema).toMatchObject({ required: ['features'] })
  })

  it('目标键缺失：返回可操作降级，不静默回退原文', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'problems' },
      provider: providerFor(JSON.stringify({ features: ['特征A'] })),
    })

    expect(String(out._error)).toContain('problems 不是数组')
    expect(out.problems).toBeUndefined()
  })

  it('目标数组含非字符串项：指出下标并降级', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'problems' },
      provider: providerFor(JSON.stringify({ problems: ['问题1', { bad: true }] })),
    })

    expect(String(out._error)).toContain('problems 数组含非字符串项（下标 1）')
    expect(out.problems).toBeUndefined()
  })

  it('模型输出非 JSON：目标键模式下降级并说明缺少目标数组', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'problems' },
      provider: providerFor('这不是 JSON'),
    })

    expect(String(out._error)).toContain('缺少 problems 数组')
    expect(out.problems).toBeUndefined()
  })

  it('空数组是合法结果', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'problems' },
      provider: providerFor(JSON.stringify({ problems: [] })),
    })

    expect(out.problems).toEqual([])
    expect(out._error).toBeUndefined()
  })
})

describe('extract 规则缺口反哺', () => {
  const targets = [
    { checkId: 'time-baseline', provision: '专利法第22条第5款', label: '现有技术时间基准' },
    { checkId: 'grace-period', provision: '专利法第24条', label: '宽限期公开' },
  ]

  it('把反哺目标写进提示词，并要求逐项 revision_coverage', async () => {
    const captured: { schema?: unknown; prompt?: string } = {}
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features', revision_targets: targets },
      provider: providerFor(JSON.stringify({
        features: ['特征A'],
        revision_coverage: { 'time-baseline': ['申请日 2024-01-01'], 'grace-period': [] },
      }), captured),
    })

    expect(out.features).toEqual(['特征A'])
    expect(out.revision_coverage).toEqual({
      'time-baseline': ['申请日 2024-01-01'],
      'grace-period': [],
    })
    expect(captured.schema).toMatchObject({ required: ['features', 'revision_coverage'] })
    expect(captured.prompt).toContain('[time-baseline] 专利法第22条第5款 — 现有技术时间基准')
    expect(captured.prompt).toContain('规则缺口反哺')
  })

  it('缺少 revision_coverage 时保留已抽取特征，不把整轮判成降级', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features', revision_targets: targets },
      provider: providerFor(JSON.stringify({ features: ['特征A'] })),
    })

    expect(out._error).toBeUndefined()
    expect(out.features).toEqual(['特征A'])
    expect(out.revision_coverage).toEqual({})
  })

  it('覆盖项含非字符串时只丢弃该条，保留已抽取特征', async () => {
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features', revision_targets: targets },
      provider: providerFor(JSON.stringify({
        features: ['特征A'],
        revision_coverage: { 'time-baseline': ['申请日'], 'grace-period': [1] },
      })),
    })

    expect(out._error).toBeUndefined()
    expect(out.features).toEqual(['特征A'])
    expect(out.revision_coverage).toEqual({ 'time-baseline': ['申请日'], 'grace-period': [] })
  })

  it('多路提取的覆盖事实按 checkId 取并集，后一路不覆盖前一路', async () => {
    const out = await new ExtractHandler().execute({
      state: {
        text: '一种装置',
        output_key: 'effects',
        revision_targets: targets,
        revision_coverage: { 'time-baseline': ['申请日 2024-01-01'] },
      },
      provider: providerFor(JSON.stringify({
        effects: ['效果A'],
        revision_coverage: { 'time-baseline': ['同一申请日的另一处记载'], 'grace-period': ['首次公开日'] },
      })),
    })

    expect(out.revision_coverage).toEqual({
      'time-baseline': ['申请日 2024-01-01', '同一申请日的另一处记载'],
      'grace-period': ['首次公开日'],
    })
  })

  it('非法目标被丢弃；全部非法时按普通抽取执行', async () => {
    const captured: { schema?: unknown; prompt?: string } = {}
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features', revision_targets: [{ checkId: '' }, null, 'x'] },
      provider: providerFor(JSON.stringify({ features: ['特征A'] }), captured),
    })

    expect(out.features).toEqual(['特征A'])
    expect(out.revision_coverage).toBeUndefined()
    expect(captured.schema).toMatchObject({ required: ['features'] })
  })

  it('混合非法目标时只保留合法条目', async () => {
    const out = await new ExtractHandler().execute({
      state: {
        text: '一种装置',
        output_key: 'features',
        revision_targets: [
          { checkId: 1, provision: 'p', label: 'l' },
          { checkId: 'x', provision: '', label: 'l' },
          { checkId: 'y', provision: 'p', label: '' },
          targets[0],
        ],
      },
      provider: providerFor(JSON.stringify({
        features: ['特征A'],
        revision_coverage: { 'time-baseline': ['申请日'] },
      })),
    })

    expect(out.features).toEqual(['特征A'])
    expect(out.revision_coverage).toEqual({ 'time-baseline': ['申请日'] })
  })

  it('反哺目标超过上限时截断到 8 个', async () => {
    const captured: { schema?: unknown; prompt?: string } = {}
    const many = Array.from({ length: 9 }, (_, index) => ({
      checkId: `check-${index}`,
      provision: 'p',
      label: 'l',
    }))
    const out = await new ExtractHandler().execute({
      state: { text: '一种装置', output_key: 'features', revision_targets: many },
      provider: providerFor(JSON.stringify({ features: ['特征A'] }), captured),
    })
    expect(out.features).toEqual(['特征A'])
    expect(captured.prompt?.match(/\[check-\d\]/g)).toHaveLength(8)
  })

  it('覆盖条目非数组时跳过该条，既有覆盖值非数组时也忽略', async () => {
    const out = await new ExtractHandler().execute({
      state: {
        text: '一种装置',
        output_key: 'features',
        revision_targets: targets,
        revision_coverage: { 'time-baseline': 'stale' },
      },
      provider: providerFor(JSON.stringify({
        features: ['特征A'],
        revision_coverage: { 'time-baseline': ['申请日'], 'grace-period': 'not-an-array' },
      })),
    })

    expect(out.revision_coverage).toEqual({ 'time-baseline': ['申请日'] })
  })
})
