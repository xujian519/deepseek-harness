import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_DB, KnowledgeDbVersionError, LAWS_DB, VECTORS_DB, openKnowledgeDb } from '@deepseek-ai/dsh-patent-knowledge'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function setVersion(dbPath: string, version: number, applicationId = 0): void {
  const db = new DatabaseSync(dbPath)
  db.exec(`PRAGMA user_version = ${version}`)
  if (applicationId !== 0) db.exec(`PRAGMA application_id = ${applicationId}`)
  db.close()
}

function readVersion(dbPath: string): { version: number; applicationId: number } {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const ver = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const app = db.prepare('PRAGMA application_id').get() as { application_id: number }
    return { version: ver.user_version, applicationId: app.application_id }
  } finally {
    db.close()
  }
}

describe('openKnowledgeDb', () => {
  it('stamps a new source db (writable path) with version and application_id', () => {
    const dir = makeTempDir('dbv-new-')
    try {
      const dbPath = join(dir, 'test.db')
      const opened = openKnowledgeDb(dbPath, KNOWLEDGE_DB)
      expect(opened.needsRebuild).toBe(false)
      expect(opened.version).toBe(0)
      opened.db.close()
      const stamp = readVersion(dbPath)
      expect(stamp.version).toBe(KNOWLEDGE_DB.version)
      expect(stamp.applicationId).toBe(KNOWLEDGE_DB.applicationId)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('opens normally when the version matches', () => {
    const dir = makeTempDir('dbv-match-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      setVersion(dbPath, KNOWLEDGE_DB.version, KNOWLEDGE_DB.applicationId)
      const source = openKnowledgeDb(dbPath, KNOWLEDGE_DB)
      expect(source.needsRebuild).toBe(false)
      expect(source.version).toBe(KNOWLEDGE_DB.version)
      source.db.close()
      const derived = openKnowledgeDb(dbPath, { ...KNOWLEDGE_DB, kind: 'derived' })
      expect(derived.needsRebuild).toBe(false)
      derived.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('tolerates a legacy (version 0) db on read and stamps on write', () => {
    const dir = makeTempDir('dbv-legacy-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      const readOnly = openKnowledgeDb(dbPath, KNOWLEDGE_DB, { readOnly: true })
      expect(readOnly.needsRebuild).toBe(false)
      readOnly.db.close()
      expect(readVersion(dbPath).version).toBe(0)
      const writable = openKnowledgeDb(dbPath, KNOWLEDGE_DB)
      writable.db.close()
      expect(readVersion(dbPath).version).toBe(KNOWLEDGE_DB.version)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails loud on an outdated source db and leaves it unchanged', () => {
    const dir = makeTempDir('dbv-source-old-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      setVersion(dbPath, 1, KNOWLEDGE_DB.applicationId)
      expect(() =>
        openKnowledgeDb(dbPath, { version: 3, kind: 'source', applicationId: KNOWLEDGE_DB.applicationId }),
      ).toThrow(KnowledgeDbVersionError)
      expect(readVersion(dbPath).version).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns needsRebuild for an outdated derived db', () => {
    const dir = makeTempDir('dbv-derived-old-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      setVersion(dbPath, 1, VECTORS_DB.applicationId)
      const opened = openKnowledgeDb(dbPath, { version: 3, kind: 'derived', applicationId: VECTORS_DB.applicationId })
      expect(opened.needsRebuild).toBe(true)
      opened.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treatZeroAsStale flags a version-0 derived db for rebuild', () => {
    const dir = makeTempDir('dbv-zero-stale-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      const lenient = openKnowledgeDb(
        dbPath,
        { version: 1, kind: 'derived', applicationId: VECTORS_DB.applicationId },
        { readOnly: true },
      )
      expect(lenient.needsRebuild).toBe(false)
      lenient.db.close()
      const strict = openKnowledgeDb(
        dbPath,
        { version: 1, kind: 'derived', applicationId: VECTORS_DB.applicationId },
        { readOnly: true, treatZeroAsStale: true },
      )
      expect(strict.needsRebuild).toBe(true)
      strict.db.close()

      const sourcePath = join(dir, 'source.db')
      new DatabaseSync(sourcePath).close()
      const sourceOpened = openKnowledgeDb(
        sourcePath,
        { version: 1, kind: 'source', applicationId: KNOWLEDGE_DB.applicationId },
        { readOnly: true, treatZeroAsStale: true },
      )
      expect(sourceOpened.needsRebuild).toBe(false)
      sourceOpened.db.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a future-version db for both kinds', () => {
    const dir = makeTempDir('dbv-future-')
    try {
      for (const kind of ['source', 'derived'] as const) {
        const dbPath = join(dir, `${kind}.db`)
        new DatabaseSync(dbPath).close()
        setVersion(dbPath, KNOWLEDGE_DB.version + 1, KNOWLEDGE_DB.applicationId)
        expect(() =>
          openKnowledgeDb(dbPath, { version: KNOWLEDGE_DB.version, kind, applicationId: KNOWLEDGE_DB.applicationId }),
        ).toThrow(KnowledgeDbVersionError)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched application_id', () => {
    const dir = makeTempDir('dbv-appid-')
    try {
      const dbPath = join(dir, 'test.db')
      new DatabaseSync(dbPath).close()
      setVersion(dbPath, KNOWLEDGE_DB.version, LAWS_DB.applicationId)
      expect(() =>
        openKnowledgeDb(dbPath, { version: KNOWLEDGE_DB.version, kind: 'source', applicationId: KNOWLEDGE_DB.applicationId }),
      ).toThrow(KnowledgeDbVersionError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses distinct application_id magic numbers for the three dbs', () => {
    const ids = new Set([KNOWLEDGE_DB.applicationId, LAWS_DB.applicationId, VECTORS_DB.applicationId])
    expect(ids.size).toBe(3)
    for (const id of ids) {
      expect(id).toBeGreaterThan(0)
      expect(Number.isInteger(id)).toBe(true)
    }
  })
})
