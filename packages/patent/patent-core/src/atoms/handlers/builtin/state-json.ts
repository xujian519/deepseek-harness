/**
 * Typed readers for JSON-valued pipeline state keys.
 *
 * Atoms that consume a JSON-encoded state key share one reader: a missing,
 * empty, or malformed value reads as undefined instead of throwing, so the
 * atom decides what an absent input means.
 * @module @deepseek-ai/dsh-patent-core/atoms/handlers/builtin/state-json
 */

import { type PipelineState, getStateString } from '../../handler.ts'

/**
 * Read a JSON state key; a missing, empty, or malformed value reads as undefined.
 * @param state - the pipeline state.
 * @param key - the state key to read.
 * @returns the parsed JSON value, or undefined when the key is absent or invalid.
 */
export function readStateJson(state: PipelineState, key: string): unknown {
  const raw = getStateString(state, key)
  if (raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Read a state key that holds one JSON object.
 * @param state - the pipeline state.
 * @param key - the state key to read.
 * @returns the object, or undefined when the value is absent or not an object.
 */
export function readStateObject(state: PipelineState, key: string): Record<string, unknown> | undefined {
  const parsed = readStateJson(state, key)
  if (parsed === undefined || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined
  }
  return parsed as Record<string, unknown>
}
