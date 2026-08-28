/**
 * Transcript mapping coverage round (src/client/sidechat-transcript.ts):
 * the degenerate inputs the happy-path specs never feed it — malformed
 * content blocks in `blockText` and tool results, a log with no seed marker,
 * empty legacy boundary bodies, malformed chunk payloads, settled messages
 * with reasoning blocks and non-text blocks, stale streaming indexes after a
 * shrink-splice, and tool rows whose pairing was invalidated the same way.
 */
import { describe, expect, it } from 'vitest'
import type { SidebarHistoryEntry, SidebarSessionEvent } from '../src/context-types.ts'
import { SIDE_BOUNDARY_PROMPT } from '../src/sidechat-core.ts'
import { blockText, collectOwnEvents, toolArgsSummary, transcriptRows, type SidechatTranscriptRow } from '../src/client/sidechat-transcript.ts'

function entry(event: SidebarSessionEvent): SidebarHistoryEntry {
  return { event }
}

function ev(type: string, seq: number, data: Record<string, unknown> = {}): SidebarSessionEvent {
  const event: SidebarSessionEvent = { type, seq, time: seq * 1000, data }
  if (type === 'user/message' || type === 'assistant/message' || type === 'tool/result') {
    return { ...event, surfaceOp: 'append' } as SidebarSessionEvent
  }
  return event
}

describe('blockText degenerate content', () => {
  it('skips null and primitive blocks, and non-text blocks', () => {
    expect(blockText([null, 42, { type: 'image', url: 'x' }, { type: 'text', text: 'a' }])).toBe('a')
  })

  it('renders the ellipsis placeholder for nothing usable', () => {
    expect(blockText([])).toBe('…')
    expect(blockText([{ type: 'text', text: 5 }])).toBe('…')
  })
})

describe('toolArgsSummary leftovers', () => {
  it('falls through to the raw flattened text for a JSON array or scalar body', () => {
    expect(toolArgsSummary('[1,2,3]')).toBe('[1,2,3]')
    expect(toolArgsSummary('42')).toBe('42')
  })
})

describe('transcriptRows malformed input handling', () => {
  it('maps everything when the log carries no end-seed marker', () => {
    const rows = transcriptRows([
      entry(ev('user/message', 0, { content: [{ type: 'text', text: 'legacy q' }], source: { kind: 'user' } })),
    ])
    expect(rows).toEqual([{ kind: 'user', seq: 0, text: 'legacy q' }])
  })

  it('renders a user message without a content array as the ellipsis row', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('user/message', 1, { source: { kind: 'user' } })),
    ])
    expect(rows).toEqual([{ kind: 'user', seq: 1, text: '…' }])
  })

  it('keeps only the injection row when the legacy boundary body is empty', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('user/message', 1, {
        content: [{ type: 'text', text: `${SIDE_BOUNDARY_PROMPT}\n\n` }],
        source: { kind: 'user' },
      })),
    ])
    expect(rows).toEqual([{ kind: 'injection', seq: 1, text: SIDE_BOUNDARY_PROMPT }])
  })

  it('ignores malformed chunk payloads (non-object, unknown kind, empty text)', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('assistant/chunk', 1, { turn: 1, step: 1, chunk: 'nope' })),
      entry(ev('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'tool-call', index: 0 } })),
      entry(ev('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '' } })),
    ])
    expect(rows).toEqual([])
  })

  it('settles a message carrying reasoning, text, and non-text blocks', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('assistant/message', 1, {
        turn: 1, step: 1,
        message: {
          content: [
            { type: 'reasoning', text: 'because' },
            { type: 'tool-use', id: 't' },
            { type: 'text', text: 'answer' },
            null,
            { type: 'text', text: '' },
          ],
        },
      })),
    ])
    expect(rows).toEqual([
      { kind: 'reasoning', seq: 1, text: 'because', settled: true },
      { kind: 'assistant', seq: 1, text: 'answer', settled: true },
    ])
  })

  it('settles an assistant message without any message content (streams are dropped)', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' } })),
      entry(ev('assistant/message', 2, { turn: 1, step: 1 })),
    ])
    expect(rows).toEqual([])
  })

  it('appends a settled message that had no streaming rows', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('assistant/message', 1, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'cold' }] } })),
    ])
    expect(rows).toEqual([{ kind: 'assistant', seq: 1, text: 'cold', settled: true }])
  })

  it('a late chunk for a superseded (stale-index) stream row does not corrupt the settled text', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      // Turn 1 streams two blocks; turn 2 streams one reasoning block.
      entry(ev('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } })),
      entry(ev('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'b' } })),
      entry(ev('assistant/chunk', 3, { turn: 2, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'hmm' } })),
      // Turn 1 settles into ONE row: the splice shifts turn 2's stream row,
      // whose cached index now points at the settled assistant text.
      entry(ev('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'ab' }] } })),
      // The stale turn 2 key must not append "more" onto the settled row.
      entry(ev('assistant/chunk', 5, { turn: 2, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: ' more' } })),
    ])
    const assistant = rows.find(row => row.kind === 'assistant') as Extract<SidechatTranscriptRow, { kind: 'assistant' }>
    expect(assistant.text).toBe('ab')
    // The stale guard (row index no longer a live unsettled stream row)
    // swallowed the late delta instead of corrupting the settled text.
    const reasoning = rows.filter(row => row.kind === 'reasoning') as Array<Extract<SidechatTranscriptRow, { kind: 'reasoning' }>>
    expect(reasoning.map(row => row.text)).toEqual(['hmm'])
  })

  it('settling one turn leaves another turn\'s stream rows in the accumulation map', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('assistant/chunk', 1, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'one' } })),
      entry(ev('assistant/chunk', 2, { turn: 2, step: 1, chunk: { type: 'text-delta', index: 0, text: 'two' } })),
      entry(ev('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'one!' }] } })),
    ])
    expect(rows.map(row => row.kind === 'assistant' ? (row as Extract<SidechatTranscriptRow, { kind: 'assistant' }>).text : '')).toEqual(['one!', 'two'])
  })
})

