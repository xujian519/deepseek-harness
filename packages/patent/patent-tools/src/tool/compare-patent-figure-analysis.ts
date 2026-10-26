/**
 * `compare_patent_figure_analysis`：把出图时声明的标号清单与识图结果做确定性比对。
 *
 * 闭环由模型串联：`generate_patent_figure` 产出图与期望清单 → `analyze_patent_figure`
 * 读图 → 本工具回答「画出来的和声明的是否一致」。不调用模型；连接关系暂不比对。
 * @module @deepseek-ai/dsh-patent-tools/tool/compare-patent-figure-analysis
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { compareFigureAnalysis } from '../figure/figure-comparison.ts'
import type { FigureComparisonReport, FigureMark } from '../figure/figure-comparison.ts'
import { FINDING_FIELDS, MARK_COMPONENT_SCHEMA, REPORT_TAIL_FIELDS } from './internal/analysis-schemas.ts'

/** 输入：期望与识图两侧的标号清单。 */
export type ComparePatentFigureAnalysisInput = {
  /** 出图时声明的期望。 */
  expected: {
    figure_type?: string | undefined
    components: readonly { ref_number: string; name?: string | undefined }[]
  }
  /** analyze_patent_figure 的识别结果。 */
  analysis: {
    figure_type?: string | undefined
    components: readonly { ref_number: string; name?: string | undefined }[]
  }
}

/** 一侧的 schema：图型可选，标号清单必填。 */
const SIDE_SCHEMA = {
  type: 'object',
  required: true,
  additionalProperties: false,
  properties: {
    figure_type: { type: 'string', description: '图型名称（如 flowchart、cross_section）；两侧都给出时比对，缺省不判' },
    components: {
      type: 'array',
      required: true,
      items: MARK_COMPONENT_SCHEMA,
      description: '该侧的标号清单',
    },
  },
} as const

const DESCRIPTION = '比对出图期望与识图结果：expected 给出生成附图时声明的图型与标号清单，analysis 给出 analyze_patent_figure 的识别结果，本工具逐项报告缺标（期望有、识图无）、多标（识图有、期望无）、名称不符（两侧名称都非空且不同）与图型不符。纯确定性比对，不调用模型；连接关系暂不比对。闭环用法：generate_patent_figure → analyze_patent_figure → 本工具；无发现时 consistent=true。'

/**
 * Build the `compare_patent_figure_analysis` tool.
 * @returns a registry-ready tool definition.
 */
export function createComparePatentFigureAnalysisTool(): ToolDefinition {
  return defineTool({
    name: 'compare_patent_figure_analysis',
    description: DESCRIPTION,
    parameters: {
      expected: SIDE_SCHEMA,
      analysis: SIDE_SCHEMA,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedCount: { type: 'integer', required: true },
          actualCount: { type: 'integer', required: true },
          findings: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ...FINDING_FIELDS,
                check: {
                  type: 'string',
                  required: true,
                  enum: ['figure-type-mismatch', 'missing-mark', 'unexpected-mark', 'name-mismatch'],
                },
                ref: { type: 'string', required: true },
              },
            },
          },
          ...REPORT_TAIL_FIELDS,
        },
      },
      render: (_args, value) => {
        const lines = ['图文比对：期望 vs 识图', '', value.summary]
        const findings = value.findings.map(finding => `- [${finding.check}] ${finding.message}`)
        return [{
          type: 'text',
          text: [...lines, ...(findings.length === 0 ? ['', '## 结论', '- 图文比对通过'] : ['', '## 发现的问题', ...findings])].join('\n'),
        }]
      },
    },
    async execute(args) {
      const report = compareFigureAnalysis({
        expected: {
          ...(args.expected.figure_type === undefined ? {} : { figureType: args.expected.figure_type }),
          components: toMarks(args.expected.components),
        },
        actual: {
          ...(args.analysis.figure_type === undefined ? {} : { figureType: args.analysis.figure_type }),
          components: toMarks(args.analysis.components),
        },
      })
      return toOutput(report)
    },
  })
}

/** 工具输入的标号窄化为比对模块的标记。 */
function toMarks(components: readonly { ref_number: string; name?: string | undefined }[]): FigureMark[] {
  return components.map(component => ({ refNumber: component.ref_number, name: component.name ?? '' }))
}

/** 报告窄化为工具输出（数组逐项复制，调用方不得改动内部状态）。 */
function toOutput(report: FigureComparisonReport): {
  expectedCount: number
  actualCount: number
  findings: FigureComparisonReport['findings']
  summary: string
  consistent: boolean
} {
  return {
    expectedCount: report.expectedCount,
    actualCount: report.actualCount,
    findings: report.findings.map(finding => ({ ...finding })),
    summary: report.summary,
    consistent: report.consistent,
  }
}
