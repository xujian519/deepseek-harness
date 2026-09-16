import { describe, expect, it, vi } from 'vitest'
import type { ChildToHost } from '../src/index.ts'
import { createFrameReader } from '../src/frame-reader.ts'
import { MAX_PENDING_CHUNKS } from '../src/output-ledger.ts'

// The reader is a pure byte-stream transform, so these cases feed it the exact
// byte sequences the real-subprocess suite can only reach by racing a child's
// writes: an oversized frame, an illegal UTF-8 byte, an unsafe integer token,
// malformed JSON, and the fragment-count seal.
interface Harness {
  push(chunk: Buffer): void
  readonly frames: ChildToHost[]
  oversizedCalls(): number
}

function harness(frameParseCapBytes = 1024): Harness {
  const frames: ChildToHost[] = []
  let oversized = 0
  const reader = createFrameReader({
    frameParseCapBytes,
    onFrame: (frame) => { frames.push(frame) },
    onOversized: () => { oversized += 1 },
  })
  return { push: (chunk) => { reader.push(chunk) }, frames, oversizedCalls: () => oversized }
}

/** `Buffer.concat` is the join primitive the reader must not reach on a rejected frame. */
function spyConcat() {
  return vi.spyOn(Buffer, 'concat')
}

describe('createFrameReader — fd-3 frame assembly', () => {
  it('emits a frame only once its newline arrives, across chunk boundaries', () => {
    const h = harness()
    h.push(Buffer.from('{"type":"log","te'))
    expect(h.frames).toEqual([])
    h.push(Buffer.from('xt":"hi"}\n'))
    expect(h.frames).toEqual([{ type: 'log', text: 'hi' }])
  })

  it('emits every frame in one chunk and carries the trailing partial line forward', () => {
    const h = harness()
    h.push(Buffer.from('{"type":"boot-ack"}\n{"type":"log","text":"a"}\n{"type":"log","te'))
    expect(h.frames).toEqual([{ type: 'boot-ack' }, { type: 'log', text: 'a' }])
    h.push(Buffer.from('xt":"b"}\n'))
    expect(h.frames).toEqual([{ type: 'boot-ack' }, { type: 'log', text: 'a' }, { type: 'log', text: 'b' }])
  })

  it('skips empty lines and keeps reading the frames around them', () => {
    const h = harness()
    h.push(Buffer.from('\n\n{"type":"boot-ack"}\n\n'))
    expect(h.frames).toEqual([{ type: 'boot-ack' }])
  })

  it('drops a line with an illegal UTF-8 byte and keeps reading the batch', () => {
    const h = harness()
    const illegal = Buffer.concat([Buffer.from('{"type":"log","text":"'), Buffer.from([0xff]), Buffer.from('"}\n')])
    h.push(Buffer.concat([illegal, Buffer.from('{"type":"boot-ack"}\n')]))
    expect(h.frames).toEqual([{ type: 'boot-ack' }])
  })

  it('drops a line whose integer token JSON.parse would silently round', () => {
    const h = harness()
    // 2**53 + 1 has no exact double, so the token is hostile traffic even
    // though the rebuilt frame would otherwise be a valid `call`.
    const rounded = '{"type":"call","id":9007199254740993,"global":"g","name":"n","args":{}}\n'
    h.push(Buffer.from(rounded + '{"type":"boot-ack"}\n'))
    expect(h.frames).toEqual([{ type: 'boot-ack' }])
  })

  it('drops a malformed line and keeps reading the batch', () => {
    const h = harness()
    h.push(Buffer.from('not json\n{"type":"boot-ack"}\n'))
    expect(h.frames).toEqual([{ type: 'boot-ack' }])
  })

  it('delivers later frames in the same batch after a done frame', () => {
    const h = harness()
    // The host's `done` arm settles the run; the reader keeps no settlement
    // state of its own, so the rest of the batch still reaches onFrame and the
    // host's own guard is what drops it.
    h.push(Buffer.from('{"type":"done","error":{"kind":"exception","message":"boom"}}\n{"type":"log","text":"late"}\n'))
    expect(h.frames.map(frame => frame.type)).toEqual(['done', 'log'])
  })
})

describe('createFrameReader — oversized frames settle through onOversized', () => {
  it('rejects a newline-free buffer past the cap without joining it', () => {
    const concat = spyConcat()
    const h = harness(8)
    h.push(Buffer.from('aaaa'))
    expect(h.oversizedCalls()).toBe(0)
    h.push(Buffer.from('bbbbb'))
    expect(h.oversizedCalls()).toBe(1)
    expect(h.frames).toEqual([])
    // The rejection returns before the join: copying the oversized buffer with
    // `Buffer.concat` is the peak-memory doubling this check exists to prevent.
    expect(concat).not.toHaveBeenCalled()
    concat.mockRestore()
  })

  it('rejects a newline-bearing chunk whose first frame is past the cap', () => {
    const concat = spyConcat()
    const h = harness(8)
    h.push(Buffer.from('aaaaaaaaaaaa\n'))
    expect(h.oversizedCalls()).toBe(1)
    expect(h.frames).toEqual([])
    expect(concat).not.toHaveBeenCalled()
    concat.mockRestore()
  })
})

describe('createFrameReader — fragment-count sealing', () => {
  it('seals a long newline-free run into one block per threshold and preserves the frame', () => {
    const concat = spyConcat()
    const h = harness(1 << 20)
    const pad = 'a'.repeat(MAX_PENDING_CHUNKS)
    // One byte per push: a run past the count bound, which the byte cap cannot
    // see because each chunk is a distinct Buffer with its own overhead.
    for (const byte of Buffer.from(`{"type":"log","text":"${pad}"}`)) h.push(Buffer.from([byte]))
    expect(h.frames).toEqual([])
    h.push(Buffer.from('\n'))
    expect(h.frames).toEqual([{ type: 'log', text: pad }])
    // Exactly two joins: one per seal at the count bound, then the single join
    // that assembles the blocks and the pending chunks into the line.
    expect(concat).toHaveBeenCalledTimes(2)
    concat.mockRestore()
  })
})
