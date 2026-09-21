// 上游来源：Mady 项目 `domains/doctmpl/renderer_docx.go`（写侧用 `archive/zip`）
// 与 `knowledge/fileindex/reader_docx.go`（读侧用 `zip.OpenReader`）。容器级用例
// 按本包的读写契约编写，Go 侧没有等价的错误分支可转写。

import { describe, expect, it } from 'vitest'
import { crc32, readZip, writeZip } from '../src/zip.ts'

/** The standard CRC-32 check value of the ASCII string "123456789". */
const CRC32_CHECK = 0xcbf43926

const TEXT_CODEC = new TextEncoder()

/** Absolute offset of the central directory, read from the end record. */
function centralDirectoryOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(bytes.length - 22 + 16, true)
}

/** Overwrite one little-endian 32-bit field of an archive. */
function patchUint32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}

/** Overwrite one little-endian 16-bit field of an archive. */
function patchUint16(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

/** One archive holding a stored and a deflated part, with equal name lengths. */
function sampleArchive(options: { compression?: 'store' | 'deflate' } = {}): Uint8Array {
  return writeZip([
    { name: 'word/document.xml', data: TEXT_CODEC.encode('<w:p>a</w:p>') },
    { name: 'word/header1.xml', data: TEXT_CODEC.encode('<w:p>b</w:p>') },
  ], options)
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(TEXT_CODEC.encode('123456789'))).toBe(CRC32_CHECK)
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('writeZip and readZip', () => {
  it('round-trips deflated parts, names, and binary data', () => {
    const payload = new Uint8Array(256).map((_value, index) => index)
    const bytes = writeZip([{ name: 'word/document.xml', data: payload }])
    const archive = readZip(bytes)
    expect(archive.problems).toEqual([])
    expect(archive.entries.map(entry => entry.name)).toEqual(['word/document.xml'])
    expect([...(archive.entries[0]?.data ?? [])]).toEqual([...payload])
  })

  it('round-trips stored parts and non-ASCII names', () => {
    const archive = readZip(writeZip([{ name: '页眉.xml', data: TEXT_CODEC.encode('x') }], { compression: 'store' }))
    expect(archive.problems).toEqual([])
    expect(archive.entries[0]?.name).toBe('页眉.xml')
    expect(new TextDecoder().decode(archive.entries[0]?.data)).toBe('x')
  })

  it('writes byte-stable archives', () => {
    expect([...sampleArchive()]).toEqual([...sampleArchive()])
  })

  it('reads an archive that still carries bytes after its end record', () => {
    const bytes = sampleArchive()
    const padded = new Uint8Array(bytes.length + 4)
    padded.set(bytes)
    padded.set(TEXT_CODEC.encode('tail'), bytes.length)
    expect(readZip(padded).entries.map(entry => entry.name)).toEqual(['word/document.xml', 'word/header1.xml'])
  })

  it('reads an archive with no entries', () => {
    expect(readZip(writeZip([]))).toEqual({ entries: [], problems: [] })
  })

  it('reads entries in central directory order when the local headers disagree', () => {
    const bytes = sampleArchive()
    const directory = centralDirectoryOffset(bytes)
    const first = bytes.slice(directory, directory + 46 + 'word/document.xml'.length)
    const second = bytes.slice(directory + first.length, directory + first.length + 46 + 'word/header1.xml'.length)
    bytes.set(second, directory)
    bytes.set(first, directory + second.length)
    expect(readZip(bytes).entries.map(entry => entry.name)).toEqual(['word/header1.xml', 'word/document.xml'])
  })

  it('rejects a name longer than the name length field', () => {
    expect(() => writeZip([{ name: 'x'.repeat(65536), data: new Uint8Array() }])).toThrow(RangeError)
  })
})

describe('readZip failures', () => {
  it('reports bytes that hold no archive', () => {
    expect(readZip(new Uint8Array())).toEqual({
      entries: [],
      problems: [{ code: 'not-a-zip', detail: 'no end-of-central-directory record' }],
    })
    expect(readZip(TEXT_CODEC.encode('not a zip')).problems[0]?.code).toBe('not-a-zip')
  })

  it('reports a ZIP64 archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, bytes.length - 22 + 16, 0xffffffff)
    expect(readZip(bytes).problems).toEqual([
      { code: 'unsupported-archive', detail: 'the archive announces ZIP64 extensions' },
    ])
  })

  it('reports a central directory outside the archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, bytes.length - 22 + 16, bytes.length + 64)
    expect(readZip(bytes)).toEqual({
      entries: [],
      problems: [{ code: 'not-a-zip', detail: 'the central directory lies outside the archive' }],
    })
  })

  it('reports a central directory record without a signature', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes), 0)
    expect(readZip(bytes).problems.map(problem => problem.code)).toEqual(['not-a-zip'])
  })

  it('reports a central directory record that extends past the archive', () => {
    const bytes = sampleArchive()
    patchUint16(bytes, centralDirectoryOffset(bytes) + 28, 0xffff)
    expect(readZip(bytes).problems.map(problem => problem.code)).toEqual(['truncated-entry'])
  })

  it('reports a missing local file header', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes) + 42, bytes.length + 64)
    expect(readZip(bytes).problems).toEqual([
      { code: 'truncated-entry', part: 'word/document.xml', detail: 'the local file header is missing or out of range' },
    ])
  })

  it('reports entry data that extends past the archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes) + 20, bytes.length)
    expect(readZip(bytes).problems.map(problem => problem.code)).toEqual(['truncated-entry'])
  })

  it('reports an unsupported compression method', () => {
    const bytes = sampleArchive()
    patchUint16(bytes, centralDirectoryOffset(bytes) + 10, 12)
    expect(readZip(bytes).problems.map(problem => problem.detail)).toEqual(['entry uses compression method 12'])
  })

  it('reports a deflate stream that cannot be read', () => {
    const bytes = sampleArchive()
    const directory = centralDirectoryOffset(bytes)
    const payloadStart = 30 + 'word/document.xml'.length
    const payloadSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(directory + 20, true)
    bytes.fill(0xff, payloadStart, payloadStart + payloadSize)
    const problems = readZip(bytes).problems
    expect(problems.map(problem => problem.code)).toEqual(['corrupt-entry'])
    expect(problems[0]?.detail).toContain('the deflate stream is unreadable')
  })

  it('reports a checksum that does not match the stored data', () => {
    const bytes = sampleArchive({ compression: 'store' })
    patchUint32(bytes, centralDirectoryOffset(bytes) + 16, 0)
    expect(readZip(bytes).problems).toEqual([
      { code: 'corrupt-entry', part: 'word/document.xml', detail: 'the entry checksum does not match the central directory' },
    ])
  })
})
