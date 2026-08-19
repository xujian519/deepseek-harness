/**
 * 首批合规单调 deny Guard（工具级强制约束，EVI-011）。
 *
 * 语义：Guard 是确定性硬约束——模型调用 evaluate_evidence 时，若输入
 * 违反《专利审查指南》第四部分第八章的证据形式要件（域外证据须公证认证、
 * 外文证据须附中文译本，EVI-011 系列规则），Guard 直接拒绝该次调用，
 * 不被任何 allow/ask 权限规则覆盖、不走 HITL 审批。
 *
 * 只做"明确缺失即拒绝"的确定性校验；模糊判断（证据真实性、证明力等）
 * 留在引擎与输出门禁，避免误伤。
 *
 * dsh 适配：ToolGuard 签名为 (execution) => string | undefined，输入从
 * execution.arguments 结构读取（unknown）；返回字符串即 deny，无 allow 结果
 * （单调 deny，与 Sati 阶段一 T2 对齐）。
 * @module @deepseek-ai/dsh-patent-rule/guard/evidenceComplianceGuards
 */

import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import { loadEvidenceRulesEngine } from '@deepseek-ai/dsh-patent-core'

/** 适用工具名（与 evaluate_evidence 工具注册名一致）。 */
export const EVIDENCE_COMPLIANCE_TOOL = 'evaluate_evidence'

/** YAML 条件名 → guard 输入字段名（EVI-011 契约映射；未知条件名索引为 undefined）。 */
const EVI_011_CONDITION_FIELDS: Record<string, string | undefined> = {
  evidence_notarized: 'notarized',
  evidence_legalized: 'legalized',
  evidence_translated: 'translated',
}

/**
 * 从 rule-loader 同一数据源派生 EVI-011 的强制条件字段；资产缺失时回退到
 * 硬编码集合，保证合规 guard 在无规则资产环境下仍可 fail-closed。
 * @param ruleDirs - evidence-rules.yaml 资产目录候选（含专利平铺资产目录）。
 * @returns 强制声明的输入字段集合。
 */
export function evi011GuardConditionFields(ruleDirs: readonly string[] = []): ReadonlySet<string> {
  const rule = loadEvidenceRulesEngine(ruleDirs)
    .engine.getRules()
    .find(r => r.ruleId === 'EVI-011')
  const derived: string[] = []
  for (const condition of rule?.check?.conditions ?? []) {
    const field = EVI_011_CONDITION_FIELDS[condition]
    if (field !== undefined) derived.push(field)
  }
  return new Set(derived.length > 0 ? derived : ['notarized', 'legalized', 'translated'])
}

/** 域外证据类型（需公证 + 认证）。 */
const OVERSEAS_EVIDENCE_TYPES = new Set(['overseas'])

/** 外文证据类型（需附中文译本）。域外（overseas）是来源地分类而非语言分类——
 * 中文原件不要求译本，误拒会阻断合法证据；语言属性由 foreign_language 表达。 */
const FOREIGN_LANGUAGE_TYPES = new Set(['foreign_language'])

/** evaluate_evidence 输入的结构视图（字段改名时守卫读取仍稳定）。 */
interface EvaluateEvidenceInput {
  evidenceType?: unknown
  notarized?: unknown
  legalized?: unknown
  translated?: unknown
}

function readEvidenceInput(input: unknown): EvaluateEvidenceInput | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  return input
}

function isTrue(value: unknown): boolean {
  return value === true
}

/** deny 原因文本：code 前缀 + 中文说明（模型可读）。 */
function formatDenial(code: string, message: string): string {
  return `${code}: ${message}`
}

/**
 * 域外证据强制公证 + 认证（EVI-011）：evidenceType 为 overseas 时，
 * notarized 与 legalized 必须均为 true。
 * @param conditions - 派生的 EVI-011 强制条件字段集合。
 * @returns 单调 deny guard。
 */
export function createOverseasNotarizationGuard(conditions: ReadonlySet<string>): ToolGuard {
  return (execution) => {
    if (execution.name !== EVIDENCE_COMPLIANCE_TOOL) return undefined
    const evidence = readEvidenceInput(execution.arguments)
    const evidenceType = evidence?.evidenceType
    if (typeof evidenceType !== 'string' || !OVERSEAS_EVIDENCE_TYPES.has(evidenceType)) return undefined
    const missing = ['notarized', 'legalized'].filter(
      field => conditions.has(field) && !isTrue((evidence as Record<string, unknown>)[field]),
    )
    if (missing.length > 0) {
      return formatDenial(
        'EVI-011-notarization',
        `域外证据（evidenceType=${evidenceType}）必须声明已公证（notarized）且已认证（legalized），否则无法采信。`,
      )
    }
    return undefined
  }
}

/**
 * 外文证据强制附中文译本（EVI-011）：evidenceType 为 foreign_language /
 * overseas 时，translated 必须为 true。
 * @param conditions - 派生的 EVI-011 强制条件字段集合。
 * @returns 单调 deny guard。
 */
export function createForeignTranslationGuard(conditions: ReadonlySet<string>): ToolGuard {
  return (execution) => {
    if (execution.name !== EVIDENCE_COMPLIANCE_TOOL) return undefined
    const evidence = readEvidenceInput(execution.arguments)
    const evidenceType = evidence?.evidenceType
    if (typeof evidenceType !== 'string' || !FOREIGN_LANGUAGE_TYPES.has(evidenceType)) return undefined
    if (conditions.has('translated') && !isTrue(evidence?.translated)) {
      return formatDenial(
        'EVI-011-translation',
        `外文证据（evidenceType=${evidenceType}）必须附中文译本（translated=true），否则无法采信。`,
      )
    }
    return undefined
  }
}

/**
 * 首批合规 guards 汇总（注册用）。每个 guard 捕获同一份派生条件字段，
 * 注册经 ctx.tools.guard() 为单调 deny。
 * @param ruleDirs - evidence-rules.yaml 资产目录候选。
 * @returns 两条 EVI-011 guard。
 */
export function createEvidenceComplianceGuards(ruleDirs: readonly string[] = []): ToolGuard[] {
  const conditions = evi011GuardConditionFields(ruleDirs)
  return [createOverseasNotarizationGuard(conditions), createForeignTranslationGuard(conditions)]
}
