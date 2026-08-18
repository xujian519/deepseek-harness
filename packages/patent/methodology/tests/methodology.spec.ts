import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as methodology from '../src/index.ts'
import {
  MethodologyRegistry,
  extractMethodologyKeywords,
  injectMethodology,
} from '../src/index.ts'
import { triz } from '../src/index.ts'
import { firstPrinciples, fishbone, pdca, sixHats } from '../src/index.ts'
import { createTrizTool, paramLabel, principleNames } from '../src/index.ts'
import { loadMatrix, loadPrinciples, lookupMatrixCell } from '../src/index.ts'
import { keywordScore } from '../src/runtime/keywordMatch.ts'

const testToolSignal = new AbortController().signal

function ctx(goal: string) {
  return { goal, keywords: extractMethodologyKeywords(goal) }
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('')
}

function execute(host: Context, name: string, args: unknown, callLabel: string) {
  return host.tools.execute({ signal: testToolSignal, callId: CallId(callLabel), name, arguments: args })
}

async function setupPlugin(config: Record<string, unknown> = {}): Promise<Context> {
  const host = new Context()
  await host.plugin(SystemPrompt)
  await host.plugin(ToolRuntime)
  await host.plugin(methodology, config)
  return host
}

describe('methodology registry and components', () => {
  it('matches five-whys for root-cause questions', () => {
    const registry = new MethodologyRegistry()
    const result = injectMethodology(registry, '分析这个专利被驳回的根本原因是什么')
    expect(result.applied).toBe(true)
    expect(result.methodologyName).toBe('five-whys')
    expect(result.prompt ?? '').toMatch(/5 Whys/)
  })

  it('matches mece for decomposition tasks', () => {
    const registry = new MethodologyRegistry()
    const result = injectMethodology(registry, '请对权利要求进行 MECE 分类拆解')
    expect(result.methodologyName).toBe('mece')
    expect(result.prompt ?? '').toMatch(/MECE/)
  })

  it('matches swot for strategic analysis', () => {
    const registry = new MethodologyRegistry()
    const result = injectMethodology(registry, '做一个 SWOT 分析评估我们公司的专利布局策略')
    expect(result.methodologyName).toBe('swot')
    expect(result.prompt ?? '').toMatch(/SWOT/)
  })

  it('returns applied=false when nothing matches', () => {
    const registry = new MethodologyRegistry()
    const result = injectMethodology(registry, '帮我看看今天天气怎么样')
    expect(result.applied).toBe(false)
  })

  it('domain filter restricts matching', () => {
    const registry = new MethodologyRegistry()
    const result = injectMethodology(registry, '分析失败原因', { domain: 'patent' })
    expect(result.methodologyName).toBe('five-whys')
  })

  it('registry rejects duplicate registrations', () => {
    const registry = new MethodologyRegistry()
    expect(() => { registry.register(registry.list()[0] as never) }).toThrow(/already registered/)
  })

  it('extractMethodologyKeywords lowercases and dedupes', () => {
    const keywords = extractMethodologyKeywords('分析失败原因 Failure Analysis')
    expect(keywords).toContain('分析失败原因')
    expect(keywords).toContain('failure')
    expect(keywords).toContain('analysis')
  })

  it('component prompts embed the goal', () => {
    const registry = new MethodologyRegistry()
    const goal = '为什么系统反复崩溃'
    const result = injectMethodology(registry, goal)
    expect(result.applied).toBe(true)
    expect(result.prompt!).toContain(goal)
  })

  it('match defaults topK and minScore when options are omitted', () => {
    const registry = new MethodologyRegistry()
    const matches = registry.match(ctx('分析失败原因'))
    expect(matches).toHaveLength(1)
    expect(matches[0]!.component.name).toBe('five-whys')
  })

  it('match applies explicit topK and minScore', () => {
    const registry = new MethodologyRegistry()
    const goal = ctx('分析失败原因，做 MECE 拆解')
    // mece scores 2/8 (mece, 拆解), five-whys 2/9 (失败, 原因)
    expect(registry.match(goal, { minScore: 0.24 }).map(m => m.component.name)).toEqual(['mece'])
    expect(registry.match(goal, { topK: 1 })).toHaveLength(1)
  })

  it('match sorts multiple scored components by descending score', () => {
    const registry = new MethodologyRegistry()
    const matches = registry.match(ctx('分析失败原因，做 MECE 拆解'), { topK: 5 })
    expect(matches.map(m => m.component.name)).toEqual(['mece', 'five-whys'])
    expect(matches[0]!.score).toBeGreaterThan(matches[1]!.score)
  })

  it('match domain filter skips components outside the domain', () => {
    const registry = new MethodologyRegistry()
    const goal = ctx('用 SWOT 分析专利布局策略，并做规避设计')
    expect(registry.match(goal, { topK: 8 }).map(m => m.component.name)).toEqual(['swot', 'triz'])
    expect(registry.match(goal, { domain: 'coding' })).toEqual([])
  })

  it('extractMethodologyKeywords handles goals without word characters', () => {
    expect(extractMethodologyKeywords('!!!')).toEqual([])
  })
})

