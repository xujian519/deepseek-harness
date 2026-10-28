// Port of Sati tests/patent/persist-utils.spec.ts: safe-id validation, atomic
// JSON write, and JsonFileStore round-trip/corruption/filtering coverage.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonFileStore, SAFE_ID_PATTERN, assertSafeId, atomicWriteJson } from '@deepseek-ai/dsh-patent-data'
import { StoredRecordError, parseStoredJsonRecord } from '@deepseek-ai/dsh-patent-core'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'persist-utils-test-'))
}

describe('assertSafeId', () => {
  it('rejects path injection and hidden files, allows the safe character set', () => {
    expect(SAFE_ID_PATTERN.test('case-123_a.b')).toBe(true)
    for (const bad of ['../etc', 'a/b', 'a\b', '.hidden', '', 'a b', 'a:b']) {
      expect(() => { assertSafeId(bad, 'id') }).toThrow(RangeError)
    }
    expect(() => { assertSafeId('case-123', 'id') }).not.toThrow()
  })
})

describe('JsonFileStore', () => {
  it('round-trips save → load → listIds with atomic overwrite', async () => {
    const dir = tempDir()
    try {
      const store = new JsonFileStore<{ n: number }>(dir, raw => JSON.parse(raw) as { n: number })
      await store.save('run-1', { n: 1 })
      await store.save('run-2', { n: 2 })
      await store.save('run-1', { n: 100 })
      expect(await store.load('run-1')).toEqual({ n: 100 })
      expect(await store.load('run-2')).toEqual({ n: 2 })
      expect((await store.listIds()).sort()).toEqual(['run-1', 'run-2'])
      const files = readdirSync(dir)
      expect(files.some(f => f.includes('.tmp-'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined for a missing id and throws on corrupted JSON', async () => {
    const dir = tempDir()
    try {
      const store = new JsonFileStore<{ n: number }>(dir, raw => JSON.parse(raw) as { n: number })
      expect(await store.load('missing')).toBeUndefined()
      writeFileSync(join(dir, 'broken.json'), '{not json')
      await expect(store.load('broken')).rejects.toThrow(SyntaxError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('filters foreign files out of listIds', async () => {
    const dir = tempDir()
    try {
      const store = new JsonFileStore<{ n: number }>(dir, raw => JSON.parse(raw) as { n: number })
      await store.save('ok', { n: 1 })
      writeFileSync(join(dir, 'notes.txt'), 'x')
      writeFileSync(join(dir, '..json'), '{}')
      writeFileSync(join(dir, '.hidden.json'), '{}')
      writeFileSync(join(dir, 'with space.json'), '{}')
      expect(await store.listIds()).toEqual(['ok'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('creates nested directories on save', async () => {
    const dir = tempDir()
    try {
      const nested = join(dir, 'a', 'b')
      const store = new JsonFileStore<{ n: number }>(nested, raw => JSON.parse(raw) as { n: number })
      await store.save('run', { n: 1 })
      expect(await store.load('run')).toEqual({ n: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('JsonFileStore parse 回调契约', () => {
  it('把记录文件路径传给 parser', async () => {
    const dir = tempDir()
    try {
      const seen: string[] = []
      const store = new JsonFileStore<string>(dir, (raw, file) => {
        seen.push(file)
        return JSON.parse(raw) as string
      })
      await store.save('a1', 'value')
      expect(await store.load('a1')).toBe('value')
      expect(seen).toEqual([join(dir, 'a1.json')])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parser 抛出的 ENOENT 错误向上传播，不被当作文件缺失', async () => {
    const dir = tempDir()
    try {
      const store = new JsonFileStore<string>(dir, () => {
        const error: NodeJS.ErrnoException = new Error('parser rejected the record')
        error.code = 'ENOENT'
        throw error
      })
      await store.save('a1', 'value')
      await expect(store.load('a1')).rejects.toThrow('parser rejected the record')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseStoredJsonRecord', () => {
  it('返回解析后的 JSON 对象', () => {
    expect(parseStoredJsonRecord('{"a":1}', 'x.json', 'run')).toEqual({ a: 1 })
  })

  it('非对象 JSON 与非法 JSON 都抛带文件与记录类型的错误', () => {
    const file = join(tmpdir(), 'x.json')
    for (const raw of ['[]', 'null', '"text"', '42', '{not json']) {
      let caught: StoredRecordError | undefined
      try {
        parseStoredJsonRecord(raw, file, 'checkpoint')
      } catch (error) {
        if (error instanceof StoredRecordError) caught = error
      }
      expect(caught, raw).toBeInstanceOf(StoredRecordError)
      expect(caught?.file).toBe(file)
      expect(caught?.recordKind).toBe('checkpoint')
      expect(caught?.message).toContain(file)
    }
  })
})

describe('atomicWriteJson', () => {
  it('writes complete content (no BOM/truncation)', async () => {
    const dir = tempDir()
    try {
      const file = join(dir, 'out.json')
      const content = JSON.stringify({ a: [1, 2, 3], b: '中文内容' })
      await atomicWriteJson(file, content)
      expect(readFileSync(file, 'utf8')).toBe(content)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
