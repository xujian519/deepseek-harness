/**
 * 宪法规则引擎 — 交付前置门禁（pre-execute）。
 *
 * 交付纪律（先跑哪几个闸门、分析收口之后才能出件）此前只写在 preset 的提示词里：模型
 * 可以不执行它们而直接调用交付工具，失败是静默的——调用记录里分不出「跑过并通过」和
 * 「没跑」。本模块把纪律落成执行点：部署声明「哪个交付工具被调用前，本会话内必须已成功
 * 执行过哪些工具」，未满足即拒绝该次调用，使缺闸门证据的交付件不落盘。
 *
 * 台账以调用方（agent）为归属单位：只有本会话内成功返回的前置调用才算数，跨会话不继承，
 * 因此同一部署下的不同案件互不顶替。归属不明的调用（无 agent）一律按未满足处理——无法
 * 归属的交付件同样拿不出本会话的闸门证据。
 * @module @deepseek-ai/dsh-patent-rule/runtime/delivery-gate
 */

import { declaredArgsMatch, type DeclaredArgValue } from './args-match.ts'

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
}

/** 解析后的交付门禁声明。 */
export type DeliveryGatePlan = {
  /** 生效的门禁声明（未声明前置调用的条目已剔除）。 */
  entries: DeliveryGateEntry[]
  /** 加载期告警（空声明）。 */
  warnings: string[]
}

/** 本会话内成功执行过的工具名台账，按归属单位（agent）分组。 */
export class DeliveryAttemptLedger {
  readonly #byAgent = new WeakMap<object, Set<string>>()

  /**
   * 记录一次成功返回的调用。
   * @param agent - 调用归属单位（`ToolExecution.agent`）。
   * @param tool - 已完成且未报错的工具名。
   */
  record(agent: object, tool: string): void {
    const seen = this.#byAgent.get(agent)
    if (seen === undefined) {
      this.#byAgent.set(agent, new Set([tool]))
      return
    }
    seen.add(tool)
  }

  /**
   * 该归属单位是否已成功执行过该工具。
   * @param agent - 调用归属单位。
   * @param tool - 被查询的前置工具名。
   * @returns 本会话内成功执行过时为 true。
   */
  has(agent: object, tool: string): boolean {
    return this.#byAgent.get(agent)?.has(tool) ?? false
  }
}

/**
 * 解析交付门禁声明：剔除未声明任何前置调用的条目。
 *
 * 「声明了门禁却没有前置条件」是配置错误，静默保留会让门禁看起来生效而实际不判，
 * 故每条都进 warnings（调用方记录后仍需人工核对）。
 * @param entries - 部署声明的门禁条目。
 * @returns 运行计划（生效条目 + 告警）。
 */
export function resolveDeliveryGate(entries: readonly DeliveryGateEntry[]): DeliveryGatePlan {
  const warnings: string[] = []
  const resolved: DeliveryGateEntry[] = []
  for (const entry of entries) {
    if (entry.requires.length === 0) {
      warnings.push(`交付前置门禁 ${entry.tool}: 未声明任何前置调用，该条不生效`)
      continue
    }
    resolved.push(entry)
  }
  return { entries: resolved, warnings }
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
  const missing: string[] = []
  for (const entry of plan.entries) {
    if (entry.tool !== tool || !declaredArgsMatch(entry.whenArgs, args)) continue
    for (const required of entry.requires) {
      if (agent !== undefined && ledger.has(agent, required)) continue
      if (!missing.includes(required)) missing.push(required)
    }
  }
  return missing
}

/**
 * 渲染拒绝理由：模型据此知道该补哪一步，而不是只看到「被拒」。
 * @param tool - 被拒绝的工具名。
 * @param missing - 尚未满足的前置工具名。
 * @returns 模型可读的拒绝理由。
 */
export function renderDeliveryGateDenial(tool: string, missing: readonly string[]): string {
  return [
    `交付前置门禁拒绝 ${tool}：本会话尚未成功执行前置调用 ${missing.join('、')}。`,
    '先执行这些工具并确认其结论通过，再重新调用该工具；门禁认的是本会话内成功返回的调用记录，缺记录即为未跑。',
  ].join('\n')
}
