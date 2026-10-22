/**
 * 提取域原子：extract（结构化抽取，按 output_key 分键）+ merge（PFIE 四路融合）。
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
import { parseJsonStringArray, parseOptionalJsonStringArray } from '../../../llm-json.ts'
import { callLlm, degraded, parseLlmJson, requireLlm, resolveInputText } from './llm.ts'
import { readAtomTunables } from '../../tunables.ts'

// ---------------------------------------------------------------------------
// extract —— 结构化抽取（JSON Schema 约束）
// ---------------------------------------------------------------------------

/** extract 原子：从文本结构化抽取特征/问题/效果。 */
export const extractAtom: Atom = {
  name: 'extract',
  description: '从文本中结构化抽取特征/问题/效果（JSON Schema 约束 LLM 输出），可按法条缺口清单做定向补提',
  category: 'extract',
  inputSchema: ['text', 'extraction_type', 'domain', 'output_key', 'revision_targets'],
  outputSchema: ['extraction_result', 'features', 'problems', 'effects', 'insight', 'revision_coverage'],
  usesModel: true,
}

/** extract 支持的分键输出；无 output_key 时沿用全量 features 模式。 */
const EXTRACT_OUTPUT_KEYS = ['features', 'problems', 'effects', 'insight'] as const

type ExtractOutputKey = (typeof EXTRACT_OUTPUT_KEYS)[number]

/** 判断 output_key 是否属于 extract 的分键输出。 */
function isExtractOutputKey(value: string | undefined): value is ExtractOutputKey {
  return value !== undefined && EXTRACT_OUTPUT_KEYS.some(key => key === value)
}

/** 单次反哺最多消费的目标数（与 legal-gaps 的产出上限一致）。 */
const MAX_REVISION_TARGETS = 8

/** 规则缺口反哺目标：法条/检查编号与名称。 */
type RevisionTarget = {
  checkId: string
  provision: string
  label: string
}

/**
 * 读取 legal-gaps 反哺清单；非数组、缺字段或超长条目被丢弃。
 * @param value - `state.revision_targets` 的原始值。
 * @returns 最多 {@link MAX_REVISION_TARGETS} 个合法目标。
 */
function parseRevisionTargets(value: unknown): RevisionTarget[] {
  if (!Array.isArray(value)) return []
  const targets: RevisionTarget[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const checkId = typeof record['checkId'] === 'string' ? record['checkId'].trim() : ''
    const provision = typeof record['provision'] === 'string' ? record['provision'].trim() : ''
    const label = typeof record['label'] === 'string' ? record['label'].trim() : ''
    if (checkId === '' || provision === '' || label === '') continue
    targets.push({ checkId, provision, label })
    if (targets.length >= MAX_REVISION_TARGETS) break
  }
  return targets
}

/**
 * 校验反哺提取的覆盖结果：每个目标都必须给出字符串数组（可为空，表示原文没有对应事实）。
 * @param value - LLM 返回的 `revision_coverage`。
 * @param targets - 本轮反哺目标。
 * @returns 校验后的覆盖映射；缺失或类型不符时返回错误原因。
 */
function parseRevisionCoverage(
  value: unknown,
  targets: readonly RevisionTarget[],
): { ok: true; coverage: Record<string, string[]> } | { ok: false; reason: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'LLM 输出缺少 revision_coverage 对象（规则缺口反哺要求逐项覆盖）' }
  }
  const record = value as Record<string, unknown>
  const coverage: Record<string, string[]> = {}
  for (const target of targets) {
    const entry = record[target.checkId]
    if (!Array.isArray(entry) || entry.some(item => typeof item !== 'string')) {
      return { ok: false, reason: `revision_coverage.${target.checkId} 必须是非空字符串数组或空数组` }
    }
    coverage[target.checkId] = entry.map(item => (item as string).trim()).filter(item => item.length > 0)
  }
  return { ok: true, coverage }
}

/** 四个分键共享的 JSON 属性声明；Schema 只把当前目标键设为 required。 */
const EXTRACT_PROPERTIES = {
  features: { type: 'array', items: { type: 'string' }, description: '技术特征列表' },
  problems: { type: 'array', items: { type: 'string' }, description: '要解决的技术问题' },
  effects: { type: 'array', items: { type: 'string' }, description: '技术效果' },
  insight: {
    type: 'array',
    items: { type: 'string' },
    description: '发明认知：使特征组合得以奏效的机制层认知，逐条按 problems 的顺序对应',
  },
} as const

/**
 * 构造当前分键的 JSON Schema：只要求目标键，避免 problems/effects/insight
 * 提取被 features 的 required 约束逼成“必须同时返回特征”。反哺轮次额外要求
 * `revision_coverage`，把「补提了什么」变成可校验的产出。
 * @param outputKey - 分键输出；缺省或未知时按 features 全量模式。
 * @param requiresCoverage - 本轮是否带规则缺口反哺目标。
 * @returns 供 LLM 端口使用的对象 Schema。
 */
