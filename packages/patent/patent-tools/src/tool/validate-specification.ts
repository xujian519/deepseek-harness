/**
 * `validate_specification` tool: deterministic patent-specification compliance
 * checker ported from Sati's `validateSpecification.ts`.
 *
 * Deterministic rules: five-part structure completeness, invention-title length,
 * abstract length / keywords / drawing, vague wording, drawing-description and
 * figure-mark consistency, embodiment presence, numeric-range endpoints and
 * midpoints, effect-data quantification, chemical characterization, and
 * claim-specification feature coverage (A26.4).
 *
 * Sati's SMILES-validity spot-check is gated behind the injected
 * `isRdkitAvailable` dependency; RDKit is not bundled in dsh, so that check
 * reports nothing by default.
 * @module @deepseek-ai/dsh-patent-tools/tool/validate-specification
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { TechDomain } from '../tool/draft-claims.ts'

/** Tool input: the specification fields to validate. */
export type ValidateSpecificationInput = {
  /** Specification full text (markdown, with section headings). */
  text?: string
  /** Invention title (optional; length checked separately). */
  title?: string
  /** Abstract (optional; length / keywords / drawing checked). */
  abstract?: string
  /** Claims full text (optional; used for feature-coverage comparison). */
  claims?: string
  /** Technical domain; "chemical" enables the characterization-data check. */
  tech_domain?: TechDomain
  /** Figure-analysis results (optional); enables figure-mark consistency. */
  figure_analysis?: FigureAnalysisResult[]
}

/** One compliance violation. */
export type SpecViolation = {
  rule: string
  severity: 'error' | 'warning'
  section?: string
  message: string
  suggestion?: string
}

/** The canonical validation result. */
export type ValidateSpecificationOutput = {
  passed: boolean
  score: number
  violations: SpecViolation[]
}

/** A numeric range extracted from the specification. */
export type NumericRange = { min: number; max: number; unit: string }

/** One recognized figure component as read by the consistency checker. */
export type FigureComponentRef = {
  /** Reference mark from the figure (Arabic numerals only). */
  refNumber: string
}

/**
 * Minimal figure-analysis result consumed by this checker: `usable` and each
 * component's `refNumber` reconcile figure marks against the drawing-description
 * section. Ported from Sati's full `FigureAnalysisResult` (not needed here).
 */
export type FigureAnalysisResult = {
  /** Whether the analysis cleared the usable-confidence threshold. */
  usable: boolean
  /** Recognized components with their reference marks. */
  components: FigureComponentRef[]
}

/** Injectable dependencies for the `validate_specification` tool. */
export type ValidateSpecificationDeps = {
  /** Reports whether the RDKit chemistry engine is available for SMILES validation. Defaults to false (RDKit is not bundled in dsh). */
  isRdkitAvailable?: () => boolean
}

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
 * Supported units (longer multi-character units first so alternation cannot
 * truncate "5mg" to "m" or "0.1-2MPa" to "m").
 */
const UNITS = '°C|℃|MPa|kPa|Pa|rpm|min|mol|mm|cm|kg|mg|ml|mL|％|°|m|g|L|h|s|%'

/** Numeric range (e.g. 20-90℃, 20℃至90℃, 20~90℃). */
const RANGE_PATTERN = new RegExp(
  `(\\d+(?:\\.\\d+)?)\\s*(?:${UNITS})?\\s*(?:[~～至\\-—])\\s*(\\d+(?:\\.\\d+)?)\\s*(${UNITS})`,
  'g',
)

/** Single value with a unit (e.g. 60℃, 5mm). */
const VALUE_PATTERN = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNITS})`, 'g')

/** Vague-effect boilerplate patterns ("效果显著 / 大幅提升" etc.). */
const VAGUE_EFFECT_RE =
  /(?:效果|性能)(?:显著|良好|优异|优越|极佳|大幅|大大提高|明显提升|显著提高|大幅提升|明显改善|显著改善|明显|好)|(?:大大|显著|明显|大幅|有效)(?:提高|提升|改善|降低|减少|增强)/

/** Chemical-domain product characterization techniques (at least one required). */
const CHEM_CHARACTERIZATION_TERMS = [
  'NMR', '核磁', 'MS', '质谱', 'IR', '红外', '元素分析', 'XRPD', 'XRD', 'X射线', 'X-射线',
  '晶胞参数', '空间群', '熔点', '旋光度', 'UV', '紫外', 'HPLC', '高效液相', 'GC', '气相色谱',
]

const CLAIM_REF_PATTERN =
  /所述([\u4e00-\u9fa5A-Za-z0-9·\-]{2,24}?)(?=与|和|及|或|、|，|,|；|;|用于|包括|连接|设置|固定|安装|位于|设于|[。])/g

const CLAIM_VALUE_PATTERN = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNITS})`, 'g')

