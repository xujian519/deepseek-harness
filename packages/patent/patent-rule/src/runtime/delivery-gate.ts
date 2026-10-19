/**
 * 宪法规则引擎 — 交付前置门禁（pre-execute）。
 *
 * 交付纪律（先跑哪几个闸门、分析收口之后才能出件）此前只写在 preset 的提示词里：模型
 * 可以不执行它们而直接调用交付工具，失败是静默的——调用记录里分不出「跑过并通过」和
 * 「没跑」。本模块把纪律落成执行点：部署声明「哪个交付工具被调用前，本会话内必须已成功
 * 执行过哪些工具」，未满足即拒绝该次调用，使缺闸门证据的交付件不落盘。
 *
 * 台账以调用方（agent）与案卷键为归属单位：只有本会话内成功返回、且未在结果中声明
 * `blocked: true` 的前置调用才算数，跨会话不继承。声明了案卷的调用只满足同一案卷的交付；
 * 未声明案卷的调用是会话级记录，只在交付的案卷没有专属记录时采用。归属不明的调用
 * （无 agent）一律按未满足处理——无法归属的交付件同样拿不出本会话的闸门证据。
 * @module @deepseek-ai/dsh-patent-rule/runtime/delivery-gate
 */

import { declaredArgsMatch, jsonRecord, type DeclaredArgValue } from './args-match.ts'

/**
 * 一个前置调用结果必须携带的证据条件。
 *
 * 交付门禁原先只认「工具名成功返回过」，于是零字节的 `rule_check` 或另一个模板的
 * 收口记录都能冒充本次交付所需的运行。证据条件把判定落到结果的字段上：身份字段
 * 不符、数组为空或字段缺失的调用仍然算未满足前置。
 */
export type DeliveryEvidenceRequirement = {
  /** 前置工具结果里的顶层字段名。 */
  field: string
  /** 期望的精确值；字符串数组表示取其中任一值。 */
  equals?: string | boolean | string[]
  /** 字段为数组时要求的最小长度。 */
  minItems?: number
}

/** 一次前置调用留下的结果字段，按字段名索引。 */
export type DeliveryEvidence = Readonly<Record<string, unknown>>

/** 一条交付门禁声明：被门禁的工具，以及它被调用前必须已成功执行过的工具。 */
export type DeliveryGateEntry = {
  /** 被门禁的交付工具名。 */
  tool: string
  /** 前置工具名：本会话内须各成功执行过一次。 */
  requires: string[]
  /**
   * 仅对匹配的入参生效的约束：字符串为精确匹配，字符串数组为取值集合。
   * 用于同一个工具的不同交付形态各要各的前置条件（如按 `template` 区分分析与撰写）。
   */
  whenArgs?: Record<string, DeclaredArgValue>
  /**
   * 前置调用结果必须携带的证据，按前置工具名分组。每个条件都成立才算满足：
   * 例如 `rule_check` 的 `evaluated` 非空、`patent_workflow_run` 的 `manifestId`
   * 与本次模板要求的 manifest 一致。未声明的前置工具仍只按成功返回判定。
   */
  evidence?: Record<string, DeliveryEvidenceRequirement[]>
}

/** 解析后的交付门禁声明。 */
export type DeliveryGatePlan = {
  /** 生效的门禁声明（未声明前置调用的条目已剔除）。 */
  entries: DeliveryGateEntry[]
  /** 加载期告警（空声明）。 */
  warnings: string[]
  /** 每个前置工具需要从结果中留存证据的字段。 */
  evidenceFields: Map<string, Set<string>>
}

/** Argument names that name the case a call belongs to, in precedence order. */
const CASE_ARG_NAMES = ['caseId', 'case_id', 'case_dir', 'caseDir'] as const

/**
 * Case key carried by one call's arguments, or undefined when the call names none.
 *
 * The ledger scopes case-named evidence to that case only; a call that names no
 * case is session-scoped, because there is nothing to attribute it to.
 * @param args - the tool call arguments.
 * @returns the trimmed case key, or undefined.
 */
