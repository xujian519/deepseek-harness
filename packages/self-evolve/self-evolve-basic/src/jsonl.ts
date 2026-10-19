/**
 * Shared append-only durable-file helpers for the self-evolve provider: a
 * JSONL row reader, a cached variant for hot proposal/validation paths, a
 * capped appender, and a latest-JSON-row reader. The readers treat a missing
 * file as an empty result; the JSONL readers skip malformed lines so a corrupt
 * diagnostics row never blocks mining, while the archive reader propagates
 * parse errors so a corrupt rollback champion fails loud.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/jsonl
 */

import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** How long one parsed-file result stays reusable without a fresh stat. */
const CACHE_TTL_MS = 1_000

interface CacheEntry {
  mtimeMs: number
  size: number
  at: number
  rows: unknown[]
}

/** Parsed-row cache keyed by file path; invalidated by mtime/size or TTL. */
const rowCache = new Map<string, CacheEntry>()

/**
 * Drop one path's cached rows; called after this module writes the file.
 *
 * @param file - absolute path of the JSONL file whose cache entry is stale.
 */
export function invalidateJsonlCache(file: string): void {
  rowCache.delete(file)
}

/**
 * Read an append-only JSONL file into parsed rows. A missing file yields an
 * empty array; malformed lines and rows the parser rejects are skipped.
 *
 * @param file - absolute path of the JSONL file.
 * @param parse - row parser; return null to skip a row.
 * @returns the parsed rows, in file order.
 */
export async function readJsonlRows<T>(file: string, parse: (raw: unknown) => T | null): Promise<T[]> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const rows: T[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    let raw: unknown
    try {
      raw = JSON.parse(line)
    } catch {
      continue
    }
    const row = parse(raw)
    if (row !== null) rows.push(row)
  }
  return rows
}

/**
 * Read an append-only JSONL file into parsed rows through a short cache. A
 * missing file yields an empty array; malformed lines are skipped. The cache
 * is validated by `(path, mtimeMs, size)` and expires after one second, so a
 * hot proposal/validation path does not re-parse the whole log per call.
 *
 * @param file - absolute path of the JSONL file.
 * @param parse - row parser; return null to skip a row.
 * @returns the parsed rows, in file order.
 */
export async function readJsonlRowsCached<T>(file: string, parse: (raw: unknown) => T | null): Promise<T[]> {
  let metadata
  try {
    metadata = await stat(file)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      rowCache.delete(file)
      return []
    }
    throw error
  }
  const hit = rowCache.get(file)
  if (
    hit !== undefined
    && hit.mtimeMs === metadata.mtimeMs
    && hit.size === metadata.size
    && Date.now() - hit.at <= CACHE_TTL_MS
  ) {
    return hit.rows as T[]
  }
  const rows = await readJsonlRows(file, parse)
  rowCache.set(file, { mtimeMs: metadata.mtimeMs, size: metadata.size, at: Date.now(), rows })
  return rows
}

/**
 * Append rows to an append-only JSONL file while retaining only the last
 * `maxRows`. The read-rewrite-commit cycle runs under the file's writer lock
 * and commits through an atomic rename, so a concurrent reader sees either
 * the old file or the truncated new one, never a partial line.
 *
 * @param file - absolute path of the JSONL file.
 * @param rows - serialized rows to append, in order.
 * @param maxRows - retained row count after the append.
 */
export async function appendJsonlCapped(file: string, rows: string[], maxRows: number): Promise<void> {
  if (rows.length === 0) return
  await mkdir(dirname(file), { recursive: true })
  await withFileLock(file, async () => {
    let existing: string[] = []
    try {
      existing = (await readFile(file, 'utf8')).split('\n').filter(line => line.trim().length > 0)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const combined = [...existing, ...rows].slice(-maxRows)
    await writeFileAtomic(file, `${combined.join('\n')}\n`, { mode: 0o600 })
    rowCache.delete(file)
  })
}

/**
 * Read the most recent `.json` row of a directory, in lexicographic filename
 * order. A missing directory yields null; a malformed row propagates so the
 * caller's fail-loud policy applies.
 *
 * @param dir - absolute path of the row directory.
 * @param parse - row parser.
 * @returns the latest row, or null when the directory is empty or absent.
 */
export async function readLatestJsonRow<T>(dir: string, parse: (raw: unknown) => T | null): Promise<T | null> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter(file => file.endsWith('.json'))
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  files.sort()
  const latest = files[files.length - 1]
  if (latest === undefined) return null
  return parse(JSON.parse(await readFile(join(dir, latest), 'utf8')))
}
