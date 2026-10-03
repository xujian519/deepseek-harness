/**
 * 上游数据通道的模型可见身份：`patent_search` 与 `patent_metadata` 都从 Google Patents
 * 的 nuo 引擎取数。
 *
 * 检索报告要写明「每个事实用的通道、失败与覆盖范围」，这份事实必须能从工具调用记录
 * 回溯。只靠命中的 URL 反推通道，报告作者分不出「换了通道」与「同一通道重试」；因此
 * 两条工具的成功结果与失败消息都点名同一个常量，通道身份只有这一处归属。
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/upstream-channel
 */

/** Google Patents 通道的模型可见名称，nuo 引擎是它在本部署的实现。 */
export const GOOGLE_PATENTS_CHANNEL = 'Google Patents（nuo 引擎）'
