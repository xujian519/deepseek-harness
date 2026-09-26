/**
 * Field readers for a shipped index asset.
 *
 * An index asset is hand-transcribed content, so a wrong field type is a
 * deployment error, not something to coerce: every reader either returns the
 * value the asset declared or refuses the file with a message naming the field.
 * That is why the readers take the caller's error factory rather than a default
 * error class — each index package keeps its own catchable error type.
 * @module @deepseek-ai/dsh-patent-index-asset/fields
 */

import { parse as parseYaml } from 'yaml'
import type { AssetFail } from './errors.ts'

const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/**
 * Parse an asset file into its root mapping.
 * @param source - the file's text.
 * @param label - what the file is, used in the message when the root is wrong.
 * @param fail - the caller's error factory, bound to the file.
 * @returns the root mapping.
 */
export function parseYamlMapping(source: string, label: string, fail: AssetFail): Record<string, unknown> {
  let value: unknown
  try {
    value = parseYaml(source)
  } catch (error) {
    throw fail(`YAML 解析失败：${(error as Error).message}`)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail(`${label}的根节点必须是映射`)
  }
  return value as Record<string, unknown>
}

/**
 * Require a value to be a mapping.
 * @param value - the value to check.
 * @param where - the field path for the message.
 * @param fail - the caller's error factory.
 * @returns the mapping.
 */
export function readMapping(value: unknown, where: string, fail: AssetFail): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail(`${where} 必须是映射`)
  }
  return value as Record<string, unknown>
}

/**
 * Read a required non-empty string field.
 * @param root - the mapping holding it.
 * @param field - the field name.
 * @param fail - the caller's error factory.
 * @returns the string.
 */
export function readString(root: Record<string, unknown>, field: string, fail: AssetFail): string {
  const value = root[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw fail(`字段 ${field} 必须是非空字符串`)
  }
  return value
}

/**
 * Read a field that is either absent/null or a non-empty string.
 * @param root - the mapping holding it.
 * @param field - the field name.
 * @param fail - the caller's error factory.
 * @returns the string, or null when the field is absent.
 */
export function readOptionalString(root: Record<string, unknown>, field: string, fail: AssetFail): string | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') {
    throw fail(`字段 ${field} 必须是 null 或非空字符串`)
  }
  return value
}

/**
 * Read a field that is either absent/null or an ISO date.
 * @param root - the mapping holding it.
 * @param field - the field name.
 * @param fail - the caller's error factory.
 * @returns the date text, or null when the field is absent.
 */
export function readOptionalDate(root: Record<string, unknown>, field: string, fail: AssetFail): string | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw fail(`字段 ${field} 必须是 null 或 YYYY-MM-DD`)
  }
  return value
}

/**
 * Read a required positive integer.
 * @param value - the value to check.
 * @param where - the field path for the message.
 * @param fail - the caller's error factory.
 * @returns the integer.
 */
export function readCount(value: unknown, where: string, fail: AssetFail): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw fail(`${where} 必须是正整数`)
  }
  return value
}

/**
 * Read a field that is either absent/null or a positive integer.
 * @param root - the mapping holding it.
 * @param field - the field name.
 * @param fail - the caller's error factory.
 * @returns the integer, or null when the field is absent.
 */
export function readOptionalCount(root: Record<string, unknown>, field: string, fail: AssetFail): number | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  return readCount(value, `字段 ${field}`, fail)
}

/**
 * Read a field that is either absent/null or a boolean.
 * @param root - the mapping holding it.
 * @param field - the field name.
 * @param fail - the caller's error factory.
 * @returns the boolean, or null when the field is absent.
 */
export function readOptionalBoolean(root: Record<string, unknown>, field: string, fail: AssetFail): boolean | null {
  const value = root[field]
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw fail(`字段 ${field} 必须是 null 或布尔值`)
  return value
}

/**
 * Read a required value from a closed set.
 * @param value - the value to check.
 * @param allowed - the accepted values.
 * @param where - the field path for the message.
 * @param fail - the caller's error factory.
 * @returns the value, narrowed to the set.
 */
export function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  where: string,
  fail: AssetFail,
): T {
  const accepted = allowed.join(' / ')
  if (typeof value !== 'string') throw fail(`${where} 必须是 ${accepted} 之一，得到：${JSON.stringify(value)}`)
  if (!(allowed as readonly string[]).includes(value)) {
    throw fail(`${where} 必须是 ${accepted} 之一，得到：${value}`)
  }
  return value as T
}