describe('transcriptRows tool rows', () => {
  it('a result whose inner content carries nothing usable still closes the call', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/call', 1, { callId: 'c1', name: 'read' })),
      entry(ev('tool/result', 2, {
        // No message content at all: resultTextOf bails before scanning.
        message: { source: { kind: 'tool', callId: 'c1' } },
      })),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'tool', name: 'read', executing: false, failed: false, resultText: undefined })
  })

  it('a result with malformed content shapes still closes the call', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/call', 1, { callId: 'c1', name: 'read' })),
      entry(ev('tool/result', 2, {
        message: {
          source: { kind: 'tool', callId: 'c1' },
          // Every malformed shape resultTextOf guards against.
          content: [
            null,
            'plain string',
            { type: 'text', text: 'not a tool-result' },
            { type: 'tool-result', content: 'not-an-array' },
            { type: 'tool-result', content: [null, { type: 'image', url: 'x' }, { type: 'text', text: 7 }] },
          ],
        },
      })),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'tool', name: 'read', executing: false, failed: false, resultText: undefined })
  })

  it('degrades unnamed calls and unparsable call ids', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/call', 1, { name: 42, arguments: 42 })),
    ])
    expect(rows).toEqual([{ kind: 'tool', seq: 1, name: 'tool', failed: false, args: undefined, executing: true }])
  })

  it('a result with a text body but no callId surfaces an anonymous orphan row', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/result', 1, {
        message: { source: { kind: 'tool' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'alone' }] }] },
      })),
    ])
    expect(rows).toEqual([{ kind: 'tool', seq: 1, name: 'tool', failed: false, resultText: 'alone' }])
  })

  it('a silent orphan result (no failure, no text) renders nothing', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/result', 1, { message: { source: { kind: 'tool', callId: 'lost' }, content: [] } })),
    ])
    expect(rows).toEqual([])
  })

  it('a failed result without text renders the truncated-id orphan row without a body', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/result', 1, {
        error: { name: 'EACCES' },
        message: { source: { kind: 'tool', callId: 'deadbeef1234' }, content: [] },
      })),
    ])
    expect(rows).toEqual([{ kind: 'tool', seq: 1, name: 'tool:deadbeef', failed: true, resultText: undefined }])
  })

  it('a paired result invalidated by the settle-splice does not clobber a text row', () => {
    const rows = transcriptRows([
      entry(ev('session/end-seed', 0)),
      entry(ev('tool/call', 1, { callId: 'c1', name: 'read' })),
      entry(ev('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } })),
      entry(ev('assistant/chunk', 3, { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'y' } })),
      entry(ev('tool/call', 4, { callId: 'c2', name: 'bash' })),
      // Two streamed rows settle into one → the c2 call row shifts left onto
      // the settled assistant row.
      entry(ev('assistant/message', 5, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'xy' }] } })),
      entry(ev('tool/result', 6, {
        message: { source: { kind: 'tool', callId: 'c2' }, content: [{ type: 'tool-result', content: [{ type: 'text', text: 'out' }] }] },
      })),
    ])
    const bash = rows.find(row => row.kind === 'tool' && (row as Extract<SidechatTranscriptRow, { kind: 'tool' }>).name === 'bash') as Extract<SidechatTranscriptRow, { kind: 'tool' }>
    // The stale index guard skipped the clobbered row: the call keeps its
    // executing state instead of painting the assistant row as a tool row.
    expect(bash.executing).toBe(true)
    const assistant = rows.find(row => row.kind === 'assistant') as Extract<SidechatTranscriptRow, { kind: 'assistant' }>
    expect(assistant.text).toBe('xy')
  })
})

describe('collectOwnEvents overlap page', () => {
  it('stops with boundary 0 when a page adds nothing older (overlapping window)', async () => {
    const entries = (seqs: number[]): SidebarHistoryEntry[] =>
      seqs.map(seq => entry(ev('assistant/chunk', seq, { turn: 1, step: 1 })))
    const pages = [entries([5, 6, 7]), entries([5, 6, 7])]
    const result = await collectOwnEvents(async () => pages.shift() ?? [])
    expect(result.seedBoundary).toBe(0)
    expect(result.entries.map(e => e.event.seq)).toEqual([5, 6, 7])
  })
})
