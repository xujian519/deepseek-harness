/**
 * adversary-review 原子：换位重跑——从对立审查员视角评估最终意见陈述书。
 *
 * 与 adversary-model（评估答复计划）不同，adversary-review 评估最终产物：
 * - 输入：final_draft + reference_documents + claims + office_action
 * - 目的：评估最终意见陈述书的论证强度、遗漏驳回理由、证据完整性
 * - 信息隔离：不可访问 dispute_framing_report、claim_chart、response_plan、draft 中间版本
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

/**
 * adversary-review 禁止访问的键（扩展 FORBIDDEN_KEYS）。
 *
 * 除己方中间推理外，还禁止访问 response_plan（adversary-model 的输入）和
 * draft 中间版本，确保换位审查的独立性。
 */
export const ADVERSARY_REVIEW_FORBIDDEN_KEYS: readonly string[] = [
  'dispute_framing_report',
  'dispute_framing_candidates',
  'dispute_framing_claims',
  'dispute_framing_refined',
  'dispute_framing_refined_candidates',
  'claim_chart',
  'draft',
  'response_plan',
  'response_plan_summary',
]

/**
 * 检查 adversary-review 的输入隔离（扩展版）。
 * @param stateKeys - PipelineState 的键列表。
 * @returns 检查结果，包含是否通过及泄漏的键列表。
 */
export function checkAdversaryReviewIsolation(stateKeys: readonly string[]): {
  clean: boolean
  leakedKeys: string[]
} {
  const leakedKeys = ADVERSARY_REVIEW_FORBIDDEN_KEYS.filter(key => stateKeys.includes(key))
  return {
    clean: leakedKeys.length === 0,
    leakedKeys,
  }
}

/** adversary-review 原子声明。 */
export const adversaryReviewAtom: Atom = {
  name: 'adversary-review',
  description: '换位重跑：从对立审查员视角评估最终意见陈述书',
  category: 'gate',
  usesModel: false,
  inputSchema: [
    'final_draft',
    'reference_documents',
    'claims',
    'office_action',
  ],
  outputSchema: [
    'adversary_review_report',
    'adversary_review_disputes',
    'adversary_review_confidence',
    'adversary_review_full_report',
    '_adversary_review_event',
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
 * 读取最终意见陈述书。
 * @param state - 状态容器。
 * @returns 最终意见陈述书文本。
 */
function readFinalDraft(state: PipelineState): string {
  return getStateString(state, 'final_draft')
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
   * @param input - 阶段执行输入（final_draft、reference_documents、claims、office_action）。
   * @returns 换位审查报告、争议点列表与整体置信度。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const state = input.state

    // 运行时隔离检查：fail-closed，检测到禁止键时立即返回降级标记
    const stateKeys = Object.keys(state)
    const isolationResult = checkAdversaryReviewIsolation(stateKeys)
    if (!isolationResult.clean) {
      return {
        adversary_review_report: `信息隔离检查失败：检测到禁止键 ${isolationResult.leakedKeys.join(', ')}`,
        adversary_review_disputes: JSON.stringify({ disputes: [], leakedKeys: isolationResult.leakedKeys }),
        adversary_review_confidence: 0,
        // 隔离失败时无有效报告可输出，降级为 null 以保持 outputSchema 一致
        adversary_review_full_report: null,
        // Session 事件数据（供工作流执行器读取并发出事件）
        _adversary_review_event: {
          inputKeys: stateKeys,
          outputKeys: ['adversary_review_report', 'adversary_review_disputes', 'adversary_review_confidence', 'adversary_review_full_report'],
          isolationCheck: { clean: false, leakedKeys: isolationResult.leakedKeys },
        },
      }
    }

    // 读取输入
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

    // 构建输出
    const outputKeys = ['adversary_review_report', 'adversary_review_disputes', 'adversary_review_confidence']

    return {
      adversary_review_report: report.summary,
      adversary_review_disputes: report.disputes,
      adversary_review_confidence: report.overallConfidence,
      // 完整报告（供后续阶段使用）
      adversary_review_full_report: report,
      // Session 事件数据（供工作流执行器读取并发出事件）
      _adversary_review_event: {
        inputKeys: stateKeys,
        outputKeys,
        isolationCheck: { clean: true, leakedKeys: [] },
      },
    }
  }
}

/**
 * 从 handler 输出中提取 session 事件数据。
 *
 * 工作流执行器在 handler 执行后调用此函数，获取事件数据并通过 ctx.emit() 写入 session。
 *
 * @param output - handler 执行输出。
 * @returns session 事件数据，不存在时返回 undefined。
 */
export function extractAdversaryReviewEvent(output: PipelineState): {
  inputKeys: string[]
  outputKeys: string[]
  isolationCheck: { clean: boolean; leakedKeys: string[] }
} | undefined {
  const event = output._adversary_review_event
  if (event === undefined || typeof event !== 'object' || event === null) {
    return undefined
  }
  return event as {
    inputKeys: string[]
    outputKeys: string[]
    isolationCheck: { clean: boolean; leakedKeys: string[] }
  }
}
