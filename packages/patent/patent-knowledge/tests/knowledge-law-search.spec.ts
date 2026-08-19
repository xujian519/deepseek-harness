import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeLawSearch, KnowledgeRuntimeStats } from '@deepseek-ai/dsh-patent-knowledge'

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

type DocChunkRow = {
  document_id: string
  title: string
  level: string | null
  source: string | null
  content: string | null
  chunk_index: number
  char_count: number | null
  fts_rank?: number | null
}

function asInternals(search: KnowledgeLawSearch): {
  backfillContent(rows: DocChunkRow[]): DocChunkRow[]
  withLevelFilter(match: string, options: { level?: string }, limit: number): DocChunkRow[]
} {
  return search as unknown as {
    backfillContent(rows: DocChunkRow[]): DocChunkRow[]
    withLevelFilter(match: string, options: { level?: string }, limit: number): DocChunkRow[]
  }
}

describe('KnowledgeLawSearch edge paths', () => {
  /** Full law schema but a plain docs_fts table so the FTS statement fails to prepare. */
  function createDegraded(): { search: KnowledgeLawSearch; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-degraded-'))
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0);
      CREATE TABLE docs_fts (name TEXT);
    `)
    db.prepare("INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES ('law:专利法', 'raw', 'law_article', '中华人民共和国专利法', '2026-01-01', '法律')").run()
    db.prepare("INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES ('law:发明指南', 'raw', 'law_article', '发明%指南', '2026-01-01', '法律')").run()
    db.prepare("INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES ('law:专利法', 0, 'text', '第一条 发明应当具备新颖性。', 20)").run()
    db.prepare("INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES ('law:发明指南', 0, 'text', '发明%审查指引正文', 20)").run()
    db.close()
    return { search: new KnowledgeLawSearch(dbPath), dir }
  }

  it('degrades to LIKE when the FTS statement preparation fails, with stats and logger', () => {
    const warns: string[] = []
    const stats = new KnowledgeRuntimeStats()
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-degrade-'))
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0);
      CREATE TABLE docs_fts (name TEXT);
    `)
    db.prepare("INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES ('law:专利法', 'raw', 'law_article', '中华人民共和国专利法', '2026-01-01', '法律')").run()
    db.prepare("INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES ('law:专利法', 0, 'text', '第一条 发明应当具备新颖性。', 20)").run()
    db.close()
    const search = new KnowledgeLawSearch(dbPath, { logger: { warn: m => warns.push(m) }, stats })
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    expect(search.ftsAvailable).toBe(false)
    expect(warns).toHaveLength(1)
    expect(warns[0]).toMatch(/FTS5 不可用，已降级 LIKE/)
    expect(stats.snapshot().legalFtsDegraded).toBe(true)
    const hits = search.search('新颖性')
    expect(hits.some(h => h.name === '中华人民共和国专利法')).toBe(true)
  })

  it('falls back to keyword-OR FTS when the whole-phrase query misses', () => {
    const s = withStore()
    const hits = s.search('专利法的实施细则')
    expect(hits.some(h => h.name === '中华人民共和国专利法')).toBe(true)
    expect(hits.some(h => h.name === '中华人民共和国专利法实施细则')).toBe(true)
  })

  it('degrades at runtime when the FTS statement throws, then stays on LIKE', () => {
    const { search, dir } = createStore()
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const db = new DatabaseSync(join(dir, 'knowledge.db'))
    db.exec('DROP TABLE docs_fts')
    db.close()

    expect(search.ftsAvailable).toBe(true)
    const first = search.search('发明创造')
    expect(first.some(h => h.name === '中华人民共和国专利法')).toBe(true)
    expect(search.ftsAvailable).toBe(false)
    const second = search.search('发明创造')
    expect(second.some(h => h.name === '中华人民共和国专利法')).toBe(true)
  })

  it('escapes wildcards in findByName and in the LIKE keyword', () => {
    const { search, dir } = createDegraded()
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const byName = search.findByName('%指南')
    expect(byName.map(r => r.name)).toEqual(['发明%指南'])
    const byKeyword = search.search('发明%', { limit: 5 })
    expect(byKeyword.some(h => h.name === '发明%指南')).toBe(true)
  })

  it('returns undefined for an unknown getById and covers getByIds branches', () => {
    const s = withStore()
    expect(s.getById('不存在')).toBeUndefined()
    expect(s.getByIds([])).toEqual([])
    expect(s.getByIds([''])).toEqual([])
    expect(s.getByIds(['law:专利法']).map(r => r.name)).toEqual(['中华人民共和国专利法'])
    expect(s.getByIds(['不存在'])).toEqual([])
    expect(s.getByIds(['law:专利法', '不存在']).map(r => r.name)).toEqual(['中华人民共和国专利法'])
  })

  it('runs the level-filtered FTS query', () => {
    const s = withStore()
    const hits = s.search('保护专利', { level: '法律' })
    expect(hits.map(h => h.name)).toEqual(['中华人民共和国专利法'])
  })

  it('runs the level-filtered LIKE query on a degraded engine', () => {
    const { search, dir } = createDegraded()
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const hits = search.search('发明', { level: '法律' })
    expect(hits.some(h => h.name === '中华人民共和国专利法')).toBe(true)
  })

  it('de-duplicates multi-chunk documents and honors the limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-dedupe-'))
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0);
      CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, module, domain, tags, tokenize='trigram', content='', contentless_delete=1);
    `)
    const insDoc = db.prepare("INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES (?, 'raw', 'law_article', ?, '2026-01-01', ?)")
    insDoc.run('law:A', '专利申请审查规定', '法律')
    insDoc.run('law:B', '专利申请格式要求', '行政法规')
    const insChunk = db.prepare("INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES (?, ?, 'text', ?, 10)")
    const a1 = insChunk.run('law:A', 0, '专利申请新颖性判断标准。').lastInsertRowid as number
    const a2 = insChunk.run('law:A', 1, '专利申请创造性判断标准。').lastInsertRowid as number
    const b1 = insChunk.run('law:B', 0, '专利申请文件格式要求说明书应当清楚完整地记载技术方案，方便公众查阅。').lastInsertRowid as number
    const insFts = db.prepare("INSERT INTO docs_fts (rowid, title, content, module, domain, tags) VALUES (?, ?, ?, NULL, 'patent', NULL)")
    insFts.run(a1, '专利申请审查规定', '专利申请新颖性判断标准。')
    insFts.run(a2, '专利申请审查规定', '专利申请创造性判断标准。')
    insFts.run(b1, '专利申请格式要求', '专利申请文件格式要求说明书应当清楚完整地记载技术方案，方便公众查阅。')
    db.close()
    const search = new KnowledgeLawSearch(dbPath)
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const hits = search.search('专利申请', { limit: 2 })
    expect(hits).toHaveLength(2)
    expect(hits.filter(h => h.name === '专利申请审查规定')).toHaveLength(1)
    expect(hits.some(h => h.name === '专利申请格式要求')).toBe(true)
  })

  it('maps a NULL level and empty content through toRecord', () => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-law-null-level-'))
    const dbPath = join(dir, 'knowledge.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE documents (id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, title TEXT NOT NULL, indexed_at TEXT NOT NULL, level TEXT, char_count INTEGER DEFAULT 0);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0);
    `)
    db.prepare("INSERT INTO documents (id, source, doc_type, title, indexed_at, level) VALUES ('law:空', 'raw', 'law_article', '无内容条款', '2026-01-01', NULL)").run()
    db.prepare("INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES ('law:空', 0, 'text', '', 0)").run()
    db.close()
    const search = new KnowledgeLawSearch(dbPath)
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    const byId = search.getById('law:空')
    expect(byId!.level).toBe('其他')
    expect(byId!.content).toBeUndefined()
    const found = search.findByName('无内容')
    expect(found[0]!.content).toBeUndefined()
  })

  it('backfills non-null rows unchanged and passes through missing chunk rows', () => {
    const s = withStore()
    const internals = asInternals(s)
    const withContent = internals.backfillContent([{
      document_id: 'law:专利法',
      title: '中华人民共和国专利法',
      level: '法律',
      source: 'raw',
      content: '已有正文',
      chunk_index: 0,
      char_count: 10,
    }])
    expect(withContent[0]!.content).toBe('已有正文')
    const missing = internals.backfillContent([{
      document_id: 'law:专利法',
      title: '中华人民共和国专利法',
      level: '法律',
      source: 'raw',
      content: null,
      chunk_index: 99,
      char_count: 10,
    }])
    expect(missing[0]!.content).toBeNull()
  })

  it('returns an empty result when the FTS statement is null in withLevelFilter', () => {
    const { search, dir } = createDegraded()
    cleanups.push(() => {
      search.close()
      rmSync(dir, { recursive: true, force: true })
    })
    expect(asInternals(search).withLevelFilter('"x"', {}, 10)).toEqual([])
  })
})
