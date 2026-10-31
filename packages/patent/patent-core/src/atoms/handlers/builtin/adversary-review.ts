/**
 * adversary-review 原子：换位重跑——从对立审查员视角评估最终意见陈述书。
 *
 * 与 adversary-model（评估答复计划）不同，adversary-review 评估最终产物：
 * - 输入：draft（最终意见陈述书）+ reference_documents + claims + office_action
 * - 目的：评估最终意见陈述书的论证强度、遗漏驳回理由、证据完整性
 * - 信息隔离：只读 draft（最终意见陈述书）与原始材料，不读 dispute_framing_report、claim_chart、response_plan
 *
 * 运行位置：draft 之后、response-check 之前。
 *
 * 模型调用：当前版本为确定性骨架（usesModel: false），不调用模型。
 * TODO：完整版应通过 StageProvider 注入 LLM 能力，并将 usesModel 改为 true。
 */

import type { Atom } from '../../atom.ts'
import {
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  getStateString,
} from '../../handler.ts'
import { readStateObject } from './state-json.ts'
import {
  type AdversaryReviewInput,
  type AdversaryReviewOfficeAction,
  reviewFinalDraft,
} from '../../../adversary/review.ts'

/** adversary-review 原子声明。 */
export const adversaryReviewAtom: Atom = {
  name: 'adversary-review',
  description: '换位重跑：从对立审查员视角评估最终意见陈述书',
  category: 'gate',
  usesModel: false,
  logInputScope: true,
  inputSchema: [
    'draft_tightened',
    'draft',
    'reference_documents',
    'claims',
    'office_action',
  ],
  outputSchema: [
    'adversary_review_report',
    'adversary_review_disputes',
    'adversary_review_confidence',
    'adversary_review_full_report',
  ],
}

/**
 * 读取通知书结构化字段。
 * @param state - 状态容器。
 * @returns 通知书对象或 undefined。
 */
function readOfficeAction(state: PipelineState): AdversaryReviewOfficeAction | undefined {
  return readStateObject(state, 'office_action')
}

/**
 * 读取权利要求书正文。
 * @param state - 状态容器。
 * @returns 权利要求书文本。
 */
function readClaimsText(state: PipelineState): string {
  return getStateString(state, 'claims')
}

/**
 * 读取最终意见陈述书。优先 `draft_tightened`（删减阶段的产出），其次 `draft`
 * （manifest 中 draft 阶段的输出键），最后 `final_draft`（按旧键写入的调用方）。
 * @param state - 状态容器。
 * @returns 最终意见陈述书文本。
 */
function readFinalDraft(state: PipelineState): string {
  for (const key of ['draft_tightened', 'draft', 'final_draft']) {
    const value = getStateString(state, key)
    if (value.trim().length > 0) return value
  }
  return ''
}

/**
 * 读取对比文件原文。
 * @param state - 状态容器。
 * @returns 对比文件文本。
 */
function readReferenceDocuments(state: PipelineState): string {
  return getStateString(state, 'reference_documents')
}

/** adversary-review 执行器。 */
export class AdversaryReviewHandler implements StageHandler {
  readonly name = 'adversary-review'
  readonly category = 'gate' as const

  /**
   * 执行换位重跑：从对立审查员视角评估最终意见陈述书。
   *
   * 当前实现为确定性骨架：不调用模型，只做覆盖率检查与证据缺口检测。
   * 模型不可用时 fail-closed：输出降级标记。
   *
   * TODO：完整版应通过 input.provider?.llm 或 input.provider?.callLLM 调用模型，
   * 做深度论证评估。
   *
   * @param input - 阶段执行输入（draft、reference_documents、claims、office_action）。
   * @returns 换位审查报告、争议点列表与整体置信度。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const state = input.state

    // 共享 state 必然包含上游产出（dispute_framing_*、claim_chart、response_plan）。
    // 隔离由本执行器只读取 draft、reference_documents、claims、office_action 保证。
    const finalDraft = readFinalDraft(state)
    const referenceDocuments = readReferenceDocuments(state)
    const claimsText = readClaimsText(state)
    const officeAction = readOfficeAction(state)

    // 构建换位审查输入
    const reviewInput: AdversaryReviewInput = {
      finalDraft,
      referenceDocuments,
      claims: claimsText,
      ...(officeAction !== undefined ? { officeAction } : {}),
    }

    // 执行换位审查
    const report = reviewFinalDraft(reviewInput)

    return {
      adversary_review_report: report.summary,
      adversary_review_disputes: report.disputes,
      adversary_review_confidence: report.overallConfidence,
      // 完整报告（供后续阶段使用）
      adversary_review_full_report: report,
    }
  }
}
