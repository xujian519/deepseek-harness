/**
 * Shared append-only durable-file readers for the self-evolve provider: one
 * JSONL row reader and one latest-JSON-row reader. Both treat a missing file
 * as an empty result; the JSONL reader skips malformed lines so a corrupt
 * diagnostics row never blocks mining, while the archive reader propagates
 * parse errors so a corrupt rollback champion fails loud.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic/jsonl
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Read an append-only JSONL file into parsed rows. A missing file yields an
 * empty array; malformed lines are skipped.
 *
 * @param file - absolute path of the JSONL file.
 * @param parse - row parser; return null to skip a row.
 * @returns the parsed rows, in file order.
 */
export async function readJsonlRows<T>(file: string, parse: (raw: unknown) => T | null): Promise<T[]> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const rows: T[] = []
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      const row = parse(JSON.parse(line))
      if (row !== null) rows.push(row)
    } catch {
      // swallow a malformed line: append-only diagnostics must not block mining
    }
  }
  return rows
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
