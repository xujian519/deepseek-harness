// @vitest-environment jsdom
/**
 * Produced-file reads over the `workspaceFiles` Remote: the bounded preview
 * window, the complete print read, the strict decode of a raw byte window, and
 * what each failure reports.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceByteReadOptions, WorkspaceFileBytes } from '@deepseek-ai/dsh-api-workspace-files/types'
import { describe, expect, it, vi } from 'vitest'
import { createFileReads, decodeByteWindow } from '../src/client/file-reads.ts'
import type { WorkspaceFilesRemote } from '../src/client/file-reads.ts'

const SESSION = 's1' as SessionId

/** One host byte window over an explicit byte sequence. */
function byteWindow(bytes: readonly number[], eof: boolean): WorkspaceFileBytes {
  return {
    absolutePath: '/w/out/index.html',
    version: 'v1',
    bytes: bytes.length,
    offset: 0,
    data: new Uint8Array(bytes),
    eof,
  }
}

/** One host failure, as the Remote face delivers it. */
function hostFailure(code: string, message: string, details: Readonly<Record<string, string | number>> = {}): RemoteResult<never> {
  return { ok: false, error: { code, message, details } } as unknown as RemoteResult<never>
}

/** A scripted Remote face whose one read answers by call shape: a ranged request gets the window, an absent range the complete result. */
function remoteFace(
  window: RemoteResult<WorkspaceFileBytes>,
  complete: RemoteResult<WorkspaceFileBytes> = window,
): { remote: WorkspaceFilesRemote; readBytes: ReturnType<typeof vi.fn> } {
  const readBytes = vi.fn(
    (_sessionId: SessionId, _path: string, options: WorkspaceByteReadOptions) =>
      Promise.resolve(options.range === undefined ? complete : window),
  )
  return { remote: { readBytes }, readBytes }
}

const resolve = (path: string): string => `/w/${path}`

describe('decodeByteWindow', () => {
  it('decodes a complete window and reports it as complete', () => {
    expect(decodeByteWindow(byteWindow([0x68, 0x69], true))).toEqual({ content: 'hi', truncated: false })
  })

  it('drops the continuation bytes of a character the window cut in half', () => {
    // 'a' plus the first byte of 'é' (0xc3 0xa9): the head stays decodable.
    expect(decodeByteWindow(byteWindow([0x61, 0xc3], false))).toEqual({ content: 'a', truncated: true })
  })

  it('keeps a trailing character the window ends on', () => {
    expect(decodeByteWindow(byteWindow([0x61, 0xc3, 0xa9], false))).toEqual({ content: 'aé', truncated: true })
  })

  it('throws for bytes that are not UTF-8 instead of decoding replacement glyphs', () => {
    expect(() => decodeByteWindow(byteWindow([0xff, 0xfe], true))).toThrow()
  })
})

describe('createFileReads', () => {
  it('reads the preview window through the host cap and reports truncation', async () => {
    const { remote, readBytes } = remoteFace({ ok: true, value: byteWindow([0x68, 0x69], false) })
    const reads = createFileReads(remote, SESSION, resolve)
    await expect(reads.readFileText('out/index.html')).resolves.toEqual({ content: 'hi', truncated: true })
    // No window length travels: the Host's configured cap is the budget.
    expect(readBytes).toHaveBeenCalledWith(SESSION, '/w/out/index.html', { range: {} })
    expect(readBytes).toHaveBeenCalledTimes(1)
  })

  it('reports a window failure with the host message', async () => {
    const { remote } = remoteFace(hostFailure('gateway/bad-request', 'no such file'))
    await expect(createFileReads(remote, SESSION, resolve).readFileText('out/missing.md'))
      .rejects.toThrow('no such file')
  })

  it('names the path it could not decode', async () => {
    const { remote } = remoteFace({ ok: true, value: byteWindow([0xff], true) })
    await expect(createFileReads(remote, SESSION, resolve).readFileText('out/broken.md'))
      .rejects.toThrow('not valid UTF-8: out/broken.md')
  })

  it('reads the complete file for print', async () => {
    const { remote, readBytes } = remoteFace({ ok: true, value: byteWindow([0x46, 0x55, 0x4c, 0x4c], true) })
    const reads = createFileReads(remote, SESSION, resolve)
    await expect(reads.readFileTextComplete('out/index.html')).resolves.toEqual({ content: 'FULL', truncated: false })
    // An absent range is the complete read: one call, no window request.
    expect(readBytes).toHaveBeenCalledWith(SESSION, '/w/out/index.html', {})
    expect(readBytes).toHaveBeenCalledTimes(1)
  })

  it('carries the host cap out of a full-file refusal, so the studio names no size of its own', async () => {
    const { remote } = remoteFace(hostFailure('workspace-file/too-large', 'exceeds the cap', { path: 'out/huge.html', limit: 32 * 1024 * 1024 }))
    await expect(createFileReads(remote, SESSION, resolve).readFileTextComplete('out/huge.html'))
      .resolves.toEqual({ truncated: true, limitBytes: 32 * 1024 * 1024 })
  })

  it('reports any other complete-read failure as an error', async () => {
    const { remote } = remoteFace(hostFailure('gateway/bad-request', 'not a regular file'))
    await expect(createFileReads(remote, SESSION, resolve).readFileTextComplete('out/dir.html'))
      .rejects.toThrow('not a regular file')
  })
})
