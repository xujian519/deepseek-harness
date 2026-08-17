import { describe, expect, it } from 'vitest'
import { CallId , createMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { interruptedTurnClosers, orphanedToolCallReplacements, TOOL_NOT_STARTED, TOOL_OUTCOME_UNKNOWN } from '../src/index.ts'
import type { SessionEvent, SurfaceEvent } from '../src/index.ts'
import { foldSurface } from '../src/index.ts'

/**
 * Unit coverage for the crash-recovery closer synthesis. The persistence
 * contract exercises it end-to-end through both backends; these tests pin the
 * pure function's branches directly — especially the synthetic error
 * `tool/result` for a tool call the crash left unanswered (without it a
 * resumed session replays a dangling assistant tool-call and the provider
 * rejects the transcript).
 */

const userTurnStart = (turn: number, seq: number): SessionEvent =>
  ({ type: 'turn/start', seq, time: seq, data: { turn } })

describe('interruptedTurnClosers', () => {
  it('returns nothing for a balanced log (ends on turn/end)', () => {
    const balanced: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'turn/end', seq: 1, time: 1, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(interruptedTurnClosers(balanced)).toEqual([])
  })

  it('returns nothing for an empty log', () => {
    expect(interruptedTurnClosers([])).toEqual([])
  })

  it('ignores event types that do not move the boundary cursor', () => {
    // A user/message falls through the switch's default branch; the balanced
    // turn still produces no closers.
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'user/message', seq: 1, time: 1, data: createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'user' },
      }) },
      { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(interruptedTurnClosers(events)).toEqual([])
  })

  it('closes an open turn with no open step (turn/end {interrupted} only)', () => {
    const events: SessionEvent[] = [userTurnStart(1, 0)]
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['turn/end'])
    const end = closers[0]!
    expect(end.seq).toBe(1)
    expect(end.type === 'turn/end' && end.data.reason).toEqual({ kind: 'interrupted' })
  })

  it('closes an open step before the turn (step/end then turn/end)', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
    ]
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['step/end', 'turn/end'])
    expect(closers.map(e => e.seq)).toEqual([2, 3])
  })

  it('marks an assistant tool request with no recorded call as not started', () => {
    const events: SessionEvent[] = [
      userTurnStart(2, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 2, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'text', text: 'calling a tool' },
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
    ]
    const closers = interruptedTurnClosers(events)
    // tool/result (for the orphaned call) → step/end → turn/end, contiguous seqs.
    expect(closers.map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
    expect(closers.map(e => e.seq)).toEqual([3, 4, 5])
    const result = closers[0]!
    expect(result.type === 'tool/result' && result.data).toMatchObject({
      turn: 2,
      step: 1,
      message: {
        source: { callId: CallId('call-1') },
        content: [{ isError: true }],
      },
      error: { code: TOOL_NOT_STARTED },
    })
    expect(result.type === 'tool/result' && result.data.message.content[0].content).toEqual([{
      type: 'text', text: 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
    }])
  })

  it('does NOT synthesize a result for a tool-call that already has one', () => {
    const events: SessionEvent[] = [
      userTurnStart(2, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 2, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
      { type: 'tool/result', seq: 3, time: 3, data: {
        turn: 2, step: 1,
        message: createToolResultMessage({
          callId: CallId('call-1'),
          content: [{ type: 'text', text: 'ok' }],
          isError: false,
        }),
      } },
    ]
    // The call is answered, so only the open step + turn need closing.
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['step/end', 'turn/end'])
  })

  it('does NOT synthesize a result after the owning step already closed', () => {
    const events: SessionEvent[] = [
      userTurnStart(2, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 2, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
      { type: 'step/end', seq: 3, time: 3, data: { turn: 2, step: 1 } },
    ]

    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['turn/end'])
    expect(closers[0]?.seq).toBe(4)
  })

  it('synthesizes results only for the still-open turn, not a committed earlier turn', () => {
    // Turn 1 completed with its own tool call+result (balanced). Turn 2 crashed
    // with an unanswered call. Only turn 2's call must get a synthetic result.
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('old-call'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
      { type: 'tool/result', seq: 3, time: 3, data: {
        turn: 1, step: 1,
        message: createToolResultMessage({
          callId: CallId('old-call'),
          content: [],
          isError: false,
        }),
      } },
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
      userTurnStart(2, 6),
      { type: 'step/start', seq: 7, time: 7, data: { turn: 2, step: 1 } },
      { type: 'assistant/message', seq: 8, time: 8, data: {
        turn: 2, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('new-call'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
    ]
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
    const result = closers[0]!
    expect(result.type === 'tool/result' && result.data.message.source.callId).toBe('new-call')
  })

  it('synthesizes a result for each of multiple unanswered calls, in log order', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-a'), name: 'bash', arguments: '{}' },
            { type: 'tool-call', id: CallId('call-b'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
      // call-a got answered before the crash; call-b did not.
      { type: 'tool/result', seq: 3, time: 3, data: {
        turn: 1, step: 1,
        message: createToolResultMessage({
          callId: CallId('call-a'),
          content: [],
          isError: false,
        }),
      } },
    ]
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
    const result = closers[0]!
    expect(result.type === 'tool/result' && result.data.message.source.callId).toBe('call-b')
  })

  it('synthesized tool/result carries surfaceOp and sourceEventSeqs when tool/call was logged', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
          ],
          source: {
            kind: 'model',
            ...{ provider: 'mock', model: 'mock' },
          },
        }),
      } },
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '{}' } },
    ]
    const closers = interruptedTurnClosers(events)
    expect(closers.map(e => e.type)).toEqual(['tool/result', 'step/end', 'turn/end'])
    const result = closers[0]!
    expect((result as SurfaceEvent).surfaceOp).toBe('append')
    expect((result as SurfaceEvent).sourceEventSeqs).toEqual([3])
    expect(result.type === 'tool/result' && result.data.error).toEqual({
      name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN,
    })
    if (result.type !== 'tool/result' || result.data.message.content[0].content[0]?.type !== 'text') {
      throw new Error('expected a text tool result')
    }
    expect(result.data.message.content[0].content[0].text).toContain('retry only if the operation is read-only or idempotent')
    expect(result.data.message.content[0].content[0].text).toContain('first verify external state or ask the user')
  })

  it('handles tool/call without a matching assistant/message entry gracefully', () => {
    // A raw tool/call with no assistant-registered pending call has nothing to
    // answer; repair still closes the step and turn without synthesizing a result.
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'tool/call', seq: 2, time: 2, data: { turn: 1, step: 1, callId: CallId('orphan'), name: 'bash', arguments: '{}' } },
    ]
    const closers = interruptedTurnClosers(events)
    // No pending calls → no synthetic tool/result, just step/end + turn/end.
    expect(closers.map(e => e.type)).toEqual(['step/end', 'turn/end'])
  })
})

