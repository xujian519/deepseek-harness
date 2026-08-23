/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock ONLY the two failure-prone fs operations; everything else stays real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  }
})

import { readFile, rename, writeFile } from 'node:fs/promises'
import { StateStore } from '../src/state.ts'

const IDENTITY = { endpoint: 'http://127.0.0.1:1934', account: '', user: '', agentId: 'dsh' }
const renameMock = rename as ReturnType<typeof vi.fn>
const writeFileMock = writeFile as ReturnType<typeof vi.fn>

let tempDir: string | undefined

async function dir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'ov-qs-'))
  return tempDir
}

afterEach(async () => {
  vi.restoreAllMocks()
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('StateStore failure paths', () => {
  it('quarantines even when the rename refuses', async () => {
    const d = await dir()
    const file = join(d, 'state.json')
    await writeFile(file, '{bad json')
    renameMock.mockRejectedValueOnce(new Error('read-only fs'))
    const { store, quarantined } = await StateStore.open(file, IDENTITY)
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]!.issue).toBe('corrupt')
    expect(store.session('x')).toBeNull()
  })

  it('survives a write failure and keeps serving from memory', async () => {
    const d = await dir()
    const file = join(d, 'state.json')
    const { store } = await StateStore.open(file, IDENTITY)
    writeFileMock.mockRejectedValueOnce(new Error('disk full'))
    await store.recordSent('dsh-s1', 1)
    expect(store.session('dsh-s1')!.sentSeqs).toEqual([1])
    // The chain continues: a subsequent write attempts again.
    await store.recordSent('dsh-s1', 2)
    expect(store.session('dsh-s1')!.sentSeqs).toEqual([1, 2])
    const { store: reloaded } = await StateStore.open(file, IDENTITY)
    expect(reloaded.session('dsh-s1')!.sentSeqs).toEqual([1, 2])
  })

  it('propagates non-ENOENT read errors instead of silently resetting', async () => {
    const d = await dir()
    await writeFile(join(d, 'notadir'), 'i am a file')
    await expect(StateStore.open(join(d, 'notadir', 'state.json'), IDENTITY)).rejects.toThrow()
    await expect(readFile(join(d, 'missing'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
