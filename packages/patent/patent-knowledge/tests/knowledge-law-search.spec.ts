import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeLawSearch } from '@deepseek-ai/dsh-patent-knowledge'

/** Fixture mirrors knowledge.db: documents(doc_type='law_article') + chunks + contentless trigram docs_fts. */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function createStore(): { search: KnowledgeLawSearch; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-search-'))
  const dbPath = join(dir, 'knowledge.db')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'patent',
      title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0
    );
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id),
      chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0
    );
    CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, module, domain, tags, tokenize='trigram', content='', contentless_delete=1);
  `)
  const insDoc = db.prepare(
    'INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES (?, \'raw\', ?, ?, \'2026-01-01\', ?)',
  )
  insDoc.run('law:专利法', 'law_article', '中华人民共和国专利法', '法律')
  insDoc.run('law:实施细则', 'law_article', '中华人民共和国专利法实施细则', '行政法规')
  insDoc.run('raw:无效复审决定:xx', 'case', '某无效决定', null)
  const insChunk = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES (?, ?, \'text\', ?, ?)',
  )
  const c1 = insChunk.run('law:专利法', 0, '第一条 为了保护专利权人的合法权益，鼓励发明创造。', 30).lastInsertRowid as number
  const c2 = insChunk.run('law:专利法', 1, '第二十六条 说明书应当对发明作出清楚、完整的说明。', 26).lastInsertRowid as number
  const c3 = insChunk.run('law:实施细则', 0, '本细则依据专利法制订，对专利申请与审查程序作出具体规定。', 33).lastInsertRowid as number
  insChunk.run('raw:无效复审决定:xx', 0, '决定正文内容', 7)
  const insFts = db.prepare(
    'INSERT INTO docs_fts (rowid, title, content, module, domain, tags) VALUES (?, ?, ?, \'module\', \'patent\', NULL)',
  )
  insFts.run(c1, '中华人民共和国专利法', '第一条 为了保护专利权人的合法权益，鼓励发明创造。')
  insFts.run(c2, '中华人民共和国专利法', '第二十六条 说明书应当对发明作出清楚、完整的说明。')
  insFts.run(c3, '中华人民共和国专利法实施细则', '本细则依据专利法制订，对专利申请与审查程序作出具体规定。')
  db.close()
  return { search: new KnowledgeLawSearch(dbPath), dir }
}

function withStore(): KnowledgeLawSearch {
  const { search, dir } = createStore()
  cleanups.push(() => {
    search.close()
    rmSync(dir, { recursive: true, force: true })
  })
  return search
}

describe('KnowledgeLawSearch', () => {
  it('hits via FTS and de-duplicates per document', () => {
    const s = withStore()
    const hits = s.search('第二十六条')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.name).toBe('中华人民共和国专利法')
    expect(hits[0]!.level).toBe('法律')
    expect(hits[0]!.content).toContain('说明书应当')
  })

  it('runs the LIKE fallback against the content table, not the contentless FTS table', () => {
    const { search, dir } = createStore()
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = new DatabaseSync(join(dir, 'knowledge.db'), { readOnly: true })
    try {
      const ftsLike = db.prepare("SELECT count(*) c FROM docs_fts WHERE docs_fts LIKE '%说明书%'").get() as { c: number }
      expect(ftsLike.c).toBe(0)
    } finally {
      db.close()
    }
    const hits = search.search('专利', { limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.content).toContain('专利')
  })

  it('excludes non-law_article documents', () => {
    const s = withStore()
    expect(s.search('无效决定')).toHaveLength(0)
  })

  it('filters by level', () => {
    const s = withStore()
    const hits = s.search('专利', { level: '行政法规' })
    expect(hits.map(h => h.name)).toEqual(['中华人民共和国专利法实施细则'])
  })

  it('falls back to LIKE for short queries', () => {
    const s = withStore()
    const hits = s.search('发明创造', { limit: 5 })
    expect(hits.some(h => h.name === '中华人民共和国专利法')).toBe(true)
  })

  it('getById/getByIds back-fill by documents.id', () => {
    const s = withStore()
    const byId = s.getById('law:专利法')
    expect(byId?.name).toBe('中华人民共和国专利法')
    expect(byId?.level).toBe('法律')
    const byIds = s.getByIds(['law:实施细则', 'law:专利法', '不存在'])
    expect(byIds.map(r => r.name)).toEqual(['中华人民共和国专利法实施细则', '中华人民共和国专利法'])
  })

  it('findByName and count', () => {
    const s = withStore()
    expect(s.findByName('实施细则').map(r => r.name)).toEqual(['中华人民共和国专利法实施细则'])
    expect(s.count()).toBe(2)
    expect(s.getCategories()).toEqual([])
  })

  it('is safe with no law_article documents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-search-empty-'))
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, domain TEXT NOT NULL DEFAULT 'patent', title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id), chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0);
    `)
    db.close()
    const s = new KnowledgeLawSearch(dbPath)
    cleanups.push(() => {
      s.close()
      rmSync(dir, { recursive: true, force: true })
    })
    expect(s.count()).toBe(0)
    expect(s.search('专利')).toEqual([])
    expect(s.ftsAvailable).toBe(false)
  })
})
