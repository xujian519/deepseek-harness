import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { installLegalKnowledgeDb } from '@deepseek-ai/dsh-legal-knowledge'

/** Create a minimal SQLite database file with the expected tables. */
function createSourceDb(dbPath: string): void {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(`
      CREATE TABLE case_law (id INTEGER PRIMARY KEY, case_name TEXT);
      INSERT INTO case_law VALUES (1, '测试案例一');
      INSERT INTO case_law VALUES (2, '测试案例二');
      CREATE TABLE legal_regulations (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO legal_regulations VALUES (1, '民法典第100条');
      CREATE TABLE judicial_interpretations (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO judicial_interpretations VALUES (1, '最高法解释一');
      CREATE TABLE guiding_cases (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO guiding_cases VALUES (1, '指导案例1号');
    `)
  } finally {
    db.close()
  }
}

/** Create a source database with FTS5 virtual tables. */
function createSourceDbWithFts(dbPath: string): void {
  createSourceDb(dbPath)
  const db = new DatabaseSync(dbPath)
  try {
    // FTS5 automatically creates shadow tables: case_law_fts_data, case_law_fts_idx, case_law_fts_docsize.
    db.exec(`
      CREATE VIRTUAL TABLE case_law_fts USING fts5(case_name, content='case_law', content_rowid='id');
    `)
  } finally {
    db.close()
  }
}

describe('installLegalKnowledgeDb', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'legal-knowledge-install-'))
  })

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
  })

  it('throws when source database does not exist', async () => {
    const logs: string[] = []
    await expect(
      installLegalKnowledgeDb({
        sourceDbPath: join(tempDir, 'nonexistent.db'),
        knowledgeDir: join(tempDir, 'data'),
        log: (line) => { logs.push(line) },
      }),
    ).rejects.toThrow(/输入库不存在/)
  })

  it('copies source database to the target directory', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDb(sourcePath)
    const knowledgeDir = join(tempDir, 'runtime')
    const logs: string[] = []

    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      knowledgeDir,
      log: (line) => { logs.push(line) },
    })

    expect(result.input).toBe(sourcePath)
    expect(result.output).toBe(join(knowledgeDir, 'legal.db'))
    expect(existsSync(result.output)).toBe(true)
    expect(result.inputBytes).toBeGreaterThan(0)
    expect(result.outputBytes).toBeGreaterThan(0)

    // Verify the output database has the expected tables.
    const db = new DatabaseSync(result.output, { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM case_law').get() as { c: number }
      expect(row.c).toBe(2)
    } finally {
      db.close()
    }
  })

  it('overwrites existing output database', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDb(sourcePath)
    const knowledgeDir = join(tempDir, 'runtime')
    const outputPath = join(knowledgeDir, 'legal.db')

    // Create a pre-existing (empty) database at the output path.
    mkdirSync(knowledgeDir, { recursive: true })
    const existingDb = new DatabaseSync(outputPath)
    existingDb.close()

    const logs: string[] = []
    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      knowledgeDir,
      log: (line) => { logs.push(line) },
    })

    expect(result.output).toBe(outputPath)
    // The output should now have data from the source.
    const db = new DatabaseSync(result.output, { readOnly: true })
    try {
      const row = db.prepare('SELECT COUNT(*) AS c FROM case_law').get() as { c: number }
      expect(row.c).toBe(2)
    } finally {
      db.close()
    }
    expect(logs.some(l => l.includes('覆盖'))).toBe(true)
  })

  it('drops FTS5 tables when noFts is true', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDbWithFts(sourcePath)
    const knowledgeDir = join(tempDir, 'runtime')
    const logs: string[] = []

    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      knowledgeDir,
      noFts: true,
      log: (line) => { logs.push(line) },
    })

    const db = new DatabaseSync(result.output, { readOnly: true })
    try {
      // FTS tables should be gone.
      const ftsTables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'case_law_fts%'",
      ).all() as Array<{ name: string }>)
      expect(ftsTables).toHaveLength(0)

      // Regular tables should still exist.
      const row = db.prepare('SELECT COUNT(*) AS c FROM case_law').get() as { c: number }
      expect(row.c).toBe(2)
    } finally {
      db.close()
    }
    expect(logs.some(l => l.includes('已删除'))).toBe(true)
  })

  it('reports that there is no FTS5 table to drop', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDb(sourcePath)
    const logs: string[] = []

    await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      knowledgeDir: join(tempDir, 'runtime'),
      noFts: true,
      log: (line) => { logs.push(line) },
    })

    expect(logs).toContain('    无 FTS5 表可删除')
  })

  it('reports an empty source and missing tables', async () => {
    const sourcePath = join(tempDir, 'empty.db')
    writeFileSync(sourcePath, '')
    const logs: string[] = []

    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      output: join(tempDir, 'runtime', 'legal.db'),
      noFts: true,
      log: (line) => { logs.push(line) },
    })

    expect(result.inputBytes).toBe(0)
    expect(logs.some(line => line.includes('（缺失）'))).toBe(true)
    expect(logs.some(line => line.includes('-0%'))).toBe(true)
  })

  it('preserves FTS5 tables when noFts is false', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDbWithFts(sourcePath)
    const knowledgeDir = join(tempDir, 'runtime')
    const logs: string[] = []

    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      knowledgeDir,
      noFts: false,
      log: (line) => { logs.push(line) },
    })

    const db = new DatabaseSync(result.output, { readOnly: true })
    try {
      const ftsTables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'case_law_fts%'",
      ).all() as Array<{ name: string }>)
      expect(ftsTables.length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('throws when input and output point to the same file', async () => {
    const sourcePath = join(tempDir, 'legal.db')
    createSourceDb(sourcePath)

    await expect(
      installLegalKnowledgeDb({
        sourceDbPath: sourcePath,
        output: sourcePath,
        log: () => {},
      }),
    ).rejects.toThrow(/同一文件/)
  })

  it('uses explicit output path when provided', async () => {
    const sourcePath = join(tempDir, 'source', 'legal.db')
    createSourceDb(sourcePath)
    const customOutput = join(tempDir, 'custom', 'my-legal.db')
    const logs: string[] = []

    const result = await installLegalKnowledgeDb({
      sourceDbPath: sourcePath,
      output: customOutput,
      log: (line) => { logs.push(line) },
    })

    expect(result.output).toBe(customOutput)
    expect(existsSync(customOutput)).toBe(true)
  })
})
