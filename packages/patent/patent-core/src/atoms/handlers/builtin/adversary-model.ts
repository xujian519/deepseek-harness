/**
 * adversary-model 原子：对立审查员模型。
 *
 * 从独立视角评估答复计划的薄弱环节——五步处理流程：
 * 1. 独立争议定位：从 OA 通知书原文独立识别争议法条与涉及权项
 * 2. 独立证据评估：从对立视角评估 response-plan 中每条策略的证据支撑强度
 * 3. 独立规则适用：（当前合并到步骤 1/2，完整版通过模型评估）
 * 4. 分歧检测：比对 adversary 独立识别的争议点 vs response-plan 覆盖的理由
 * 5. 报告生成：输出结构化对抗式检验报告
 *
 * 信息隔离：只读 office_action、claims、response_plan、response_plan_summary，
 * 不读 dispute_framing_report、claim_chart、draft 等己方中间推理。
 *
 * 模型调用：完整版通过 StageProvider 注入 LLM 能力（usesModel: true）。
 * 模型不可用时 fail-closed：输出 unverified 标记与降级摘要。
 */

import type { Atom } from '../../atom.ts'
import {
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  getStateString,
} from '../../handler.ts'
import { readStateJson, readStateObject } from './state-json.ts'
import {
  type AdversaryDispute,
  type AdversaryOfficeAction,
  type AdversaryPlanEntry,
} from '../../../adversary/types.ts'
import {
  assessEvidenceIndependent,
  buildAdversaryPrompt,
  buildAdversaryReport,
  degradedSummary,
  detectDivergence,
  locateDisputesIndependent,
  parseAdversaryOutput,
  renderAdversaryReport,
  scanOutputForLeaks,
} from '../../../adversary/index.ts'
import { callLlm, degraded, requireLlm } from './llm.ts'
import { readAtomTunables } from '../../tunables.ts'

/** adversary-model 原子声明。 */
export const adversaryModelAtom: Atom = {
  name: 'adversary-model',
  description: '对立审查员模型：独立评估答复计划的薄弱环节（调用模型）',
  category: 'gate',
  usesModel: true,
  inputSchema: [
    'office_action',
    'claims',
    'response_plan',
    'response_plan_summary',
  ],
  outputSchema: [
    'adversary_report',
    'adversary_disputes',
    'adversary_confidence',
  ],
}

/**
 * 读取通知书结构化字段。
 * @param state - 状态容器。
 * @returns 通知书对象或 undefined。
 */
function readOfficeAction(state: PipelineState): AdversaryOfficeAction | undefined {
  return readStateObject(state, 'office_action')
}

/**
 * 读取答复计划条目列表。
 * @param state - 状态容器。
 * @returns 答复计划条目数组或 undefined。
 */
function readResponsePlan(state: PipelineState): AdversaryPlanEntry[] | undefined {
  const parsed = readStateJson(state, 'response_plan')
  if (!Array.isArray(parsed)) return undefined
  return parsed.filter(
    (item): item is AdversaryPlanEntry =>
      typeof item === 'object' && item !== null && typeof (item as AdversaryPlanEntry).ground === 'string',
  )
}

/**
 * 读取权利要求书正文。
 * @param state - 状态容器。
 * @returns 权利要求书文本。
 */
function readClaimsText(state: PipelineState): string {
  return getStateString(state, 'claims')
}

/** adversary-model 执行器。 */
export class AdversaryModelHandler implements StageHandler {
  readonly name = 'adversary-model'
  readonly category = 'gate' as const

