// Real-composition test: boots a test cordis.yml through the real Loader
// mounting @deepseek-ai/dsh-patent-knowledge with a Config knowledgeDir that
// points at a fixture knowledge.db, and asserts ctx.patentKnowledge plus a
// real query.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import PatentKnowledge from '@deepseek-ai/dsh-patent-knowledge'

function makeDb(dir: string): void {
  const dbPath = join(dir, 'knowledge.db')
  const db = new DatabaseSync(dbPath)
  db.exec([
    'CREATE TABLE documents (',
    '  id TEXT PRIMARY KEY, source TEXT NOT NULL, doc_type TEXT NOT NULL, domain TEXT NOT NULL DEFAULT \'patent\',',
    '  title TEXT NOT NULL, level TEXT, court TEXT, decision_number TEXT, case_number TEXT, module TEXT,',
    '  char_count INTEGER DEFAULT 0, chunk_count INTEGER DEFAULT 0, indexed_at TEXT NOT NULL',
    ');',
    'CREATE TABLE chunks (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT, document_id TEXT NOT NULL REFERENCES documents(id),',
    '  chunk_index INTEGER NOT NULL, chunk_type TEXT NOT NULL, content TEXT NOT NULL, char_count INTEGER DEFAULT 0',
    ');',
    "CREATE VIRTUAL TABLE docs_fts USING fts5(title, content, module, domain, tags, tokenize='trigram', content='', contentless_delete=1);",
  ].join('\n'))
  db.prepare([
    'INSERT INTO documents (id, source, doc_type, title, level, court, decision_number, case_number, char_count, indexed_at)',
    "VALUES ('case:d1', 'raw', 'case', '创造性三步法无效决定', null, null, '566693', '008073341', 100, '2026-01-01')",
  ].join(' ')).run()
  const c1 = db.prepare([
    'INSERT INTO chunks (document_id, chunk_index, chunk_type, content, char_count)',
    "VALUES ('case:d1', 0, 'paragraph', '创造性判断应当采用三步法框架。', 50)",
  ].join(' ')).run().lastInsertRowid as number
  db.prepare([
    'INSERT INTO docs_fts (rowid, title, content, module, domain, tags)',
    "VALUES (?, '创造性三步法无效决定', '创造性判断应当采用三步法框架。', NULL, 'patent', NULL)",
  ].join(' ')).run(c1)
  db.close()
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-patent-knowledge-loader-'))
  makeDb(root)
  const configPath = join(root, 'cordis.yml')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-patent-knowledge'",
    '  config:',
    '    knowledgeDir: ' + root,
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-patent-knowledge', PatentKnowledge],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('patent-knowledge real Loader composition through cordis.yml', () => {
  it('mounts ctx.patentKnowledge and serves a case-law query against the fixture db', async () => {
    const ctx = await boot()
    expect(ctx.patentKnowledge).toBeInstanceOf(PatentKnowledge)

    const hits = ctx.patentKnowledge.caseLawSearch('创造性')
    expect(hits.some(h => h.documentId === 'case:d1')).toBe(true)
  }, 30_000)
})
