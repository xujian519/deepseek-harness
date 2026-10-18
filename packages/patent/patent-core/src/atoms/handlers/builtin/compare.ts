/**
 * 对比域原子：compare（权利要求特征对比 chart）+ novelty（逐特征新颖性初判）。
 */

import { type Atom } from '../../atom.ts'
import {
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  getStateArray,
  getStateString,
} from '../../handler.ts'
import { dataBlock } from '../../../prompt-hygiene.ts'
import {
  parseJsonRecordArray,
  parseOptionalJsonStringArray,
  readJsonString,
} from '../../../llm-json.ts'
import { callLlm, degraded, formatPriorArt, parseLlmJson, requireLlm, resolveInputText } from './llm.ts'
import { readAtomTunables } from '../../tunables.ts'

// ---------------------------------------------------------------------------
// compare —— 特征对比（claim chart）
// ---------------------------------------------------------------------------

/** compare 原子：逐项对比权利要求特征与现有技术。 */
export const compareAtom: Atom = {
  name: 'compare',
  description: '逐项对比权利要求特征与现有技术，输出结构化对比表（claim chart）',
  category: 'compare',
  inputSchema: ['claim', 'prior_art', 'comparison_scope'],
  outputSchema: ['claim_chart', 'diff_features'],
  usesModel: true,
}

const COMPARE_SCHEMA = {
  type: 'object',
  properties: {
    claim_chart: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: '权利要求特征' },
          prior_art_match: { type: 'string', description: '现有技术对应内容（无则填空）' },
          identical: { type: 'boolean', description: '是否相同' },
          note: { type: 'string' },
        },
        required: ['feature'],
      },
    },
    diff_features: { type: 'array', items: { type: 'string' }, description: '区别技术特征' },
  },
  required: ['claim_chart'],
} as const

/**
 * 校验 claim_chart 条目：`feature` 必填且为非空字符串，可选字段给出时类型必须正确。
 * @param entries - 已确认是对象数组的条目。
 * @returns 首个错误的原因；全部合法时为 undefined。
 */
function checkClaimChartEntries(entries: readonly Record<string, unknown>[]): string | undefined {
  for (const [index, entry] of entries.entries()) {
    if (readJsonString(entry.feature) === undefined) return `claim_chart[${index}] 缺少 feature 字符串`
    if (entry.prior_art_match !== undefined && typeof entry.prior_art_match !== 'string') {
      return `claim_chart[${index}] 的 prior_art_match 不是字符串`
    }
    if (entry.identical !== undefined && typeof entry.identical !== 'boolean') {
      return `claim_chart[${index}] 的 identical 不是布尔值`
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') {
      return `claim_chart[${index}] 的 note 不是字符串`
    }
  }
  return undefined
}

/** compare 执行器：逐项对比权利要求特征与现有技术。 */
export class CompareHandler implements StageHandler {
  readonly name = 'compare'
  readonly category = 'compare' as const

  /**
   * 执行 compare 阶段（权利要求与对比文件比对），返回下一管线状态。
   * @param execInput - 阶段执行输入（state 与 LLM provider）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  async execute(execInput: StageExecuteInput): Promise<PipelineState> {
    const { state, provider, signal } = execInput
    const tuned = readAtomTunables(state, { temperature: 0, promptLimit: 6000 })
    if (!tuned.ok) return degraded('compare', tuned.reason)
    const { temperature, promptLimit, promptLimitConfigured } = tuned.tunables
    const missing = requireLlm(provider, 'compare')
    if (missing) return missing
    const claim = resolveInputText(state, ['claim', 'claim_text'], '')
    if (claim.trim().length === 0) {
      return degraded('compare', '权利要求为空')
    }
    const priorArt = formatPriorArt(state)
    const scope = getStateString(state, 'comparison_scope') || '单独对比原则（新颖性）'
    const prompt = [
      `对比范围：${scope}`,
      '权利要求：',
      dataBlock(claim.slice(0, promptLimitConfigured ? promptLimit : 4000)),
      '现有技术：',
      dataBlock(priorArt.slice(0, promptLimit)),
      '请逐项对比，严格输出 JSON（claim_chart 每项含 feature/prior_art_match/identical/note，diff_features 为区别特征）。',
    ].join('\n')
    const res = await callLlm(provider, 'compare', prompt, { schema: COMPARE_SCHEMA, temperature }, signal)
    if (!res.ok) return res.error
    return parseLlmJson(res.raw, parseCompareChart, raw => ({ claim_chart: raw }))
  }
}

/** Validate compare output into chart rows and distinguishing features. */
function parseCompareChart(parsed: Record<string, unknown>): PipelineState {
  const chart = parseJsonRecordArray(parsed.claim_chart, 'claim_chart')
  if (!chart.ok) return degraded('compare', chart.reason)
  const chartError = checkClaimChartEntries(chart.values)
  if (chartError !== undefined) return degraded('compare', chartError)
  const diff = parseOptionalJsonStringArray(parsed.diff_features, 'diff_features')
  if (!diff.ok) return degraded('compare', diff.reason)
  return { claim_chart: chart.values, diff_features: diff.values }
}

// ---------------------------------------------------------------------------
// novelty —— 逐特征新颖性初判（移植 Mady disclosure/novelty.go 语义）
// ---------------------------------------------------------------------------
//
// 消费 extract 产出的 features + search 产出的 prior_art 证据片段，
// 按单独对比原则（专利法 A22.2）逐特征判定是否被现有技术公开。
// evidence_coverage 对齐 Mady：无证据 → none（提示不可靠），1-2 条 → partial，≥3 → full。

/** novelty 原子：逐特征新颖性初判。 */
export const noveltyAtom: Atom = {
  name: 'novelty',
  description: '逐特征新颖性初判：结合现有技术证据（prior_art）按单独对比原则判定',
  category: 'compare',
  inputSchema: ['features', 'prior_art', 'novelty_scope'],
  outputSchema: ['novelty_result', 'novelty_conclusion', 'evidence_coverage'],
  usesModel: true,
}

const NOVELTY_SCHEMA = {
  type: 'object',
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string', description: '技术特征' },
          prior_art: { type: 'string', description: '公开该特征的现有技术来源（无则空）' },
          disclosed: { type: 'boolean', description: '是否被现有技术单独公开' },
          reasoning: { type: 'string', description: '判断依据' },
        },
        required: ['feature', 'disclosed'],
      },
    },
    conclusion: { type: 'string', description: '整体新颖性结论（具备/不具备，附置信度）' },
  },
  required: ['assessments'],
} as const

