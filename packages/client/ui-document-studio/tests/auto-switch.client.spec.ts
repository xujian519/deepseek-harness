/**
 * Auto-switch eligibility: the studio may only take the screen once the
 * session has logged a successful `document_deliver` registration.
 */
import { describe, expect, it } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { hasDeliverRegistration } from '../src/client/auto-switch.ts'

function at(seq: number, type: string, data: unknown, surfaceOp?: 'append' | 'replace'): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq, time: seq * 1_000, type, data,
      ...surfaceOp === undefined ? {} : { surfaceOp },
    } as SessionEvent,
  }
}

function call(seq: number, callId: string, name: string): SessionLiveEventEntry {
  return at(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
}

function result(seq: number, callId: string, isError = false, surfaceOp: 'append' | 'replace' = 'append'): SessionLiveEventEntry {
  return at(seq, 'tool/result', {
    turn: 1, step: 1,
    message: { source: { kind: 'tool', callId }, content: [], isError },
  }, surfaceOp)
}

describe('hasDeliverRegistration', () => {
  it('is false for an empty window and for a call without its result', () => {
    expect(hasDeliverRegistration([])).toBe(false)
    expect(hasDeliverRegistration([call(1, 'reg', 'document_deliver')])).toBe(false)
  })

  it('is true once the registration call has a non-error append result', () => {
    expect(hasDeliverRegistration([
      call(1, 'reg', 'document_deliver'),
      result(2, 'reg'),
    ])).toBe(true)
  })

  it('ignores a failed registration, a non-append settlement, and unrelated tools', () => {
    expect(hasDeliverRegistration([
      call(1, 'reg', 'document_deliver'),
      result(2, 'reg', true),
    ])).toBe(false)
    expect(hasDeliverRegistration([
      call(3, 'reg', 'document_deliver'),
      result(4, 'reg', false, 'replace'),
    ])).toBe(false)
    expect(hasDeliverRegistration([
      call(5, 'write', 'write'),
      result(6, 'write'),
    ])).toBe(false)
  })

  it('ignores transient entries and pairs results with their own call', () => {
    const transient = { type: 'transient', event: { type: 'assistant/chunk' } } as unknown as SessionLiveEventEntry
    expect(hasDeliverRegistration([
      transient,
      call(1, 'other', 'write'),
      result(2, 'reg'),
    ])).toBe(false)
  })
})