const assistantToolCallMessage = (seq: number, turn: number, callId: string): SessionEvent =>
  ({ type: 'assistant/message', seq, time: seq, surfaceOp: 'append', data: {
    turn, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [
        { type: 'tool-call', id: CallId(callId), name: 'bash', arguments: '{}' },
      ],
      source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
    }),
  } })

const toolResultEvent = (seq: number, turn: number, callId: string): SessionEvent =>
  ({ type: 'tool/result', seq, time: seq, surfaceOp: 'append', data: {
    turn, step: 1,
    message: createToolResultMessage({
      callId: CallId(callId),
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    }),
  } })

describe('orphanedToolCallReplacements', () => {
  it('returns nothing for an empty or balanced log', () => {
    expect(orphanedToolCallReplacements([])).toEqual([])
    const balanced: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      assistantToolCallMessage(2, 1, 'call-1'),
      toolResultEvent(3, 1, 'call-1'),
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(orphanedToolCallReplacements(balanced)).toEqual([])
  })

  it('shadows a closed-turn assistant tool_calls message whose call was never answered', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      assistantToolCallMessage(2, 1, 'call-1'),
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '{}' } },
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
    ]
    const replacements = orphanedToolCallReplacements(events)
    expect(replacements).toHaveLength(1)
    const replacement = replacements[0] as SurfaceEvent
    expect(replacement.type).toBe('user/message')
    expect(replacement.seq).toBe(6)
    expect(replacement.surfaceOp).toEqual({ op: 'replace', start: 2, end: 2 })
    expect(replacement.sourceEventSeqs).toEqual([2])
    const message = (replacement as unknown as { data: { content: { type: string; text?: string }[] } }).data
    expect(message.content[0]?.type).toBe('text')
    expect(message.content[0]?.text).toContain('never executed')
  })

  it('stops the shadowed range at the first non-result surface node', () => {
    // A plain-text assistant message following the orphaned tool-call message
    // ends the consumed range: the replacement must not swallow it.
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      assistantToolCallMessage(2, 1, 'call-1'),
      { type: 'assistant/message', seq: 3, time: 3, surfaceOp: 'append', data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'follow-up note' }],
          source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
        }),
      } },
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
    ]
    const replacements = orphanedToolCallReplacements(events)
    expect(replacements).toHaveLength(1)
    const replacement = replacements[0] as SurfaceEvent
    expect(replacement.surfaceOp).toEqual({ op: 'replace', start: 2, end: 2 })
    expect(replacement.sourceEventSeqs).toEqual([2])
  })

  it('shadows the message and its answered results together when only some calls were answered', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      { type: 'assistant/message', seq: 2, time: 2, surfaceOp: 'append', data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant',
          content: [
            { type: 'tool-call', id: CallId('call-1'), name: 'bash', arguments: '{}' },
            { type: 'tool-call', id: CallId('call-2'), name: 'bash', arguments: '{}' },
          ],
          source: { kind: 'model', ...{ provider: 'mock', model: 'mock' } },
        }),
      } },
      toolResultEvent(3, 1, 'call-1'),
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
    ]
    const replacements = orphanedToolCallReplacements(events)
    expect(replacements).toHaveLength(1)
    const replacement = replacements[0] as SurfaceEvent
    // The answered call-1 result is shadowed with the message: once the
    // assistant message is gone, a standalone tool result would itself dangle.
    expect(replacement.surfaceOp).toEqual({ op: 'replace', start: 2, end: 3 })
    expect(replacement.sourceEventSeqs).toEqual([2, 3])
  })

  it('replaces the full transcript into a provider-valid shape and is idempotent', () => {
    const events: SessionEvent[] = [
      userTurnStart(1, 0),
      { type: 'step/start', seq: 1, time: 1, data: { turn: 1, step: 1 } },
      assistantToolCallMessage(2, 1, 'call-1'),
      { type: 'tool/call', seq: 3, time: 3, data: { turn: 1, step: 1, callId: CallId('call-1'), name: 'bash', arguments: '{}' } },
      { type: 'step/end', seq: 4, time: 4, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: 5, time: 5, data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
    ]
    const healed = [...events, ...orphanedToolCallReplacements(events)]
    // The orphaned assistant message is shadowed by a text-only user-role
    // message: no tool calls remain dangling on the surface.
    const { nodes } = foldSurface(healed)
    const bySeq = new Map(healed.map(event => [event.seq, event] as const))
    const surfaceMessages = nodes.map(seq => bySeq.get(seq))
    expect(surfaceMessages.map(event => event!.type)).toEqual(['user/message'])
    const note = surfaceMessages[0]!
    if (note.type !== 'user/message') throw new Error('expected the healed user message')
    expect(note.data.content.some((block: { type: string }) => block.type === 'tool-call')).toBe(false)
    // A second scan of the healed log produces nothing: the repair is idempotent.
    expect(orphanedToolCallReplacements(healed)).toEqual([])
  })
})
