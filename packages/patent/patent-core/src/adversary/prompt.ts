/**
 * src/adversary/prompt — 对手模型提示词构建。
 *
 * 从对立审查员视角构建提示词，让模型评估答复计划的薄弱环节。
 * 提示词遵循 prompt-hygiene.ts 的 dataBlock 隔离规范：不可信外部文本（答复计划、
 * 权利要求、审查意见）经 dataBlock 序列化，与指令区物理隔离。
 */

import type { AdversaryOfficeAction, AdversaryPlanEntry } from './types.ts'
import { dataBlock } from '../prompt-hygiene.ts'

/**
 * 构建对手模型提示词。
 *
 * 指令区只含开发可控的固定文本；外部数据（答复计划、权利要求、审查意见原文）
 * 经 dataBlock 隔离，防止提示注入。
 *
 * @param officeAction - 通知书结构化字段。
 * @param claimsText - 权利要求书正文。
 * @param responsePlan - 答复计划条目列表。
 * @param responsePlanSummary - 答复计划摘要（可选）。
 * @returns 隔离后的完整提示词。
 */
export function buildAdversaryPrompt(
  officeAction: AdversaryOfficeAction | undefined,
  claimsText: string,
  responsePlan: AdversaryPlanEntry[] | undefined,
  responsePlanSummary?: string,
): string {
  const lines: string[] = [
    '你是一位严格的专利审查员，请从对立视角评估以下意见陈述书答复计划的薄弱环节。',
    '',
    '任务要求：',
    '1. 独立识别审查意见中的全部驳回理由与涉及权利要求',
    '2. 逐条评估答复计划中每个策略的证据支撑强度与论证逻辑',
    '3. 识别答复计划的遗漏、权项不对齐、证据不足等薄弱环节',
    '4. 对每个争议点给出置信度评估（0-1）',
    '',
    '请严格输出以下 JSON 格式：',
    '{',
    '  "disputes": [',
    '    {',
    '      "statute": "规范化法条编号（如 A22.3）",',
    '      "claims": [1, 2],',
    '      "point": "争议要点描述（中文）",',
    '      "weakness": "薄弱环节说明（中文）",',
    '      "confidence": 0.8',
    '    }',
    '  ],',
    '  "overall_assessment": "整体评估（中文，100-300字）",',
    '  "divergence_reason": "与答复计划的主要分歧原因（中文）"',
    '}',
    '',
    '【审查意见】',
    dataBlock(formatOfficeAction(officeAction)),
    '',
    '【权利要求】',
    dataBlock(claimsText || '(无权利要求文本)'),
    '',
    '【答复计划】',
    dataBlock(responsePlan !== undefined ? JSON.stringify(responsePlan, null, 2) : '(无答复计划)'),
  ]

  if (responsePlanSummary !== undefined && responsePlanSummary.trim().length > 0) {
    lines.push('')
    lines.push('【答复计划摘要】')
    lines.push(dataBlock(responsePlanSummary))
  }

  return lines.join('\n')
}

/**
 * 格式化通知书结构化字段为可读文本。
 * @param officeAction - 通知书对象。
 * @returns 格式化后的文本。
 */
function formatOfficeAction(officeAction: AdversaryOfficeAction | undefined): string {
  if (officeAction === undefined) return '(无审查意见结构化字段)'
  const parts: string[] = []
  if (officeAction.rejectionTypes !== undefined && officeAction.rejectionTypes.length > 0) {
    parts.push(`驳回理由：${officeAction.rejectionTypes.join('、')}`)
  }
  if (officeAction.affectedClaims !== undefined && officeAction.affectedClaims.length > 0) {
    parts.push(`涉及权利要求：${officeAction.affectedClaims.join('、')}`)
  }
  const rawArguments = officeAction.examinerArguments
  const examinerArguments = rawArguments === undefined
    ? undefined
    : typeof rawArguments === 'string' ? rawArguments : rawArguments.join('\n')
  if (examinerArguments !== undefined && examinerArguments.trim().length > 0) {
    parts.push(`审查员论点原文：${examinerArguments}`)
  }
  return parts.length > 0 ? parts.join('\n') : '(审查意见结构化字段为空)'
}
