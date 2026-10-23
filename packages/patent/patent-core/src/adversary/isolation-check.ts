/**
 * src/adversary/isolation-check — 信息隔离检查。
 *
 * 三重检查机制确保 adversary-model 输入不泄漏己方中间推理：
 * 1. 声明层：inputSchema 不包含禁止键
 * 2. 运行时层：execute() 入口检测 PipelineState 是否含禁止键
 * 3. 输出层：扫描报告文本是否包含禁止术语
 *
 * Spike 结论：信息隔离可行，三重检查确保隔离严格。
 */

/** 禁止出现在 adversary 输入中的键（己方中间推理产物）。 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'dispute_framing_report',
  'dispute_framing_candidates',
  'dispute_framing_claims',
  'dispute_framing_refined',
  'dispute_framing_refined_candidates',
  'claim_chart',
  'draft',
]

/** 禁止出现在 adversary 输出中的术语（防止反向泄漏）。 */
export const FORBIDDEN_OUTPUT_TERMS: readonly string[] = [
  'dispute_framing',
  'claim_chart',
  '己方推理',
  '内部分析',
]

/** 隔离检查结果。 */
export type IsolationCheckResult = {
  /** 是否通过检查（clean=true 表示无泄漏）。 */
  clean: boolean
  /** 检测到的禁止键或术语列表。 */
  leakedKeys: string[]
}

/**
 * 检查 PipelineState 是否包含禁止键（运行时层隔离检查）。
 * @param stateKeys - PipelineState 的键列表。
 * @returns 检查结果，包含是否通过及泄漏的键列表。
 */
export function checkInputIsolation(stateKeys: readonly string[]): IsolationCheckResult {
  const leakedKeys = FORBIDDEN_KEYS.filter(key => stateKeys.includes(key))
  return {
    clean: leakedKeys.length === 0,
    leakedKeys,
  }
}

/**
 * 扫描输出文本是否包含禁止术语（输出层隔离检查）。
 * @param report - 待扫描的报告文本。
 * @param forbiddenTerms - 禁止术语列表（默认使用 FORBIDDEN_OUTPUT_TERMS）。
 * @returns 检查结果，包含是否通过及检测到的术语列表。
 */
export function scanOutputForLeaks(
  report: string,
  forbiddenTerms: readonly string[] = FORBIDDEN_OUTPUT_TERMS,
): IsolationCheckResult {
  const leakedKeys = forbiddenTerms.filter(term => report.includes(term))
  return {
    clean: leakedKeys.length === 0,
    leakedKeys,
  }
}
