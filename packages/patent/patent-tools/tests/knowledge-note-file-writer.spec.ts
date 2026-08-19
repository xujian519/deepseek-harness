/**
 * Unit tests for the file-backed knowledge-note writer: first-save inserts,
 * repeated saves are idempotent (duplicate), and the directory is created.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNoteFileWriter } from '../src/tool/knowledge-note-file-writer.ts'

describe('createNoteFileWriter', () => {
  it('writes a JSON note file and returns its path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-note-writer-'))
    try {
      const writeNote = createNoteFileWriter(dir)
      const result = await writeNote({ documentId: 'aabbccdd', title: 'OA 答复要点', content: '对比文件 D1 未公开区别特征。', project: 'p1' })
      expect(result).toEqual({ saved: true, path: join(dir, 'aabbccdd.json') })
      const raw = JSON.parse(await readFile(join(dir, 'aabbccdd.json'), 'utf8')) as Record<string, unknown>
      expect(raw.title).toBe('OA 答复要点')
      expect(raw.project).toBe('p1')
      expect(typeof raw.ts).toBe('number')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports duplicate for an already-written documentId', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-note-writer-'))
    try {
      const writeNote = createNoteFileWriter(dir)
      await writeNote({ documentId: 'same', title: 't', content: 'c' })
      const again = await writeNote({ documentId: 'same', title: 't', content: 'c' })
      expect(again).toEqual({ saved: false, reason: 'duplicate' })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('creates the note directory on first write', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-note-writer-'))
    try {
      const dir = join(base, 'nested', '99-知识库')
      const writeNote = createNoteFileWriter(dir)
      const result = await writeNote({ documentId: 'x1', title: 't', content: 'c' })
      expect(result.saved).toBe(true)
      expect(result).toEqual({ saved: true, path: join(dir, 'x1.json') })
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })
})
