/**
 * Upload write-path failure coverage: stream errors surface through the
 * promise chain (never crash the host), the end-callback failure path, the
 * post-end streamError check, and the failed-upload cleanup whose temp-file
 * removal itself fails. Real-fault tests use filesystem permissions; the
 * mid-write/end flush failures use a scripted createWriteStream because no
 * portable fault makes a healthy file descriptor fail mid-write.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeWorkspaceUpload } from '../src/fs-operations.ts'

/** The scripted failure the fake createWriteStream performs (null = behave normally). */
let script: 'write-error-after-first-chunk' | 'end-callback-error' | 'error-before-successful-end' | null = null

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    createWriteStream: vi.fn((path: string, options?: { flags?: string }) => {
      if (script === null) return actual.createWriteStream(path, options)
      const stream = new EventEmitter() as EventEmitter & {
        write: (buffer: Buffer) => boolean
        end: (cb?: (error?: Error | null) => void) => void
        destroy: () => void
      }
      let chunks = 0
      stream.write = (_buffer: Buffer): boolean => {
        chunks += 1
        if (script === 'write-error-after-first-chunk' && chunks === 1) {
          // The first write succeeds; the failure surfaces while the caller
          // awaits the next chunk — the post-write check must throw it.
          queueMicrotask(() => stream.emit('error', new Error('ENOSPC: simulated disk full')))
        }
        return true
      }
      stream.end = (cb?: (error?: Error | null) => void) => {
        if (script === 'end-callback-error') {
          cb?.(new Error('EIO: simulated flush failure'))
          return
        }
        if (script === 'error-before-successful-end') {
          stream.emit('error', new Error('ENOSPC: simulated tail failure'))
        }
        cb?.(null)
      }
      stream.destroy = () => {
        stream.emit('close')
      }
      return stream
    }),
  }
})

/** The shared real workspace for the permission-based tests. */
const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-upload-err-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** One-chunk body (the face the route receives). */
const chunksOf = (...parts: string[]): AsyncIterable<string | Uint8Array> => ({
  async *[Symbol.asyncIterator]() { for (const part of parts) yield part },
})

/** Leftover temp files under dir (cleanup must always remove them when possible). */
const leftovers = (dir: string): string[] => readdirSync(dir).filter(name => name.includes('.dsh-upload-'))

describe('upload stream failures', () => {
  it('rejects with the stream error when the write path is unwritable and cleans up', async () => {
    const dir = join(root, 'readonly')
    mkdirSync(dir)
    // The temp stream cannot even open (directory lost its write bit).
    chmodSync(dir, 0o500)
    try {
      await expect(writeWorkspaceUpload({
        cwd: root, dir, relativePath: 'file.txt', chunks: chunksOf('x'), limit: 1024,
      })).rejects.toThrow()
      expect(leftovers(dir)).toEqual([])
    } finally {
      chmodSync(dir, 0o700)
    }
  })

  it('rejects when the rename fails and temp removal fails too', async () => {
    const dir = join(root, 'rename-fail')
    mkdirSync(dir)
    // First chunk opens the temp file while the directory is still writable;
    // the directory then loses its write bit, so rename AND unlink both fail
    // (EACCES) and the original failure must still be thrown.
    const body = (async function* () {
      yield 'a'
      await new Promise(resolve => setTimeout(resolve, 50))
      chmodSync(dir, 0o500)
      yield 'b'
    })()
    try {
      await expect(writeWorkspaceUpload({
        cwd: root, dir, relativePath: 'file.txt', chunks: body, limit: 1024,
      })).rejects.toThrow()
    } finally {
      chmodSync(dir, 0o700)
      // Cleanup is best-effort: the unlink ran while the directory was still
      // read-only and failed, so the temp file survives; the original rename
      // error is what the caller saw.
      expect(leftovers(dir)).toHaveLength(1)
    }
  })

  it('surfaces a mid-write stream error through the post-write check', async () => {
    script = 'write-error-after-first-chunk'
    try {
      await expect(writeWorkspaceUpload({
        cwd: root, dir: root, relativePath: 'simulated.txt', chunks: chunksOf('a', 'b'), limit: 1024,
      })).rejects.toThrow('ENOSPC: simulated disk full')
      expect(leftovers(root)).toEqual([])
    } finally {
      script = null
    }
  })

  it('surfaces an end-callback flush failure', async () => {
    script = 'end-callback-error'
    try {
      await expect(writeWorkspaceUpload({
        cwd: root, dir: root, relativePath: 'simulated.txt', chunks: chunksOf('a'), limit: 1024,
      })).rejects.toThrow('EIO: simulated flush failure')
    } finally {
      script = null
    }
  })

  it('throws the recorded stream error when the end callback succeeds', async () => {
    script = 'error-before-successful-end'
    try {
      await expect(writeWorkspaceUpload({
        cwd: root, dir: root, relativePath: 'simulated.txt', chunks: chunksOf('a'), limit: 1024,
      })).rejects.toThrow('ENOSPC: simulated tail failure')
    } finally {
      script = null
    }
  })
})

describe('upload target shapes that fail at rename', () => {
  let target: string
  beforeAll(() => {
    target = join(root, 'occupied')
    mkdirSync(target)
  })

  it('refuses to clobber an existing directory and leaves no temp file', async () => {
    writeFileSync(join(target, 'keep.txt'), 'x')
    // rename(file, existing-directory) fails (EISDIR); the raw fs error is
    // rethrown after cleanup.
    await expect(writeWorkspaceUpload({
      cwd: root, dir: root, relativePath: 'occupied', chunks: chunksOf('x'), limit: 1024,
    })).rejects.toThrow()
    // The directory content is untouched.
    expect(existsSync(join(target, 'keep.txt'))).toBe(true)
    expect(leftovers(root)).toEqual([])
  })
})