export function caseKeyOfArguments(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const name of CASE_ARG_NAMES) {
    const value = record[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** 一次成功的前置调用，及其结果中留存的证据字段。 */
type DeliveryRecord = {
  readonly evidence?: DeliveryEvidence
}

/** 本会话内成功执行过的工具名台账，按归属单位（agent）与案卷键分组。 */
export class DeliveryAttemptLedger {
  readonly #byAgent = new WeakMap<object, Map<string | undefined, Map<string, DeliveryRecord[]>>>()

  /**
   * 记录一次成功返回的调用。
   * @param agent - 调用归属单位（`ToolExecution.agent`）。
   * @param tool - 已完成、未报错且未声明 `blocked: true` 的工具名。
   * @param caseKey - 该调用声明的案卷键；未声明时为 undefined（会话级）。
   * @param evidence - 该调用结果中按门禁声明留存的身份字段。
   */
  record(agent: object, tool: string, caseKey?: string, evidence?: DeliveryEvidence): void {
    let scopes = this.#byAgent.get(agent)
    if (scopes === undefined) {
      scopes = new Map()
      this.#byAgent.set(agent, scopes)
    }
    let tools = scopes.get(caseKey)
    if (tools === undefined) {
      tools = new Map()
      scopes.set(caseKey, tools)
    }
    const record: DeliveryRecord = evidence === undefined ? {} : { evidence }
    const records = tools.get(tool)
    if (records === undefined) {
      tools.set(tool, [record])
      return
    }
    records.push(record)
  }

  /**
   * 该归属单位是否已成功执行过该工具。
   *
   * A case-named query reads only that case's records; when none exist it falls
   * back to session-level records (calls that named no case), which are the only
   * evidence an unscoped prerequisite can leave. Another case's records are
   * never consulted.
   * @param agent - 调用归属单位。
   * @param tool - 被查询的前置工具名。
   * @param caseKey - 本次交付声明的案卷键。
   * @returns 本会话内成功执行过时为 true。
   */
  has(agent: object, tool: string, caseKey?: string): boolean {
    return this.#records(agent, tool, caseKey).length > 0
  }

  /**
   * 是否有一次记录的結果同时满足全部证据条件。
   *
   * 条件不可跨记录拼凑：一次 `ok: true` 的 disclosure 收口与另一次 `ok: false` 的
   * OA 收口不能合起来冒充一次成功的 OA 收口。
   * @param agent - 调用归属单位。
   * @param tool - 被查询的前置工具名。
   * @param caseKey - 本次交付声明的案卷键。
   * @param requirements - 该前置工具在本次门禁条目上必须携带的证据。
   * @returns 未满足时最近一条记录的模型可读理由；满足或未声明条件时为 undefined。
   */
  evidenceFailure(
    agent: object,
    tool: string,
    caseKey: string | undefined,
    requirements: readonly DeliveryEvidenceRequirement[],
  ): string | undefined {
    if (requirements.length === 0) return undefined
    const records = this.#records(agent, tool, caseKey)
    if (records.some(record => requirements.every(requirement => matchesEvidence(record.evidence, requirement)))) {
      return undefined
    }
    const latest = records.at(-1)?.evidence
    return requirements
      .filter(requirement => !matchesEvidence(latest, requirement))
      .map(requirement => describeEvidenceFailure(latest, requirement))
      .join('；')
  }

  /** 一次查询可见的记录：本案卷与会话级，或未声明案卷时的全部记录。 */
  #records(agent: object, tool: string, caseKey: string | undefined): readonly DeliveryRecord[] {
    const scopes = this.#byAgent.get(agent)
    if (scopes === undefined) return []
    if (caseKey !== undefined) {
      // A case-named delivery reads its own case and the session-level bucket;
      // another case's records never satisfy it.
      return [
        ...scopes.get(caseKey)?.get(tool) ?? [],
        ...scopes.get(undefined)?.get(tool) ?? [],
      ]
    }
    // A delivery that names no case cannot be isolated, so any record made in
    // this session (including one that named a case) is valid evidence.
    const records: DeliveryRecord[] = []
    for (const tools of scopes.values()) records.push(...tools.get(tool) ?? [])
    return records
  }
}

/** 一条证据条件是否由该结果满足。 */
function matchesEvidence(
  evidence: DeliveryEvidence | undefined,
  requirement: DeliveryEvidenceRequirement,
): boolean {
  const actual = evidence?.[requirement.field]
  if (actual === undefined) return false
  if (requirement.minItems !== undefined && (!Array.isArray(actual) || actual.length < requirement.minItems)) {
    return false
  }
  if (requirement.equals !== undefined) {
    if (Array.isArray(requirement.equals)) {
      return typeof actual === 'string' && requirement.equals.includes(actual)
    }
    return actual === requirement.equals
  }
  return true
}

/** 把未满足的条件渲染成模型据此补证据的理由。 */
function describeEvidenceFailure(
  evidence: DeliveryEvidence | undefined,
  requirement: DeliveryEvidenceRequirement,
): string {
  const actual = evidence?.[requirement.field]
  if (actual === undefined) return `结果未携带 ${requirement.field}`
  if (requirement.minItems !== undefined && (!Array.isArray(actual) || actual.length < requirement.minItems)) {
    return `结果的 ${requirement.field} 不足 ${requirement.minItems} 项`
  }
  // Called only after a failed match: with `minItems` absent, `equals` is the bound
  // that failed, so there is no third case to describe.
  const expected = Array.isArray(requirement.equals)
    ? requirement.equals.join(' / ')
    : String(requirement.equals)
  return `结果的 ${requirement.field} 为 ${JSON.stringify(actual)}，需要 ${expected}`
}

/**
 * 解析交付门禁声明：剔除未声明任何前置调用的条目，并收集证据字段。
 *
 * 「声明了门禁却没有前置条件」是配置错误，静默保留会让门禁看起来生效而实际不判，
 * 故每条都进 warnings（调用方记录后仍需人工核对）。证据挂到未声明的工具上是同一类
 * 自包含配置错误；它会让门禁永远等不到那条证据，故在加载期直接失败。
 * @param entries - 部署声明的门禁条目。
 * @returns 运行计划（生效条目、告警、证据字段）。
 * @throws Error when an entry declares evidence for a tool it does not require.
 */
export function resolveDeliveryGate(entries: readonly DeliveryGateEntry[]): DeliveryGatePlan {
  const warnings: string[] = []
  const resolved: DeliveryGateEntry[] = []
  const evidenceFields = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (entry.requires.length === 0) {
      warnings.push(`交付前置门禁 ${entry.tool}: 未声明任何前置调用，该条不生效`)
      continue
    }
    for (const [tool, requirements] of Object.entries(entry.evidence ?? {})) {
      if (!entry.requires.includes(tool)) {
        throw new Error(`交付前置门禁 ${entry.tool}: evidence 声明了不在 requires 中的前置工具 ${tool}`)
      }
      let fields = evidenceFields.get(tool)
      if (fields === undefined) {
        fields = new Set()
        evidenceFields.set(tool, fields)
      }
      for (const requirement of requirements) fields.add(requirement.field)
    }
    resolved.push(entry)
  }
  return { entries: resolved, warnings, evidenceFields }
}

