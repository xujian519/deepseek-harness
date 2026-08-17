/**
 * patent-knowledge:install — the knowledge.db trim bootstrap.
 *
 * Produces a compact knowledge-lite.db from a local source knowledge.db by
 * vacuuming into a fresh copy, gzip-compressing chunks.content long bodies
 * (readers decompress transparently via sati_uncompress), and dropping the
 * embeddings tables (P0.4: no vector infrastructure in P1). The source database
 * is opened read-only and never modified.
 *
 * The install logic never runs on plugin load; it is exported for programmatic
 * use and wrapped by the patent-knowledge-install bin.
 * @module @deepseek-ai/dsh-patent-knowledge/install
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { compressChunk, shouldCompress } from './shared/chunk-compression.ts'
import { KgStore } from './shared/kg-store.ts'
import { KnowledgeLawSearch } from './legal/knowledge-law-search.ts'
import { CaseLawSearchEngine } from './case-law/case-law-search.ts'
import { DEFAULT_KNOWLEDGE_DIR, DEFAULT_SOURCE_DB_PATH } from './config.ts'
import type { InstallKnowledgeDbOptions, InstallResult } from './types.ts'

/** Compress chunks.content long bodies to gzip BLOBs. Returns the compressed count. */
function compressChunksTable(db: DatabaseSync): number {
  const select = db.prepare('SELECT id, content FROM chunks')
  const update = db.prepare('UPDATE chunks SET content = ? WHERE id = ?')
  let compressed = 0
  for (const row of select.iterate()) {
    const content = row.content
    const id = row.id
    if (typeof content !== 'string' || typeof id !== 'number') continue
    if (shouldCompress(content)) {
      update.run(compressChunk(content), id)
      compressed += 1
    }
  }
  return compressed
}

/** Escape a single quote for the VACUUM INTO string literal. */
function sqlQuote(path: string): string {
  return path.replace(/'/g, "''")
}

function countRows(db: DatabaseSync, table: string): number {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number }
    return row.c
  } catch {
    return -1
  }
}

function gb(bytes: number): string {
  return `${(bytes / 1073741824).toFixed(2)} GB`
}

/**
 * Trim a source knowledge.db into knowledgeDir, keeping the full-text and
 * knowledge-graph capability while dropping embeddings.
 *
 * @param options - input/output paths, trimming toggles, and a log sink.
 * @returns the run summary (paths, sizes, dropped tables, compressed count).
 */
/**
 * 路径的真实形态：父目录 realpath 后拼接 basename。输出文件可能尚不存在，
 * 无法对其本身 realpath，故对父目录解析——同文件别名（./、symlink）归一为同一值。
 * @param path - 待归一化的文件路径。
 * @returns 归一化后的绝对路径。
 */
function realPathOf(path: string): string {
  return join(realpathSync(dirname(resolve(path))), basename(resolve(path)))
}

/**
 * patent-knowledge:install 的入口。
 * @param options - source/输出路径与裁剪开关。
 * @returns 安装结果（输出路径、去表清单与压缩统计）。
 */
