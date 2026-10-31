/**
 * src/patent/workflow — `consumes` 条目的投影引用解析。
 *
 * `consumes` 的条目有两种形态：`'parse'`（取该阶段全文）与 `'parse#oa-summary'`
 * （取该阶段产出的命名投影）。语法用 `#` 而不是另设 map 字段，是因为投影紧贴它
 * 所投影的阶段：改阶段 id 时不会漏改另一张表，也不会出现「map 里写着 s1、数组里
 * 却已经把 s1 删掉」的漂移。
 *
 * 解析本身是**全函数**（任何字符串都有结果）：形状合法与否由
 * `validateWorkflowManifest` 判，渲染器只消费校验过的 manifest。这样解析器不必
 * 在两个包里各写一份「这里该不该抛错」的分支。
 */

/** 一条 `consumes` 条目的拆解结果。 */
export type ConsumeRef = {
  /** 上游阶段 id。 */
  stageId: string
  /** 命名的投影键；缺省表示取该阶段全文（向后兼容）。 */
  projection?: string
}

/**
 * 拆解一条 `consumes` 条目。
 * @param entry - `'stage'` 或 `'stage#projection'` 形态的条目。
 * @returns 阶段 id 与可选投影键；条目里没有 `#` 时 `projection` 缺省。
 */
export function parseConsumeRef(entry: string): ConsumeRef {
  const at = entry.indexOf('#')
  if (at < 0) return { stageId: entry }
  return { stageId: entry.slice(0, at), projection: entry.slice(at + 1) }
}
