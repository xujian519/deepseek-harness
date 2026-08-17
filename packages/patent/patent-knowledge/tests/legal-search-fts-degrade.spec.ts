import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { LegalSearchEngine } from '@deepseek-ai/dsh-patent-knowledge'

type FtsSetup = 'none' | 'fake' | 'real'

function buildDb(setup: FtsSetup): string {
  const dir = mkdtempSync(join(tmpdir(), 'legal-search-fts-'))
  const dbPath = join(dir, 'test.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT, folder TEXT, isSubFolder INTEGER, "group" TEXT, "order" INTEGER);
    CREATE TABLE law (
      id TEXT PRIMARY KEY, level TEXT, name TEXT, filename TEXT, publish TEXT,
      expired INTEGER, category_id INTEGER, subtitle TEXT, valid_from TEXT,
      content TEXT, "order" INTEGER
    );
    INSERT INTO category (id, name, "order") VALUES (1, '民法商法', 1);
    INSERT INTO law VALUES
      ('L1','法律','专利法',NULL,'2020-10-17',0,1,NULL,NULL,'同样的发明创造只能授予一项专利权。',1),
      ('L2','法律','著作权法',NULL,'2020-11-11',0,1,NULL,NULL,'著作权人享有发表权。',2);
  `)
  if (setup === 'fake') {
    db.exec('CREATE TABLE law_fts (name TEXT, content TEXT); INSERT INTO law_fts VALUES (\'专利法\', \'x\');')
  } else if (setup === 'real') {
    db.exec(
      `CREATE VIRTUAL TABLE law_fts USING fts5(name, content);
       INSERT INTO law_fts (name, content) VALUES ('专利法', '同样的发明创造只能授予一项专利权。');`,
    )
  }
  db.close()
  return dbPath
}

function runtimeHasFts5(): boolean {
  try {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE VIRTUAL TABLE t USING fts5(x)')
    db.close()
    return true
  } catch {
    return false
  }
}

describe('LegalSearchEngine FTS5 capability probe and degradation', () => {
  it('degrades to LIKE with no law_fts table', () => {
    const dbPath = buildDb('none')
    try {
      const engine = new LegalSearchEngine(dbPath)
      expect(engine.ftsAvailable).toBe(false)
      const rows = engine.search('专利法', { limit: 5 })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.name).toBe('专利法')
      engine.close()
    } finally {
      rmSync(dirname(dbPath), { recursive: true, force: true })
    }
  })

  it('degrades to LIKE without crashing when law_fts is a fake table', () => {
    const dbPath = buildDb('fake')
    try {
      const engine = new LegalSearchEngine(dbPath)
      const rows = engine.search('专利法', { limit: 5 })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.name).toBe('专利法')
      expect(engine.ftsAvailable).toBe(false)
      const again = engine.search('著作权', { limit: 5 })
      expect(again.some(r => r.name.includes('著作权'))).toBe(true)
      engine.close()
    } finally {
      rmSync(dirname(dbPath), { recursive: true, force: true })
    }
  })

  it.skipIf(!runtimeHasFts5())('uses the FTS path when FTS5 is available', () => {
    const dbPath = buildDb('real')
    try {
      const engine = new LegalSearchEngine(dbPath)
      expect(engine.ftsAvailable).toBe(true)
      const rows = engine.search('专利法', { limit: 5 })
      expect(rows.length).toBeGreaterThan(0)
      expect(rows[0]!.name).toBe('专利法')
      engine.close()
    } finally {
      rmSync(dirname(dbPath), { recursive: true, force: true })
    }
  })

  it('findByName / count do not depend on FTS5', () => {
    const dbPath = buildDb('fake')
    try {
      const engine = new LegalSearchEngine(dbPath)
      const byName = engine.findByName('专利法', 3)
      expect(byName.some(r => r.name === '专利法')).toBe(true)
      expect(engine.count()).toBe(2)
      engine.close()
    } finally {
      rmSync(dirname(dbPath), { recursive: true, force: true })
    }
  })
})