/**
 * 从前置工具的规范结果中取出声明过的证据字段。
 * @param value - 前置调用返回的规范结果值。
 * @param fields - 该工具需要留存的字段名；未声明证据时为 undefined。
 * @returns 字段到值的证据记录；没有声明字段时为 undefined，结果不是记录时为空记录。
 */
export function deliveryEvidence(
  value: unknown,
  fields: ReadonlySet<string> | undefined,
): DeliveryEvidence | undefined {
  if (fields === undefined || fields.size === 0) return undefined
  const record = jsonRecord(value)
  if (record === null) return {}
  const evidence: Record<string, unknown> = {}
  for (const field of fields) {
    if (Object.hasOwn(record, field)) evidence[field] = record[field]
  }
  return evidence
}

/**
 * 本次调用尚未满足的前置工具名。
 * @param plan - 运行计划。
 * @param ledger - 本会话成功调用台账。
 * @param agent - 调用归属单位；缺省表示无法归属，按未满足处理。
 * @param tool - 本次调用的工具名。
 * @param args - 本次调用的入参（判定 `whenArgs`）。
 * @returns 尚未成功执行过的前置工具名（按声明顺序去重）；无缺口时为空数组。
 */
export function deliveryGateMissing(
  plan: DeliveryGatePlan,
  ledger: DeliveryAttemptLedger,
  agent: object | undefined,
  tool: string,
  args: unknown,
): string[] {
  const missing = new Map<string, string>()
  const caseKey = caseKeyOfArguments(args)
  for (const entry of plan.entries) {
    if (entry.tool !== tool || !declaredArgsMatch(entry.whenArgs, args)) continue
    for (const required of entry.requires) {
      if (missing.has(required)) continue
      if (agent === undefined || !ledger.has(agent, required, caseKey)) {
        missing.set(required, required)
        continue
      }
      const failure = ledger.evidenceFailure(agent, required, caseKey, entry.evidence?.[required] ?? [])
      if (failure !== undefined) missing.set(required, `${required}（${failure}）`)
    }
  }
  return [...missing.values()]
}

/**
 * 渲染拒绝理由：模型据此知道该补哪一步，而不是只看到「被拒」。
 * @param tool - 被拒绝的工具名。
 * @param missing - 尚未满足的前置工具名。
 * @returns 模型可读的拒绝理由。
 */
export function renderDeliveryGateDenial(tool: string, missing: readonly string[]): string {
  return [
    `交付前置门禁拒绝 ${tool}：前置证据不满足 ${missing.join('、')}。`,
    '先执行这些工具并确认其结论通过、结果与本次交付所需的内容一致，再重新调用该工具；门禁认的是本会话内成功返回且证据匹配的调用记录，缺记录即为未跑。',
  ].join('\n')
}
