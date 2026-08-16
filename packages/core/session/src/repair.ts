/**
 * Crash-recovery repair for an interrupted session log. It preserves a fully
 * written final turn and supplies the missing tool, step, and turn boundaries
 * needed to resume with a provider-valid transcript.
 * @module @deepseek-ai/dsh-session/repair
 */

import { MessageId, freezeMessage, type CallId, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from './types.ts'
import { foldSurface } from './surface.ts'

/** Recovery code for an assistant tool request that never reached a recorded call start. */
export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'

/** Recovery code for a recorded tool call whose completed outcome was not durably recorded. */
export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'

/**
 * Return deterministic synthetic events that close an open tail turn. Unmatched
 * calls receive error results first, followed by an open `step/end` and an
 * interrupted `turn/end`; sequences continue the log and timestamps reuse the
 * last real event. A balanced or empty log returns no events.
 *
 * @param events - the loaded durable log to scan (a valid committed prefix, possibly with a crash tail).
 * @returns the synthetic closer events to append after `events`, in order; empty when the log is already balanced.
 */
export function interruptedTurnClosers(events: readonly SessionEvent[]): SessionEvent[] {
  let openTurn: number | null = null
  let openStep: number | null = null
  // Reset at each turn boundary so earlier calls cannot leak into tail repair.
  // Assistant blocks register calls; later `tool/call` events add their seqs to `sourceEventSeqs`.
  const pendingCalls = new Map<CallId, { step: number; callSeq?: number }>()
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        openTurn = event.data.turn
        openStep = null
        pendingCalls.clear()
        break
      case 'turn/end':
        openTurn = null
        openStep = null
        pendingCalls.clear()
        break
      case 'step/start':
        openStep = event.data.step
        break
      case 'step/end':
        pendingCalls.clear()
        openStep = null
        break
      case 'assistant/message':
        // The assistant message carries the tool-call blocks; each is pending
        // until a tool/result event with the same callId is logged.
        for (const block of event.data.message.content) {
          if (block.type === 'tool-call') pendingCalls.set(block.id, { step: event.data.step })
        }
        break
      case 'tool/call':
        // Cite the `tool/call` seq from the synthetic result.
        {
          const entry = pendingCalls.get(event.data.callId)
          if (entry) {
            entry.callSeq = event.seq
          }
        }
        break
      case 'tool/result':
        pendingCalls.delete(event.data.message.source.callId)
        break
      // Other event types do not move the turn/step boundary cursor.
      default:
        break
    }
  }

  // Balanced log (no crash mid-turn): nothing to close. An open turn implies
  // `events` is non-empty (its turn/start was logged), so `last` exists.
  const last = events.at(-1)
  if (openTurn === null || last === undefined) return []

  // The last real event supplies the seq base and the timestamp for the
  // synthetic closers (reusing the last timestamp keeps them deterministic and
  // never invents a "future" time).
  let seq = last.seq + 1
  const time = last.time
  const closers: SessionEvent[] = []

  // Close calls before their step: providers reject dangling assistant calls,
  // and Map insertion order preserves their transcript order.
  for (const [callId, { step, callSeq }] of pendingCalls) {
    const started = callSeq !== undefined
    const message: ToolResultMessage = freezeMessage({
      id: MessageId(`interrupted-tool-result-${callId}-${seq}`),
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        isError: true,
        content: [{
          type: 'text',
          text: started
            ? 'The tool call was interrupted after it was recorded, but no result was durably recorded. Its outcome is unknown. Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; if it may have side effects, first verify external state or ask the user. Do not retry blindly.'
            : 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
        }],
      }],
    })
    closers.push({
      type: 'tool/result',
      seq: seq++,
      time,
      data: {
        turn: openTurn,
        step,
        message,
        error: started
          ? { name: 'ToolOutcomeUnknownError', code: TOOL_OUTCOME_UNKNOWN }
          : { name: 'ToolNotStartedError', code: TOOL_NOT_STARTED },
      },
      surfaceOp: 'append',
      ...started ? { sourceEventSeqs: [callSeq] } : {},
    })
  }

  // Close an open step next — a turn/end while a step is open is an invariant
  // violation, so the step's boundary must be synthesized before the turn's.
  if (openStep !== null) {
    closers.push({ type: 'step/end', seq: seq++, time, data: { turn: openTurn, step: openStep } })
  }
  closers.push({ type: 'turn/end', seq: seq++, time, data: { turn: openTurn, reason: { kind: 'interrupted' } } })
  return closers
}

/**
 * Return deterministic surface-replacement events that shadow assistant
 * `tool_calls` messages whose calls were never answered, replacing each with a
 * plain-text user-role message (the harness carries producer-injected context
 * in user role). A turn that closed with an error after recording its tool
 * calls but before their results leaves a dangling message that makes every
 * later request provider-invalid; the shadow keeps the transcript valid.
 * Partial answers are shadowed together with the message — their results
 * belong to the failed batch and would themselves dangle once the assistant
 * message is gone. Idempotent: a healed message carries no tool calls. The
 * caller passes the log WITH any tail closers already applied, so an open
 * turn's synthesized results count as answers.
 * @param events - the log to scan, tail closers included.
 * @returns the replacement events to append after `events`, in order.
 */
export function orphanedToolCallReplacements(events: readonly SessionEvent[]): SessionEvent[] {
  const answered = new Set<CallId>()
  for (const event of events) {
    if (event.type === 'tool/result') answered.add(event.data.message.source.callId)
  }
  // Shadow only messages still on the model-visible surface: a message a prior
  // replacement removed is not an orphan.
  const { nodes } = foldSurface(events)
  const bySeq = new Map(events.map(event => [event.seq, event] as const))
  const last = events.at(-1)
  if (last === undefined) return []
  let seq = last.seq + 1
  const time = last.time
  const replacements: SessionEvent[] = []
  for (let i = 0; i < nodes.length;) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the loop condition
    const event = bySeq.get(nodes[i]!)
    if (event?.type !== 'assistant/message') {
      i++
      continue
    }
    const toolCalls = event.data.message.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
    if (toolCalls.length === 0 || toolCalls.every(call => answered.has(call.id))) {
      i++
      continue
    }
    // Consume the message and any contiguous following results as one range.
    const shadowed = [event.seq]
    let end = event.seq
    let j = i + 1
    while (j < nodes.length) {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the while condition
      const next = bySeq.get(nodes[j]!)
      if (next?.type !== 'tool/result') break
      // oxlint-disable-next-line typescript/no-non-null-assertion -- bounded by the while condition
      end = nodes[j]!
      shadowed.push(end)
      j++
    }
    const healedSeq = seq++
    replacements.push({
      type: 'user/message',
      seq: healedSeq,
      time,
      data: freezeMessage({
        id: MessageId(`healed-tool-calls-${healedSeq}`),
        role: 'user',
        source: { kind: 'plugin', plugin: 'dsh-session' },
        content: [{
          type: 'text',
          text: 'The previous assistant message contained tool calls that were never executed and produced no results, so it was removed to keep the conversation valid. Restate the request if the work is still needed.',
        }],
      }),
      surfaceOp: { op: 'replace', start: event.seq, end },
      sourceEventSeqs: shadowed,
    })
    i = j
  }
  return replacements
}
