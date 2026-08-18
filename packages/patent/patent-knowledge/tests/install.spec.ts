// installKnowledgeDb test: trims a fixture source db (compress chunks + drop
// embeddings) and verifies the output database structure.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SOURCE_DB_PATH, decompressChunk, installKnowledgeDb } from '@deepseek-ai/dsh-patent-knowledge'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeSourceDb(dir: string): string {
  const dbPath = join(dir, 'knowledge.db')
  const db = new DatabaseSync(dbPath)
  db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT)')
  db.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, content)')
  db.exec('CREATE TABLE embeddings (id INTEGER PRIMARY KEY, vector BLOB)')
  db.prepare('INSERT INTO documents (id, title) VALUES (?, ?)').run('d1', '创造性三步法')
  const long = '权利要求所述技术方案具有突出的实质性特点，不属于本领域技术人员容易想到的改进。'.repeat(30)
  db.prepare('INSERT INTO chunks (content) VALUES (?)').run(long)
  db.prepare('INSERT INTO chunks (content) VALUES (?)').run('短文本保持明文')
  db.prepare('INSERT INTO embeddings (vector) VALUES (?)').run(new Uint8Array(16))
  db.close()
  return dbPath
}

describe('installKnowledgeDb', () => {
  it('trims a source db by compressing long chunks and dropping embeddings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeSourceDb(dir)
    const output = join(dir, 'knowledge-lite.db')
    const log: string[] = []
    const result = await installKnowledgeDb({
      sourceDbPath: input,
      output,
      skipVerify: true,
      log: line => log.push(line),
    })

    expect(result.output).toBe(output)
    expect(result.dropped).toEqual(['embeddings', 'ivf_index', 'index_meta'])

    const outDb = new DatabaseSync(output, { readOnly: true })
    try {
      const tables = outDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>
      const names = tables.map(t => t.name)
      expect(names).toContain('chunks')
      expect(names).toContain('documents')
      expect(names).not.toContain('embeddings')

      const rows = outDb.prepare('SELECT content FROM chunks ORDER BY id').all() as Array<{ content: string | Uint8Array }>
      // Long chunk (id 1) is a compressed BLOB; short chunk (id 2) stays plain.
      expect(rows[0]!.content).toBeInstanceOf(Uint8Array)
      expect(rows[1]!.content).toBe('短文本保持明文')
      expect(decompressChunk(rows[0]!.content)).toContain('实质性特点')
    } finally {
      outDb.close()
    }
    expect(log.some(l => l.includes('VACUUM'))).toBe(true)
  })
})

it('rejects an output path that aliases the source (symlink/./ forms) before touching it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-alias-'))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  const input = makeSourceDb(dir)
  // 文本不相等但真实路径相同：必须先于任何删除被守卫拦下。
  const aliased = join(dir, '.', 'knowledge.db')
  await expect(installKnowledgeDb({ sourceDbPath: input, output: aliased, skipVerify: true }))
    .rejects.toThrow(/指向同一文件/)
    // 源库完好。
  const check = new DatabaseSync(input, { readOnly: true })
  check.close()
})

