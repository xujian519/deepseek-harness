
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { StateStore, expandStateFile, identityHash } from '../src/state.ts'

const IDENTITY = { endpoint: 'http://127.0.0.1:1934', account: '', user: '', agentId: 'dsh' }

let tempDir: string | undefined

async function tempDirName(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'ov-state-'))
  return tempDir
}

afterEach(async () => {
  if (tempDir !== undefined) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('StateStore', () => {
  it('creates an empty snapshot for a missing file', async () => {
    const dir = await tempDirName()
    const { store, quarantined } = await StateStore.open(join(dir, 'state.json'), IDENTITY)
    expect(store.session('dsh-s1')).toBeNull()
    expect(store.sessions()).toEqual([])
    expect(quarantined).toEqual([])
    expect(store.identity).toBe(identityHash(IDENTITY))
  })

  it('persists bookkeeping and reloads it', async () => {
    const dir = await tempDirName()
    const file = join(dir, 'state.json')
    const { store: first } = await StateStore.open(file, IDENTITY)
    await first.recordSent('dsh-s1', 7)
    await first.setUncommittedTurns('dsh-s1', 2)
    await first.recordCommit('dsh-s1', 1234)

    const { store: second } = await StateStore.open(file, IDENTITY)
    expect(second.session('dsh-s1')).toEqual({ sentSeqs: [7], uncommittedUserTurns: 0, lastCommitAt: 1234 })
  })

  it('quarantines an identity mismatch and starts fresh', async () => {
    const dir = await tempDirName()
    const file = join(dir, 'state.json')
    const { store: first } = await StateStore.open(file, IDENTITY)
    await first.recordSent('dsh-s1', 1)
    const { store, quarantined } = await StateStore.open(file, { ...IDENTITY, user: 'other' })
    expect(quarantined).toHaveLength(1)
    expect(quarantined[0]!.issue).toBe('identity-mismatch')
    expect(store.session('dsh-s1')).toBeNull()
    const { store: fresh } = await StateStore.open(file, { ...IDENTITY, user: 'other' })
    expect(fresh.session('dsh-s1')).toBeNull()
  })

  it('quarantines a corrupt file', async () => {
    const dir = await tempDirName()
    const file = join(dir, 'state.json')
    const { store: first } = await StateStore.open(file, IDENTITY)
    await first.recordSent('dsh-s1', 1)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, '{not json')
    const { store, quarantined } = await StateStore.open(file, IDENTITY)
    expect(quarantined[0]!.issue).toBe('corrupt')
    expect(store.session('dsh-s1')).toBeNull()
  })

  it('quarantines JSON that is not an object or has the wrong shape', async () => {
    const dir = await tempDirName()
    const file = join(dir, 'state.json')
    const { writeFile } = await import('node:fs/promises')
    for (const content of ['null', '"string"', '{"version":2,"identity":"x","sessions":{}}', '{"version":1,"identity":"x","sessions":[]}']) {
      await writeFile(file, content)
      const { store, quarantined } = await StateStore.open(file, IDENTITY)
      expect(quarantined[0]!.issue, content).toBe('corrupt')
      expect(store.session('s')).toBeNull()
    }
  })

  it('records a commit for a session that never synced', async () => {
    const dir = await tempDirName()
    const { store } = await StateStore.open(join(dir, 'state.json'), IDENTITY)
    await store.recordCommit('dsh-new', 42)
    expect(store.session('dsh-new')).toEqual({ sentSeqs: [], uncommittedUserTurns: 0, lastCommitAt: 42 })
  })

  it('caps the dedupe window at 10000 seqs', async () => {
    const dir = await tempDirName()
    const file = join(dir, 'state.json')
    const seed = { version: 1 as const, identity: identityHash(IDENTITY), sessions: { ['dsh-s1']: { sentSeqs: Array.from({ length: 10000 }, (_v, index) => index), uncommittedUserTurns: 0, lastCommitAt: null } } }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, JSON.stringify(seed))
    const { store } = await StateStore.open(file, IDENTITY)
    await store.recordSent('dsh-s1', 10000)
    expect(store.session('dsh-s1')!.sentSeqs).toHaveLength(5001)
    expect(store.session('dsh-s1')!.sentSeqs.at(-1)).toBe(10000)
  })
})

describe('expandStateFile', () => {
  it('expands a leading tilde and passes other paths through', () => {
    const home = process.env.HOME ?? '/home/test'
    expect(expandStateFile('~/x/state.json').startsWith(home)).toBe(true)
    expect(expandStateFile('~')).toBe(home)
    expect(expandStateFile('/abs/state.json')).toBe('/abs/state.json')
  })
})
