// Real-service test: mounts the patent-knowledge service on a real Context
// pointed at an in-test fixture knowledge.db and drives every query engine.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import PatentKnowledge from '@deepseek-ai/dsh-patent-knowledge'

/** Build a fixture knowledge.db (documents/chunks/docs_fts + kg_nodes/kg_edges). */
function makeDb(dir: string): string {
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
    CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, module, domain, tags, tokenize='trigram', content='', contentless_delete=1);
    CREATE TABLE kg_nodes (
      id TEXT PRIMARY KEY, node_type TEXT, name TEXT, title TEXT, content TEXT,
      law_refs TEXT, source TEXT, full_ref TEXT, chapter TEXT, article_number TEXT
    );
    CREATE TABLE kg_edges (source_id TEXT, target_id TEXT, relation TEXT);
  `)
  const insDoc = db.prepare(
    `INSERT INTO documents (id, source, doc_type, title, level, court, decision_number, case_number, char_count, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')`,
  )
  insDoc.run('case:d1', 'raw', 'case', '创造性三步法无效决定', null, null, '566693', '008073341', 100)
  insDoc.run('law:专利法', 'raw', 'law_article', '中华人民共和国专利法', '法律', null, null, null, 100)
  const insChunk = db.prepare(
    'INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count) VALUES (?, ?, \'paragraph\', ?, ?)',
  )
  const c1 = insChunk.run('case:d1', 0, '创造性判断应当采用三步法框架。', 50).lastInsertRowid as number
  const c2 = insChunk.run('law:专利法', 0, '第一条 为了保护专利权人的合法权益，鼓励发明创造。', 50).lastInsertRowid as number
  const insFts = db.prepare(
    'INSERT INTO docs_fts (rowid, title, content, module, domain, tags) VALUES (?, ?, ?, NULL, \'patent\', NULL)',
  )
  insFts.run(c1, '创造性三步法无效决定', '创造性判断应当采用三步法框架。')
  insFts.run(c2, '中华人民共和国专利法', '第一条 为了保护专利权人的合法权益，鼓励发明创造。')

  db.prepare(
    'INSERT INTO kg_nodes (id, node_type, name, content) VALUES (?, ?, ?, ?)',
  ).run('kg:n1', 'Concept', '创造性', '创造性是指与现有技术相比具有突出的实质性特点。')
  db.prepare(
    'INSERT INTO kg_nodes (id, node_type, name, content) VALUES (?, ?, ?, ?)',
  ).run('kg:n2', 'Concept', '新颖性', '新颖性是指不属于现有技术。')
  db.prepare('INSERT INTO kg_edges (source_id, target_id, relation) VALUES (?, ?, ?)').run('kg:n1', 'kg:n2', 'RELATED_TO')
  db.close()
  return dbPath
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

describe('PatentKnowledge service', () => {
  it('serves every query engine over a fixture knowledge.db', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-svc-'))
    makeDb(dir)
    const ctx = new Context()
    await ctx.plugin(PatentKnowledge, { knowledgeDir: dir })
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true })
    })
    try {
      expect(ctx.patentKnowledge).toBeInstanceOf(PatentKnowledge)

      const caseHits = ctx.patentKnowledge.caseLawSearch('创造性')
      expect(caseHits.some(h => h.documentId === 'case:d1')).toBe(true)

      const lawHits = ctx.patentKnowledge.legalSearch('专利法')
      expect(lawHits.some(h => h.name === '中华人民共和国专利法')).toBe(true)

      const node = ctx.patentKnowledge.kgGetNode('kg:n1')
      expect(node?.name).toBe('创造性')

      const concepts = ctx.patentKnowledge.kgListByType('Concept')
      expect(concepts.length).toBeGreaterThanOrEqual(2)

      const hits = ctx.patentKnowledge.kgSearch('创造性')
      expect(hits.some(h => h.node.id === 'kg:n1')).toBe(true)

      const classified = ctx.patentKnowledge.ipcClassify('一种无线通信电路，包含集成电路芯片和天线')
      expect(classified[0]!.section).toBe('H')

      // IPC examination-standard lookups run off the shipped asset, no db needed.
      const sectionCards = ctx.patentKnowledge.ipcStandards('A')
      expect(Array.isArray(sectionCards)).toBe(true)
      const articleCards = ctx.patentKnowledge.ipcStandardsByArticle('patent-law-a22.3')
      expect(Array.isArray(articleCards)).toBe(true)
      const searched = ctx.patentKnowledge.ipcStandardsSearch('新颖性')
      expect(Array.isArray(searched)).toBe(true)
      const searchedDefault = ctx.patentKnowledge.ipcStandardsSearch('A')
      expect(Array.isArray(searchedDefault)).toBe(true)

      // wiki dir is absent in the fixture: keyword lookup degrades to empty.
      expect(ctx.patentKnowledge.wikiCards('创造性')).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('removes ctx.patentKnowledge when its fiber disposes (HMR safety)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-patent-knowledge-hmr-'))
    makeDb(dir)
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true })
    })
    const ctx = new Context()
    const fiber = ctx.plugin(PatentKnowledge, { knowledgeDir: dir })
    await fiber
    expect(ctx.patentKnowledge).toBeInstanceOf(PatentKnowledge)
    await fiber.dispose()
    expect(ctx.get('patentKnowledge')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