/** Full-schema source db so verifyComponents can open KgStore and both search engines. */
function makeFullSourceDb(dir: string, { match }: { match: boolean }): string {
  const dbPath = join(dir, 'knowledge.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'patent',
      title TEXT NOT NULL, level TEXT, court TEXT, decision_number TEXT, case_number TEXT,
      module TEXT, char_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0, indexed_at TEXT NOT NULL
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id),
      chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0
    );
    CREATE TABLE kg_nodes (
      id TEXT PRIMARY KEY, node_type TEXT, name TEXT, title TEXT, content TEXT,
      law_refs TEXT, source TEXT, full_ref TEXT, chapter TEXT, article_number TEXT
    );
    CREATE TABLE kg_edges (source_id TEXT, target_id TEXT, relation TEXT);
    CREATE TABLE embeddings (id INTEGER PRIMARY KEY, vector BLOB);
  `)
  const insDoc = db.prepare(
    `INSERT INTO documents (id, source, doc_type, title, level, char_count, indexed_at)
     VALUES (?, 'raw', ?, ?, ?, 50, '2026-01-01')`,
  )
  const insChunk = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES (?, 0, \'paragraph\', ?, 50)',
  )
  const insNode = db.prepare('INSERT INTO kg_nodes (id, node_type, name) VALUES (?, ?, ?)')
  if (match) {
    insDoc.run('case:d1', 'case', '无效决定', null)
    insDoc.run('law:专利法', 'law_article', '中华人民共和国专利法', '法律')
    insChunk.run('case:d1', '创造性 三步法判断要求技术方案具有突出的实质性特点。'.repeat(40))
    insChunk.run('law:专利法', '本细则规定发明应当具备新颖性、创造性和实用性。'.repeat(40))
    insNode.run('kg:n1', 'Concept', '创造性')
  } else {
    insDoc.run('case:d1', 'case', '附图规范', null)
    insDoc.run('law:细则', 'law_article', '申请文件形式要求', '部门规章')
    insChunk.run('case:d1', '说明书附图应当清楚完整地表达技术方案。'.repeat(40))
    insChunk.run('law:细则', '说明书附图应当满足形式审查要求。'.repeat(40))
    insNode.run('kg:n1', 'Concept', '附图')
  }
  db.close()
  return dbPath
}

describe('installKnowledgeDb verify + option branches', () => {
  it('runs verifyComponents with matching content and default options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-verify-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeFullSourceDb(dir, { match: true })
    const output = join(dir, 'knowledge-lite.db')
    const log: string[] = []
    const result = await installKnowledgeDb({ sourceDbPath: input, output, log: line => log.push(line) })

    expect(result.compressedChunks).toBeGreaterThan(0)
    expect(log.some(l => l.includes('KgStore 关键词检索: 命中 1'))).toBe(true)
    expect(log.some(l => l.includes('KnowledgeLawSearch count=1 fts='))).toBe(true)
    expect(log.some(l => l.includes('检索"创造性 三步法"') && l.includes('命中'))).toBe(true)
  })

  it('runs verifyComponents with no matching content and noFts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-verify-none-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeFullSourceDb(dir, { match: false })
    const output = join(dir, 'knowledge-lite.db')
    const log: string[] = []
    const result = await installKnowledgeDb({ sourceDbPath: input, output, noFts: true, log: line => log.push(line) })

    expect(result.dropped).toEqual(['embeddings', 'ivf_index', 'index_meta', 'docs_fts', 'kg_nodes_fts'])
    expect(log.some(l => l.includes('KgStore 关键词检索: 无命中'))).toBe(true)
    expect(log.some(l => l.includes('KnowledgeLawSearch count=1') && l.includes('无命中'))).toBe(true)
    expect(log.some(l => l.includes('检索"创造性"') && l.includes('无命中'))).toBe(true)
  })

  it('keeps embeddings and skips compression when asked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-keep-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeSourceDb(dir)
    const output = join(dir, 'knowledge-lite.db')
    const log: string[] = []
    const result = await installKnowledgeDb({
      sourceDbPath: input,
      output,
      keepEmbeddings: true,
      compressChunks: false,
      skipVerify: true,
      log: line => log.push(line),
    })

    expect(result.dropped).toEqual([])
    expect(result.compressedChunks).toBe(0)
    expect(log.some(l => l.includes('无（仅 VACUUM 去碎片）'))).toBe(true)
    const outDb = new DatabaseSync(output, { readOnly: true })
    try {
      const names = (outDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map(t => t.name)
      expect(names).toContain('embeddings')
      const rows = outDb.prepare('SELECT content FROM chunks ORDER BY id').all() as Array<{ content: string | Uint8Array }>
      // untouched by compression when compressChunks=false (plain string preserved)
      expect(rows[0]!.content).toContain('突出的实质性特点')
    } finally {
      outDb.close()
    }
  })

  it('skips non-string chunk contents during compression', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-skip-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec('CREATE TABLE documents (id TEXT PRIMARY KEY, title TEXT)')
    db.exec('CREATE TABLE chunks (id INTEGER PRIMARY KEY, content)')
    const long = '长文本'.repeat(500)
    db.prepare('INSERT INTO chunks (content) VALUES (?)').run(long)
    db.prepare('INSERT INTO chunks (content) VALUES (?)').run(null)
    db.prepare('INSERT INTO chunks (content) VALUES (?)').run(Buffer.from('blob内容', 'utf8'))
    db.close()
    const output = join(dir, 'knowledge-lite.db')
    const result = await installKnowledgeDb({ sourceDbPath: dbPath, output, skipVerify: true })
    expect(result.compressedChunks).toBe(1)
  })

  it('throws when the input database is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-missing-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    await expect(
      installKnowledgeDb({ sourceDbPath: join(dir, 'nope.db'), output: join(dir, 'out.db'), skipVerify: true }),
    ).rejects.toThrow(/输入库不存在/)
  })

  it('defaults the output path under knowledgeDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-default-out-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeSourceDb(dir)
    const result = await installKnowledgeDb({ knowledgeDir: dir, sourceDbPath: input, skipVerify: true })
    expect(result.output).toBe(join(dir, 'knowledge-lite.db'))
  })

  it('defaults to the shipped source path and fails loud before touching anything', async () => {
    // Omitted sourceDbPath resolves to ~/.sati/knowledge/knowledge.db: either the
    // default source is absent (CI) → missing-input error, or it aliases the
    // requested output (dev machines shipping the source) → same-file guard.
    // Both reject before any file operation.
    await expect(installKnowledgeDb({ output: DEFAULT_SOURCE_DB_PATH, skipVerify: true })).rejects.toThrow()
  })

  it('cleans up a stale tmp output before vacuuming', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-tmp-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeSourceDb(dir)
    const output = join(dir, 'knowledge-lite.db')
    const staleTmp = `${resolve(output)}.tmp-${process.pid}`
    writeFileSync(staleTmp, 'stale')
    await installKnowledgeDb({ sourceDbPath: input, output, skipVerify: true })
    expect(existsSync(staleTmp)).toBe(false)
  })

  it('overwrites an existing output file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-install-overwrite-'))
    cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
    const input = makeSourceDb(dir)
    const output = join(dir, 'knowledge-lite.db')
    writeFileSync(output, 'old output')
    const log: string[] = []
    const result = await installKnowledgeDb({ sourceDbPath: input, output, skipVerify: true, log: line => log.push(line) })
    expect(existsSync(output)).toBe(true)
    expect(result.output).toBe(output)
    expect(log.some(l => l.includes('输出已存在，覆盖'))).toBe(true)
  })
})
