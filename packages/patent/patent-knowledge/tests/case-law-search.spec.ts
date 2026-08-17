import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CaseLawSearchEngine } from '@deepseek-ai/dsh-patent-knowledge'

/**
 * CaseLawSearchEngine tests. The fixture mirrors the real knowledge.db:
 * contentless trigram FTS5 docs_fts whose rowid equals chunks.id, with the body
 * back-filled by JOIN chunks then JOIN documents.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function createEngine(includeFts = true): { engine: CaseLawSearchEngine; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'case-law-test-'))
  const dbPath = join(dir, 'test.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'patent',
      title TEXT NOT NULL, file_path TEXT, module TEXT, priority TEXT, level TEXT, publish_date TEXT,
      case_number TEXT, court TEXT, decision_number TEXT, article_number TEXT, content_hash TEXT,
      indexed_at TEXT NOT NULL, char_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id),
      chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, heading TEXT, content TEXT NOT NULL, char_count INTEGER DEFAULT 0
    );
    CREATE INDEX idx_chunks_document ON chunks(document_id, chunk_index);
  `)
  if (includeFts) {
    db.exec(
      `CREATE VIRTUAL TABLE docs_fts USING fts5(
        title, content, module, domain, tags, tokenize='trigram', content='', contentless_delete=1
      )`,
    )
  }
  const insertDoc = db.prepare(
    `INSERT INTO documents (id, source, doc_type, domain, title, case_number, court, decision_number, char_count, chunk_count, indexed_at)
     VALUES (?, ?, ?, 'patent', ?, ?, ?, ?, ?, ?, '2026-07-01T00:00:00.000Z')`,
  )
  insertDoc.run('d1', 'raw', 'case', '专利无效复审决定 008073341', '008073341', null, '566693', 300, 2)
  insertDoc.run('d2', 'raw', 'judgment', '某专利侵权判决', null, '最高人民法院', null, 200, 1)
  insertDoc.run('d3', 'raw', 'case', '另一无效决定', '999999999', null, '777777', 100, 1)
  insertDoc.run('d4', 'wiki', 'case', '创造性-审查标准-磨削抛光', null, null, null, 150, 1)

  const insertChunk = db.prepare(
    `INSERT INTO chunks (id, document_id, chunk_index, chunk_type, heading, content, char_count)
     VALUES (?, ?, ?, 'paragraph', NULL, ?, ?)`,
  )
  insertChunk.run(1, 'd1', 0, '本案涉及创造性三步法判断，审查员认为技术方案显而易见。', 150)
  insertChunk.run(2, 'd1', 1, '合议组认为区别特征产生了预料不到的技术效果。', 100)
  insertChunk.run(3, 'd2', 0, '判决书正文：创造性判断应采用三步法框架进行认定。', 120)
  insertChunk.run(4, 'd3', 0, '本决定认为权利要求不具备新颖性。', 80)
  insertChunk.run(5, 'd4', 0, '创造性审查标准：技术启示的判断应当结合本领域技术人员认知。', 150)

  if (includeFts) {
    const insertFts = db.prepare(
      'INSERT INTO docs_fts (rowid, title, content, module, domain, tags) VALUES (?, ?, ?, NULL, \'patent\', NULL)',
    )
    insertFts.run(1, '专利无效复审决定 008073341', '本案涉及创造性三步法判断，审查员认为技术方案显而易见。')
    insertFts.run(2, '专利无效复审决定 008073341', '合议组认为区别特征产生了预料不到的技术效果。')
    insertFts.run(3, '某专利侵权判决', '判决书正文：创造性判断应采用三步法框架进行认定。')
    insertFts.run(4, '另一无效决定', '本决定认为权利要求不具备新颖性。')
    insertFts.run(5, '创造性-审查标准-磨削抛光', '创造性审查标准：技术启示的判断应当结合本领域技术人员认知。')
  }
  db.close()
  return { engine: new CaseLawSearchEngine(dbPath), dir }
}

function withEngine(includeFts = true): CaseLawSearchEngine {
  const { engine, dir } = createEngine(includeFts)
  cleanups.push(() => {
    engine.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return engine
}

describe('CaseLawSearchEngine', () => {
  it('hits via FTS and de-duplicates per document', () => {
    const engine = withEngine()
    const hits = engine.search('创造性')
    expect(hits.length).toBeGreaterThanOrEqual(1)
    const d1 = hits.find(h => h.documentId === 'd1')
    expect(d1).toBeDefined()
    expect(d1!.via).toBe('fts')
    expect(hits.filter(h => h.documentId === 'd1')).toHaveLength(1)
    expect(d1!.snippet.length).toBeGreaterThan(0)
  })

  it('orders hits by bm25 descending', () => {
    const engine = withEngine()
    const hits = engine.search('创造性')
    const ranks = hits.map(h => h.ftsRank ?? 0)
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]!).toBeGreaterThanOrEqual(ranks[i]!)
    }
  })

  it('filters by doc_type', () => {
    const engine = withEngine()
    const hits = engine.search('创造性', { docType: 'judgment' })
    expect(hits.every(h => h.docType === 'judgment')).toBe(true)
    expect(hits.some(h => h.documentId === 'd2')).toBe(true)
  })

  it('filters by court substring', () => {
    const engine = withEngine()
    const hits = engine.search('创造性', { court: '最高' })
    expect(hits.every(h => h.court?.includes('最高'))).toBe(true)
  })

  it('falls back to LIKE for 2-char queries', () => {
    const engine = withEngine()
    const hits = engine.search('认为')
    expect(hits.some(h => h.documentId === 'd1' && h.snippet.includes('认为'))).toBe(true)
    expect(hits.every(h => h.via === 'like')).toBe(true)
  })

  it('degrades to LIKE when no docs_fts table exists', () => {
    const engine = withEngine(false)
    expect(engine.ftsAvailable).toBe(false)
    const hits = engine.search('认为')
    expect(hits.some(h => h.documentId === 'd1')).toBe(true)
    expect(hits.every(h => h.via === 'like')).toBe(true)
  })

  it('falls back to LIKE when FTS returns no hits', () => {
    const engine = withEngine()
    const hits = engine.search('预料不到的技术效果')
    expect(hits.some(h => h.documentId === 'd1')).toBe(true)
  })

  it('getById returns chunks ordered by chunk_index', () => {
    const engine = withEngine()
    const chunks = engine.getById('d1')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.chunkIndex).toBe(0)
    expect(chunks[1]!.chunkIndex).toBe(1)
    expect(chunks[0]!.content).toContain('三步法')
  })

  it('returns empty for blank queries and honors limit', () => {
    const engine = withEngine()
    expect(engine.search('')).toHaveLength(0)
    expect(engine.search('创造性', { limit: 1 })).toHaveLength(1)
  })

  it('counts documents', () => {
    const engine = withEngine()
    expect(engine.count()).toBe(4)
  })

  it('excludes a source (wiki cards)', () => {
    const engine = withEngine()
    const all = engine.search('创造性')
    expect(all.some(h => h.documentId === 'd4')).toBe(true)
    const rawOnly = engine.search('创造性', { excludeSource: 'wiki' })
    expect(rawOnly.some(h => h.documentId === 'd4')).toBe(false)
    expect(rawOnly.some(h => h.documentId === 'd1')).toBe(true)
  })

  it('reuses the prepared FTS statement across repeated calls', () => {
    const engine = withEngine()
    expect(engine.ftsAvailable).toBe(true)
    const first = engine.search('创造性')
    const second = engine.search('创造性')
    expect(first.map(h => h.documentId)).toEqual(second.map(h => h.documentId))
    expect(first.length).toBeGreaterThanOrEqual(1)
  })

  it('reuses the prepared LIKE statement across repeated calls', () => {
    const engine = withEngine()
    const first = engine.search('认为')
    const second = engine.search('认为')
    expect(first.length).toBeGreaterThanOrEqual(1)
    expect(first.map(h => h.documentId).sort()).toEqual(second.map(h => h.documentId).sort())
    expect(first.every(h => h.via === 'like')).toBe(true)
  })
})
