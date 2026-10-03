/**
 * 门禁共用入参匹配：把模型侧的 JSON 入参收窄为字符串记录，并判定部署声明的
 * `whenArgs` 是否适用于本次调用。
 *
 * 制品结构门禁与交付前置门禁回答同一个问题——「这条声明是不是冲着本次调用来的」，
 * 答案是「声明的每个字段都与实际入参相等，或落在声明的取值集合里」。两处各写一份，
 * 同一条声明在两种门禁上就会有不同含义。
 * @module @deepseek-ai/dsh-patent-rule/runtime/args-match
 */

/**
 * 把 JSON 值当作字符串记录读取。
 * @param value - 待收窄的值。
 * @returns 字符串键记录；数组与非记录返回 null。
 */
export function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** 一条声明的入参取值：字符串为精确匹配，字符串数组为取值集合。 */
export type DeclaredArgValue = string | string[]

/**
 * 声明的 `whenArgs` 是否适用于本次调用。
 * @param when - 声明的入参约束；缺省表示不约束（恒适用）。
 * @param args - 本次调用的入参（模型侧 JSON 值）。
 * @returns 声明的每个字段都满足时为 true。
 */
export function declaredArgsMatch(
  when: Record<string, DeclaredArgValue> | undefined,
  args: unknown,
): boolean {
  if (when === undefined) return true
  const record = jsonRecord(args)
  if (record === null) return false
  return Object.entries(when).every(([name, declared]) => {
    const actual = record[name]
    return typeof declared === 'string'
      ? actual === declared
      : typeof actual === 'string' && declared.includes(actual)
  })
}