function extractSchema(
  outputKey: ExtractOutputKey | undefined,
  requiresCoverage: boolean,
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ...EXTRACT_PROPERTIES,
      ...(requiresCoverage
        ? {
          revision_coverage: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
            description: '按 checkId 列出本轮补提到的事实；原文没有对应事实时写空数组',
          },
        }
        : {}),
    },
    required: [...(outputKey === undefined ? ['features'] : [outputKey]), ...(requiresCoverage ? ['revision_coverage'] : [])],
  }
}

/**
 * 特征抽取的 MTU（最小技术单元）拆分与反幻觉标注规则（移植 Mady feature-extraction
 * 模板，Apache-2.0）。仅注入特征类抽取的提示词；标注随特征文本落串，不改变
 * features 的字符串数组 schema 及其下游消费方（merge/keywords/novelty）。
 */
const FEATURE_MTU_GUIDANCE = [
  'MTU 拆分规则：每条特征必须是最小技术单元——单一技术手段、单一技术效果、可与现有技术独立比对；可再拆分的必须继续拆分。',
  '逐条在句末标注：[必要性:必要|非必要]（以解决技术问题是否必需判断）与 [依赖:<所依赖特征文本|无>]。',
  '原文无法确定的技术含义不得编造；不确定时在句末追加 [待确认] 并简述推测依据。',
].join('\n')

/** extract 执行器：结构化抽取（JSON Schema 约束）。 */
export class ExtractHandler implements StageHandler {
  readonly name = 'extract'
  readonly category = 'extract' as const

  /**
   * 执行 extract 阶段（PFE 抽取），返回下一管线状态。
   * @param execInput - 阶段执行输入（state 与 LLM provider）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  async execute(execInput: StageExecuteInput): Promise<PipelineState> {
    const { state, provider, signal } = execInput
    const tuned = readAtomTunables(state, { temperature: 0, promptLimit: 8000 })
    if (!tuned.ok) return degraded('extract', tuned.reason)
    const { temperature, promptLimit } = tuned.tunables
    const missing = requireLlm(provider, 'extract')
    if (missing) return missing
    const text = resolveInputText(state, ['text', 'extraction_input'], '')
    if (text.trim().length === 0) {
      return degraded('extract', '输入文本为空')
    }
    const extractionType = getStateString(state, 'extraction_type') || '技术特征抽取'
    const domain = getStateString(state, 'domain') || '专利'
    // 按任务分键（经 stage.params.output_key 注入）：四路提取互不覆盖。
    // 缺省时保持旧行为（全量写 features/problems/effects）。
    const outputKey = getStateString(state, 'output_key')
    const targetKey = isExtractOutputKey(outputKey) ? outputKey : undefined
    const isFeatureExtraction = targetKey === 'features' || extractionType.includes('特征')
    // 规则缺口反哺：legal-gaps 的未评估项经回退保留在 state.revision_targets，
    // 本轮抽取按清单定向补提，并要求逐项回报覆盖结果。
    const revisionTargets = parseRevisionTargets(state['revision_targets'])
    const requiresCoverage = revisionTargets.length > 0
    const prompt = [
      `你是 ${domain} 领域的技术分析助手。任务：${extractionType}。`,
      ...(isFeatureExtraction ? [FEATURE_MTU_GUIDANCE] : []),
      targetKey !== undefined
        ? `请从以下文本中提取结构化结果，严格输出 JSON：{ "${targetKey}": [...] }`
        : '请从以下文本中提取结构化结果，严格输出 JSON：',
      ...(requiresCoverage
        ? [
          '本轮为规则缺口反哺：以下法条/检查在上一轮未被确定性检查覆盖。',
          ...revisionTargets.map(target => `- [${target.checkId}] ${target.provision} — ${target.label}`),
          '除目标键外，必须另给 "revision_coverage": { "<checkId>": ["支持该法条评估的事实", ...] }；原文没有对应事实的写空数组，不得编造。',
        ]
        : []),
      dataBlock(text.slice(0, promptLimit)),
    ].join('\n')
    const res = await callLlm(
      provider,
      'extract',
      prompt,
      { schema: extractSchema(targetKey, requiresCoverage), temperature },
      signal,
    )
    if (!res.ok) return res.error
    return parseLlmJson(
      res.raw,
      (parsed, raw) => {
        const coverage = requiresCoverage
          ? parseRevisionCoverage(parsed.revision_coverage, revisionTargets)
          : undefined
        if (coverage !== undefined && !coverage.ok) return degraded('extract', coverage.reason)
        const coverageDelta = coverage === undefined ? {} : { revision_coverage: coverage.coverage }
        if (targetKey !== undefined) {
          const result = parseJsonStringArray(parsed[targetKey], targetKey)
          if (!result.ok) return degraded('extract', result.reason)
          return { extraction_result: raw, [targetKey]: result.values, ...coverageDelta }
        }
        const features = parseJsonStringArray(parsed.features, 'features')
        if (!features.ok) return degraded('extract', features.reason)
        const problems = parseOptionalJsonStringArray(parsed.problems, 'problems')
        if (!problems.ok) return degraded('extract', problems.reason)
        const effects = parseOptionalJsonStringArray(parsed.effects, 'effects')
        if (!effects.ok) return degraded('extract', effects.reason)
        return {
          extraction_result: raw,
          features: features.values,
          problems: problems.values,
          effects: effects.values,
          ...coverageDelta,
        }
      },
      raw => targetKey !== undefined
        ? degraded('extract', `LLM 输出不是 JSON 对象，缺少 ${targetKey} 数组`)
        : { extraction_result: raw },
    )
  }
}

// ---------------------------------------------------------------------------
// merge —— PFIE 四路提取融合（移植 Mady disclosure/graph.go mergeExtractionsNode）
// ---------------------------------------------------------------------------
//
// 确定性实现（无 LLM）：读 extract 四路分键产出的 problems/features/effects/insight，
// 按索引配对为 PFIE 四元组（问题为锚点），多余特征/效果并入末组，多余发明认知追加到
// 末组的 insight；全部为空时降级。
//
// 配对由索引**构造**而非校验，故"问题有特征承接"不由本阶段证明——问题多于特征时索引
// 越界的那几组会拿到空特征列表，这正是 pfe-consistency 原子判定的结构事实。

/** merge 原子：融合 PFIE 四路提取结果为四元组。 */
export const mergeAtom: Atom = {
  name: 'merge',
  description: '融合 PFIE 四路提取结果（问题↔发明认知↔特征↔效果），产出 PFIE 四元组',
  category: 'extract',
  inputSchema: ['features', 'problems', 'effects', 'insight'],
  outputSchema: ['pfe_triples', 'merge_result'],
}

/**
 * PFIE 四元组：一个问题与对应的发明认知、特征、效果。
 *
 * `insight` 可选：下游消费方（keywords/novelty/draft-claims）只读问题与特征，未跑
 * extract_insight 的管线不应因为缺发明认知而整体降级。
 */
export type PFETriple = {
  id: string
  problem: string
  /** 发明认知：使本组特征得以奏效的机制层认知；缺省表示本组未提炼。 */
  insight?: string
  features: string[]
  effects: string[]
}

/** merge 执行器：按索引配对四路提取结果为 PFIE 四元组。 */
export class MergeHandler implements StageHandler {
  readonly name = 'merge'
  readonly category = 'extract' as const

