/**
 * TRIZ 矛盾分析的确定性组装。
 *
 * 分工：模型只从交底书**识别**矛盾与缺口；编号合法性（1-39）、矩阵落格、
 * 参数与原理名称、证据能否在原文定位，全部由本模块判定。证据定位失败的
 * 矛盾一律丢弃并计数——分解粒度越细，编造的矛盾越多，这是原子化必须付出
 * 的核验代价。
 * @module @deepseek-ai/dsh-patent-core/triz/analysis
 */

import { lookupMatrixCell, paramLabel, principleById } from '@deepseek-ai/dsh-methodology'
import { verifyQuoteInSource } from '../claim-chart/runtime/pin-cite-validator.ts'
import { asJsonArray, asJsonRecord, readJsonString, readJsonStringArray } from '../llm-json.ts'
import type {
  TrizContradiction,
  TrizContradictionAnalysis,
  TrizExtractionInput,
  TrizGapKind,
  TrizParameterGap,
  TrizParameterRef,
  TrizPrincipleRef,
  TrizUnmappedItem,
} from './types.ts'

/** 工程参数编号的下界。 */
export const TRIZ_PARAMETER_MIN = 1

/** 工程参数编号的上界。 */
export const TRIZ_PARAMETER_MAX = 39

/** 参数缺口类型的全集，用于校验模型输出。 */
export const TRIZ_GAP_KINDS: readonly TrizGapKind[] = [
  'current-value',
  'target-value',
  'unit',
  'test-method',
  'other',
]

/** 读取 1-39 的整数工程参数编号；其它取值返回 undefined。 */
function readParameterNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(parsed)) return undefined
  return parsed >= TRIZ_PARAMETER_MIN && parsed <= TRIZ_PARAMETER_MAX ? parsed : undefined
}

/** 参数引用：名称只取随包参数表，不取模型输出。 */
function parameterRef(no: number): TrizParameterRef {
  return { number: no, name: paramLabel(no) }
}

/**
 * 落格到经典矛盾矩阵：对角格是物理矛盾，空值是转录缺口，二者都不给原理。
 * @param improving - 改善参数编号。
 * @param worsening - 恶化参数编号。
 * @returns 落格状态与推荐原理（名称取自随包原理表）。
 */
function resolveMatrix(
  improving: number,
  worsening: number,
): { status: 'recommended' | 'physical' | 'gap'; principles: TrizPrincipleRef[] } {
  if (improving === worsening) return { status: 'physical', principles: [] }
  const ids = lookupMatrixCell(improving, worsening)
  if (ids.length === 0) return { status: 'gap', principles: [] }
  return {
    status: 'recommended',
    principles: ids.map(no => ({ number: no, name: principleById(no)?.name ?? '' })),
  }
}

/**
 * 证据核验：片段去空白后必须能在交底书原文中定位。空片段视为无证据。
 * @param evidence - 模型给出的原文片段。
 * @param sourceText - 交底书原文。
 * @returns 是否通过核验。
 */
function evidenceGrounded(evidence: string, sourceText: string): boolean {
  if (evidence.trim().length === 0) return false
  return verifyQuoteInSource(evidence, sourceText).ok
}

/** 读取缺口维度并去重（保持 TRIZ_GAP_KINDS 的顺序）。 */
function readGapKinds(value: unknown): TrizGapKind[] {
  const raw = readJsonStringArray(value)
  return TRIZ_GAP_KINDS.filter(kind => raw.includes(kind))
}

/**
 * 把模型抽取结果组装成已核验的矛盾分析。
 * @param extraction - 模型输出的原始结果（字段逐项校验）。
 * @param sourceText - 交底书原文，用于证据定位核验。
 * @returns 矛盾、参数缺口、未采纳项与丢弃计数的完整产物。
 */
export function buildTrizAnalysis(
  extraction: TrizExtractionInput,
  sourceText: string,
): TrizContradictionAnalysis {
  const contradictions: TrizContradiction[] = []
  const unmapped: TrizUnmappedItem[] = []
  let droppedForEvidence = 0

  for (const [index, raw] of asJsonArray(extraction.contradictions).entries()) {
    const record = asJsonRecord(raw)
    if (record === undefined) {
      unmapped.push({ statement: `第 ${index + 1} 条矛盾`, reason: '条目不是对象' })
      continue
    }
    const statement = readJsonString(record.statement) ?? `第 ${index + 1} 条矛盾`
    const improving = readParameterNumber(record.improving)
    const worsening = readParameterNumber(record.worsening)
    if (improving === undefined || worsening === undefined) {
      unmapped.push({
        statement,
        reason: `改善／恶化参数不是 ${TRIZ_PARAMETER_MIN}-${TRIZ_PARAMETER_MAX} 的整数编号，无法落格到矛盾矩阵`,
      })
      continue
    }
    const evidence = readJsonString(record.evidence) ?? ''
    if (!evidenceGrounded(evidence, sourceText)) {
      droppedForEvidence += 1
      unmapped.push({ statement, reason: '证据片段无法在交底书原文中定位，按无依据矛盾丢弃' })
      continue
    }
    const matrix = resolveMatrix(improving, worsening)
    contradictions.push({
      id: `C${contradictions.length + 1}`,
      improving: parameterRef(improving),
      worsening: parameterRef(worsening),
      statement,
      evidence,
      principles: matrix.principles,
      matrixStatus: matrix.status,
      solutionDirections: readJsonStringArray(record.solution_directions),
    })
  }

  // 缺口按参数编号合并：同一参数被多次点名时取维度并集，保留首条说明。
  const gapByParameter = new Map<number, { missing: TrizGapKind[]; detail: string }>()
  for (const raw of asJsonArray(extraction.parameter_gaps)) {
    const record = asJsonRecord(raw)
    if (record === undefined) continue
    const no = readParameterNumber(record.parameter)
    const missing = readGapKinds(record.missing)
    if (no === undefined || missing.length === 0) {
      unmapped.push({
        statement: `参数缺口条目 ${JSON.stringify(record.parameter ?? record.missing ?? '')}`,
        reason: '参数编号或缺失维度非法，未采纳',
      })
      continue
    }
    const detail = readJsonString(record.detail) ?? ''
    const existing = gapByParameter.get(no)
    if (existing === undefined) {
      gapByParameter.set(no, { missing: [...missing], detail })
      continue
    }
    for (const kind of missing) {
      if (!existing.missing.includes(kind)) existing.missing.push(kind)
    }
    if (existing.detail.length === 0) existing.detail = detail
  }
  const parameterGaps: TrizParameterGap[] = [...gapByParameter.entries()].map(([no, gap]) => ({
    parameter: parameterRef(no),
    missing: TRIZ_GAP_KINDS.filter(kind => gap.missing.includes(kind)),
    detail: gap.detail,
  }))

  for (const raw of asJsonArray(extraction.unmapped)) {
    const record = asJsonRecord(raw)
    if (record === undefined) continue
    const statement = readJsonString(record.statement)
    if (statement === undefined) continue
    unmapped.push({
      statement,
      reason: readJsonString(record.reason) ?? '未映射到 1-39 工程参数',
    })
  }

  return { contradictions, parameterGaps, unmapped, droppedForEvidence }
}
