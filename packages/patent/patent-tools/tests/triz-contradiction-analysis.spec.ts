import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { createTrizContradictionAnalysisTool, renderTrizContradictionAnalysis } from '../src/tool/triz-contradiction-analysis.ts'

const signal = new AbortController().signal

const SOURCE = '本方案增大预紧力以提升结构稳定性，但预紧力增大后装配耗时明显增加，产线节拍下降。'

/** 随包矩阵中 improving=3、worsening=1 有推荐原理（8/15/29/34）；此处只用它的存在性。 */
const RECOMMENDED_CELL = { improving: 3, worsening: 1 }

function jsonModel(json: string): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta' as const, text: json }
      yield { type: 'done' as const }
    },
  }
}

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

describe('triz_contradiction_analysis', () => {
  it('识别矛盾、核验证据并把方案方向与补强清单渲染到模型可见文本', async () => {
    const cell = RECOMMENDED_CELL
    const model = jsonModel(JSON.stringify({
      contradictions: [
        {
          improving: cell.improving,
          worsening: cell.worsening,
          statement: '提升结构稳定性同时牺牲节拍',
          evidence: '增大预紧力以提升结构稳定性',
          solution_directions: ['预紧力改为分组可调'],
        },
        {
          improving: cell.improving,
          worsening: cell.worsening,
          statement: '原文没有依据的矛盾',
          evidence: '这句话不在交底书里',
        },
      ],
      parameter_gaps: [{ parameter: 17, missing: ['target-value', 'unit'], detail: '只写加热，未给温度范围' }],
      unmapped: [{ statement: '提高客户满意度', reason: '非工程参数' }],
    }))
    const ctx = await ctxWith(createTrizContradictionAnalysisTool({ model }))
    const result = await execute(ctx, 'triz_contradiction_analysis', { text: SOURCE }, 'tca-1')

    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected success')
    const out = text(result)
    expect(out).toContain('矛盾 1 条')
    expect(out).toContain('其中证据未定位丢弃 1 条')
    expect(out).toContain('## 技术矛盾')
    expect(out).toContain('改善「')
    expect(out).toContain('增大预紧力以提升结构稳定性')
    expect(out).toContain('推荐原理：')
    expect(out).toContain('预紧力改为分组可调')
    expect(out).toContain('## 参数完备性缺口（交底书补强清单）')
    expect(out).toContain('温度（17）：缺目标值、缺单位 —— 只写加热，未给温度范围')
    expect(out).toContain('## 未采纳')
    expect(out).toContain('提高客户满意度 —— 非工程参数')

    const value = (result as { value?: { dropped_for_evidence?: number; contradictions?: unknown[] } }).value
    expect(value?.dropped_for_evidence).toBe(1)
    expect(value?.contradictions).toHaveLength(1)
  })

  it('text 为空 → 输入错误，不调用模型', async () => {
    const ctx = await ctxWith(createTrizContradictionAnalysisTool({ model: jsonModel('{}') }))
    const result = await execute(ctx, 'triz_contradiction_analysis', { text: '   ' }, 'tca-2')

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('text 为空')
  })

  it('未注入模型端口 → setup_required', async () => {
    const ctx = await ctxWith(createTrizContradictionAnalysisTool())
    const result = await execute(ctx, 'triz_contradiction_analysis', { text: SOURCE }, 'tca-3')

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('未配置 LLM')
  })

  it('模型输出不是 JSON → 执行失败并带原因', async () => {
    const ctx = await ctxWith(createTrizContradictionAnalysisTool({ model: jsonModel('不是 JSON') }))
    const result = await execute(ctx, 'triz_contradiction_analysis', { text: SOURCE }, 'tca-4')

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('JSON')
  })
})

describe('renderTrizContradictionAnalysis', () => {
  it('空产物渲染出明确的零结果说明', () => {
    const out = renderTrizContradictionAnalysis({
      contradictions: [],
      parameter_gaps: [],
      unmapped: [],
      dropped_for_evidence: 0,
    })

    expect(out).toContain('矛盾 0 条')
    expect(out).toContain('未识别到有原文证据支撑的技术矛盾。')
    expect(out).toContain('无缺口记录。')
    expect(out).not.toContain('## 未采纳')
  })

  it('非对象输入不抛错', () => {
    expect(renderTrizContradictionAnalysis(undefined)).toBe('triz_contradiction_analysis: 无结果')
  })

  it('矩阵空缺与物理矛盾不给推荐原理', () => {
    const out = renderTrizContradictionAnalysis({
      contradictions: [
        { id: 'C1', improving: { number: 1, name: '运动物体重量' }, worsening: { number: 1, name: '运动物体重量' }, statement: 's', evidence: 'e', principles: [], matrixStatus: 'physical', solutionDirections: [] },
        { id: 'C2', improving: { number: 2, name: '静止物体重量' }, worsening: { number: 3, name: '运动物体长度' }, statement: 's', evidence: 'e', principles: [], matrixStatus: 'gap', solutionDirections: [] },
      ],
      parameter_gaps: [],
      unmapped: [],
      dropped_for_evidence: 0,
    })

    expect(out).toContain('物理矛盾（对角格，经典矩阵无条目）')
    expect(out).toContain('矩阵转录空缺（无推荐原理）')
    expect(out.match(/推荐原理：无（矩阵无条目或转录空缺）/g)).toHaveLength(2)
  })
})