/** Overly broad generic terms that do not participate in coverage comparison. */
const GENERIC_TERMS = new Set([
  '装置', '系统', '方法', '结构', '单元', '模块', '部件', '组件', '步骤', '特征',
  '技术', '方案', '本发明', '申请', '权利要求', '领域', '信息', '数据',
])

/** Normalize temperature units to "°" so ℃ / °C / ° stay comparable. */
function normalizeUnit(unit: string): string {
  return ['℃', '°C', '°'].includes(unit) ? '°' : unit
}

/**
 * Extract numeric ranges from the text (kept only when min < max).
 * @param text - the text to scan.
 * @returns the numeric ranges found.
 */
export function extractNumericRanges(text: string): NumericRange[] {
  const ranges: NumericRange[] = []
  let m: RegExpExecArray | null
  RANGE_PATTERN.lastIndex = 0
  while ((m = RANGE_PATTERN.exec(text)) !== null) {
    const min = Number(m[1])
    const max = Number(m[2])
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      ranges.push({ min, max, unit: normalizeUnit(m[3] ?? '') })
    }
  }
  return ranges
}

function extractNumericValues(text: string): Array<{ value: number; unit: string }> {
  const body = text.replace(RANGE_PATTERN, ' ')
  const values: Array<{ value: number; unit: string }> = []
  let m: RegExpExecArray | null
  VALUE_PATTERN.lastIndex = 0
  while ((m = VALUE_PATTERN.exec(body)) !== null) {
    const value = Number(m[1])
    if (Number.isFinite(value)) values.push({ value, unit: normalizeUnit(m[2] ?? '') })
  }
  return values
}

/**
 * Range endpoint + midpoint example detection: returns (missing-endpoint, missing-midpoint).
 * @param text - the text to scan.
 * @returns ranges missing an endpoint example and ranges missing a midpoint example.
 */
export function checkNumericRangeCoverage(text: string): {
  endpointMissing: NumericRange[]
  midpointMissing: NumericRange[]
} {
  const ranges = extractNumericRanges(text)
  const values = extractNumericValues(text)
  const endpointMissing: NumericRange[] = []
  const midpointMissing: NumericRange[] = []
  for (const range of ranges) {
    const sameUnit = values.filter(v => v.unit === range.unit)
    const hasEndpoint = sameUnit.some(v => v.value === range.min || v.value === range.max)
    const hasMidpoint = sameUnit.some(v => v.value > range.min && v.value < range.max)
    if (!hasEndpoint) endpointMissing.push(range)
    if (!hasMidpoint) midpointMissing.push(range)
  }
  return { endpointMissing, midpointMissing }
}

function formatRange(range: NumericRange): string {
  return `${range.min}-${range.max}${range.unit === '°' ? '℃' : range.unit}`
}

/**
 * Return "effect boilerplate" sentences lacking any number / percentage (truncated to 40 chars).
 * @param text - the text to scan.
 * @returns the effect sentences lacking quantitative data.
 */
export function checkEffectQuantification(text: string): string[] {
  const hits: string[] = []
  for (const raw of text.split(/[。；\n]/)) {
    const sentence = raw.trim()
    if (sentence.length === 0) continue
    if (VAGUE_EFFECT_RE.test(sentence) && !/\d|％|%/.test(sentence)) {
      hits.push(sentence.slice(0, 40))
    }
  }
  return hits
}

/**
 * Chemical domain: return the fully-missing characterization terms.
 * @param text - the text to scan.
 * @returns the characterization terms absent from the text.
 */
export function checkChemicalCharacterization(text: string): string[] {
  return CHEM_CHARACTERIZATION_TERMS.filter(term => !text.includes(term))
}

/**
 * SMILES-validity spot-check, ported from Sati's async RDKit enhancement.
 * RDKit is an optional native dependency that dsh does not bundle, so this
 * reports nothing: it skips when `isRdkitAvailable` reports false (the default),
 * and the candidate-extraction / validation engine is not ported, so even an
 * injected "available" override validates no candidates.
 * @param _text - specification text (kept for the Sati call shape; unused).
 * @param isRdkitAvailable - reports whether the RDKit chemistry engine is loaded.
 * @returns always empty; SMILES validation is unavailable in dsh.
 */
export function checkSmilesValidity(_text: string, isRdkitAvailable: () => boolean): SpecViolation[] {
  if (!isRdkitAvailable()) return []
  // Unreached in dsh (RDKit unbundled): the chemistry engine is not ported.
  return []
}

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
 * Extract technical-feature candidates from claims ("所述X" nouns + number-unit values).
 * @param claims - the claims text.
 * @returns the extracted feature candidates.
 */
