/** JSON values admitted by every Inspector cross-realm message. */

import { isPlainObject } from '@deepseek-ai/dsh-value'

export { isPlainObject }

/** JSON scalar accepted by Inspector transports. */
export type InspectorJsonPrimitive = null | boolean | number | string

/** Recursively JSON-compatible value accepted by Inspector transports. */
export type InspectorJsonValue =
  | InspectorJsonPrimitive
  | readonly InspectorJsonValue[]
  | InspectorJsonObject

/** JSON-compatible object accepted by Inspector transports. */
export interface InspectorJsonObject {
  readonly [key: string]: InspectorJsonValue
}

/**
 * Test that a value can cross both MessagePort and JSON WebSocket carriers without coercion.
 * @param value - Candidate wire value.
 * @returns Whether the value is lossless JSON data.
 */
export function isJsonValue(value: unknown): value is InspectorJsonValue {
  return visitJson(value, new Set<object>())
}

/**
 * Require a plain JSON object and return it with a narrowed type.
 * @param value - Candidate wire value.
 * @param label - Field name used in validation errors.
 * @returns The validated JSON object.
 */
export function requireJsonObject(value: unknown, label: string): InspectorJsonObject {
  if (!isPlainObject(value) || !isJsonValue(value)) {
    throw new Error(`inspector protocol: ${label} must be a JSON object`)
  }
  return value
}

/**
 * Compute the UTF-8 byte length of a JSON wire value.
 * @param value - Validated JSON value.
 * @returns Its encoded byte length.
 */
export function jsonByteLength(value: InspectorJsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function visitJson(value: unknown, ancestors: Set<object>): value is InspectorJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false
      return value.every(item => visitJson(item, ancestors))
    }
    if (!isPlainObject(value)) return false
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !('value' in descriptor) || !visitJson(descriptor.value, ancestors)) return false
    }
    return true
  } finally {
    ancestors.delete(value)
  }
}
