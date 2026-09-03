/**
 * Checker 结构化复核结论（CheckerVerdict）：checker-tier worker 输出的机读结论 schema。
 *
 * Schema 与词表移植自 Mady prompt/templates/quality/checker-verdict.json（Apache-2.0）。
 * status 三级与 dsh-patent-core checker 引擎的聚合结论同构（pass / needs_revision /
 * blocked）；severity 三级的阻断语义：critical → blocked、major → needs_revision、
 * minor 不阻断。按模板约定，status=pass 对应 issues 为空数组（由消费方裁决，此处只校验结构）。
 */

import { tryParseJson } from '@deepseek-ai/dsh-patent-core'

/** 复核结论三级：可交付 / 须修改后重审 / 不得定稿。 */
export type CheckerVerdictStatus = 'pass' | 'needs_revision' | 'blocked'

/** 问题严重度三级：致命 / 主要 / 次要。 */
export type CheckerIssueSeverity = 'critical' | 'major' | 'minor'

/** 单个复核问题：严重度、描述与可选定位锚（权项号/段落号/文件路径）。 */
export type CheckerIssue = {
  severity: CheckerIssueSeverity
  description: string
  anchor?: string
}

/** 结构化复核结论：worker 输出契约以 requiredFields 形式引用本 schema 的字段。 */
export type CheckerVerdict = {
  status: CheckerVerdictStatus
  summary: string
  issues: CheckerIssue[]
  legal_basis?: string[]
}

/** verdict 的必填字段（worker 输出契约 requiredFields 与本解析器共用的单一来源）。 */
export const CHECKER_VERDICT_REQUIRED_FIELDS: readonly string[] = ['status', 'summary', 'issues']

/** verdict 解析失败：非 JSON、缺字段或词表外的枚举值。 */
export class CheckerVerdictParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckerVerdictParseError'
  }
}

const STATUSES: readonly CheckerVerdictStatus[] = ['pass', 'needs_revision', 'blocked']
const SEVERITIES: readonly CheckerIssueSeverity[] = ['critical', 'major', 'minor']

/**
 * 从模型输出文本解析 CheckerVerdict（容忍 markdown 代码围栏）。模型/工具 JSON 边界上的
 * 结构校验：词表外枚举或缺失必填字段抛 CheckerVerdictParseError，由调用方决定降级。
 * @param raw - 模型输出的原始文本（可含 ```json 围栏）。
 * @returns 解析后的结构化结论。
 * @throws CheckerVerdictParseError 非 JSON、status/summary/issues 缺失或非法。
 */
export function parseCheckerVerdict(raw: string): CheckerVerdict {
  const parsed = tryParseJson(raw)
  if (!parsed) throw new CheckerVerdictParseError('checker verdict 不是合法 JSON')
  const { status, summary, issues, legal_basis } = parsed
  if (!STATUSES.includes(status as CheckerVerdictStatus)) {
    throw new CheckerVerdictParseError(`checker verdict.status 非法: ${JSON.stringify(status)}`)
  }
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new CheckerVerdictParseError('checker verdict.summary 缺失或为空')
  }
  if (!Array.isArray(issues)) throw new CheckerVerdictParseError('checker verdict.issues 必须是数组')
  for (const issue of issues) {
    const { severity, description, anchor } = issue as Record<string, unknown>
    if (!SEVERITIES.includes(severity as CheckerIssueSeverity)) {
      throw new CheckerVerdictParseError(`checker issue.severity 非法: ${JSON.stringify(severity)}`)
    }
    if (typeof description !== 'string' || !description.trim()) {
      throw new CheckerVerdictParseError('checker issue.description 缺失或为空')
    }
    if (anchor !== undefined && typeof anchor !== 'string') {
      throw new CheckerVerdictParseError('checker issue.anchor 必须是字符串')
    }
  }
  if (legal_basis !== undefined && (!Array.isArray(legal_basis) || legal_basis.some(x => typeof x !== 'string'))) {
    throw new CheckerVerdictParseError('checker verdict.legal_basis 必须是字符串数组')
  }
  return parsed as unknown as CheckerVerdict
}
