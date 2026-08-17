/**
 * Session projection unit that folds the durable session event stream into a
 * failure-pattern state tree. Each pattern carries a monotonic occurrence
 * counter, its last-occurrence seq, and supporting verifier seqs so proposals
 * can cite concrete evidence without re-scanning the full log.
 *
 * Pattern identity strictly follows the Self-Harness paper definition: a
 * pattern is keyed on `(level, verifierTier, causalSignature)`, not the
 * free-form summary. The summary is a human-facing rendering only.
 *
 * @module @deepseek-ai/dsh-self-evolve/failure-projection
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { EvolveLevel, FailurePattern } from './types.ts'

/** Projection-unit key registered under `ctx.sessionProjections`. */
export const FAILURE_PATTERNS_PROJECTION_KEY = 'failure-patterns'

type VerifierTier = FailurePattern['verifierTier']

const failurePatternSchema = z.object({
  patternId: z.string(),
  verifierTier: z.enum(['tool-runtime', 'subprocess-exit', 'llm-provider', 'agent-loop']),
  causalSignature: z.string(),
  level: z.enum(['L1-skill', 'L2-context', 'L3-workflow', 'L4-harness']),
  summary: z.string(),
  supportingSeqs: z.array(z.number().int().nonnegative()),
  occurrences: z.number().int().positive(),
  verifierMeta: z.record(z.string(), z.unknown()),
}).strict()

const failurePatternsStateSchema = z.object({
  patterns: z.record(z.string(), failurePatternSchema),
  discoveryOrder: z.array(z.string()),
  lastMinedSeq: z.number().int().nonnegative(),
  /** Recent `tool/call` identities (callId → name), so `tool/result` classification can name its tool. */
  toolCalls: z.record(z.string(), z.object({ name: z.string(), seq: z.number().int().nonnegative() })),
}).strict()

/** Durable folded state — one copy per session, projected incrementally. */
export type FailurePatternsState = z.infer<typeof failurePatternsStateSchema>

/** Upper bound on tracked tool-call identities; older entries are pruned on fold. */
const MAX_TRACKED_TOOL_CALLS = 64

type ClassifiedFailure = {
  level: EvolveLevel
  verifierTier: VerifierTier
  causalSignature: string
  summary: string
  verifierMeta: Record<string, unknown>
}

function toNarrowLevel(tier: VerifierTier): EvolveLevel {
  switch (tier) {
    case 'subprocess-exit':
    case 'tool-runtime':
      return 'L1-skill'
    case 'llm-provider':
      return 'L2-context'
    case 'agent-loop':
      return 'L4-harness'
  }
}

const B32_CHARS = 'abcdefghijklmnopqrstuvwxyz234567'

function sha1Base32(input: string): string {
  const digest = createHash('sha1').update(input).digest()
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
  let out = ''
  let buffer = 0
  let bits = 0
  for (let i = 0; i < view.byteLength; i++) {
    buffer = (buffer << 8) | view.getUint8(i)
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += B32_CHARS[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) out += B32_CHARS[(buffer << (5 - bits)) & 31]
  return out
}

/** Join the text blocks of a content list into one plain-text surface. */
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ) {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n')
}

/** One verifier-grounded shell failure parsed from rendered tool-result text. */
type ShellFailureMark =
  | { kind: 'exit'; exitCode: number; signature: string; stderrPrefix: string }
  | { kind: 'signal'; signal: string; signature: string; stderrPrefix: string }

function shellSignature(text: string, markerIndex: number, detail: string): { signature: string; stderrPrefix: string } {
  const body = text.slice(0, markerIndex)
  const stderr = /\[stderr\]\n([\s\S]*)$/.exec(body)?.[1] ?? body
  const stderrPrefix = stderr.slice(0, 200)
  return { signature: `${detail}:${stderrPrefix}`, stderrPrefix }
}

/**
 * Parse the shell renderer's failure markers from a tool-result text. Only
 * markers that end the rendered text count, matching the renderer's own
 * layout; an `[exit code: 0]` marker is a successful exit, not a failure.
 */
function parseShellMarkers(text: string): ShellFailureMark | null {
  const exit = /(?:^|\n)\[exit code: (\d+)\]$/.exec(text)
  if (exit !== null && Number(exit[1]) !== 0) {
    return { kind: 'exit', exitCode: Number(exit[1]), ...shellSignature(text, exit.index, `exit=${exit[1]}`) }
  }
  const signal = /(?:^|\n)\[killed by signal: ([A-Z0-9]+)\]$/.exec(text)
  if (signal !== null) {
    const signalName = signal[1]
    if (signalName === undefined) return null
    return { kind: 'signal', signal: signalName, ...shellSignature(text, signal.index, `signal=${signalName}`) }
  }
  return null
}

