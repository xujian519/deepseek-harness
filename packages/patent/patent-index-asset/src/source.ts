/**
 * The source a transcribed entry records.
 *
 * Every entry of a shipped index carries where its text or amount came from and
 * when a person checked it. Both fields stay null until someone transcribes the
 * entry from an official source and records that, which is what lets a consumer
 * tell a transcribed value from a remembered one.
 * @module @deepseek-ai/dsh-patent-index-asset/source
 */

import { readOptionalDate, readOptionalString } from './fields.ts'
import type { AssetFail } from './errors.ts'

/** Where an entry's content came from, and when it was checked. */
export type RecordedSource = {
  /** The official document the value was taken from, or null. */
  sourceDoc: string | null
  /** Date a person checked the value against `sourceDoc`, or null. */
  verifiedOn: string | null
}

/**
 * Read the recorded source of one entry.
 * @param entry - the entry's mapping.
 * @param fail - the caller's error factory.
 * @returns the recorded source, with nulls where nothing is recorded yet.
 */
export function readRecordedSource(entry: Record<string, unknown>, fail: AssetFail): RecordedSource {
  return {
    sourceDoc: readOptionalString(entry, 'sourceDoc', fail),
    verifiedOn: readOptionalDate(entry, 'verifiedOn', fail),
  }
}
