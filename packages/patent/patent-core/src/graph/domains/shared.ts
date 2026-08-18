/**
 * src/patent/graph/domains — 三性领域子图公共设施。
 *
 * - handlerNode：现有 StageHandler → 图节点（可注入固定 params）；
 * - llmNode：通用 LLM 节点工厂（JSON schema + 降级标记，复用 atoms llm 语义）；
 * - ruleGateNode：确定性规则门收口节点（复用 checker RuleEngine + aggregate）；
 * - collectStateText：汇总 state 文本供规则门评估。
 */

import type { GraphNode, GraphState, StateDelta } from '../types.ts'
import { markDegraded, DEGRADATION_SUFFIX } from '../degradation.ts'
import { runStageHandler } from '../adapter.ts'
import type { StageHandler } from '../../atoms/index.ts'
import { collectStateText } from '../../atoms/handler.ts'
import { RuleEngine, aggregate, defaultPatentRules, type Verdict } from '../../checker/index.ts'
import type { RuleCheckResult } from '../../checker/types.ts'

export { collectStateText }

/** 现有 StageHandler → 图节点（注入固定 params，合并进执行态，不污染共享 state）。
 * @param handler - 要包装为图节点的 StageHandler。
 * @param params - 注入 handler 的固定参数（可选）。
 * @returns 包装后的图节点。
 */
export function handlerNode(handler: StageHandler, params?: Record<string, unknown>): GraphNode {
  return async ({ state, provider, signal }) => {
    const execState = params !== undefined ? { ...state, ...params } : state
    return runStageHandler(handler, execState, provider, signal)
  }
}

/** LLM 节点工厂：JSON schema 结构化输出，LLM 缺失/失败 → markDegraded（不中断全图）。 */
export type LlmNodeOptions = {
  outputKey: string
  buildPrompt: (state: GraphState) => string
  schema?: unknown
  temperature?: number
}

/** 基于 LlmNodeOptions 构造 LLM 图节点：调用 provider.callLLM，缺失/失败时写降级标记。
 * @param input - LlmNodeOptions。
 * @returns 图节点。
 */
export function llmNode(input: LlmNodeOptions): GraphNode {
  const { outputKey, buildPrompt, schema, temperature = 0.2 } = input
  return async ({ state, provider, signal }) => {
    if (!provider?.callLLM) {
      const delta: StateDelta = {}
      markDegraded(delta, outputKey, '', 'llm_unavailable', `${outputKey} 需要 LLM（provider.callLLM 缺失）`)
      return delta
    }
    const prompt = buildPrompt(state)
    try {
      const raw = await provider.callLLM(prompt, {
        ...(schema !== undefined ? { jsonSchema: schema } : {}),
        temperature,
      }, signal)
      return { [outputKey]: raw }
    } catch (err) {
      const delta: StateDelta = {}
      markDegraded(
        delta,
        outputKey,
        '',
        'llm_unavailable',
        `${outputKey} LLM 调用失败: ${err instanceof Error ? err.message : String(err)}`,
      )
      return delta
    }
  }
}

/** 规则门收口节点：汇总 state 文本 → checker RuleEngine 按域评估 → verdict 写入 state。
 * @param domains - 规则门评估的领域列表。
 * @returns 规则门图节点。
 */
export function ruleGateNode(domains: readonly string[]): GraphNode {
  // oxlint-disable-next-line typescript/require-await -- GraphNode contract requires Promise<StateDelta>
  return async ({ state }) => {
    const text = collectStateText(state, {
      // 规则门自身的写入键与降级标记不属于业务文本。
      skipKey: key =>
        key.endsWith(DEGRADATION_SUFFIX) ||
        key === 'rule_gate_verdict' ||
        key === 'rule_gate_domains' ||
        key === 'rule_gate_failures',
    })
    const engine = new RuleEngine()
    engine.registerMany(defaultPatentRules())
    const failures = engine.evaluate(text, { domain: domains })
    const verdict = aggregate(failures)
    return {
      rule_gate_verdict: verdict,
      rule_gate_domains: [...domains],
      rule_gate_failures: failures.map(f => f.ruleId),
      rule_gate_text_length: text.length,
    }
  }
}

/** 规则门写入 state 的结果结构。 */
export type RuleGateState = {
  verdict: Verdict
  failures: RuleCheckResult[]
}

/** 通用：从 state 读取输入文本（对齐 workflowCtx 映射的多键回退）。
 * @param state - 图状态。
 * @param keys - 按优先级回退的候选键。
 * @returns 首个非空字符串值；均无返回空字符串。
 */
export function resolveInput(state: GraphState, keys: string[]): string {
  for (const key of keys) {
    const value = state[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return ''
}

/** 将现有技术证据条目数组格式化为逐行文本（对象 JSON 序列化，其余转字符串）。
 * @param priorArt - 现有技术证据条目数组。
 * @returns 逐行拼接后的现有技术文本。
 */
export function formatPriorArtLines(priorArt: unknown[]): string {
  return priorArt.map(d => (typeof d === 'object' && d !== null ? JSON.stringify(d) : String(d))).join('\n')
}