/**
 * Classify a session event into a verifier-grounded failure signal. The
 * classifier is deliberately conservative: only explicit failure surfaces
 * produce a pattern, so silent bugs are never mis-attributed as solved.
 *
 * Verifier tier semantics (weakest → strongest):
 *   - `tool-runtime` — fallback layer; only a generic `error.name` or free
 *     text is available. Thresholds are lifted by one in the provider.
 *   - `subprocess-exit` — shell/bash tools whose rendered `tool/result` text
 *     carries a `[exit code: N]` or `[killed by signal: …]` marker; the
 *     signature is the marker plus the stderr prefix.
 *   - `llm-provider` — request errors surfaced by the LLM service adapter;
 *     signature is `error.code` or numeric `statusCode`.
 *   - `agent-loop` — self-evolve loop failures themselves; signature is
 *     `error.name`.
 *
 * @param event - the durable session event to classify.
 * @param toolName - resolved tool name for `tool/result` events, from the
 *   paired `tool/call` identity; omitted when the pairing is unknown.
 */
function classifyFailure(event: SessionEvent, toolName?: string): ClassifiedFailure | null {
  const type = event.type as string
  switch (type) {
    case 'tool/result': {
      const data = event.data as { message?: { content?: unknown; toolCallId?: unknown } | null; error?: unknown }
      const message = data.message
      if (message === undefined || typeof message !== 'object' || message === null) return null
      const text = extractText(message.content)
      const shell = parseShellMarkers(text)
      if (shell !== null) {
        const detail = shell.kind === 'exit' ? `exit=${shell.exitCode}` : `signal=${shell.signal}`
        return {
          level: 'L1-skill',
          verifierTier: 'subprocess-exit',
          causalSignature: shell.signature,
          summary: `tool ${toolName ?? 'unknown-tool'} ${detail}`,
          verifierMeta: {
            tool: toolName,
            ...(shell.kind === 'exit' ? { exitCode: shell.exitCode } : { signal: shell.signal }),
            stderrPrefix: shell.stderrPrefix,
          },
        }
      }
      const errorData = data.error
      if (errorData !== undefined) {
        const rawName = (errorData as { name?: unknown } | undefined)?.name
        const name = typeof rawName === 'string' && rawName.length > 0 ? rawName : 'generic-error'
        return {
          level: toNarrowLevel('tool-runtime'),
          verifierTier: 'tool-runtime',
          causalSignature: name,
          summary: `tool ${toolName ?? 'unknown-tool'} error: ${name}`,
          verifierMeta: { tool: toolName, error: errorData, text },
        }
      }
      return null
    }
    case 'agent/request-error': {
      const data = event.data as { provider?: unknown; model?: unknown; error?: unknown; statusCode?: unknown }
      const err = data.error as { code?: unknown; name?: unknown } | undefined
      const code = typeof err?.code === 'string' && err.code.length > 0 ? err.code : undefined
      const status = typeof data.statusCode === 'number' ? String(data.statusCode) : undefined
      const name = typeof err?.name === 'string' && err.name.length > 0 ? err.name : undefined
      const causalSignature = code ?? status ?? name ?? 'unknown-request-error'
      return {
        level: 'L2-context',
        verifierTier: 'llm-provider',
        causalSignature,
        summary: 'llm request failed after retries',
        verifierMeta: { provider: data.provider, model: data.model, code, status, name, error: data.error },
      }
    }
    case 'compaction/end': {
      const data = event.data as { error?: unknown }
      const error = data.error
      if (error === undefined) return null
      const errName = (error as { name?: unknown } | undefined)?.name
      return {
        level: 'L2-context',
        verifierTier: 'tool-runtime',
        causalSignature: typeof errName === 'string' && errName.length > 0 ? errName : 'compaction-error',
        summary: 'compaction did not finish cleanly',
        verifierMeta: { error },
      }
    }
    case 'self-evolve/end': {
      const raw = (event.data as { error?: unknown }).error
      if (raw === undefined || raw === null || raw === '') return null
      const errName = (raw as { name?: unknown } | undefined)?.name
      const text = typeof raw === 'string' ? raw : undefined
      const causalSignature = typeof errName === 'string' && errName.length > 0
        ? errName
        : (text?.slice(0, text.indexOf(':')) || text || 'self-evolve-error')
      return {
        level: 'L4-harness',
        verifierTier: 'agent-loop',
        causalSignature,
        summary: 'prior self-evolve loop failed',
        verifierMeta: { error: raw },
      }
    }
    default:
      return null
  }
}

function foldEventSync(state: FailurePatternsState, id: string, signal: ClassifiedFailure, seq: number): FailurePatternsState {
  const existing = state.patterns[id]
  if (existing === undefined) {
    const pattern: FailurePattern = {
      patternId: id,
      verifierTier: signal.verifierTier,
      causalSignature: signal.causalSignature,
      level: signal.level,
      summary: signal.summary,
      supportingSeqs: [seq],
      occurrences: 1,
      verifierMeta: signal.verifierMeta,
    }
    return {
      patterns: { ...state.patterns, [id]: pattern },
      discoveryOrder: [...state.discoveryOrder, id],
      lastMinedSeq: seq,
      toolCalls: state.toolCalls,
    }
  }
  const supportingSeqs = existing.supportingSeqs.includes(seq)
    ? existing.supportingSeqs
    : [...existing.supportingSeqs, seq].slice(-8)
  const merged: FailurePattern = {
    ...existing,
    supportingSeqs,
    occurrences: existing.occurrences + 1,
    verifierMeta:
      signal.verifierMeta !== undefined ? { ...existing.verifierMeta, ...signal.verifierMeta } : existing.verifierMeta,
  }
  return {
    patterns: { ...state.patterns, [id]: merged },
    discoveryOrder: state.discoveryOrder,
    lastMinedSeq: seq,
    toolCalls: state.toolCalls,
  }
}

