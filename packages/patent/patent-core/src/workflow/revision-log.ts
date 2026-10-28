/**
 * 回退留痕（RevisionRecord[]）的持久化校验。
 *
 * 判定规则只有一份：flexible-plan 的 `fromJSON` 与 workflow-run 的磁盘记录都
 * 消费同一形状。两侧抛的错误类型不同（FlexiblePlanError / StoredRecordError），
 * 因此本函数返回原因而不是抛错，由调用方组装自己的错误。
 */

import { isJsonRecord, readNonEmptyString, readOptionalNonEmptyString } from '../llm-json.ts'
import type { RevisionRecord } from './types.ts'

/** 校验结果：成功携带原序记录，失败携带可直接展示的原因。 */
export type RevisionLogResult = { ok: true; value: RevisionRecord[] } | { ok: false; reason: string }

/**
 * 校验持久化的回退留痕：只接受带必填字段的对象数组。
 * @param value - 待校验的 JSON 值。
 * @returns 原序记录，或失败原因。
 */
export function validateRevisionLog(value: unknown): RevisionLogResult {
  if (!Array.isArray(value)) return { ok: false, reason: 'revisions 必须是数组' }
  const records: RevisionRecord[] = []
  for (const item of value) {
    if (!isJsonRecord(item)) return { ok: false, reason: 'revisions 含非对象元素' }
    const gapId = readNonEmptyString(item, 'gapId')
    if (gapId === undefined) return { ok: false, reason: 'revision.gapId 缺失或不是非空字符串' }
    const rewindTo = readNonEmptyString(item, 'rewindTo')
    if (rewindTo === undefined) return { ok: false, reason: 'revision.rewindTo 缺失或不是非空字符串' }
    const requestedBy = readNonEmptyString(item, 'requestedBy')
    if (requestedBy === undefined) return { ok: false, reason: 'revision.requestedBy 缺失或不是非空字符串' }
    const before = readNonEmptyString(item, 'before')
    if (before === undefined) return { ok: false, reason: 'revision.before 缺失或不是非空字符串' }
    const rationale = readNonEmptyString(item, 'rationale')
    if (rationale === undefined) return { ok: false, reason: 'revision.rationale 缺失或不是非空字符串' }
    const after = readOptionalNonEmptyString(item, 'after')
    if (after === null) return { ok: false, reason: 'revision.after 必须是非空字符串' }
    const evidence = readOptionalNonEmptyString(item, 'evidence')
    if (evidence === null) return { ok: false, reason: 'revision.evidence 必须是非空字符串' }
    const at = readOptionalNonEmptyString(item, 'at')
    if (at === null) return { ok: false, reason: 'revision.at 必须是非空字符串' }
    const outcome = item['outcome']
    if (outcome !== 'applied' && outcome !== 'exhausted') {
      return { ok: false, reason: 'revision.outcome 必须是 applied / exhausted' }
    }
    const round = item['round']
    if (typeof round !== 'number' || !Number.isInteger(round) || round < 1) {
      return { ok: false, reason: 'revision.round 必须是正整数' }
    }
    records.push({
      gapId,
      rewindTo,
      requestedBy,
      round,
      before,
      rationale,
      outcome,
      ...(after !== undefined ? { after } : {}),
      ...(evidence !== undefined ? { evidence } : {}),
      ...(at !== undefined ? { at } : {}),
    })
  }
  return { ok: true, value: records }
}
