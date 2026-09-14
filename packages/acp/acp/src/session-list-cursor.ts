/**
 * `session/list` keyset pagination: the opaque continuation cursor and the
 * byte-stable ordering it encodes. The bridge keeps no server-side page state,
 * so decoding and comparison are pure and live apart from the handler that
 * spends them.
 * @module @deepseek-ai/dsh-acp/session-list-cursor
 */

import { Buffer } from 'node:buffer'

/** The keyset position a `session/list` page ended at. */
export interface SessionListCursor {
  createdAt: number
  sessionId: string
}

/**
 * Decode an opaque keyset cursor without assigning meaning to client metadata.
 * @param value - the continuation token from the previous page, or `null`/`undefined` for the first page.
 * @returns the decoded position, or `undefined` when the caller sent no cursor.
 * @throws Error when the token is not canonical base64url of a `[createdAt, sessionId]` pair.
 */
export function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | undefined {
  if (value === undefined || value === null) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('session/list cursor is invalid')
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    const createdAt: unknown = Array.isArray(decoded) ? decoded[0] : undefined
    const sessionId: unknown = Array.isArray(decoded) ? decoded[1] : undefined
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || typeof createdAt !== 'number'
      || !Number.isSafeInteger(createdAt)
      || createdAt < 0
      || typeof sessionId !== 'string'
      || sessionId.length === 0
    ) throw new Error('invalid cursor fields')
    const canonical = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
    if (canonical !== value) throw new Error('non-canonical cursor')
    return { createdAt, sessionId }
  } catch (_invalidCursor) {
    throw new Error('session/list cursor is invalid')
  }
}

/**
 * Encode the last returned ordering key as an opaque continuation token.
 * @param entry - the last entry of the page just returned.
 * @returns the token a client sends back to continue after that entry.
 */
export function encodeSessionListCursor(entry: SessionListCursor): string {
  return Buffer.from(JSON.stringify([entry.createdAt, entry.sessionId]), 'utf8').toString('base64url')
}

/**
 * Test whether an entry follows the cursor in newest-first list order.
 * @param entry - a candidate entry.
 * @param cursor - the position the previous page ended at.
 * @returns true when `entry` sorts strictly after `cursor`.
 */
export function isAfterSessionListCursor(entry: SessionListCursor, cursor: SessionListCursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && compareSessionIds(entry.sessionId, cursor.sessionId) > 0)
}

/**
 * Compare opaque session ids by stable UTF-8 bytes, independent of process locale.
 * @param left - first session id.
 * @param right - second session id.
 * @returns a negative, zero, or positive number as `left` sorts before, with, or after `right`.
 */
export function compareSessionIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}