export async function installKnowledgeDb(options: InstallKnowledgeDbOptions = {}): Promise<InstallResult> {
  const log = options.log ?? console.log
  const knowledgeDir = options.knowledgeDir ?? DEFAULT_KNOWLEDGE_DIR
  const sourceDbPath = options.sourceDbPath ?? DEFAULT_SOURCE_DB_PATH
  const input = sourceDbPath
  const output = options.output ?? join(knowledgeDir, 'knowledge-lite.db')
  const compress = options.compressChunks ?? true
  const keepEmbeddings = options.keepEmbeddings ?? false
  const noFts = options.noFts ?? false
  const skipVerify = options.skipVerify ?? false

  log(`输入: ${input}`)
  log(`输出: ${output}`)
  const dropped: string[] = []
  if (!keepEmbeddings) dropped.push('embeddings', 'ivf_index', 'index_meta')
  if (noFts) dropped.push('docs_fts', 'kg_nodes_fts')
  log(`去除: ${dropped.length > 0 ? dropped.join(', ') : '无（仅 VACUUM 去碎片）'}`)

  if (!existsSync(input)) {
    throw new Error(`输入库不存在（${input}）。请用 --from 指定 knowledge.db 路径。`)
  }
  // 同文件守卫用真实路径比较：文本相等会漏掉 /x/./k.db、symlink 别名等写法，
  // 一旦误判为不同路径，先删后建会把源库不可逆删除。
  if (realPathOf(input) === realPathOf(output)) {
    throw new Error('--output 与 --input 指向同一文件（含路径别名），会破坏源库，请指定不同输出路径。')
  }

  const sourceBytes = statSync(input).size

  // 1. VACUUM INTO 生成紧凑副本：先写临时文件，成功后原子替换输出——
  // VACUUM INTO 要求目标不存在，直接 rmSync(output) 会在 VACUUM 失败时
  // 丢掉上一份可用产物。
  mkdirSync(dirname(resolve(output)), { recursive: true })
  const tmpOutput = resolve(output) + `.tmp-${process.pid}`
  if (existsSync(tmpOutput)) rmSync(tmpOutput)
  log('[1/3] VACUUM INTO 生成紧凑副本…')
  {
    const db = new DatabaseSync(input, { readOnly: true })
    try {
      db.exec(`VACUUM INTO '${sqlQuote(tmpOutput)}'`)
    } finally {
      db.close()
    }
  }
  if (existsSync(output)) {
    log(`输出已存在，覆盖: ${output}`)
    rmSync(output)
  }
  renameSync(tmpOutput, output)

  // 2. Compress chunks, drop tables, then vacuum again.
  let compressedChunks = 0
  {
    const db = new DatabaseSync(output)
    try {
      if (compress) {
        log('[2/3] 压缩 chunks.content（长 chunk 转 gzip BLOB）…')
        compressedChunks = compressChunksTable(db)
        log(`    完成：压缩 ${compressedChunks.toLocaleString()} 条（其余明文保留）`)
      }
      if (dropped.length > 0) {
        log(`[2/3] 删除: ${dropped.join(', ')}…`)
        db.exec(dropped.map(t => `DROP TABLE IF EXISTS "${t}"`).join(';\n'))
      }
      log('[3/3] 二次 VACUUM 释放空间…')
      db.exec('VACUUM')
    } finally {
      db.close()
    }
  }

  const outputBytes = statSync(output).size
  log('')
  log('=== 结果 ===')
  log(`源库:   ${gb(sourceBytes)}`)
  log(`裁剪版: ${gb(outputBytes)}（-${Math.round((1 - outputBytes / sourceBytes) * 100)}%）`)
  {
    const db = new DatabaseSync(output, { readOnly: true })
    try {
      log('保留表行数:')
      for (const t of ['kg_nodes', 'kg_edges', 'documents', 'chunks']) {
        const n = countRows(db, t)
        log(`  ${t.padEnd(12)} ${n >= 0 ? n.toLocaleString() : '（缺失）'}`)
      }
    } finally {
      db.close()
    }
  }

  if (!skipVerify) {
    verifyComponents(output, noFts, log)
  }

  return { input, output, inputBytes: sourceBytes, outputBytes, dropped, compressedChunks }
}

/** Fail-loud component verification of the trimmed database. */
function verifyComponents(output: string, noFts: boolean, log: (line: string) => void): void {
  log('=== 组件验证 ===')
  const kg = new KgStore(output)
  log(`  KgStore schema=${kg.schemaKind()} fts=${kg.ftsMode()}`)
  const hit = kg.searchByKeyword('创造性', 1)
  log(`  KgStore 关键词检索: ${hit.length > 0 ? `命中 ${hit.length}` : '无命中'}`)
  kg.close()

  const law = new KnowledgeLawSearch(output)
  const lawCount = law.count()
  const lawHits = law.search('新颖性', { limit: 1 })
  log(`  KnowledgeLawSearch count=${lawCount} fts=${law.ftsAvailable} 检索: ${lawHits.length > 0 ? `命中 ${lawHits[0]?.name}` : '无命中'}`)
  law.close()

  const cs = new CaseLawSearchEngine(output)
  const csCount = cs.count()
  const query = noFts ? '创造性' : '创造性 三步法'
  const csHits = cs.search(query, { limit: 1 })
  log(`  CaseLawSearchEngine count=${csCount} fts=${cs.ftsAvailable} 检索"${query}": ${csHits.length > 0 ? `命中 ${csHits[0]?.title}` : '无命中'}`)
  cs.close()
}
