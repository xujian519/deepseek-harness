import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJsonlRows, readLatestJsonRow } from '../src/jsonl.ts'

const parse = (raw: unknown): { value: number } | null => {
  const item = raw as { value?: unknown }
  return typeof item.value === 'number' ? { value: item.value } : null
}

describe('readJsonlRows', () => {
  it('returns an empty array for a missing file', async () => {
    expect(await readJsonlRows(join(await mkdtemp(join(tmpdir(), 'se-jsonl-')), 'absent.jsonl'), parse)).toEqual([])
  })

  it('parses rows in order and skips blank lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    const file = join(dir, 'rows.jsonl')
    await writeFile(file, '{"value": 1}\n\n{"value": 2}\n')
    expect(await readJsonlRows(file, parse)).toEqual([{ value: 1 }, { value: 2 }])
  })

  it('skips malformed lines and rows the parser rejects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    const file = join(dir, 'rows.jsonl')
    await writeFile(file, '{"value": 1}\nnot-json\n{"other": true}\n{"value": 3}\n')
    expect(await readJsonlRows(file, parse)).toEqual([{ value: 1 }, { value: 3 }])
  })

  it('propagates non-ENOENT read failures', async () => {
    // readFile on a directory yields EISDIR, not ENOENT; the reader must rethrow.
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    await expect(readJsonlRows(dir, parse)).rejects.toThrow()
  })
})

describe('readLatestJsonRow', () => {
  it('returns null for a missing directory', async () => {
    expect(await readLatestJsonRow(join(await mkdtemp(join(tmpdir(), 'se-jsonl-')), 'absent'), parse)).toBeNull()
  })

  it('propagates non-ENOENT readdir failures', async () => {
    // readdir on a regular file yields ENOTDIR, not ENOENT; the reader must rethrow.
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    const file = join(dir, 'plain.txt')
    await writeFile(file, 'x')
    await expect(readLatestJsonRow(file, parse)).rejects.toThrow()
  })

  it('returns null for an empty directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    expect(await readLatestJsonRow(dir, parse)).toBeNull()
  })

  it('reads the lexicographically latest .json row and ignores other files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    await writeFile(join(dir, 'a.json'), '{"value": 1}')
    await writeFile(join(dir, 'b.json'), '{"value": 2}')
    await writeFile(join(dir, 'note.txt'), '{"value": 9}')
    expect(await readLatestJsonRow(dir, parse)).toEqual({ value: 2 })
  })

  it('propagates parse errors from the latest row', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'se-jsonl-'))
    await writeFile(join(dir, 'broken.json'), 'not-json')
    await expect(readLatestJsonRow(dir, parse)).rejects.toThrow()
  })
})
