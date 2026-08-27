/**
 * 反套话域原子：slop-gate（评分门 + 失败带证据自动回退）。
 *
 * 移植自 Sati 的 src/patent/atoms/handlers/builtin/gate.ts（SlopGateHandler）。
 * 与 patent-core 的内置 handler 不同，本 handler 依赖 dsh-patent-tools 的
 * slop 引擎（analyzeSlop / buildSlopRevisionHint），故按依赖方向落在本包。
 *
 * 闭环：manifest 中 draft-claims 之后接 slop-gate 阶段，其 retry 声明
 * `whenOutputMatches: '需修订'`、`rewindTo: 'draft_claims'`；未通过时本
 * handler 输出含「需修订」的 slop_report（retry 信号载体）并写入仅含证据
 * 的 slop_revision_hint（保密契约，见 retry-hints.ts），runWorkflow 捕获信号
 * 回退重跑 draft-claims，其 prompt 注入上一轮 hint。
 */

import {
  type Atom,
  type PipelineState,
  type StageExecuteInput,
  type StageHandler,
  degraded,
  getStateString,
} from '@deepseek-ai/dsh-patent-core'
import { analyzeSlop } from '../internal/slop-engine.ts'
import { buildSlopRevisionHint } from '../internal/retry-hints.ts'

/** 反套话评分门通过线（与 slop 引擎的 SlopScore 一致）。 */
export const SLOP_GATE_PASS_THRESHOLD = 35

/** slop-gate 原子：对草稿文本做确定性套话检测，未通过时输出「需修订」并附证据提示。 */
export const slopGateAtom: Atom = {
  name: 'slop-gate',
  description: '反套话评分门：对权利要求/说明书草稿做确定性套话检测；未通过时输出「需修订」并写入证据型修订提示（自动回退重写）',
  category: 'gate',
  inputSchema: ['claims_draft'],
  outputSchema: ['slop_report', 'slop_score'],
}

/** slop-gate 执行器：确定性评分 + 未通过时产出回退信号与证据提示。 */
export class SlopGateHandler implements StageHandler {
  readonly name = 'slop-gate'
  readonly category = 'gate' as const

  /**
   * 执行 slop-gate 阶段，返回下一管线状态。
   * @param input - 阶段执行输入（state）。
   * @returns 下一管线状态（含 slop_report / slop_score，未通过时追加 slop_revision_hint）。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const draft = getStateString(state, 'claims_draft').trim()
    if (draft.length === 0) {
      return degraded('slop-gate', '输入为空（state.claims_draft）')
    }
    const analysis = analyzeSlop(draft)
    const { score } = analysis
    const passed = score.passed
    const segment: PipelineState = {
      slop_report: `反套话评分门: ${passed ? '✅ 通过' : '⚠️ 需修订'}（总分 ${score.total}，通过线 ${SLOP_GATE_PASS_THRESHOLD}）`,
      slop_score: score.total,
    }
    if (!passed) {
      const hint = buildSlopRevisionHint(analysis)
      if (hint !== undefined) segment.slop_revision_hint = hint
    }
    return segment
  }
}