  /**
   * 执行对立审查员模型。
   *
   * 完整版：调用模型从对立视角评估答复计划的薄弱环节。
   * 模型不可用时 fail-closed：输出 unverified 标记与降级摘要。
   *
   * @param input - 阶段执行输入（office_action、claims、response_plan、response_plan_summary）。
   * @returns 报告、争议点列表与整体置信度。
   */
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state, provider, signal } = input

    // 共享 state 必然包含上游产出（dispute_framing_*、claim_chart、draft）。
    // 隔离由本执行器只读取下面四个键保证；不能按整个 state 的键判失败。

    // 读取 tunables
    const tuned = readAtomTunables(state, { temperature: 0.2, promptLimit: 8000 })
    if (!tuned.ok) return degraded('adversary-model', tuned.reason)
    const { temperature, promptLimit } = tuned.tunables

    // 读取输入
    const officeAction = readOfficeAction(state)
    const claimsText = readClaimsText(state)
    const responsePlan = readResponsePlan(state)
    const responsePlanSummary = getStateString(state, 'response_plan_summary')

    // 步骤 1：独立争议定位（确定性）
    const locatedDisputes = locateDisputesIndependent(officeAction, claimsText)

    // 步骤 2：独立证据评估（确定性）
    const assessedDisputes = assessEvidenceIndependent(officeAction, responsePlan)

    // 合并争议点：按 statute 去重，保留置信度更高的条目；置信度相同时合并 claims 取并集。
    const disputeMap = new Map<string, AdversaryDispute>()
    for (const d of [...locatedDisputes, ...assessedDisputes]) {
      const existing = disputeMap.get(d.statute)
      if (existing === undefined || d.confidence > existing.confidence) {
        disputeMap.set(d.statute, d)
      } else if (d.confidence === existing.confidence) {
        existing.claims = [...new Set([...existing.claims, ...d.claims])]
      }
    }
    const heuristicDisputes = [...disputeMap.values()]

    // 步骤 3：模型调用（完整版）
    const missing = requireLlm(provider, 'adversary-model')
    if (missing !== null) {
      // 模型不可用：fail-closed，使用确定性结果 + 降级摘要
      return deterministicResult(heuristicDisputes, responsePlan)
    }

    // 构建提示词并调用模型
    const prompt = buildAdversaryPrompt(officeAction, claimsText.slice(0, promptLimit), responsePlan, responsePlanSummary)
    const res = await callLlm(provider, 'adversary-model', prompt, { temperature }, signal)
    if (!res.ok) return res.error

    // 解析模型输出
    const parsed = parseAdversaryOutput(res.raw)
    if (parsed === null) {
      // 解析失败：使用确定性结果 + 降级摘要
      return deterministicResult(heuristicDisputes, responsePlan)
    }

    // 输出层隔离：模型返回的文本不能再把己方中间推理带回报告。
    const leak = scanOutputForLeaks([
      parsed.overallAssessment,
      ...parsed.disputes.map(dispute => `${dispute.point}\n${dispute.divergenceReason ?? ''}`),
    ].join('\n'))
    if (!leak.clean) {
      return deterministicResult(
        heuristicDisputes,
        responsePlan,
        `模型输出包含禁止术语（${leak.leakedKeys.join('、')}），已丢弃并回退到确定性结果。`,
      )
    }

    // 合并模型输出与确定性结果：按 statute 去重，模型结果优先
    const mergedDisputes = mergeDisputes(heuristicDisputes, parsed.disputes)

    // 步骤 4：分歧检测
    const markedDisputes = detectDivergence(mergedDisputes, responsePlan)

    // 步骤 5：报告生成（使用模型生成的摘要）
    const summary = parsed.overallAssessment.length > 0
      ? parsed.overallAssessment
      : degradedSummary(markedDisputes)
    const report = buildAdversaryReport(markedDisputes, summary)
    const reportText = renderAdversaryReport(report)

    return {
      adversary_report: reportText,
      adversary_disputes: report.disputes,
      adversary_confidence: report.overallConfidence,
    }
  }
}

/**
 * 用确定性结果生成报告，并可选追加一条降级说明。
 * @param heuristicDisputes - 确定性规则识别的争议点。
 * @param responsePlan - 答复计划条目。
 * @param note - 追加到摘要末尾的说明。
 * @returns 阶段输出。
 */
function deterministicResult(
  heuristicDisputes: AdversaryDispute[],
  responsePlan: AdversaryPlanEntry[] | undefined,
  note?: string,
): PipelineState {
  const markedDisputes = detectDivergence(heuristicDisputes, responsePlan)
  const base = degradedSummary(markedDisputes)
  const summary = note === undefined ? base : `${base}\n\n${note}`
  const report = buildAdversaryReport(markedDisputes, summary)
  return {
    adversary_report: renderAdversaryReport(report),
    adversary_disputes: report.disputes,
    adversary_confidence: report.overallConfidence,
  }
}

/**
 * 合并确定性结果与模型输出：按 statute 去重，模型结果优先。
 *
 * @param heuristicDisputes - 确定性规则识别的争议点。
 * @param modelDisputes - 模型识别的争议点。
 * @returns 合并后的争议点列表。
 */
function mergeDisputes(
  heuristicDisputes: AdversaryDispute[],
  modelDisputes: AdversaryDispute[],
): AdversaryDispute[] {
  const merged = new Map<string, AdversaryDispute>()

  // 先放入确定性结果
  for (const d of heuristicDisputes) {
    merged.set(d.statute, d)
  }

  // 模型结果优先：覆盖同 statute 的确定性结果
  for (const d of modelDisputes) {
    const existing = merged.get(d.statute)
    if (existing === undefined || d.confidence >= existing.confidence) {
      merged.set(d.statute, d)
    }
  }

  return [...merged.values()]
}
