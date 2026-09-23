// 上游来源：Mady 项目 `domains/doctmpl/renderer_docx.go`（写侧用 `archive/zip`）
// 与 `knowledge/fileindex/reader_docx.go`（读侧用 `zip.OpenReader`）。容器级用例
// 按本包的读写契约编写，Go 侧没有等价的错误分支可转写。

import { describe, expect, it } from 'vitest'
import { crc32, readZip, writeZip } from '../src/zip.ts'
import type { ZipReadLimits } from '../src/types.ts'

/** The standard CRC-32 check value of the ASCII string "123456789". */
const CRC32_CHECK = 0xcbf43926

const TEXT_CODEC = new TextEncoder()

/** Read budgets wide enough that no fixture below reaches them. */
const LIMITS: ZipReadLimits = { maxArchiveEntries: 1_000, maxUncompressedBytes: 1 << 20 }

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

/**
 * Overwrite the declared uncompressed size of a one-entry archive, in both the
 * local file header and the central directory record. The declared size is what
 * a reader must trust before it inflates anything, so this is how a fixture
 * states a size the payload does not have.
 */
function patchDeclaredSize(bytes: Uint8Array, declared: number): void {
  patchUint32(bytes, 22, declared)
  patchUint32(bytes, centralDirectoryOffset(bytes) + 24, declared)
}

/** One entry holding `size` bytes, written with a declared uncompressed size of `declared`. */
function declaredSizeArchive(
  size: number,
  declared: number,
  compression: 'store' | 'deflate' = 'store',
): Uint8Array {
  const bytes = writeZip([{ name: 'word/document.xml', data: new Uint8Array(size).fill(0x61) }], { compression })
  patchDeclaredSize(bytes, declared)
  return bytes
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

  it('matches node:zlib.crc32 across lengths, fills, and byte ranges', () => {
    // Values produced by `node:zlib.crc32`, the implementation this module now
    // delegates to; they pin the checksum the ZIP central directory stores.
    expect(crc32(new Uint8Array(1024).fill(0xff))).toBe(3090874356)
    expect(crc32(new Uint8Array(64 * 1024).fill(0x5a))).toBe(4102653070)
    expect(crc32(new Uint8Array(200).map((_value, index) => index))).toBe(3976749440)
    const backing = new Uint8Array(64).map((_value, index) => index)
    expect(crc32(backing.subarray(7, 40))).toBe(4008122885)
    expect(crc32(backing)).not.toBe(crc32(backing.subarray(7, 40)))
  })
})

describe('writeZip and readZip', () => {
  it('round-trips deflated parts, names, and binary data', () => {
    const payload = new Uint8Array(256).map((_value, index) => index)
    const bytes = writeZip([{ name: 'word/document.xml', data: payload }])
    const archive = readZip(bytes, LIMITS)
    expect(archive.problems).toEqual([])
    expect(archive.entries.map(entry => entry.name)).toEqual(['word/document.xml'])
    expect([...(archive.entries[0]?.data ?? [])]).toEqual([...payload])
  })

  it('round-trips stored parts and non-ASCII names', () => {
    const archive = readZip(writeZip([{ name: '页眉.xml', data: TEXT_CODEC.encode('x') }], { compression: 'store' }), LIMITS)
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
    expect(readZip(padded, LIMITS).entries.map(entry => entry.name)).toEqual(['word/document.xml', 'word/header1.xml'])
  })

  it('reads an archive with no entries', () => {
    expect(readZip(writeZip([]), LIMITS)).toEqual({ entries: [], problems: [] })
  })

  it('reads entries in central directory order when the local headers disagree', () => {
    const bytes = sampleArchive()
    const directory = centralDirectoryOffset(bytes)
    const first = bytes.slice(directory, directory + 46 + 'word/document.xml'.length)
    const second = bytes.slice(directory + first.length, directory + first.length + 46 + 'word/header1.xml'.length)
    bytes.set(second, directory)
    bytes.set(first, directory + second.length)
    expect(readZip(bytes, LIMITS).entries.map(entry => entry.name)).toEqual(['word/header1.xml', 'word/document.xml'])
  })

  it('rejects a name longer than the name length field', () => {
    expect(() => writeZip([{ name: 'x'.repeat(65536), data: new Uint8Array() }])).toThrow(RangeError)
  })
})

