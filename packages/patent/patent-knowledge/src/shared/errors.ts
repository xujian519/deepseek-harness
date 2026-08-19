/**
 * 共享错误工具：把捕获到的 unknown 异常值规范化为可读消息。
 */

/**
 * 异常值 → 可读消息（Error 取 message，其余值 String() 序列化）。
 * @param e 捕获到的异常值（catch 绑定为 unknown）。
 * @returns 可读错误消息。
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