/**
 * 证据覆盖分级：≥3 条 full；1-2 条 partial；0 条 none。
 * @param count - 现有技术证据条数。
 * @returns 覆盖分级（full/partial/none）。
 */
export function evidenceCoverage(count: number): 'full' | 'partial' | 'none' {
  if (count >= 3) return 'full'
  if (count >= 1) return 'partial'
  return 'none'
}

/**
 * 校验 novelty 的 assessments 条目：`feature` 与非布尔 `disclosed` 必填，可选字段给出时类型必须正确。
 * @param entries - 已确认是对象数组的条目。
 * @returns 首个错误的原因；全部合法时为 undefined。
 */
function checkNoveltyAssessments(entries: readonly Record<string, unknown>[]): string | undefined {
  for (const [index, entry] of entries.entries()) {
    if (readJsonString(entry.feature) === undefined) return `assessments[${index}] 缺少 feature 字符串`
    if (typeof entry.disclosed !== 'boolean') return `assessments[${index}] 的 disclosed 不是布尔值`
    if (entry.prior_art !== undefined && typeof entry.prior_art !== 'string') {
      return `assessments[${index}] 的 prior_art 不是字符串`
    }
    if (entry.reasoning !== undefined && typeof entry.reasoning !== 'string') {
      return `assessments[${index}] 的 reasoning 不是字符串`
    }
  }
  return undefined
}

/** novelty 执行器：逐特征新颖性初判。 */
export class NoveltyHandler implements StageHandler {
  readonly name = 'novelty'
  readonly category = 'compare' as const

  /**
   * 执行 novelty 阶段（逐特征新颖性判定），返回下一管线状态。
   * @param input - 阶段执行输入（state 与 LLM provider）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state, provider, signal } = input
    const tuned = readAtomTunables(state, { temperature: 0.1, promptLimit: 6000 })
    if (!tuned.ok) return degraded('novelty', tuned.reason)
    const { temperature, promptLimit } = tuned.tunables
    const features = getStateArray(state, 'features')
    if (features.length === 0) {
      return degraded('novelty', '无特征可评估（state.features 为空）')
    }
    const missing = requireLlm(provider, 'novelty')
    if (missing) return missing
    const priorArt = formatPriorArt(state)
    const coverage = evidenceCoverage(getStateArray(state, 'prior_art').length)
    const scope = getStateString(state, 'novelty_scope') || '单独对比原则（新颖性，专利法 A22.2）'
    const featureLines = features.map((f, i) => `[${i + 1}] ${String(f)}`).join('\n')
    const prompt = [
      `你是专利新颖性分析专家。对比范围：${scope}`,
      '要求：',
      '- 单独对比原则：逐特征与单份现有技术对比，不得将多份文件结合后认定公开',
      '- 仅基于证据片段明确公开的内容判断，不含推测',
      '- 区别特征为 0 时结论为不具备新颖性',
      '',
      '【技术特征】',
      featureLines,
      '',
      '【现有技术证据】',
      dataBlock(priorArt.slice(0, promptLimit)),
      '',
      '请严格输出 JSON：assessments 为每个特征的 { feature, prior_art, disclosed, reasoning } 列表，',
      'conclusion 为整体新颖性结论（附置信度）。',
    ].join('\n')
    const res = await callLlm(provider, 'novelty', prompt, { schema: NOVELTY_SCHEMA, temperature }, signal)
    if (!res.ok) return res.error
    return parseLlmJson(
      res.raw,
      parsed => parseNoveltyAssessments(parsed, coverage),
      raw => ({ novelty_result: raw, evidence_coverage: coverage }),
    )
  }
}

/** Validate novelty assessments and attach the evidence-coverage grade. */
function parseNoveltyAssessments(
  parsed: Record<string, unknown>,
  coverage: ReturnType<typeof evidenceCoverage>,
): PipelineState {
  const assessments = parseJsonRecordArray(parsed.assessments, 'assessments')
  if (!assessments.ok) return degraded('novelty', assessments.reason)
  const assessmentError = checkNoveltyAssessments(assessments.values)
  if (assessmentError !== undefined) return degraded('novelty', assessmentError)
  return {
    novelty_result: JSON.stringify(parsed),
    novelty_conclusion: typeof parsed.conclusion === 'string' ? parsed.conclusion : '',
    evidence_coverage: coverage,
  }
}