  /**
   * 执行 merge 阶段（四路结果配对为 PFIE 四元组），返回下一管线状态。
   * @param input - 阶段执行输入（state）。
   * @returns 下一管线状态（可能带降级标记）。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const features = getStateArray(state, 'features').map(String).filter(Boolean)
    const problems = getStateArray(state, 'problems').map(String).filter(Boolean)
    const effects = getStateArray(state, 'effects').map(String).filter(Boolean)
    const insights = getStateArray(state, 'insight').map(String).filter(Boolean)
    if (features.length + problems.length + effects.length + insights.length === 0) {
      return degraded('merge', '四路提取结果均为空（state.features/problems/effects/insight）')
    }
    const triples: PFETriple[] = problems.map((problem, i) => ({
      id: `T${i + 1}`,
      problem,
      ...(insights[i] !== undefined ? { insight: insights[i] } : {}),
      features: features[i] !== undefined ? [features[i]] : [],
      effects: effects[i] !== undefined ? [effects[i]] : [],
    }))
    // 多于问题数的特征/效果/发明认知并入最后一个三元组（无问题时构造单一三元组）。
    const extraFeatures = features.slice(problems.length)
    const extraEffects = effects.slice(problems.length)
    const extraInsights = insights.slice(problems.length)
    if (extraFeatures.length > 0 || extraEffects.length > 0 || extraInsights.length > 0) {
      const last = triples.at(-1)
      if (last !== undefined) {
        last.features.push(...extraFeatures)
        last.effects.push(...extraEffects)
        if (extraInsights.length > 0) {
          last.insight = [last.insight, ...extraInsights]
            .filter((value): value is string => value !== undefined)
            .join('；')
        }
      } else {
        triples.push({
          id: 'T1',
          problem: '',
          ...(insights.length > 0 ? { insight: insights.join('；') } : {}),
          features: [...features],
          effects: [...effects],
        })
      }
    }
    const summary = `PFIE 融合：${problems.length} 个问题 / ${insights.length} 条发明认知 / ${features.length} 个特征 / ${effects.length} 个效果`
    return { pfe_triples: triples, merge_result: summary }
  }
}
