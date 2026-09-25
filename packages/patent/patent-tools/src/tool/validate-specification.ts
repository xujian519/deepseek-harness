/**
 * `validate_specification` tool: deterministic patent-specification compliance
 * checker ported from Sati's `validateSpecification.ts`.
 *
 * Deterministic rules: five-part structure completeness, invention-title length,
 * abstract length / keywords / drawing, vague wording, drawing-description and
 * figure-mark consistency, embodiment presence, numeric-range endpoints and
 * midpoints, effect-data quantification, chemical characterization,
 * claim-specification feature coverage (A26.4), independent-claim unity (A31.1),
 * and the claim-to-embodiment coverage matrix.
 *
 * Sati's SMILES-validity spot-check is gated behind the injected
 * `isRdkitAvailable` dependency; RDKit is not bundled in dsh, so that check
 * reports nothing by default.
 * @module @deepseek-ai/dsh-patent-tools/tool/validate-specification
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { checkClaimCoverage, checkClaimSet } from './spec-claim-coverage.ts'
import {
  checkFigureMarkConsistency,
  countInDrawingSection,
  extractAbstractDrawingNumber,
  getDrawingSection,
  knownFigureNumbers,
} from './spec-figure-marks.ts'
import { checkNumericRangeCoverage, formatRange } from './spec-numeric.ts'
import {
  CHEM_CHARACTERIZATION_TERMS,
  checkChemicalCharacterization,
  checkEffectQuantification,
  checkSmilesValidity,
} from './spec-quantification.ts'
import type {
  SpecViolation,
  ValidateSpecificationDeps,
  ValidateSpecificationInput,
  ValidateSpecificationOutput,
} from './spec-types.ts'

/** Required sections (matching Sati's requiredSections). */
const REQUIRED_SECTIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: '技术领域', pattern: /^#{1,3}\s*技术领域/m },
  { name: '背景技术', pattern: /^#{1,3}\s*背景技术/m },
  { name: '发明内容', pattern: /^#{1,3}\s*发明内容/m },
  { name: '附图说明', pattern: /^#{1,3}\s*附图说明/m },
  { name: '具体实施方式', pattern: /^#{1,3}\s*具体实施方式/m },
]

const VAGUE_TERMS = ['约', '大致', '可能', '优选', '例如', '大约', '左右', '较好']

/**
 * Score: each error deducts 0.25, each warning 0.1, floor 0; passed depends only on errors.
 * @param violations - the violations to score.
 * @returns whether the specification passed and the computed score.
 */
export function computeSpecScore(violations: SpecViolation[]): { passed: boolean; score: number } {
  const errors = violations.filter(v => v.severity === 'error').length
  const warnings = violations.filter(v => v.severity === 'warning').length
  const score = Math.max(0, Math.min(1, 1 - errors * 0.25 - warnings * 0.1))
  return { passed: errors === 0, score: Math.round(score * 100) / 100 }
}

/**
 * Pure entry point: validate the specification against the rule set.
 * @param input - the specification fields to validate.
 * @returns the validation result (passed, score, violations).
 */
export function validateSpecification(input: ValidateSpecificationInput): ValidateSpecificationOutput {
  const violations: SpecViolation[] = []
  const text = input.text ?? ''
  const title = input.title?.trim() ?? ''

  const present = new Set<string>()
  for (const sec of REQUIRED_SECTIONS) {
    if (sec.pattern.test(text)) present.add(sec.name)
  }
  const missing = REQUIRED_SECTIONS.map(s => s.name).filter(n => !present.has(n))
  if (text.trim().length > 0 && missing.length > 0) {
    violations.push({
      rule: 'sections',
      severity: 'error',
      message: `缺少必要章节：${missing.join('、')}`,
      suggestion: '请按顺序撰写技术领域、背景技术、发明内容、附图说明和具体实施方式',
    })
  } else if (text.trim().length === 0) {
    violations.push({
      rule: 'sections',
      severity: 'error',
      message: '说明书缺少所有必要章节（text 为空）',
      suggestion: '请提供说明书全文',
    })
  }

  if (title.length > 25) {
    violations.push({
      rule: 'title_length',
      severity: 'error',
      section: '技术领域',
      message: `发明名称超过 25 字限制（${title.length} 字）`,
      suggestion: '请缩短至 25 字以内，使用通用技术术语',
    })
  }

  if (input.abstract && Array.from(input.abstract.trim()).length > 300) {
    violations.push({
      rule: 'abstract_length',
      severity: 'error',
      section: '摘要',
      message: `摘要超过 300 字限制（${Array.from(input.abstract.trim()).length} 字）`,
      suggestion: '请压缩至 300 字以内',
    })
  }
  if (input.abstract && input.abstract.trim().length > 0 && !/关键词|关键字/.test(input.abstract)) {
    violations.push({
      rule: 'abstract_keywords',
      severity: 'warning',
      section: '摘要',
      message: '摘要未包含关键词',
      suggestion: '在摘要末尾添加关键词，如“关键词：…；…”，便于检索分类',
    })
  }
  if (input.abstract && present.has('附图说明')) {
    const drawingSection = getDrawingSection(text)
    const hasRealDrawings = !/无附图/.test(drawingSection)
    if (hasRealDrawings && !/摘要附图|附图.{0,16}图\s*\d|图\s*\d.{0,16}摘要/.test(input.abstract)) {
      violations.push({
        rule: 'abstract_drawing',
        severity: 'warning',
        section: '摘要',
        // 指南 4.5.2：有附图须指定一幅最能说明技术特征的附图作摘要附图，且须在缩小到 4 厘米×6 厘米时仍可辨。
        message: '说明书含附图但摘要未指定摘要附图（《专利审查指南》第一部分第一章 4.5.2：应当指定一幅最能说明技术特征的附图，并保证缩小到 4 厘米×6 厘米时仍能分辨细节）',
        suggestion: '在摘要中注明“摘要附图为图X”，与附图说明对应；该图须在 4 厘米×6 厘米缩放下仍可分辨',
      })
    }
    const designated = extractAbstractDrawingNumber(input.abstract)
    if (designated !== undefined) {
      const known = knownFigureNumbers(text, input.figure_analysis)
      if (known.length > 0 && !known.includes(designated)) {
        violations.push({
          rule: 'abstract_drawing',
          severity: 'warning',
          section: '摘要',
          message: `摘要附图指定的图${designated}在附图中不存在（本申请附图为图${known.join('、图')}）`,
          suggestion: '把摘要附图改为实际存在的某一幅附图，或核对附图说明中的图号',
        })
      }
    }
  }

  const vagueHits = VAGUE_TERMS.filter(t => text.includes(t))
  if (vagueHits.length > 0) {
    violations.push({
      rule: 'clarity',
      severity: 'warning',
      message: `说明书包含模糊表述：${vagueHits.join('、')}`,
      suggestion: "删除'约/大致/可能/优选/例如'等模糊表述，使用确定的技术术语",
    })
  }

  const hasDrawingSection = present.has('附图说明')
  const figRefs = text.match(/图\s*[一二三四五六七八九十\d]+/g) ?? []
  const bodyRefs = figRefs.length - countInDrawingSection(text)
  if (hasDrawingSection && bodyRefs === 0) {
    violations.push({
      rule: 'drawings',
      severity: 'warning',
      section: '附图说明',
      message: '存在附图说明章节但正文未引用任何附图（图1、图2...）',
      suggestion: '在具体实施方式中引用附图标记，与附图说明对应',
    })
  }
  if (!hasDrawingSection && bodyRefs > 0) {
    violations.push({
      rule: 'drawings',
      severity: 'warning',
      message: `正文引用了 ${bodyRefs} 处附图但缺少附图说明章节`,
      suggestion: '补充附图说明章节，逐图说明图名和内容',
    })
  }

  if (input.figure_analysis?.length) {
    violations.push(...checkFigureMarkConsistency(text, input.figure_analysis, input.claims))
  }

  const embodimentCount = (text.match(/(?:本|该)?实施例(?:\s*[一二三四五六七八九十\d]+)?/g) ?? []).length
  if (text.trim().length > 0 && embodimentCount === 0) {
    violations.push({
      rule: 'embodiments',
      severity: 'error',
      section: '具体实施方式',
      message: '说明书未记载任何实施例',
      suggestion: '撰写至少一个可实施实施例，覆盖权利要求的全部技术特征',
    })
  }

  if (text.trim().length > 0) {
    const { endpointMissing, midpointMissing } = checkNumericRangeCoverage(text)
    if (endpointMissing.length > 0) {
      violations.push({
        rule: 'numeric_range_endpoints',
        severity: 'error',
        section: '具体实施方式',
        message: `数值范围缺少端点值实施例：${endpointMissing.map(formatRange).join('、')}`,
        suggestion: '为每个数值范围补充两端值附近（最好是两端值）的实施例',
      })
    }
    if (midpointMissing.length > 0) {
      violations.push({
        rule: 'numeric_range_midpoint',
        severity: 'warning',
        section: '具体实施方式',
        message: `数值范围缺少中间值实施例：${midpointMissing.map(formatRange).join('、')}`,
        suggestion: '范围较宽时补充至少一个中间值的实施例，支持中间范围内的概括',
      })
    }
  }

  const vagueEffects = checkEffectQuantification(text)
  if (vagueEffects.length > 0) {
    violations.push({
      rule: 'effect_data_quantified',
      severity: 'warning',
      section: '发明内容',
      message: `效果表述缺少定量数据支撑：${vagueEffects.slice(0, 3).join('；')}`,
      suggestion: '补充定量效果数据（对比实验/百分比/提升幅度），建立效果与区别技术特征的对应',
    })
  }

  if (input.tech_domain === 'chemical' && text.trim().length > 0) {
    const missingTerms = checkChemicalCharacterization(text)
    if (missingTerms.length === CHEM_CHARACTERIZATION_TERMS.length) {
      violations.push({
        rule: 'chemical_characterization',
        severity: 'warning',
        section: '具体实施方式',
        message: '化学领域说明书未提供任何产物表征数据',
        suggestion: '补充产物表征数据（NMR/MS/IR/元素分析/XRPD/晶胞参数等至少其一），并与具体实施例对应',
      })
    }
  }

  if (input.claims && input.claims.trim().length > 0 && text.trim().length > 0) {
    const { missing: missingFeatures, total } = checkClaimCoverage(input.claims, text)
    if (total >= 3 && missingFeatures.length > 0) {
      const rate = missingFeatures.length / total
      violations.push({
        rule: 'claim_coverage',
        severity: rate > 0.5 ? 'error' : 'warning',
        section: '发明内容',
        message: `权利要求中的 ${missingFeatures.length}/${total} 个技术特征未在说明书记载：${missingFeatures.join('、')}`,
        suggestion: '在发明内容/具体实施方式中补充记载上述技术特征，确保说明书支持权利要求（A26.3/A26.4）',
      })
    }
  }

  violations.push(...checkClaimSet(input))

  const scored = computeSpecScore(violations)

  return {
    passed: scored.passed,
    score: scored.score,
    violations,
  }
}

/**
 * Render the canonical validation result into model-facing prose.
 * @param value - the validation result.
 * @returns the rendered Markdown text.
 */
export function renderSpecification(value: ValidateSpecificationOutput): string {
  const errors = value.violations.filter(v => v.severity === 'error')
  const warnings = value.violations.filter(v => v.severity === 'warning')
  const head = `专利说明书校验：${value.passed ? '通过' : '未通过'}（得分 ${value.score}）`
  if (value.violations.length === 0) {
    return `${head}，未发现违规项。`
  }
  const rows = value.violations.map((v) => {
    const where = v.section === undefined ? '' : `（${v.section}）`
    const line = `- [${v.severity}]${where} ${v.message}`
    return v.suggestion === undefined ? line : `${line}\n  → ${v.suggestion}`
  })
  return [
    head,
    '',
    `共 ${value.violations.length} 项违规（error ${errors.length}、warning ${warnings.length}）：`,
    '',
    ...rows,
  ].join('\n')
}

const DESCRIPTION = [
  '验证专利说明书是否符合撰写要求（确定性规则，无 LLM 调用）。',
  '- 结构完整性：技术领域 / 背景技术 / 发明内容 / 附图说明 / 具体实施方式五部分章节',
  '- 发明名称长度（≤25 字）与摘要长度（≤300 字）、摘要关键词与摘要附图',
  '- 模糊表述、附图说明与图引用一致性、实施例存在性',
  '- 权利要求-说明书特征覆盖（A26.4）、数值范围端点与中间值实施例',
  '- 独立权利要求之间的单一性（A31.1，传 claim_units 时）',
  '- 权项—实施例覆盖矩阵（A26.3/A26.4，传 coverage_entries 时；覆盖度由 features 与 embodiment_refs 计算，不接受调用方给定的覆盖度结论）',
  '- 效果数据定量性、化学领域产物表征数据（tech_domain=chemical 时）',
  '',
  '用法：说明书初稿完成后调用；传入 text（说明书全文）即可，另可传 title / abstract / claims / tech_domain / figure_analysis / claim_units / coverage_entries 启用相应校验。',
  '',
  '注意：SMILES 合法性抽检依赖 RDKit（本环境未内置），自动跳过，不影响其余规则。',
].join('\n')
/**
 * Build the `validate_specification` tool.
 * @param deps - optional injected `isRdkitAvailable` probe (defaults to false).
 * @returns a registry-ready tool definition.
 */
export function createValidateSpecificationTool(deps?: ValidateSpecificationDeps): ToolDefinition {
  const isRdkitAvailable = deps?.isRdkitAvailable ?? (() => false)
  return defineTool({
    name: 'validate_specification',
    description: DESCRIPTION,
    parameters: {
      text: { type: 'string', description: '说明书全文（markdown，含章节标题）' },
      title: { type: 'string', description: '发明名称（可选，单独校验长度）' },
      abstract: { type: 'string', description: '摘要（可选，校验长度/关键词/摘要附图）' },
      claims: { type: 'string', description: '权利要求书全文（可选，用于特征覆盖比对）' },
      tech_domain: {
        type: 'string',
        enum: ['mechanical', 'electrical', 'chemical', 'software', 'general'],
        description: '技术领域（chemical 时附加化学表征数据校验）',
      },
      figure_analysis: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            usable: { type: 'boolean', required: true, description: '分析结果是否可用（组件提取成功）' },
            components: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  refNumber: { type: 'string', required: true, description: '附图标记号（与图面标号一致）' },
                },
              },
              description: '识别的组件列表',
            },
          },
        },
        description: '附图智能分析结果（可选）：提供时执行图文一致性校验',
      },
      claim_units: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            number: { type: 'number', required: true, description: '权利要求编号（与权利要求书一致）' },
            kind: {
              type: 'string',
              required: true,
              enum: ['independent', 'dependent'],
              description: '独立或从属权利要求（仅独立权利要求进入单一性比较）',
            },
            preamble: { type: 'string', required: true, description: '前序部分，如"一种智能门锁"' },
            characterized: { type: 'string', description: '"其特征在于"之后的特征部分' },
          },
        },
        description: '结构化权利要求（可选）：提供时执行独立权利要求单一性自检（A31.1）',
      },
      coverage_entries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claim_id: { type: 'string', required: true, description: '权利要求标识，形如 claim_1' },
            features: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: '该权利要求的技术特征',
            },
            embodiment_refs: {
              type: 'array',
              required: true,
              items: { type: 'string' },
              description: '支持该权利要求的实施例原文片段',
            },
          },
        },
        description: '权项—实施例覆盖条目（可选）：提供时计算覆盖矩阵，逐特征判定是否有实施例支持',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          passed: { type: 'boolean', required: true },
          score: { type: 'number', required: true },
          violations: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rule: { type: 'string', required: true },
                severity: { type: 'string', required: true, enum: ['error', 'warning'] },
                section: { type: 'string' },
                message: { type: 'string', required: true },
                suggestion: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSpecification(value) }],
    },
    execute: (args) => {
      const input = args as unknown as ValidateSpecificationInput
      const output = validateSpecification(input)
      // Sati's SMILES spot-check appends warnings only when RDKit is available;
      // dsh does not bundle RDKit, so this is a no-op (see checkSmilesValidity).
      /* v8 ignore start -- checkSmilesValidity always returns [] in dsh (RDKit unbundled). */
      const smileChecks = checkSmilesValidity(input.text ?? '', isRdkitAvailable)
      if (smileChecks.length > 0) {
        output.violations.push(...smileChecks)
        const scored = computeSpecScore(output.violations)
        output.passed = scored.passed
        output.score = scored.score
      }
      /* v8 ignore stop */
      return Promise.resolve(output)
    },
  })
}
