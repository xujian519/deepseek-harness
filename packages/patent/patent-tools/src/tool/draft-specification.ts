/**
 * `draft_specification` tool: deterministic patent-specification drafting
 * (technical field / background / summary / drawings / embodiments). Ported from
 * Sati's draftSpecification.ts. No LLM or dsh service dependency.
 * @module @deepseek-ai/dsh-patent-tools/tool/draft-specification
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { DOMAIN_KEYWORDS } from './draft-claims.ts'
import type { PatentType, TechDomain } from './draft-claims.ts'

/** Minimal figure-analysis shape the drafting layer reads (Sati figure/types.ts). */
export type FigureAnalysisResult = {
  figureDescription: string
  electrical?: { components: Array<{ ref: string; name: string; value?: string }> }
}

/** Input for the draft_specification tool. */
export type DraftSpecificationInput = {
  /** Invention title (max 25 chars). */
  title: string
  /** Technical domain. */
  tech_domain?: TechDomain
  /** Patent type: invention or utility model (default invention). */
  patent_type?: PatentType
  /** Technical problem to solve (optional). */
  technical_problem?: string
  /** Technical solution description (optional). */
  technical_solution?: string
  /** Beneficial effects (optional). */
  beneficial_effects?: string
  /** Background / prior-art description (optional). */
  background?: string
  /** Drawing descriptions (optional, e.g. "图1为本发明实施例的整体结构示意图"). */
  drawing_descriptions?: string[]
  /** Figure-analysis results (optional): auto-generate drawing descriptions when absent. */
  figure_analysis?: FigureAnalysisResult[]
  /** Embodiments (optional, may be several). */
  embodiments?: string[]
  /** Whether drawings exist (utility models require them). */
  has_drawings?: boolean
}

/** One specification section (name, content, and placeholder flag). */
export type SpecificationSection = {
  name: string
  content: string
  /** Whether this is a template guide (missing user input). */
  placeholder: boolean
}

/** Output of the draft_specification tool. */
export type DraftSpecificationOutput = {
  title: string
  tech_domain: TechDomain
  patent_type: PatentType
  sections: SpecificationSection[]
  warnings: string[]
}

const DESCRIPTION = '根据技术交底书或技术方案撰写符合要求的专利说明书草案（技术领域/背景技术/发明内容/附图说明/具体实施方式五部分）。当用户要求撰写说明书、写专利申请文件时使用，避免自行手写说明书文本。'

/** Render the canonical draft into model-facing Markdown. */
function renderDraftSpecification(value: DraftSpecificationOutput): string {
  const lines = [`# 说明书草案（${value.title}）`, `技术领域: ${value.tech_domain} · 专利类型: ${value.patent_type}`, '']
  for (const section of value.sections) {
    lines.push(`## ${section.name}${section.placeholder ? '（撰写指引）' : ''}`, '', section.content, '')
  }
  if (value.warnings.length > 0) lines.push('## 警告', ...value.warnings.map(w => `- ${w}`))
  return lines.join('\n')
}

function buildTechField(title: string, domain: TechDomain): SpecificationSection {
  const domainLabel = domain === 'mechanical' ? '机械' : domain === 'electrical' ? '电学' : domain === 'chemical' ? '化学' : domain === 'software' ? '软件' : ''
  return { name: '技术领域', content: `本发明涉及${domainLabel}技术领域，尤其涉及一种${title}。`, placeholder: false }
}

function buildBackground(background?: string): SpecificationSection {
  if (background && background.trim()) return { name: '背景技术', content: background.trim(), placeholder: false }
  return { name: '背景技术', content: '【撰写指引】描述现有技术的不足：① 引证与本申请最接近的现有技术文件并注明出处；② 指出现有技术存在的问题/缺陷，引出本申请要解决的技术问题。', placeholder: true }
}

function buildContent(input: DraftSpecificationInput): SpecificationSection {
  const parts: string[] = []
  const problem = input.technical_problem?.trim()
  const solution = input.technical_solution?.trim()
  const effects = input.beneficial_effects?.trim()
  if (problem) parts.push(`本发明要解决的技术问题是：${problem}`)
  else parts.push('【撰写指引】记载要解决的技术问题（与背景技术的缺陷对应）。')
  if (solution) parts.push(`为解决上述技术问题，本发明提供如下技术方案：${solution}`)
  else parts.push('【撰写指引】记载技术方案（与权利要求的技术特征对应，问题→方案→效果逻辑链完整）。')
  if (effects) parts.push(`本发明的有益效果是：${effects}`)
  else parts.push('【撰写指引】记载有益效果（与区别技术特征对应，有对比实验或理论推导支撑）。')
  return { name: '发明内容', content: parts.join('\n'), placeholder: !(problem && solution && effects) }
}

function buildDrawings(descriptions?: string[], hasDrawings?: boolean): SpecificationSection {
  if (descriptions && descriptions.length > 0) {
    const content = descriptions.map((d, i) => {
      const trimmed = d.trim()
      return /^(?:图|附图)\s*(?:\d+|[一二三四五六七八九十]+)/.test(trimmed) ? trimmed : `图${i + 1}为${trimmed}`
    }).join('\n')
    return { name: '附图说明', content, placeholder: false }
  }
  if (hasDrawings) {
    return { name: '附图说明', content: '【撰写指引】按图序逐图说明：图1为整体结构示意图，图2为局部放大图（按实际附图调整）。', placeholder: true }
  }
  return { name: '附图说明', content: '【撰写指引】如无附图可省略本节；如有附图，按图序说明每幅附图的图名和内容。', placeholder: true }
}