describe('readZip failures', () => {
  it('reports bytes that hold no archive', () => {
    expect(readZip(new Uint8Array(), LIMITS)).toEqual({
      entries: [],
      problems: [{ code: 'not-a-zip', detail: 'no end-of-central-directory record' }],
    })
    expect(readZip(TEXT_CODEC.encode('not a zip'), LIMITS).problems[0]?.code).toBe('not-a-zip')
  })

  it('reports a ZIP64 archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, bytes.length - 22 + 16, 0xffffffff)
    expect(readZip(bytes, LIMITS).problems).toEqual([
      { code: 'unsupported-archive', detail: 'the archive announces ZIP64 extensions' },
    ])
  })

  it('reports a central directory outside the archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, bytes.length - 22 + 16, bytes.length + 64)
    expect(readZip(bytes, LIMITS)).toEqual({
      entries: [],
      problems: [{ code: 'not-a-zip', detail: 'the central directory lies outside the archive' }],
    })
  })

  it('reports a central directory record without a signature', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes), 0)
    expect(readZip(bytes, LIMITS).problems.map(problem => problem.code)).toEqual(['not-a-zip'])
  })

  it('reports a central directory record that extends past the archive', () => {
    const bytes = sampleArchive()
    patchUint16(bytes, centralDirectoryOffset(bytes) + 28, 0xffff)
    expect(readZip(bytes, LIMITS).problems.map(problem => problem.code)).toEqual(['truncated-entry'])
  })

  it('reports a missing local file header', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes) + 42, bytes.length + 64)
    expect(readZip(bytes, LIMITS).problems).toEqual([
      { code: 'truncated-entry', part: 'word/document.xml', detail: 'the local file header is missing or out of range' },
    ])
  })

  it('reports entry data that extends past the archive', () => {
    const bytes = sampleArchive()
    patchUint32(bytes, centralDirectoryOffset(bytes) + 20, bytes.length)
    expect(readZip(bytes, LIMITS).problems.map(problem => problem.code)).toEqual(['truncated-entry'])
  })

  it('reports an unsupported compression method', () => {
    const bytes = sampleArchive()
    patchUint16(bytes, centralDirectoryOffset(bytes) + 10, 12)
    expect(readZip(bytes, LIMITS).problems.map(problem => problem.detail)).toEqual(['entry uses compression method 12'])
  })

  it('reports a deflate stream that cannot be read', () => {
    const bytes = sampleArchive()
    const directory = centralDirectoryOffset(bytes)
    const payloadStart = 30 + 'word/document.xml'.length
    const payloadSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(directory + 20, true)
    bytes.fill(0xff, payloadStart, payloadStart + payloadSize)
    const problems = readZip(bytes, LIMITS).problems
    expect(problems.map(problem => problem.code)).toEqual(['corrupt-entry'])
    expect(problems[0]?.detail).toContain('the deflate stream is unreadable')
  })

  it('reports a checksum that does not match the stored data', () => {
    const bytes = sampleArchive({ compression: 'store' })
    patchUint32(bytes, centralDirectoryOffset(bytes) + 16, 0)
    expect(readZip(bytes, LIMITS).problems).toEqual([
      { code: 'corrupt-entry', part: 'word/document.xml', detail: 'the entry checksum does not match the central directory' },
    ])
  })
})

