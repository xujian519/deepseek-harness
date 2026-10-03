/**
 * 上游数据通道的模型可见身份：`patent_search` 与 `patent_metadata` 都从 Google Patents
 * 的 nuo 引擎取数。
 *
 * 检索报告要写明「每个事实用的通道、失败与覆盖范围」，这份事实必须能从工具调用记录
 * 回溯。只靠命中的 URL 反推通道，报告作者分不出「换了通道」与「同一通道重试」；因此
 * 两条工具的成功结果与失败消息都点名同一个常量，通道身份与失败文案只有这一处归属。
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/upstream-channel
 */

/** Google Patents 通道的模型可见名称，nuo 引擎是它在本部署的实现。 */
export const GOOGLE_PATENTS_CHANNEL = 'Google Patents（nuo 引擎）'

/**
 * 渲染一次失败的上游查询：点名通道、上游错误与已尝试次数。
 *
 * 只有上游短语（`fetch failed`）时报告分不出事实出自哪个通道，而不写次数的重试提示
 * 会被读成「离开工具层」的邀请——通道名让调用记录自证，次数让调用方分得出首跑失败
 * 与退避后仍失败。
 * @param detail - 上游失败原文。
 * @param attempts - 已尝试的总次数。
 * @returns 模型可见的失败文案。
 */
export function renderUpstreamFailure(detail: string, attempts: number): string {
  const retried = attempts > 1 ? `；已退避重试 ${attempts - 1} 次仍未成功` : ''
  return `通道 ${GOOGLE_PATENTS_CHANNEL}：${detail}${retried}；上游瞬时失败，可稍后重试`
}