function buildEmbodiments(embodiments?: string[], patentType?: PatentType): SpecificationSection {
  if (embodiments && embodiments.length > 0) {
    const content = embodiments.map((e, i) => `实施例${i + 1}：${e.trim()}`).join('\n')
    return { name: '具体实施方式', content, placeholder: false }
  }
  return { name: '具体实施方式', content: `【撰写指引】撰写至少一个实施例，使所属领域技术人员能够实现：① 实施例的操作步骤/参数/条件记载完整；② 数值范围给出端点值和至少一个中间值的实施例；③ 有益效果有定量效果数据；④ 有与最接近现有技术的对比实验数据（${patentType === 'utility_model' ? '实用新型' : '创造性'}判断的关键支撑）。`, placeholder: true }
}

function resolveDomain(hint: TechDomain | undefined, title: string, input: DraftSpecificationInput): TechDomain {
  if (hint && hint !== 'general') return hint
  const haystack = `${title} ${input.technical_solution ?? ''} ${input.background ?? ''}`
  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.keywords.some(k => haystack.includes(k))) return entry.domain
  }
  return 'general'
}

/** Enrich a figure description with electrical component detail (Step3), when present. */
function enrichFigureDescription(figure: FigureAnalysisResult): string {
  const base = figure.figureDescription.trim()
  const electrical = figure.electrical
  if (!electrical || electrical.components.length === 0) return base
  const hasAllRefs = electrical.components.every(component => base.includes(component.ref))
  if (hasAllRefs) return base
  const details = electrical.components.map(component => `${component.ref}-${component.name}${component.value ? `（${component.value}）` : ''}`).join('；')
  return base.length > 0 ? `${base}\n图中：${details}；` : `图1为电路原理图；图中：${details}；`
}

/**
 * Pure entry point: assemble a five-part specification draft.
 * @param input - the specification-drafting request.
 * @returns the drafted sections and warnings.
 */
export function draftSpecification(input: DraftSpecificationInput): DraftSpecificationOutput {
  const title = input.title.trim()
  const patentType: PatentType = input.patent_type ?? 'invention'
  const domain = resolveDomain(input.tech_domain, title, input)
  const warnings: string[] = []
  if (title.length > 25) warnings.push(`发明名称 ${title.length} 字，超过 25 字限制`)
  if (patentType === 'utility_model' && !input.has_drawings) warnings.push('实用新型必须有附图，请确认补充附图')
  const explicitDescriptions = input.drawing_descriptions && input.drawing_descriptions.length > 0 ? input.drawing_descriptions : undefined
  const autoDescriptions = input.figure_analysis?.map(f => enrichFigureDescription(f).trim()).filter(d => d.length > 0) ?? []
  const drawingDescriptions = explicitDescriptions ?? (autoDescriptions.length > 0 ? autoDescriptions : undefined)
  if (!explicitDescriptions && autoDescriptions.length > 0) warnings.push('附图说明由附图智能分析自动生成，请人工核对附图标记与图面一致')
  const sections: SpecificationSection[] = [
    buildTechField(title, domain),
    buildBackground(input.background),
    buildContent(input),
    buildDrawings(drawingDescriptions, input.has_drawings),
    buildEmbodiments(input.embodiments, patentType),
  ]
  return { title, tech_domain: domain, patent_type: patentType, sections, warnings }
}

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', required: true },
    content: { type: 'string', required: true },
    placeholder: { type: 'boolean', required: true },
  },
} as const

/**
 * Build the `draft_specification` tool (pure, no dependencies).
 * @returns a registry-ready tool definition.
 */
export function createDraftSpecificationTool(): ToolDefinition {
  return defineTool({
    name: 'draft_specification',
    description: DESCRIPTION,
    parameters: {
      title: { type: 'string', required: true, description: '发明名称（不超过 25 字）' },
      tech_domain: { type: 'string', enum: ['mechanical', 'electrical', 'chemical', 'software', 'general'], description: '技术领域（为空时自动识别）' },
      patent_type: { type: 'string', enum: ['invention', 'utility_model'], description: '专利类型：发明或实用新型（默认 invention）' },
      technical_problem: { type: 'string', description: '要解决的技术问题（可选）' },
      technical_solution: { type: 'string', description: '技术方案描述（可选）' },
      beneficial_effects: { type: 'string', description: '有益效果（可选）' },
      background: { type: 'string', description: '背景技术/现有技术描述（可选）' },
      drawing_descriptions: { type: 'array', items: { type: 'string' }, description: '附图说明（可选，如 "图1为本发明实施例的整体结构示意图"）' },
      figure_analysis: { type: 'array', items: { type: 'json' }, description: '附图智能分析结果（可选，未提供 drawing_descriptions 时自动生成附图说明）' },
      embodiments: { type: 'array', items: { type: 'string' }, description: '具体实施方式（可选，可多个实施例）' },
      has_drawings: { type: 'boolean', description: '是否有附图（实用新型必须有附图）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          tech_domain: { type: 'string', required: true, enum: ['mechanical', 'electrical', 'chemical', 'software', 'general'] },
          patent_type: { type: 'string', required: true, enum: ['invention', 'utility_model'] },
          sections: { type: 'array', required: true, items: SECTION_SCHEMA },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDraftSpecification(value as unknown as DraftSpecificationOutput) }],
    },
    async execute(args) {
      return draftSpecification(args as unknown as DraftSpecificationInput)
    },
  })
}