describe('readZip decompression budgets', () => {
  /** Budgets tight enough that a small fixture reaches them. */
  const TIGHT: ZipReadLimits = { maxArchiveEntries: 10, maxUncompressedBytes: 4096 }

  it('refuses an archive that declares more entries than the budget allows', () => {
    const bytes = writeZip(Array.from({ length: 11 }, (_value, index) => (
      { name: `part-${String(index)}.xml`, data: TEXT_CODEC.encode('x') }
    )))
    expect(readZip(bytes, TIGHT)).toEqual({
      entries: [],
      problems: [{ code: 'too-large', detail: 'the archive declares 11 entries, above the 10-entry budget' }],
    })
  })

  it('reads an archive that declares exactly the entry budget', () => {
    const bytes = writeZip(Array.from({ length: 10 }, (_value, index) => (
      { name: `part-${String(index)}.xml`, data: TEXT_CODEC.encode('x') }
    )))
    const archive = readZip(bytes, TIGHT)
    expect(archive.problems).toEqual([])
    expect(archive.entries).toHaveLength(10)
  })

  it('refuses a declared entry size above the budget without inflating the payload', () => {
    // 64 KiB of deflated payload declared as 1 GiB: the detail names the
    // declaration, which is what tells this guard apart from the inflate cap
    // that would refuse the same entry only after expanding it.
    const bytes = declaredSizeArchive(64 * 1024, 1 << 30, 'deflate')
    expect(readZip(bytes, TIGHT)).toEqual({
      entries: [],
      problems: [{
        code: 'too-large',
        part: 'word/document.xml',
        detail: 'the entry declares 1073741824 uncompressed bytes, above the 4096 bytes left of the budget',
      }],
    })
  })

  it('refuses a deflate stream that expands past the budget while the declaration understates it', () => {
    // 64 KiB of payload declared as 16 bytes: the declaration clears the budget,
    // so only the inflate output cap can refuse this entry.
    const bytes = declaredSizeArchive(64 * 1024, 16, 'deflate')
    const archive = readZip(bytes, TIGHT)
    expect(archive.entries).toEqual([])
    expect(archive.problems).toEqual([{
      code: 'too-large',
      part: 'word/document.xml',
      detail: 'the deflate stream expands beyond the 4096 bytes left of the budget',
    }])
  })

  it('refuses a stored entry that holds more bytes than the budget leaves', () => {
    // A stored entry is copied verbatim, so its length — not its declaration —
    // is what the budget has to bound.
    const bytes = declaredSizeArchive(64 * 1024, 16)
    const archive = readZip(bytes, TIGHT)
    expect(archive.entries).toEqual([])
    expect(archive.problems).toEqual([{
      code: 'too-large',
      part: 'word/document.xml',
      detail: 'the stored entry holds 65536 bytes, above the 4096 bytes left of the budget',
    }])
  })

  it('reads an entry that fills the budget exactly, and an empty entry after it', () => {
    const bytes = writeZip([
      { name: 'word/document.xml', data: new Uint8Array(4096).fill(0x61) },
      { name: 'word/header1.xml', data: new Uint8Array(0) },
    ])
    const archive = readZip(bytes, TIGHT)
    expect(archive.problems).toEqual([])
    expect(archive.entries.map(entry => entry.data.length)).toEqual([4096, 0])
  })

  it('stops reading once the accumulated total would pass the budget', () => {
    // The third part is small enough to fit the bytes left, so only a reader
    // that stops at the over-budget part leaves it out.
    const bytes = writeZip([
      { name: 'a.xml', data: new Uint8Array(60).fill(0x61) },
      { name: 'b.xml', data: new Uint8Array(60).fill(0x61) },
      { name: 'c.xml', data: new Uint8Array(5).fill(0x61) },
    ])
    const archive = readZip(bytes, { maxArchiveEntries: 10, maxUncompressedBytes: 100 })
    expect(archive.entries.map(entry => entry.name)).toEqual(['a.xml'])
    expect(archive.problems).toEqual([{
      code: 'too-large',
      part: 'b.xml',
      detail: 'the entry declares 60 uncompressed bytes, above the 40 bytes left of the budget',
    }])
  })

  it('trusts the declared size of a stored entry over its payload length', () => {
    // The payload would fit the budget exactly; the declaration does not, and a
    // declaration the payload contradicts is refused rather than repaired.
    const bytes = declaredSizeArchive(4096, 4097)
    expect(readZip(bytes, TIGHT).problems).toEqual([{
      code: 'too-large',
      part: 'word/document.xml',
      detail: 'the entry declares 4097 uncompressed bytes, above the 4096 bytes left of the budget',
    }])
  })
})
