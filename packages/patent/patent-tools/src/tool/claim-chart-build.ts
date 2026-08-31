/**
 * `claim_chart_build` tool: element-level claim-chart evidence grid via the
 * claim-chart atom (ClaimChartHandler). Ported from Sati's claimChart.ts; the
 * engine lives in @deepseek-ai/dsh-patent-core.
 * @module @deepseek-ai/dsh-patent-tools/tool/claim-chart-build
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ClaimChartHandler } from '@deepseek-ai/dsh-patent-core'
import type { ChartMode, ChartTarget, ClaimChart, PatentModelPort, StageProvider } from '@deepseek-ai/dsh-patent-core'
import { PatentToolError } from '../error.ts'

/** One claim-chart mapping target (prior art or accused product). */
export type ClaimChartTargetInput = {
  id: string
  kind: 'prior-art' | 'accused-product'
  title?: string
  source_path?: string
}

/** Input for the claim_chart_build tool. */
export type ClaimChartInput = {
  mode: ChartMode
  claim_text: string
  targets: ClaimChartTargetInput[]
  case_id?: string
}

/** Output of the claim_chart_build tool. */
export type ClaimChartOutput = {
  chart: ClaimChart
  json_path?: string
  md_path?: string
  gap_count: number
}

/** Injected model port (the integrator wires a createLlmModelPort over ctx.llm). */
export type ClaimChartBuildDeps = {
  model?: PatentModelPort
}

const DESCRIPTION = '构建权利要求对照表（claim chart）：把权利要求拆分为编号要素，逐要素映射到对比文件或产品证据（每行 pin-cite 引用），并输出 gap list（证据薄弱的要素）。适用于撰写（可专利性布局）、OA 答复、无效/复审、侵权比对等场景。'

/** Render the canonical claim-chart value into model-facing prose. */
function renderClaimChart(value: ClaimChartOutput): string {
  const c = value.chart
  const lines = [
    `claim_chart_build: 模式 ${c.mode}，权利要求 ${c.claimNos.join(', ')}，要素 ${c.elements.length} 个，映射行 ${c.rows.length} 行，gap ${c.gaps.length} 个。`,
    '',
  ]
  if (c.gaps.length > 0) {
    lines.push('## Gap list', ...c.gaps.map(g => `- ${g.elementId}→${g.targetId}（${g.mapping}）: ${g.reason} → ${g.suggestion}`))
  } else {
    lines.push('## Gap list', '无 gap（全部要素已映射）。')
  }
  if (value.json_path !== undefined && value.md_path !== undefined) {
    lines.push('', `落盘: ${value.json_path} + ${value.md_path}`)
  }
  return lines.join('\n')
}

/**
 * Build the `claim_chart_build` tool over an injectable model port.
 * @param deps - the model port driving element splitting + mapping.
 * @returns a registry-ready tool definition.
 */
export function createClaimChartBuildTool(deps: ClaimChartBuildDeps = {}): ToolDefinition {
  return defineTool({
    name: 'claim_chart_build',
    description: DESCRIPTION,
    parameters: {
      mode: { type: 'string', required: true, enum: ['infringement', 'invalidity', 'oa-response', 'reexamination', 'patentability'], description: '场景模式：infringement=侵权（被控产品，支持 doe）/invalidity=无效/oa-response=审查意见答复/reexamination=复审/patentability=撰写前可专利性' },
      claim_text: { type: 'string', required: true, description: '权利要求原文（需拆分的权利要求，可含多条）' },
      targets: { type: 'array', required: true, items: { type: 'json' }, description: '映射目标列表（对比文件/被控产品材料），每项 {id, kind: prior-art|accused-product, title?, source_path?}' },
      case_id: { type: 'string', description: '案卷 ID（提供时结果落盘 data/cases/<case_id>/outputs/）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chart: { type: 'json', required: true },
          json_path: { type: 'string' },
          md_path: { type: 'string' },
          gap_count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderClaimChart(value as unknown as ClaimChartOutput) }],
    },
    async execute(args) {
      if (args.claim_text.trim().length === 0) {
        throw new PatentToolError('invalid_tool_input', 'claim_text 为空', { tool: 'claim_chart_build' })
      }
      if (deps.model === undefined) {
        throw new PatentToolError('setup_required', '未配置 LLM（模型客户端缺失），无法执行要素拆分与映射', { tool: 'claim_chart_build' })
      }
      const inputTargets = args.targets as unknown as ClaimChartTargetInput[]
      const targets: ChartTarget[] = inputTargets.map(t => ({
        id: t.id,
        kind: t.kind,
        ...(t.title !== undefined ? { title: t.title } : {}),
        ...(t.source_path !== undefined ? { sourcePath: t.source_path } : {}),
      }))
      const provider: StageProvider = { ...(args.case_id !== undefined ? { caseId: args.case_id } : {}), llm: deps.model }
      const handler = new ClaimChartHandler()
      const state = await handler.execute({
        state: { claim: args.claim_text, chart_targets: JSON.stringify(targets), chart_mode: args.mode },
        provider,
      })
      if (typeof state._error === 'string') {
        throw new PatentToolError('tool_execution_failed', state._error, { tool: 'claim_chart_build' })
      }
      /* v8 ignore next -- the success state always carries a string claim_chart_doc (degraded states carry _error). */
      const doc = typeof state.claim_chart_doc === 'string' ? state.claim_chart_doc : '{}'
      const chart = JSON.parse(doc) as ClaimChart
      const rawPaths = typeof state.claim_chart_paths === 'string' ? state.claim_chart_paths : undefined
      const paths = rawPaths !== undefined ? (JSON.parse(rawPaths) as { jsonPath: string; mdPath: string }) : undefined
      return {
        chart: chart as unknown as JsonValue,
        ...(paths !== undefined ? { json_path: paths.jsonPath, md_path: paths.mdPath } : {}),
        gap_count: chart.gaps.length,
      }
    },
  })
}
