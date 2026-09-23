/**
 * src/patent/novelty — 数值范围与单位的共享词表。
 *
 * 同一句专利文本会同时进入两条生产路径：新颖性图节点（{@link ./numeric-range.ts}）
 * 与规格校验（`@deepseek-ai/dsh-patent-tools` 的 `validate-specification`）。
 * 两侧各写一份词表时，「温度 20℃ 至 90℃」会被一侧读成区间、另一侧读成两个数值点，
 * 同一句文本因此得到互相矛盾的结论。**词表**（连接符、可写单位、单位归一）在这里
 * 单点定义；**规则**差异留在各自实现里——规格校验要求尾随单位，因为它要用同单位的
 * 单值比对端点与中点，而新颖性判定只关心区间本身。
 */

/**
 * 范围连接符的字符类内容：连字符、en dash、em dash、波浪号、全角波浪号，以及「至」「到」。
 * 供两侧以 `[...]` 嵌入正则；连字符放末位，避免被读成字符范围。
 */
export const NUMERIC_RANGE_SEPARATOR_CLASS = '~～至到–—-'

/**
 * 可写单位的备选串（长者在前，否则交替会把 "5mg" 截成 "m"、"0.1-2MPa" 截成 "m"）。
 * 摄氏度含 `℃`／`°C`／`°c`／`°` 四种写法，规格校验侧曾漏掉小写 `°c`。
 */
export const NUMERIC_UNIT_ALTERNATION =
  '°C|℃|°c|MPa|kPa|Pa|rpm|min|mol|mm|cm|kg|mg|ml|mL|％|°|m|g|L|h|s|%'

/**
 * 单位归一：摄氏度四种写法统一为 `°`，其余原样返回。
 * @param unit - 待归一的单位文本（大小写均可）。
 * @returns 归一后的单位。
 */
export function normalizeNumericUnit(unit: string): string {
  return unit === '℃' || unit.toLowerCase() === '°c' ? '°' : unit
}
