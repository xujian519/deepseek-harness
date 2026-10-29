import { describe, expect, it } from 'vitest'
import { FigureAnalysisHandler } from '../src/atoms/figure-analysis.ts'

const handler = new FigureAnalysisHandler()
const run = (state: Record<string, unknown>) => handler.execute({ state })

describe('FigureAnalysisHandler', () => {
  it('无附图时显式跳过', async () => {
    const out = await run({ figure_files: [] })
    expect(out.figure_analysis).toEqual([])
    expect(String(out.figure_analysis_skipped)).toContain('无附图')
  })

  it('解析 sub_agent 输出的 JSON 数组', async () => {
    const out = await run({
      figure_files: ['fig1.svg'],
      figure_analysis: JSON.stringify([{ figureNumber: 1, usable: true, components: [{ refNumber: '10' }] }]),
    })
    expect(out.figure_analysis).toEqual([{ figureNumber: 1, usable: true, components: [{ refNumber: '10' }] }])
    expect(String(out.figure_analysis_report)).toContain('可用 1 张')
  })

  it('接受已解析的数组', async () => {
    const out = await run({
      figure_files: ['fig1.svg'],
      figure_analysis: [{ usable: false, components: [] }],
    })
    expect(out.figure_analysis).toEqual([{ usable: false, components: [] }])
  })

  it('sub_agent 声明跳过时写原因', async () => {
    const out = await run({ figure_files: ['fig1.svg'], figure_analysis: '[SKIP] 视觉能力不可用' })
    expect(out.figure_analysis).toEqual([])
    expect(String(out.figure_analysis_skipped)).toBe('视觉能力不可用')
    const bare = await run({ figure_files: ['fig1.svg'], figure_analysis: '[SKIP]' })
    expect(String(bare.figure_analysis_skipped)).toBe('sub_agent 声明跳过')
  })

  it('没有分析结果时显式跳过', async () => {
    const out = await run({ figure_files: ['fig1.svg'] })
    expect(out.figure_analysis).toEqual([])
    expect(String(out.figure_analysis_skipped)).toContain('未产出')
    const blank = await run({ figure_files: ['fig1.svg'], figure_analysis: '   ' })
    expect(String(blank.figure_analysis_skipped)).toContain('未产出')
  })

  it('非法 JSON 与非法条目降级报错', async () => {
    const badJson = await run({ figure_files: ['fig1.svg'], figure_analysis: '{' })
    expect(String(badJson._error)).toContain('不是合法 JSON')
    const badEntry = await run({ figure_files: ['fig1.svg'], figure_analysis: JSON.stringify([{ usable: true }]) })
    expect(String(badEntry._error)).toContain('components 必须是数组')
    const badNumber = await run({
      figure_files: ['fig1.svg'],
      figure_analysis: JSON.stringify([{ figureNumber: 0, usable: true, components: [] }]),
    })
    expect(String(badNumber._error)).toContain('figureNumber 必须是正整数')
    const badShape = await run({ figure_files: ['fig1.svg'], figure_analysis: '42' })
    expect(String(badShape._error)).toContain('必须是数组')
  })

  it('拒绝非对象条目、非布尔 usable 与非法组件', async () => {
    const cases: [unknown, string][] = [
      [[null], '必须是对象'],
      [[{ usable: 'yes', components: [] }], 'usable 必须是布尔值'],
      [[{ usable: true, components: [null] }], 'components[0] 必须是对象'],
      [[{ usable: true, components: [{ refNumber: 1 }] }], 'refNumber 必须是字符串'],
    ]
    for (const [entry, message] of cases) {
      const out = await run({ figure_files: ['fig1.svg'], figure_analysis: JSON.stringify(entry) })
      expect(String(out._error)).toContain(message)
    }
  })
})
