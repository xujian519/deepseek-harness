/**
 * src/patent/graph/domains — 三性领域子图公共设施。
 *
 * - handlerNode：现有 StageHandler → 图节点（可注入固定 params）；
 * - llmNode：通用 LLM 节点工厂（JSON schema + 降级标记，复用 atoms llm 语义）；
 * - ruleGateNode：确定性规则门收口节点（经注入的 RuleEvaluator 评估，fail-closed）；
 * - requireRuleEvaluator：启用规则门时强制注入评估器（缺少评估器在构图期报错）；
 * - collectStateText：汇总 state 文本供规则门评估。
 */

import type { GraphNode, GraphState, StateDelta } from '../types.ts'
import { markDegraded, DEGRADATION_SUFFIX } from '../degradation.ts'
import { runStageHandler } from '../adapter.ts'
import type { StageHandler } from '../../atoms/index.ts'
import { APPROVAL_GRANTED_KEY, isApprovalGateHandler, isGateApproved } from '../../atoms/index.ts'
import { collectStateText } from '../../atoms/handler.ts'
import type { RuleEvaluator, RuleGateAssessment, RuleGateRequest } from '../../checker/index.ts'
import { LevelMust } from '../../checker/types.ts'
import type { RuleCheckResult, Verdict } from '../../checker/types.ts'

export { collectStateText }

/** 现有 StageHandler → 图节点（注入固定 params，合并进执行态，不污染共享 state）。
 *
 * 审批门放行按**门粒度**判定：节点名取自引擎注入的 `nodeName`，命中该节点在共享 state 的
 * 放行记录时把 `APPROVAL_GRANTED_KEY` 注入执行态拷贝。拿不到节点名（直接构造上下文调用节点）
 * 时不放行——fail-closed，绝不退化为"任意放行"。
 * @param handler - 要包装为图节点的 StageHandler。
 * @param params - 注入 handler 的固定参数（可选）。
 * @returns 包装后的图节点。
 */
export function handlerNode(handler: StageHandler, params?: Record<string, unknown>): GraphNode {
  return async ({ state, provider, signal, nodeName }) => {
    const approvedGate =
      nodeName !== undefined && isApprovalGateHandler(handler) && isGateApproved(state, nodeName)
    const execState =
      params !== undefined || approvedGate
        ? { ...state, ...params, ...(approvedGate ? { [APPROVAL_GRANTED_KEY]: true } : {}) }
        : state
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

/** 规则门写入 state 的键前缀；汇总待评估文本时整族跳过。 */
const RULE_GATE_KEY_PREFIX = 'rule_gate_'

/** 规则门启用开关与评估器注入（领域子图构建选项的公共部分）。 */
export interface RuleGateOptions {
  /** 规则门收口（缺省 true）。 */
  ruleGate?: boolean
  /** 规则评估器；启用规则门时必填，缺少评估器在构图期报错。 */
  ruleEvaluator?: RuleEvaluator
}

/**
 * 读取规则门评估器；启用规则门而未注入评估器属配置错误，构图期即失败。
 * @param options - 子图构建选项中的规则门部分。
 * @returns 注入的规则评估器。
 * @throws 当规则门启用但 `ruleEvaluator` 缺失时抛出。
 */
export function requireRuleEvaluator(options: RuleGateOptions): RuleEvaluator {
  if (options.ruleEvaluator === undefined) {
    throw new Error(
      '规则门已启用但未注入 ruleEvaluator：规则语料由 @deepseek-ai/dsh-patent-rule 提供，'
      + '请在构图时注入其 createCheckerRuleEvaluator() 或等价实现（或显式设置 ruleGate: false）。',
    )
  }
  return options.ruleEvaluator
}

/** 构造规则门的失败结果（配置/评估器错误按 Must 级阻断）。 */
function gateFailure(ruleId: string, message: string, fixSuggestion: string): RuleCheckResult {
  return {
    ruleId,
    ruleName: '规则门配置错误',
    passed: false,
    level: LevelMust,
    severity: 'critical',
    message,
    fixSuggestion,
  }
}

function blocked(failure: RuleCheckResult): RuleGateAssessment {
  return { verdict: 'blocked', failures: [failure], evaluatedRules: 0 }
}

/**
 * 执行一次规则门评估，未知领域、空领域、评估器异常与空规则集一律 fail-closed。
 * @param evaluator - 注入的规则评估器。
 * @param request - 待评估文本与声明领域。
 * @returns 评估结论；配置/评估器异常时返回 blocked。
 */
export function evaluateRuleGate(evaluator: RuleEvaluator, request: RuleGateRequest): RuleGateAssessment {
  if (request.domains.length === 0) {
    return blocked(
      gateFailure('RULE-GATE-NO-DOMAINS', '规则门没有声明评估领域，拒绝放行', '为规则门声明至少一个评估领域'),
    )
  }
  const supported = evaluator.domains
  if (supported !== undefined) {
    const unknown = request.domains.filter(domain => !supported.includes(domain))
    if (unknown.length > 0) {
      return blocked(
        gateFailure(
          'RULE-GATE-UNKNOWN-DOMAIN',
          `规则评估器 ${evaluator.id} 不支持领域：${unknown.join('、')}`,
          '检查规则门领域配置或注入支持该领域的评估器',
        ),
      )
    }
  }
  let assessment: RuleGateAssessment
  try {
    assessment = evaluator.evaluate(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return blocked(
      gateFailure(
        'RULE-GATE-EVALUATOR-ERROR',
        `规则评估器 ${evaluator.id} 执行失败：${message}`,
        '检查规则资产与评估器实现；规则评估失败时不得放行',
      ),
    )
  }
  if (assessment.evaluatedRules === 0) {
    return blocked(
      gateFailure(
        'RULE-GATE-EMPTY-RULESET',
        `领域 ${request.domains.join('、')} 没有可评估的规则`,
        '检查规则资产加载是否完整；空规则集不得作为通过',
      ),
    )
  }
  return assessment
}

/** 规则门收口节点：汇总 state 文本 → 注入的评估器按域评估 → verdict 写入 state。
 * @param domains - 规则门评估的领域列表。
 * @param evaluator - 规则评估器（规则语料由其来源包提供）。
 * @returns 规则门图节点。
 */
export function ruleGateNode(domains: readonly string[], evaluator: RuleEvaluator): GraphNode {
  // oxlint-disable-next-line typescript/require-await -- GraphNode contract requires Promise<StateDelta>
  return async ({ state }) => {
    const text = collectStateText(state, {
      // 规则门自身的写入键与降级标记不属于业务文本。
      skipKey: key => key.endsWith(DEGRADATION_SUFFIX) || key.startsWith(RULE_GATE_KEY_PREFIX),
    })
    const assessment = evaluateRuleGate(evaluator, { text, domains })
    return {
      rule_gate_verdict: assessment.verdict,
      rule_gate_domains: [...domains],
      rule_gate_failures: assessment.failures.map(f => f.ruleId),
      rule_gate_evaluator: evaluator.id,
      rule_gate_rules_evaluated: assessment.evaluatedRules,
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