describe('keyword scoring and data access edge cases', () => {
  it('keywordScore returns 0 when no triggers are configured', () => {
    expect(keywordScore(ctx('任何目标'), [])).toBe(0)
  })

  it('lookupMatrixCell returns [] for out-of-range parameters', () => {
    expect(lookupMatrixCell(14, 0)).toEqual([])
    expect(lookupMatrixCell(0, 14)).toEqual([])
  })

  it('paramLabel falls back to the number for unknown parameters', () => {
    expect(paramLabel(99)).toBe('99')
  })

  it('principleNames renders unknown ids without a name', () => {
    expect(principleNames([999])).toBe('999')
    expect(principleNames([1, 999])).toBe('1 分割, 999')
  })
})

describe('component execute prompts', () => {
  it('firstPrinciples execute renders the decomposition prompt', () => {
    const goal = '如何颠覆现有电池技术'
    const prompt = firstPrinciples.execute(ctx(goal)).prompt
    expect(prompt).toContain('第一性原理')
    expect(prompt).toContain(goal)
  })

  it('fishbone execute renders the cause-and-effect prompt', () => {
    const goal = '排查产线不良率高的原因'
    const prompt = fishbone.execute(ctx(goal)).prompt
    expect(prompt).toContain('鱼骨图')
    expect(prompt).toContain(goal)
  })

  it('pdca execute renders the improvement-cycle prompt', () => {
    const goal = '优化专利申请流程'
    const prompt = pdca.execute(ctx(goal)).prompt
    expect(prompt).toContain('PDCA')
    expect(prompt).toContain(goal)
  })

  it('sixHats execute renders the parallel-thinking prompt', () => {
    const goal = '全面评估收购方案'
    const prompt = sixHats.execute(ctx(goal)).prompt
    expect(prompt).toContain('六顶思考帽')
    expect(prompt).toContain(goal)
  })
})

describe('triz component', () => {
  it('identify hits contradiction/trade-off/design-around triggers', () => {
    expect(triz.identify(ctx('这个结构的强度和重量存在矛盾，需要权衡'))).toBeGreaterThan(0)
    expect(triz.identify(ctx('对竞争对手专利做规避设计'))).toBeGreaterThan(0)
    expect(triz.identify(ctx('优化传动效率时体积增大，需要权衡'))).toBeGreaterThan(0)
  })

  it('identify misses unrelated tasks', () => {
    expect(triz.identify(ctx('写一份会议纪要'))).toBe(0)
  })

  it('identify does not fire on generic improve/optimize words alone', () => {
    expect(triz.identify(ctx('改进生产线流程，优化效率'))).toBe(0)
    expect(triz.identify(ctx('重构这套系统的架构'))).toBe(0)
  })

  it('execute prompt contains contradiction definition and matrix steps', () => {
    const prompt = triz.execute(ctx('改进切割装置')).prompt
    expect(prompt).toContain('技术矛盾')
    expect(prompt).toContain('矛盾矩阵')
    expect(prompt).toContain('40 发明原理')
    expect(prompt).toContain('规避设计')
  })

  it('execute injects deterministic lookup when the goal names parameters', () => {
    const prompt = triz.execute(ctx('提高强度同时减轻重量')).prompt
    expect(prompt).toContain('确定性查表结果')
    expect(prompt).toContain('强度(14)')
    expect(prompt).toContain('重量(1)')
    expect(prompt).toContain('原理 [')
  })

  it('execute omits the lookup section when no parameter is named', () => {
    const prompt = triz.execute(ctx('写一份会议纪要')).prompt
    expect(prompt).not.toContain('确定性查表结果')
  })

  it('lookupMatrixCell resolves classic reference cells', () => {
    expect(lookupMatrixCell(14, 1)).toEqual([1, 8, 40, 15])
    expect(lookupMatrixCell(9, 10)).toEqual([13, 28, 15, 19])
  })

  it('matrix data is 39x39 with 1190 filled cells of principle numbers 1-40', () => {
    const data = loadMatrix()
    expect(data.length).toBe(39)
    let filled = 0
    for (const row of data) {
      expect(row.length).toBe(39)
      for (const cell of row) {
        if (cell.length > 0) filled += 1
        for (const n of cell) {
          expect(n).toBeGreaterThanOrEqual(1)
          expect(n).toBeLessThanOrEqual(40)
        }
      }
    }
    expect(filled).toBe(1190)
  })

  it('matrix diagonal cells are empty physical contradictions', () => {
    const data = loadMatrix()
    for (let i = 0; i < 39; i += 1) {
      expect(data[i]?.[i]).toEqual([])
    }
  })

  it('principles data holds 40 numbered, named, described entries', () => {
    const data = loadPrinciples()
    expect(data.length).toBe(40)
    expect(new Set(data.map(p => p.no)).size).toBe(40)
    expect(data.map(p => p.no)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    for (const p of data) {
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.description.length).toBeGreaterThan(0)
    }
  })

  it('triz is registered in the default component set', () => {
    const registry = new MethodologyRegistry()
    expect(registry.has('triz')).toBe(true)
  })
})

