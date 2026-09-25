/**
 * 证据规则集的 YAML 解析与校验。
 *
 * 把 `evidence-rules.yaml` 的文本解析成 `EvidenceRuleSet`（权重表 + 规则条目）。
 * 容错面向资产作者：单个坏规则只累积一条警告并跳过，不阻塞整体加载，引擎随后
 * 用默认权重与已解析的规则子集继续判定。
 *
 * 资产的定位与读取在 `rule-loader.ts` —— 那个模块决定"从哪读"，本模块决定
 * "怎么解析"。
 */

import { parseDocument } from 'yaml'
import { asRecord } from '@deepseek-ai/dsh-value'
import type { AssessmentDimension, AssessmentType, EvidenceRule, EvidenceRuleSet, EvidenceType } from './types.ts'
import { EVIDENCE_TYPES } from './types.ts'

/** 三维度权重缺省值：资产未给出权重，或给出的不是数值时逐字段回退到本表。 */
export const DEFAULT_WEIGHTS = { relevance: 0.35, legality: 0.3, authenticity: 0.35 }

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

/** 解析规则集维度的分级列表；非数组或非法条目被过滤，返回同构分级数组。 */
function parseLevels(raw: unknown): AssessmentDimension['levels'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(lv => asRecord(lv))
    .filter((lv): lv is Record<string, unknown> => lv !== null)
    .map(lv => ({
      value: typeof lv.value === 'string' ? lv.value : '',
      score: typeof lv.score === 'number' ? lv.score : 0,
      ...(typeof lv.description === 'string' ? { description: lv.description } : {}),
    }))
    .filter(lv => lv.value !== '')
}

/**
 * 解析规则集的评估维度与权重；单个坏规则跳过不阻塞整体加载。
 * @param yamlText - `evidence-rules.yaml` 的全文。
 * @param source - 资产路径，仅用于警告文本。
 * @returns 解析出的规则集（顶层不是对象时为 null）与累积警告。
 */
export function parseRuleSet(yamlText: string, source: string): { ruleSet: EvidenceRuleSet | null; warnings: string[] } {
  const warnings: string[] = []
  const doc = parseDocument(yamlText)
  if (doc.errors.length > 0) {
    /* v8 ignore next -- YAMLParseError always carries a message */
    warnings.push(`证据规则 YAML 解析失败 ${source}: ${doc.errors[0]?.message ?? 'unknown'}`)
    return { ruleSet: null, warnings }
  }
  const root = asRecord(doc.toJS())
  if (root === null) {
    warnings.push(`证据规则文件顶层必须是对象 ${source}`)
    return { ruleSet: null, warnings }
  }
  const weightsRaw = asRecord(root.weights)
  const weights = {
    relevance: typeof weightsRaw?.relevance === 'number' ? weightsRaw.relevance : DEFAULT_WEIGHTS.relevance,
    legality: typeof weightsRaw?.legality === 'number' ? weightsRaw.legality : DEFAULT_WEIGHTS.legality,
    authenticity: typeof weightsRaw?.authenticity === 'number' ? weightsRaw.authenticity : DEFAULT_WEIGHTS.authenticity,
  }
  const rules: EvidenceRule[] = []
  const rawRules = root.rules
  if (Array.isArray(rawRules)) {
    for (const item of rawRules) {
      const record = asRecord(item)
      if (record === null || typeof record.ruleId !== 'string' || typeof record.name !== 'string') {
        warnings.push(`证据规则条目缺少 ruleId/name ${source}`)
        continue
      }
      const evidenceType = record.evidenceType as EvidenceType
      if (!EVIDENCE_TYPES.includes(evidenceType)) {
        warnings.push(`证据规则 ${record.ruleId} 未知证据类型 "${String(record.evidenceType)}"，跳过`)
        continue
      }
      const assessment = asRecord(record.evidenceAssessment)
      let dimensions: AssessmentDimension[] | undefined
      if (assessment !== null && Array.isArray(assessment.dimensions)) {
        dimensions = []
        for (const dimRaw of assessment.dimensions) {
          const dim = asRecord(dimRaw)
          if (dim === null || typeof dim.name !== 'string' || typeof dim.weight !== 'number') continue
          const levels = parseLevels(dim.levels)
          dimensions.push({ name: dim.name, weight: dim.weight, levels })
        }
      }
      const check = asRecord(record.check)
      rules.push({
        ruleId: record.ruleId,
        name: record.name,
        description: typeof record.description === 'string' ? record.description : '',
        ...(typeof record.legalBasis === 'string' ? { legalBasis: record.legalBasis } : {}),
        ...(typeof record.domain === 'string' ? { domain: record.domain } : {}),
        severity: typeof record.severity === 'string' ? record.severity : 'minor',
        action: typeof record.action === 'string' ? record.action : 'apply',
        evidenceType,
        ...(check !== null
          ? {
            check: {
              type: typeof check.type === 'string' ? check.type : '',
              method: typeof check.method === 'string' ? check.method : '',
              principles: asStringArray(check.principles),
              rules: asStringArray(check.rules),
              conditions: asStringArray(check.conditions),
            },
          }
          : {}),
        ...(assessment !== null
          ? {
            evidenceAssessment: {
              assessmentType: (typeof assessment.assessmentType === 'string'
                ? assessment.assessmentType
                : 'triple-attribute') as AssessmentType,
              ...(dimensions !== undefined ? { dimensions } : {}),
              exemptions: asStringArray(assessment.exemptions),
            },
          }
          : {}),
      })
    }
  } else {
    warnings.push(`证据规则文件缺少 rules 数组 ${source}`)
  }
  return { ruleSet: { weights, rules }, warnings }
}
