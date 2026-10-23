/**
 * src/adversary/parse — 对手模型输出解析。
 *
 * 将模型返回的 JSON 文本解析为结构化的 AdversaryDispute 列表与评估摘要。
 * 容错策略：
 * 1. 优先直接解析 JSON
 * 2. 去除 markdown 代码围栏后重试
 * 3. 解析失败时返回 null（调用方走降级路径）
 *
 * 结构验证：disputes 必须为数组，每条争议点须含 statute/point/confidence 字段。
 */

import type { AdversaryDispute } from './types.ts'
import { tryParseJson } from '../llm-json.ts'

/** 模型输出的争议点形状（经 tryParseJson 后的 cast 边界）。 */
type RawDispute = {
  statute?: unknown
  claims?: unknown
  point?: unknown
  weakness?: unknown
  confidence?: unknown
}

/** 模型输出的完整结构。 */
export type AdversaryModelOutput = {
  disputes: AdversaryDispute[]
  overallAssessment: string
  divergenceReason: string
}

/**
 * 解析对手模型输出为结构化结果。
 *
 * @param raw - 模型原始输出文本。
 * @returns 解析成功携带结构化结果，失败返回 null（调用方走降级路径）。
 */
export function parseAdversaryOutput(raw: string): AdversaryModelOutput | null {
  const parsed = tryParseJson(raw)
  if (parsed === undefined) return null

  const rawDisputes = parsed['disputes']
  if (!Array.isArray(rawDisputes)) return null

  const disputes = toValidDisputes(rawDisputes)
  const overallAssessment = typeof parsed['overall_assessment'] === 'string'
    ? parsed['overall_assessment']
    : ''
  const divergenceReason = typeof parsed['divergence_reason'] === 'string'
    ? parsed['divergence_reason']
    : ''

  return { disputes, overallAssessment, divergenceReason }
}

/**
 * 将原始争议点数组收窄为合法的 AdversaryDispute[]。
 *
 * 过滤规则：
 * - 非对象元素跳过
 * - statute 非字符串跳过（必填字段）
 * - confidence 非法时默认 0.5
 * - claims 非数组时默认空数组
 * - point/weakness 非字符串时默认空串
 *
 * @param rawDisputes - 原始争议点数组（模型输出，未验证）。
 * @returns 合法的 AdversaryDispute 列表。
 */
function toValidDisputes(rawDisputes: unknown[]): AdversaryDispute[] {
  const result: AdversaryDispute[] = []
  for (const item of rawDisputes) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as RawDispute
    if (typeof raw.statute !== 'string' || raw.statute.trim().length === 0) continue

    const claims = Array.isArray(raw.claims)
      ? raw.claims.filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
      : []

    const confidence = typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : 0.5

    const point = typeof raw.point === 'string' ? raw.point : ''
    const weakness = typeof raw.weakness === 'string' ? raw.weakness : ''

    const dispute: AdversaryDispute = {
      statute: raw.statute.trim(),
      claims,
      point: weakness.length > 0 ? `${point}——${weakness}` : point,
      relation: 'disagreement',
      confidence,
      tag: 'heuristic',
    }
    if (weakness.length > 0) {
      dispute.divergenceReason = weakness
    }
    result.push(dispute)
  }
  return result
}