/** Record one `tool/call` identity so its `tool/result` can be named. */
function foldToolCall(state: FailurePatternsState, event: SessionEvent): FailurePatternsState {
  const data = event.data as { callId?: unknown; name?: unknown }
  const callId = typeof data.callId === 'string' && data.callId.length > 0 ? data.callId : null
  if (callId === null) return state
  const name = typeof data.name === 'string' && data.name.length > 0 ? data.name : 'unknown-tool'
  const existing = state.toolCalls[callId]
  if (existing !== undefined && existing.name === name && existing.seq === event.seq) return state
  const toolCalls = { ...state.toolCalls, [callId]: { name, seq: event.seq } }
  const keys = Object.keys(toolCalls)
  if (keys.length > MAX_TRACKED_TOOL_CALLS) {
    let oldestKey: string | undefined
    let oldestSeq = Number.POSITIVE_INFINITY
    for (const key of keys) {
      const entry = toolCalls[key]
      if (entry !== undefined && entry.seq < oldestSeq) {
        oldestSeq = entry.seq
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) {
      const pruned: Record<string, { name: string; seq: number }> = {}
      for (const key of keys) {
        const entry = toolCalls[key]
        if (entry !== undefined && key !== oldestKey) pruned[key] = entry
      }
      return { ...state, toolCalls: pruned }
    }
  }
  return { ...state, toolCalls }
}

/** Resolve the tool name for a `tool/result` event from its paired call. */
function toolNameFor(state: FailurePatternsState, event: SessionEvent): string | undefined {
  if (event.type !== 'tool/result') return undefined
  const callId = (event.data as { message?: { toolCallId?: unknown } | null }).message?.toolCallId
  if (typeof callId !== 'string') return undefined
  return state.toolCalls[callId]?.name
}

/**
 * Fold one event into the projection state. Returns a new state object on
 * change; returns the same reference when the event is not classified.
 *
 * @param state - current projection state.
 * @param event - durable session event to classify and fold.
 * @returns the updated state, or the same reference when the event is not classified.
 */
export function foldEvent(state: FailurePatternsState, event: SessionEvent): FailurePatternsState {
  if (event.type === 'tool/call') return foldToolCall(state, event)
  if (event.type === 'self-evolve/reflection') return foldReflection(state, event)
  const signal = classifyFailure(event, toolNameFor(state, event))
  if (signal === null) return state
  const digest = sha1Base32(`${signal.verifierTier}:${signal.causalSignature}`)
  const id = `${signal.level}:${digest}`
  return foldEventSync(state, id, signal, event.seq)
}

/** Fold one `self-evolve/reflection` event as extra evidence for an existing pattern. */
function foldReflection(state: FailurePatternsState, event: SessionEvent): FailurePatternsState {
  const data = event.data as { patternId?: unknown }
  const patternId = typeof data.patternId === 'string' ? data.patternId : null
  if (patternId === null) return state
  const existing = state.patterns[patternId]
  if (existing === undefined) return state
  const supportingSeqs = existing.supportingSeqs.includes(event.seq)
    ? existing.supportingSeqs
    : [...existing.supportingSeqs, event.seq].slice(-8)
  return {
    patterns: { ...state.patterns, [patternId]: { ...existing, supportingSeqs, occurrences: existing.occurrences + 1 } },
    discoveryOrder: state.discoveryOrder,
    lastMinedSeq: state.lastMinedSeq,
    toolCalls: state.toolCalls,
  }
}

/**
 * Registered ProjectionDefinition. `stateVersion` is bumped to `3` from the
 * original `1` because FailurePattern grew two required shape fields
 * (`verifierTier`, `causalSignature`; v2) and the state added the `toolCalls`
 * identity map (v3); both break deserialization of older states.
 */
export const failurePatternsProjectionDefinition: ProjectionDefinition<typeof FAILURE_PATTERNS_PROJECTION_KEY, FailurePatternsState> = {
  key: FAILURE_PATTERNS_PROJECTION_KEY,
  schema: failurePatternsStateSchema,
  init: () => ({ patterns: {}, discoveryOrder: [], lastMinedSeq: 0, toolCalls: {} }),
  apply: (state, event) => foldEvent(state, event),
  view: state => ({
    patterns: state.patterns,
    discoveryOrder: state.discoveryOrder,
    lastMinedSeq: state.lastMinedSeq,
  }),
  stateVersion: 3,
}
