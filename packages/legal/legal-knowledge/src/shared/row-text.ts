/**
 * SQLite 行值到文本的窄化。
 *
 * `node:sqlite` 返回的行是 `Record<string, unknown>`；模板插值或 `String()`
 * 直接作用于未知值会把对象渲染成 `[object Object]`。检索引擎只接受标量列，
 * 因此这里把非标量显式收敛为空串，避免把占位字符串当成检索结果。
 * @module @deepseek-ai/dsh-legal-knowledge/shared/row-text
 */

/**
 * 把一个未知列值渲染为文本。
 * @param value - 数据库行中的列值。
 * @returns 字符串原样返回；数字、bigint、布尔值转为字面量；其余为空串。
 */
export function columnText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }
  return ''
}
