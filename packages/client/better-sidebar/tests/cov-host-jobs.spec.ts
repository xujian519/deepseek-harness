/**
 * Background-job route edge coverage: the tool-result text extractor's
 * malformed envelopes, the trace extractor's unrelated rows, the live mirror's
 * ring eviction (call identities dropped with evicted entries), the
 * store-log-without-session read, and a registry refusal carrying a non-Error.
 */
import { describe, expect, it, vi } from 'vitest'
import { buildJobsApi } from '../src/jobs-routes.ts'
import type { Context, SidebarSessionEvent } from '../src/context-types.ts'

/** A context serving the given services and session store. */
function ctxWith(sessions: unknown, jobs: unknown, agents: unknown, capture?: { on?: unknown }): Context {
  const ctx = {
    sessions,
    get: (key: string) => (key === 'jobs' ? jobs : key === 'agents' ? agents : undefined),
    on: (_event: string, fn: unknown) => {
      if (capture) capture.on = fn
      return () => {}
    },
    effect: (fn: () => unknown | (() => void)) => { fn() },
  }
  return ctx as unknown as Context
}

/** One tool/call event of any tool (arguments as given). */
function callEvent(seq: number, name: string, callId: string, args: unknown): SidebarSessionEvent {
  return { type: 'tool/call', seq, time: seq, data: { name, callId, arguments: args } }
}

/** One tool/result event with the given message envelope. */
function resultEvent(seq: number, message: unknown): SidebarSessionEvent {
  return { type: 'tool/result', seq, time: seq, data: { message } }
}

/** A job_output result whose single tool-result block carries `text`. */
function jobResult(seq: number, callId: string, text: string): SidebarSessionEvent {
  return resultEvent(seq, {
    source: { kind: 'tool', callId },
    content: [{ type: 'tool-result', isError: false, content: [{ type: 'text', text }] }],
  })
}

describe('jobs.output malformed envelopes', () => {
  it('ignores results whose content is missing, malformed, or textless', () => {
    const events: SidebarSessionEvent[] = [
      // Unrelated tool call: not part of any job pairing.
      callEvent(0, 'read_file', 'r1', { path: 'x' }),
      // A result with a non-array content.
      resultEvent(1, { source: { callId: 'r1' }, content: 'text' }),
      // A result whose blocks are null / non-tool-result / contentless / primitive.
      resultEvent(2, {
        source: { callId: 'r1' },
        content: [null, { type: 'text', text: 'nope' }, { type: 'tool-result' }, { type: 'tool-result', content: [null, { type: 'text', text: 5 }] }],
      }),
    ]
    const api = buildJobsApi(ctxWith({ get: () => ({ header: {}, events }) }, undefined, undefined), 4096)
    // Nothing readable for any job — the replay stays empty and unread.
    expect(api.output({ sessionId: 's1', id: 'any-job' })).toEqual({ text: '', truncated: false, read: false })
  })

  it('ignores call rows that are not job_output or carry malformed arguments', () => {
    const events: SidebarSessionEvent[] = [
      callEvent(0, 'job_output', 'no-args', undefined),
      callEvent(1, 'job_output', 'bad-args', 'not-json'),
      { type: 'tool/call', seq: 2, time: 2, data: { name: 'job_output' } },
      // An unrelated event type the mirror never traces.
      { type: 'user/message', seq: 3, time: 3, data: {} },
    ]
    const api = buildJobsApi(ctxWith({ get: () => ({ header: {}, events }) }, undefined, undefined), 4096)
    expect(api.output({ sessionId: 's1', id: 'bash-1' })).toEqual({ text: '', truncated: false, read: false })
  })

  it('ignores result rows without a message or a string callId', () => {
    const events: SidebarSessionEvent[] = [
      resultEvent(0, undefined),
      resultEvent(1, { content: [] }),
    ]
    const api = buildJobsApi(ctxWith({ get: () => ({ header: {}, events }) }, undefined, undefined), 4096)
    expect(api.output({ sessionId: 's1', id: 'bash-1' }).read).toBe(false)
  })

  it('reads against an unknown session store without failing', () => {
    const api = buildJobsApi(ctxWith({ get: () => undefined }, undefined, undefined), 4096)
    expect(api.output({ sessionId: 'ghost', id: 'bash-1' })).toEqual({ text: '', truncated: false, read: false })
  })

  it('drops evicted call identities when the mirror ring overflows', () => {
    const capture: { on?: (session: unknown, event: SidebarSessionEvent) => void } = {}
    const api = buildJobsApi(ctxWith({ get: () => ({ header: {}, events: [] }) }, undefined, undefined, capture), 4096)
    const emit = capture.on!
    const call = (seq: number, callId: string): SidebarSessionEvent =>
      callEvent(seq, 'job_output', callId, JSON.stringify({ job_id: 'bash-1' }))
    // 201 job_output calls for one session: the ring caps at 200 and evicts
    // the oldest call identity (c0) while the remaining identities stay.
    for (let seq = 0; seq < 201; seq += 1) emit({ id: 's1' }, call(seq, `c${seq}`))
    expect(api.output({ sessionId: 's1', id: 'bash-1' })).toEqual({ text: '', truncated: false, read: false })
    // The evicted c0's result is dropped; a result for a RETAINED call lands.
    emit({ id: 's1' }, jobResult(500, 'c0', 'never cached'))
    // Streaming one result per retained call evicts every remaining call
    // entry; the last eviction empties the identity set and drops the key.
    for (let seq = 0; seq < 200; seq += 1) emit({ id: 's1' }, jobResult(600 + seq, `c${seq + 1}`, 'drain'))
    // A result for a call whose identity set was dropped is no longer cached.
    emit({ id: 's1' }, jobResult(900, 'c200', 'identity gone'))
    // A fresh pair still reads end to end.
    emit({ id: 's1' }, call(1000, 'c-live'))
    emit({ id: 's1' }, jobResult(1001, 'c-live', 'fresh line'))
    expect(api.output({ sessionId: 's1', id: 'bash-1' })).toEqual({
      text: 'fresh line',
      truncated: false,
      read: true,
    })
  })

  it('ignores feed events whose session has no id and non-mirror events', () => {
    const capture: { on?: (session: unknown, event: SidebarSessionEvent) => void } = {}
    buildJobsApi(ctxWith({ get: () => undefined }, undefined, undefined, capture), 4096)
    const emit = capture.on!
    // No session id: dropped before tracing.
    emit(null, callEvent(0, 'job_output', 'c0', '{"job_id":"j"}'))
    // Unrelated event types: ignored.
    emit({ id: 's1' }, { type: 'turn/start', seq: 1, time: 1, data: {} } as SidebarSessionEvent)
  })
})

describe('jobs.kill refusals', () => {
  it('maps a non-Error registry refusal to a 404 job-error', () => {
    const jobs = { kill: vi.fn(() => { throw 'registry gone' }) }
    const api = buildJobsApi(ctxWith({ get: () => undefined }, jobs, undefined), 100)
    expect(() => api.kill({ sessionId: 's1', id: 'bash-1' })).toThrowError(
      expect.objectContaining({ code: 'job-error', status: 404, message: 'registry gone' }),
    )
  })
})