describe('dsh-methodology plugin-registered triz tool', () => {
  it('registers the triz tool', async () => {
    const host = await setupPlugin()
    const names = host.tools.schemas().map(schema => schema.name)
    expect(names).toContain('triz')
  })

  it('lists the 39 parameters and 40 principles with no arguments', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', {}, 'catalog')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected triz success')
    const value = result.value as { mode: string; parameters: { number: number }[]; principles: { number: number }[] }
    expect(value.mode).toBe('catalog')
    expect(value.parameters.length).toBe(39)
    expect(value.principles.length).toBe(40)
    expect(value.principles.map(p => p.number)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
    const rendered = text(result)
    expect(rendered).toContain('39 engineering parameters')
    expect(rendered).toContain('40 inventive principles')
  })

  it('looks up a contradiction-matrix cell for an improving/worsening pair', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', { improving: 14, worsening: 1 }, 'lookup')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected triz success')
    const value = result.value as {
      mode: string
      improving: { number: number; label: string }
      worsening: { number: number; label: string }
      recommended: { number: number; name: string }[]
    }
    expect(value.mode).toBe('lookup')
    expect(value.improving).toEqual({ number: 14, label: '强度' })
    expect(value.worsening).toEqual({ number: 1, label: '运动物体重量' })
    expect(value.recommended.map(p => p.number)).toEqual([1, 8, 40, 15])
    expect(value.recommended.every(p => p.name.length > 0)).toBe(true)
    const rendered = text(result)
    expect(rendered).toContain('强度 (14)')
    expect(rendered).toContain('运动物体重量 (1)')
    expect(rendered).toContain('1, 8, 40, 15')
  })

  it('fails loudly when exactly one of improving/worsening is given', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', { improving: 14 }, 'half-pair')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('both improving and worsening')
  })

  it('renders the empty recommendation text for a diagonal cell', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', { improving: 5, worsening: 5 }, 'diagonal')
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected triz success')
    const value = result.value as { mode: string; recommended: unknown[] }
    expect(value.mode).toBe('lookup')
    expect(value.recommended).toEqual([])
    expect(text(result)).toContain('Recommended principles: none.')
  })

  it('rejects an improving parameter outside 1-39', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', { improving: 40, worsening: 1 }, 'bad-improving')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('improving must be an integer 1-39')
  })

  it('rejects a worsening parameter outside 1-39', async () => {
    const host = await setupPlugin()
    const result = await execute(host, 'triz', { improving: 14, worsening: 0 }, 'bad-worsening')
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('worsening must be an integer 1-39')
  })

  it('render throws for an unknown mode (exhaustive default)', () => {
    const tool = createTrizTool()
    expect(() => tool.output.render({}, { mode: 'bogus' })).toThrow(/未知 TrizOutput mode/)
  })

  it('unregisters the tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const host = new Context()
    await host.plugin(SystemPrompt)
    await host.plugin(ToolRuntime)
    const fiber = await host.plugin(methodology, {})
    expect(host.tools.schemas().some(schema => schema.name === 'triz')).toBe(true)
    await fiber.dispose()
    expect(host.tools.schemas().some(schema => schema.name === 'triz')).toBe(false)
  })
})
