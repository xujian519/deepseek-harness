/**
 * legal-knowledge:install — the legal knowledge database bootstrap.
 *
 * Copies a source legal.db into the runtime data directory, optionally
 * trimming FTS5 indexes for a compact deployment. The source database is
 * opened read-only and never modified.
 *
 * The install logic never runs on plugin load; it is exported for programmatic
 * use and wrapped by the legal-knowledge-install bin.
 * @module @deepseek-ai/dsh-legal-knowledge/install
 */

import { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_LEGAL_KNOWLEDGE_DIR, DEFAULT_LEGAL_SOURCE_DB_PATH } from './config.ts'
import type { InstallLegalKnowledgeOptions, InstallResult } from './types.ts'

/**
 * Resolve the true absolute path of a file that may not yet exist. Walks up
 * to the first existing ancestor, applies realpath, then re-appends the
 * missing segments.
 * @param path - the file path to normalise.
 * @returns the normalised absolute path.
 */
function realPathOf(path: string): string {
  const abs = resolve(path)
  let dir = dirname(abs)
  let suffix = basename(abs)
  while (!existsSync(dir)) {
    suffix = join(basename(dir), suffix)
    dir = dirname(dir)
  }
  return join(realpathSync(dir), suffix)
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
 * Drop FTS5 virtual tables and their shadow indexes from the output database.
 * @param db - an open writable database connection.
 * @returns the names of the tables that were actually dropped.
 */
function dropFtsTables(db: DatabaseSync): string[] {
  const ftsTables = [
    'case_law_fts', 'case_law_fts_data', 'case_law_fts_idx', 'case_law_fts_docsize',
    'legal_regulations_fts', 'legal_regulations_fts_data', 'legal_regulations_fts_idx', 'legal_regulations_fts_docsize',
    'judicial_interpretations_fts', 'judicial_interpretations_fts_data', 'judicial_interpretations_fts_idx', 'judicial_interpretations_fts_docsize',
  ]
  const existing = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map(r => r.name),
  )
  const dropped: string[] = []
  for (const table of ftsTables) {
    if (!existing.has(table)) continue
    db.exec(`DROP TABLE IF EXISTS "${table}"`)
    dropped.push(table)
  }
  return dropped
}

/**
 * Initialise the legal knowledge database by copying (and optionally trimming)
 * a source database into the runtime data directory.
 *
 * @param options - input/output paths, trimming toggles, and a log sink.
 * @returns the install summary (paths and sizes).
 */
export async function installLegalKnowledgeDb(options: InstallLegalKnowledgeOptions = {}): Promise<InstallResult> {
  const log = options.log ?? console.log
  const knowledgeDir = options.knowledgeDir ?? DEFAULT_LEGAL_KNOWLEDGE_DIR
  const sourceDbPath = options.sourceDbPath ?? DEFAULT_LEGAL_SOURCE_DB_PATH
  const input = sourceDbPath
  const output = options.output ?? join(knowledgeDir, 'legal.db')
  const noFts = options.noFts ?? false

  log(`输入: ${input}`)
  log(`输出: ${output}`)

  if (!existsSync(input)) {
    throw new Error(`输入库不存在（${input}）。请用 --from 指定 legal.db 路径。`)
  }

  // Same-file guard: prevent accidentally overwriting the source.
  if (realPathOf(input) === realPathOf(output)) {
    throw new Error('--output 与 --input 指向同一文件（含路径别名），会破坏源库，请指定不同输出路径。')
  }

  const sourceBytes = statSync(input).size

  // 1. Copy source to a temporary file, then atomically replace the output.
  mkdirSync(dirname(resolve(output)), { recursive: true })
  const tmpOutput = resolve(output) + `.tmp-${process.pid}`
  if (existsSync(tmpOutput)) rmSync(tmpOutput)

  log('[1/3] 复制源数据库…')
  copyFileSync(input, tmpOutput)

  // 2. Optionally trim FTS5 tables and VACUUM.
  const dropped: string[] = []
  {
    const db = new DatabaseSync(tmpOutput)
    try {
      if (noFts) {
        log('[2/3] 删除 FTS5 索引…')
        const result = dropFtsTables(db)
        dropped.push(...result)
        if (dropped.length > 0) {
          log(`    已删除: ${dropped.join(', ')}`)
        } else {
          log('    无 FTS5 表可删除')
        }
      } else {
        log('[2/3] 保留 FTS5 索引（未启用 noFts）')
      }
      log('[3/3] VACUUM 释放碎片空间…')
      db.exec('VACUUM')
    } finally {
      db.close()
    }
  }

  if (existsSync(output)) {
    log(`输出已存在，覆盖: ${output}`)
    rmSync(output)
  }
  renameSync(tmpOutput, output)

  const outputBytes = statSync(output).size
  log('')
  log('=== 结果 ===')
  log(`源库:     ${gb(sourceBytes)}`)
  log(`安装后:   ${gb(outputBytes)}（-${sourceBytes > 0 ? Math.round((1 - outputBytes / sourceBytes) * 100) : 0}%）`)

  // Report row counts for key tables.
  {
    const db = new DatabaseSync(output, { readOnly: true })
    try {
      log('保留表行数:')
      for (const t of ['case_law', 'legal_regulations', 'judicial_interpretations', 'guiding_cases']) {
        const n = countRows(db, t)
        log(`  ${t.padEnd(28)} ${n >= 0 ? n.toLocaleString() : '（缺失）'}`)
      }
    } finally {
      db.close()
    }
  }

  return { input, output, inputBytes: sourceBytes, outputBytes }
}