export function extractClaimFeatures(claims: string): string[] {
  const features = new Set<string>()
  let m: RegExpExecArray | null
  CLAIM_REF_PATTERN.lastIndex = 0
  while ((m = CLAIM_REF_PATTERN.exec(claims)) !== null) {
    const term = (m[1] ?? '').trim()
    if (term.length >= 2 && !GENERIC_TERMS.has(term)) features.add(term)
  }
  CLAIM_VALUE_PATTERN.lastIndex = 0
  while ((m = CLAIM_VALUE_PATTERN.exec(claims)) !== null) {
    features.add(`${m[1] ?? ''}${normalizeUnit(m[2] ?? '')}`)
  }
  return [...features]
}

function checkClaimCoverage(claims: string, text: string): { missing: string[]; total: number } {
  const features = extractClaimFeatures(claims)
  const missing = features.filter(feature => !text.includes(feature))
  return { missing, total: features.length }
}

/**
 * Figure-mark consistency: drawing-description marks vs. figure-analysis marks.
 * Unusable figures are skipped per-figure (no all-or-nothing); a mark present in
 * the figure but absent from the drawing description is a warning (漏标), and a
 * mark listed in the description but absent from the figure is an error (悬空).
 * @param text - the specification text (drawing-description section).
 * @param figureAnalysis - the figure-analysis results.
 * @returns the consistency violations found.
 */
export function checkFigureMarkConsistency(text: string, figureAnalysis: FigureAnalysisResult[]): SpecViolation[] {
  if (figureAnalysis.length === 0) return []
  const violations: SpecViolation[] = []

  const unusable = figureAnalysis.filter(f => !f.usable)
  if (unusable.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      message: `附图分析结果不可用（${unusable.length} 张），请人工核对图面标号与附图说明`,
    })
  }

  const figureMarks = new Set<string>()
  for (const f of figureAnalysis) {
    if (!f.usable) continue
    for (const c of f.components) {
      if (/^\d+$/.test(c.refNumber)) figureMarks.add(c.refNumber)
    }
  }
  if (figureMarks.size === 0) return violations

  const drawingSection = getDrawingSection(text)
  if (!drawingSection) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      message: '说明书缺少附图说明章节，无法核验附图标记与图面一致性',
      suggestion: '补充附图说明章节，逐图列出标号对应的部件',
    })
    return violations
  }

  const listedMarks = new Set<string>()
  const markPattern = /(?:^|[；;\n，,：:])\s*(\d+)\s*[-–—]/g
  let match: RegExpExecArray | null
  while ((match = markPattern.exec(drawingSection)) !== null) {
    const mark = match[1]
    if (mark !== undefined) listedMarks.add(mark)
  }

  const missing = [...figureMarks].filter(n => !listedMarks.has(n))
  if (missing.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'warning',
      section: '附图说明',
      message: `附图标记 ${missing.join('、')} 未在附图说明中列出`,
      suggestion: '在附图说明中补充对应标号的部件说明',
    })
  }

  const dangling = [...listedMarks].filter(n => !figureMarks.has(n))
  if (dangling.length > 0) {
    violations.push({
      rule: 'figure_mark_consistency',
      severity: 'error',
      section: '附图说明',
      message: `附图说明中的标记 ${dangling.join('、')} 在附图中不存在`,
      suggestion: '核对图面标号，删除或更正附图说明中不存在的标号',
    })
  }

  return violations
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
        message: '说明书含附图但摘要未指定摘要附图',
        suggestion: '在摘要中注明“摘要附图为图X”，与附图说明对应',
      })
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
    violations.push(...checkFigureMarkConsistency(text, input.figure_analysis))
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

  const scored = computeSpecScore(violations)

  return {
    passed: scored.passed,
    score: scored.score,
    violations,
  }
}

const DRAWING_SECTION_RE = /^#{1,3}\s*附图说明\s*\n([\s\S]*?)(?=^#{1,3}\s|\s*$)/m

/** Extract the drawing-description section body (empty when absent). */
function getDrawingSection(text: string): string {
  return text.match(DRAWING_SECTION_RE)?.[1] ?? ''
}

/** Count "图N" references inside the drawing-description section. */
function countInDrawingSection(text: string): number {
  return (getDrawingSection(text).match(/图\s*[一二三四五六七八九十\d]+/g) ?? []).length
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
  '- 效果数据定量性、化学领域产物表征数据（tech_domain=chemical 时）',
  '',
  '用法：说明书初稿完成后调用；传入 text（说明书全文）即可，另可传 title / abstract / claims / tech_domain / figure_analysis 启用相应校验。',
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
      const smileChecks = checkSmilesValidity(input.text ?? '', isRdkitAvailable)
      if (smileChecks.length > 0) {
        output.violations.push(...smileChecks)
        const scored = computeSpecScore(output.violations)
        output.passed = scored.passed
        output.score = scored.score
      }
      return Promise.resolve(output)
    },
  })
}
