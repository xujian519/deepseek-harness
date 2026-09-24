import { describe, expect, it } from 'vitest'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import { createPatentAnalysisReportTool, type PatentAnalysisReportOutput } from '../src/tool/patent-analysis-report.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const exec = { signal: new AbortController().signal } as unknown as Parameters<ToolDefinition['execute']>[1]

const ARGS = {
  patent_id: 'CN123456789A',
  title: '一种智能机器人控制方法',
  abstract: '本发明公开一种智能机器人控制方法及系统，基于多传感器数据生成控制指令。',
  claims: [
    '一种智能机器人控制方法，其特征在于，包括：获取传感器数据；基于所述数据生成控制指令；执行所述控制指令。',
    '如权利要求1所述的方法，其特征在于，所述传感器数据包括视觉图像与激光测距数据。',
    '一种机器人控制系统，包括：处理器、存储器与执行机构。',
  ],
}

/** A ModelPort returning a fixed score JSON. */
function jsonModel(payload: unknown): PatentModelPort {
  return {
    stream: async function* () {
      yield { type: 'delta', text: JSON.stringify(payload) }
      yield { type: 'done' }
    },
  }
}

describe('patent_analysis_report', () => {
  it('registers under patent_analysis_report', () => {
    expect(createPatentAnalysisReportTool().name).toBe('patent_analysis_report')
  })

  it('assembles the deterministic report without a model', async () => {
    const tool = createPatentAnalysisReportTool()
    const value = (await tool.execute(ARGS, exec)) as PatentAnalysisReportOutput
    expect(value.patentId).toBe('CN123456789A')
    expect(value.technicalFeatures).toHaveLength(3)
    expect(value.featureStatistics.total).toBe(3)
    expect(value.ipc.length).toBeGreaterThan(0)
    // Deterministic-only: no model dimensions.
    expect(value.scores.map(s => s.domain)).not.toContain('novelty')
    expect(value.scores.map(s => s.domain)).not.toContain('technical_strength')
    expect(value.innovationInsights.length).toBeGreaterThan(0)
    // Standardized search strategy derived from the IPC classification.
    expect(value.searchStrategy?.query).toContain('智能机器人')
    expect(value.searchStrategy?.ipc?.length).toBeGreaterThan(0)
  })

  it('renders every model-facing section with its sources', async () => {
    const tool = createPatentAnalysisReportTool({
      model: jsonModel({ novelty: { score: 80, rationale: '初判具有新颖性' }, technical_strength: { score: 75, rationale: '技术效果明确' } }),
    })
    const value = (await tool.execute(ARGS, exec)) as PatentAnalysisReportOutput
    const blocks = tool.output.render({}, value as never)
    const text = blocks.map(block => ('text' in block && typeof block.text === 'string' ? block.text : '')).join('')
    const top = value.ipc[0]!
    expect(text).toContain(`# 专利分析报告：${ARGS.title}`)
    expect(text).toContain(`专利号：${ARGS.patent_id}`)
    expect(text).toContain(`IPC：${top.section} ${top.domainName}（置信度 ${top.confidence.toFixed(2)}）`)
    expect(text).toContain('## 技术特征')
    expect(text).toContain(`- 权${value.technicalFeatures[0]!.claimNo} [${value.technicalFeatures[0]!.type}/${value.technicalFeatures[0]!.importance}] ${value.technicalFeatures[0]!.text}`)
    expect(text).toContain('## 质量评分')
    // Each score row states the domain, the score, and whether the model or the
    // deterministic rules produced it.
    expect(text).toContain('- novelty：80/100（LLM）— 初判具有新颖性')
    expect(text).toContain('（规则）')
    expect(text).toContain('## 创新性洞察')
    expect(text.split('\n')).toContain('## 检索策略')
    expect(text).toContain(`- 检索式：${value.searchStrategy!.query}`)
  })

  it('fills novelty / technical_strength from the model when configured', async () => {
    const tool = createPatentAnalysisReportTool({
      model: jsonModel({ novelty: { score: 80, rationale: '初判具有新颖性' }, technical_strength: { score: 75, rationale: '技术效果明确' } }),
    })
    const value = (await tool.execute(ARGS, exec)) as PatentAnalysisReportOutput
    const novelty = value.scores.find(s => s.domain === 'novelty')
    const strength = value.scores.find(s => s.domain === 'technical_strength')
    expect(novelty?.basis).toBe('model')
    expect(novelty?.score).toBe(80)
    expect(strength?.basis).toBe('model')
    expect(strength?.score).toBe(75)
  })

  it('falls back to deterministic-only when the model call fails', async () => {
    const tool = createPatentAnalysisReportTool({
      model: { stream: async function* () { throw new Error('no llm') } },
    })
    const value = (await tool.execute(ARGS, exec)) as PatentAnalysisReportOutput
    expect(value.scores.map(s => s.domain)).not.toContain('novelty')
    expect(value.scores.map(s => s.domain)).toContain('clarity')
  })
})
