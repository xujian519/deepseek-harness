import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import {
  MIN_COMPRESS_CHARS,
  compressChunk,
  decompressChunk,
  registerChunkUncompress,
  shouldCompress,
} from '@deepseek-ai/dsh-patent-knowledge'

describe('chunk-compression', () => {
  it('round-trips a long Chinese text through compress/decompress', () => {
    const text = '权利要求所述技术方案具有突出的实质性特点，不属于本领域技术人员容易想到的改进。'.repeat(30)
    const blob = compressChunk(text)
    expect(blob.length).toBeLessThan(Buffer.byteLength(text, 'utf8'))
    expect(blob[0]).toBe(0x53)
    expect(blob[1]).toBe(0x43)
    expect(decompressChunk(blob)).toBe(text)
  })

  it('returns plain text unchanged', () => {
    const text = '普通明文笔记内容，无需压缩。'
    expect(decompressChunk(text)).toBe(text)
  })

  it('keeps short text plain (threshold)', () => {
    expect(shouldCompress('短文本')).toBe(false)
    const long = '超过阈值的长文本'.repeat(Math.ceil(MIN_COMPRESS_CHARS / 8))
    expect(long.length).toBeGreaterThanOrEqual(MIN_COMPRESS_CHARS)
    expect(shouldCompress(long)).toBe(true)
  })

  it('falls back to utf8 for a non-gzip BLOB', () => {
    const raw = Buffer.from('非压缩 BLOB 内容', 'utf8')
    expect(decompressChunk(raw)).toBe('非压缩 BLOB 内容')
  })

  it('does not throw on an SC-magic BLOB that is not valid gzip', () => {
    const corrupt = Buffer.concat([Buffer.from([0x53, 0x43]), Buffer.from('不是 gzip 数据', 'utf8')])
    expect(() => decompressChunk(corrupt)).not.toThrow()
    expect(decompressChunk(corrupt)).toBe(corrupt.toString('utf8'))
  })

  it('sati_uncompress does not throw on a corrupt BLOB', () => {
    const db = new DatabaseSync(':memory:')
    registerChunkUncompress(db)
    db.exec('CREATE TABLE t (content)')
    db.prepare('INSERT INTO t VALUES (?)').run(Buffer.concat([Buffer.from([0x53, 0x43]), Buffer.from('坏数据')]))
    const row = db.prepare('SELECT sati_uncompress(content) AS c FROM t').get() as { c: string }
    expect(typeof row.c).toBe('string')
    db.close()
  })

  it('sati_uncompress returns plain text, decompresses gzip, and maps NULL to empty', () => {
    const db = new DatabaseSync(':memory:')
    registerChunkUncompress(db)
    db.exec('CREATE TABLE t (content)')
    db.prepare('INSERT INTO t VALUES (?)').run('明文内容')
    db.prepare('INSERT INTO t VALUES (?)').run(compressChunk('压缩后的长正文内容'.repeat(50)))
    db.prepare('INSERT INTO t VALUES (?)').run(null)
    const rows = db.prepare('SELECT sati_uncompress(content) AS c FROM t ORDER BY rowid').all() as Array<{ c: string }>
    expect(rows[0]!.c).toBe('明文内容')
    expect(rows[1]!.c).toBe('压缩后的长正文内容'.repeat(50))
    expect(rows[2]!.c).toBe('')
    db.close()
  })

  it('decompression is idempotent', () => {
    const text = '幂等性验证文本。'.repeat(100)
    const blob = compressChunk(text)
    expect(decompressChunk(decompressChunk(blob))).toBe(text)
  })

  it('sati_uncompress stringifies non-text storage classes (integer)', () => {
    const db = new DatabaseSync(':memory:')
    registerChunkUncompress(db)
    db.exec('CREATE TABLE t (v)')
    db.prepare('INSERT INTO t VALUES (?)').run(42)
    const row = db.prepare('SELECT sati_uncompress(v) AS c FROM t').get() as { c: string }
    expect(row.c).toBe('42')
    db.close()
  })

  it('sati_uncompress maps an undefined value to the empty string', () => {
    let callback: ((value: unknown) => string) | undefined
    const stub = {
      function: (_name: string, _options: unknown, fn: (value: unknown) => string) => {
        callback = fn
      },
    } as unknown as DatabaseSync
    registerChunkUncompress(stub)
    expect(callback).toBeDefined()
    expect(callback!(undefined)).toBe('')
    expect(callback!(null)).toBe('')
    expect(callback!('明文')).toBe('明文')
  })
})
