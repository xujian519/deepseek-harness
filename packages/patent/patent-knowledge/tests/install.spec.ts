// installKnowledgeDb test: trims a fixture source db (compress chunks + drop
// embeddings) and verifies the output database structure.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { decompressChunk, installKnowledgeDb } from '@deepseek-ai/dsh-patent-knowledge'

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
