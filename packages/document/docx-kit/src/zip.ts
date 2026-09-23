/**
 * Minimal ZIP container reading and writing over `node:zlib`, the only
 * dependency either direction needs. Entries use store or deflate compression.
 * Entry names are written as UTF-8 and read as UTF-8; the ZIP64 extensions are
 * not decoded.
 *
 * The Go originals used `archive/zip`, whose writer always emits a data
 * descriptor and the current timestamp; this writer records sizes in the local
 * header and a fixed DOS timestamp, so equal input bytes produce equal output.
 */

import { crc32 as nodeCrc32, deflateRawSync, inflateRawSync } from 'node:zlib'
import type { DocxProblem, ZipArchive, ZipCompression, ZipEntry, ZipEntryInput, ZipReadLimits, ZipWriteOptions } from './types.ts'

/** Local file header signature. */
const LOCAL_SIGNATURE = 0x04034b50
/** Central directory header signature. */
const CENTRAL_SIGNATURE = 0x02014b50
/** End-of-central-directory record signature. */
const END_SIGNATURE = 0x06054b50
/** Fixed local file header length. */
const LOCAL_HEADER_LENGTH = 30
/** Fixed central directory header length. */
const CENTRAL_HEADER_LENGTH = 46
/** Fixed end-of-central-directory record length, comment excluded. */
const END_RECORD_LENGTH = 22
/** Largest end-of-central-directory comment length. */
const MAX_COMMENT_LENGTH = 0xffff
/** Value announcing ZIP64 in a 32-bit directory field. */
const ZIP64_SENTINEL = 0xffffffff
/** Value announcing ZIP64 in the 16-bit entry-count field. */
const ZIP64_COUNT_SENTINEL = 0xffff
/** Zip version 2.0, the earliest that reads deflated entries. */
const ZIP_VERSION = 20
/** General-purpose flag announcing UTF-8 entry names. */
const UTF8_FLAG = 0x0800
/** Compression method of a stored entry. */
const STORE_METHOD = 0
/** Compression method of a deflated entry. */
const DEFLATE_METHOD = 8
/** Largest entry name the 16-bit name length field holds. */
const MAX_NAME_LENGTH = 0xffff
/** DOS date 1980-01-01, the earliest representable value. */
const FIXED_DOS_DATE = 0x0021
/** DOS time midnight. */
const FIXED_DOS_TIME = 0
/** Code `node:zlib` raises when a stream would exceed `maxOutputLength`. */
const BUFFER_TOO_LARGE = 'ERR_BUFFER_TOO_LARGE'

/** Name codec of the archive format, fixed by the UTF-8 name flag this writer sets. */
const TEXT_CODEC = new TextEncoder()
const TEXT_DECODER = new TextDecoder()

/**
 * Compute the CRC-32 checksum ZIP stores for an entry.
 * @param bytes - uncompressed entry data.
 * @returns the checksum as an unsigned 32-bit number.
 */
export function crc32(bytes: Uint8Array): number {
  return nodeCrc32(bytes)
}

/**
 * Whether an inflate failure is the output cap rather than a damaged stream.
 * @param error - the error `inflateRawSync` threw.
 * @returns true when the stream was refused for its size.
 */
function isBufferTooLarge(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === BUFFER_TOO_LARGE
}

/**
 * Write one little-endian 16-bit field.
 * @param bytes - target bytes.
 * @param offset - field position.
 * @param value - value to store.
 */
function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

/**
 * Write one little-endian 32-bit field.
 * @param bytes - target bytes.
 * @param offset - field position.
 * @param value - value to store.
 */
function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

/** One entry encoded and compressed for writing. */
interface PreparedEntry {
  /** UTF-8 name bytes. */
  readonly name: Uint8Array
  /** Stored payload, deflated or verbatim. */
  readonly payload: Uint8Array
  /** Checksum of the uncompressed data. */
  readonly crc: number
  /** Uncompressed byte length. */
  readonly size: number
  /** ZIP compression method. */
  readonly method: number
}

/**
 * Encode and compress one entry.
 * @param entry - the caller's entry.
 * @param compression - compression applied to its data.
 * @returns the prepared entry.
 * @throws RangeError when the name exceeds the 16-bit name length field.
 */
function prepareEntry(entry: ZipEntryInput, compression: ZipCompression): PreparedEntry {
  const name = TEXT_CODEC.encode(entry.name)
  if (name.length > MAX_NAME_LENGTH) {
    throw new RangeError(`zip entry name exceeds ${MAX_NAME_LENGTH} bytes: ${entry.name}`)
  }
  const method = compression === 'store' ? STORE_METHOD : DEFLATE_METHOD
  return {
    name,
    method,
    payload: method === STORE_METHOD ? entry.data : deflateRawSync(entry.data),
    crc: crc32(entry.data),
    size: entry.data.length,
  }
}

/**
 * Write one local file header and its payload.
 * @param bytes - archive bytes.
 * @param offset - write position.
 * @param entry - the prepared entry.
 * @returns the position after the payload.
 */
function writeLocalEntry(bytes: Uint8Array, offset: number, entry: PreparedEntry): number {
  writeUint32(bytes, offset, LOCAL_SIGNATURE)
  writeUint16(bytes, offset + 4, ZIP_VERSION)
  writeUint16(bytes, offset + 6, UTF8_FLAG)
  writeUint16(bytes, offset + 8, entry.method)
  writeUint16(bytes, offset + 10, FIXED_DOS_TIME)
  writeUint16(bytes, offset + 12, FIXED_DOS_DATE)
  writeUint32(bytes, offset + 14, entry.crc)
  writeUint32(bytes, offset + 18, entry.payload.length)
  writeUint32(bytes, offset + 22, entry.size)
  writeUint16(bytes, offset + 26, entry.name.length)
  writeUint16(bytes, offset + 28, 0)
  const nameOffset = offset + LOCAL_HEADER_LENGTH
  bytes.set(entry.name, nameOffset)
  const dataOffset = nameOffset + entry.name.length
  bytes.set(entry.payload, dataOffset)
  return dataOffset + entry.payload.length
}

/**
 * Write one central directory header.
 * @param bytes - archive bytes.
 * @param offset - write position.
 * @param entry - the prepared entry.
 * @param localOffset - position of the entry's local file header.
 * @returns the position after the record.
 */
function writeCentralEntry(bytes: Uint8Array, offset: number, entry: PreparedEntry, localOffset: number): number {
  writeUint32(bytes, offset, CENTRAL_SIGNATURE)
  writeUint16(bytes, offset + 4, ZIP_VERSION)
  writeUint16(bytes, offset + 6, ZIP_VERSION)
  writeUint16(bytes, offset + 8, UTF8_FLAG)
  writeUint16(bytes, offset + 10, entry.method)
  writeUint16(bytes, offset + 12, FIXED_DOS_TIME)
  writeUint16(bytes, offset + 14, FIXED_DOS_DATE)
  writeUint32(bytes, offset + 16, entry.crc)
  writeUint32(bytes, offset + 20, entry.payload.length)
  writeUint32(bytes, offset + 24, entry.size)
  writeUint16(bytes, offset + 28, entry.name.length)
  writeUint16(bytes, offset + 30, 0)
  writeUint16(bytes, offset + 32, 0)
  writeUint16(bytes, offset + 34, 0)
  writeUint16(bytes, offset + 36, 0)
  writeUint32(bytes, offset + 38, 0)
  writeUint32(bytes, offset + 42, localOffset)
  const nameOffset = offset + CENTRAL_HEADER_LENGTH
  bytes.set(entry.name, nameOffset)
  return nameOffset + entry.name.length
}

/**
 * Write the end-of-central-directory record.
 * @param bytes - archive bytes.
 * @param offset - write position.
 * @param entryCount - number of entries.
 * @param directorySize - central directory byte length.
 * @param directoryOffset - central directory start.
 */
function writeEndRecord(
  bytes: Uint8Array,
  offset: number,
  entryCount: number,
  directorySize: number,
  directoryOffset: number,
): void {
  writeUint32(bytes, offset, END_SIGNATURE)
  writeUint16(bytes, offset + 4, 0)
  writeUint16(bytes, offset + 6, 0)
  writeUint16(bytes, offset + 8, entryCount)
  writeUint16(bytes, offset + 10, entryCount)
  writeUint32(bytes, offset + 12, directorySize)
  writeUint32(bytes, offset + 16, directoryOffset)
  writeUint16(bytes, offset + 20, 0)
}

/**
 * Write a ZIP archive.
 * @param entries - entries in archive order.
 * @param options - compression applied to every entry; defaults to `deflate`.
 * @returns the archive bytes.
 * @throws RangeError when an entry name exceeds the 16-bit name length field.
 */
export function writeZip(entries: readonly ZipEntryInput[], options: ZipWriteOptions = {}): Uint8Array {
  const compression = options.compression ?? 'deflate'
  const prepared = entries.map(entry => prepareEntry(entry, compression))
  let length = END_RECORD_LENGTH
  for (const entry of prepared) {
    length += LOCAL_HEADER_LENGTH + entry.name.length + entry.payload.length
    length += CENTRAL_HEADER_LENGTH + entry.name.length
  }
  const bytes = new Uint8Array(length)
  const laid: { entry: PreparedEntry; offset: number }[] = []
  let cursor = 0
  for (const entry of prepared) {
    laid.push({ entry, offset: cursor })
    cursor = writeLocalEntry(bytes, cursor, entry)
  }
  const directoryOffset = cursor
  for (const { entry, offset } of laid) cursor = writeCentralEntry(bytes, cursor, entry, offset)
  writeEndRecord(bytes, cursor, laid.length, cursor - directoryOffset, directoryOffset)
  return bytes
}

/**
 * View one byte range through `DataView` arithmetic.
 * @param bytes - the bytes to read.
 * @returns a view over the same range.
 */
function dataViewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Locate the end-of-central-directory record.
 * @param view - the archive bytes.
 * @returns the record offset, or `undefined` when no signature is present.
 */
function findEndRecord(view: DataView): number | undefined {
  const first = Math.max(0, view.byteLength - END_RECORD_LENGTH - MAX_COMMENT_LENGTH)
  for (let offset = view.byteLength - END_RECORD_LENGTH; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === END_SIGNATURE) return offset
  }
  return undefined
}

/** One central directory record. */
interface CentralRecord {
  /** Entry name, decoded as UTF-8. */
  readonly name: string
  /** ZIP compression method. */
  readonly method: number
  /** Checksum of the uncompressed data. */
  readonly crc: number
  /** Stored payload byte length. */
  readonly compressedSize: number
  /** Declared uncompressed byte length, which the read budget is checked against. */
  readonly uncompressedSize: number
  /** Position of the entry's local file header. */
  readonly localOffset: number
  /** Position after this record. */
  readonly next: number
}

/**
 * Read one central directory record.
 * @param view - the archive bytes.
 * @param bytes - the archive bytes as an array.
 * @param offset - record position.
 * @param problems - problem list to append to.
 * @returns the record, or `undefined` when the directory is unreadable from this position.
 */
function readCentralRecord(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  problems: DocxProblem[],
): CentralRecord | undefined {
  if (offset + CENTRAL_HEADER_LENGTH > view.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
    problems.push({ code: 'not-a-zip', detail: 'the central directory is truncated or lacks a header signature' })
    return undefined
  }
  const nameLength = view.getUint16(offset + 28, true)
  const extraLength = view.getUint16(offset + 30, true)
  const commentLength = view.getUint16(offset + 32, true)
  const next = offset + CENTRAL_HEADER_LENGTH + nameLength + extraLength + commentLength
  if (next > view.byteLength) {
    problems.push({ code: 'truncated-entry', detail: 'a central directory record extends past the archive' })
    return undefined
  }
  const nameOffset = offset + CENTRAL_HEADER_LENGTH
  return {
    name: TEXT_DECODER.decode(bytes.subarray(nameOffset, nameOffset + nameLength)),
    method: view.getUint16(offset + 10, true),
    crc: view.getUint32(offset + 16, true),
    compressedSize: view.getUint32(offset + 20, true),
    uncompressedSize: view.getUint32(offset + 24, true),
    localOffset: view.getUint32(offset + 42, true),
    next,
  }
}

/**
 * Decompress one entry payload.
 * @param payload - stored bytes.
 * @param record - the entry's central directory record.
 * @param problems - problem list to append to.
 * @param maxOutputLength - bytes this entry may expand to; the caller passes the
 *   bytes its budget has left, so a stream that would push the total past the
 *   budget is refused instead of allocated.
 * @returns the uncompressed data, or `undefined` when the payload is unreadable or over budget.
 */
function decompressEntry(
  payload: Uint8Array,
  record: CentralRecord,
  problems: DocxProblem[],
  maxOutputLength: number,
): Uint8Array | undefined {
  if (record.method === STORE_METHOD) {
    // A stored entry is copied verbatim, so its payload length — not its
    // declaration — is what has to fit here; a deflated entry gets the same
    // bound from `maxOutputLength` below.
    if (payload.length > maxOutputLength) {
      problems.push({
        code: 'too-large',
        part: record.name,
        detail: `the stored entry holds ${String(payload.length)} bytes, above the ${String(maxOutputLength)} bytes left of the budget`,
      })
      return undefined
    }
    return payload.slice()
  }
  if (record.method !== DEFLATE_METHOD) {
    problems.push({
      code: 'unsupported-compression',
      part: record.name,
      detail: `entry uses compression method ${record.method}`,
    })
    return undefined
  }
  try {
    return inflateRawSync(payload, { maxOutputLength })
  } catch (error) {
    if (isBufferTooLarge(error)) {
      problems.push({
        code: 'too-large',
        part: record.name,
        detail: `the deflate stream expands beyond the ${String(maxOutputLength)} bytes left of the budget`,
      })
      return undefined
    }
    problems.push({
      code: 'corrupt-entry',
      part: record.name,
      detail: `the deflate stream is unreadable: ${String(error)}`,
    })
    return undefined
  }
}

/**
 * Read one entry's data and verify its checksum.
 * @param bytes - the archive bytes.
 * @param view - the archive bytes as a view.
 * @param record - the entry's central directory record.
 * @param problems - problem list to append to.
 * @param maxOutputLength - bytes this entry may expand to (see {@link decompressEntry}).
 * @returns the entry, or `undefined` when its data is unreadable or over budget.
 */
function readEntry(
  bytes: Uint8Array,
  view: DataView,
  record: CentralRecord,
  problems: DocxProblem[],
  maxOutputLength: number,
): ZipEntry | undefined {
  const headerInRange = record.localOffset + LOCAL_HEADER_LENGTH <= view.byteLength
  if (!headerInRange || view.getUint32(record.localOffset, true) !== LOCAL_SIGNATURE) {
    problems.push({ code: 'truncated-entry', part: record.name, detail: 'the local file header is missing or out of range' })
    return undefined
  }
  const nameLength = view.getUint16(record.localOffset + 26, true)
  const extraLength = view.getUint16(record.localOffset + 28, true)
  const dataOffset = record.localOffset + LOCAL_HEADER_LENGTH + nameLength + extraLength
  if (dataOffset + record.compressedSize > view.byteLength) {
    problems.push({ code: 'truncated-entry', part: record.name, detail: 'entry data extends past the archive' })
    return undefined
  }
  const data = decompressEntry(bytes.subarray(dataOffset, dataOffset + record.compressedSize), record, problems, maxOutputLength)
  if (data === undefined) return undefined
  if (crc32(data) !== record.crc) {
    problems.push({
      code: 'corrupt-entry',
      part: record.name,
      detail: 'the entry checksum does not match the central directory',
    })
    return undefined
  }
  return { name: record.name, data }
}

/**
 * Read a ZIP archive under the caller's read budgets.
 * An entry that cannot be read is reported in `problems` and left out of
 * `entries`; the scan ends early only for an archive that declares no readable
 * directory or that has spent its uncompressed budget.
 * @param bytes - the archive bytes.
 * @param limits - entry-count and uncompressed-byte budgets the read must stay within.
 * @returns the decompressed entries and one problem per failure.
 */
export function readZip(bytes: Uint8Array, limits: ZipReadLimits): ZipArchive {
  const entries: ZipEntry[] = []
  const problems: DocxProblem[] = []
  const view = dataViewOf(bytes)
  const end = findEndRecord(view)
  if (end === undefined) {
    return { entries, problems: [{ code: 'not-a-zip', detail: 'no end-of-central-directory record' }] }
  }
  const count = view.getUint16(end + 10, true)
  const directoryOffset = view.getUint32(end + 16, true)
  if (count === ZIP64_COUNT_SENTINEL || directoryOffset === ZIP64_SENTINEL) {
    return { entries, problems: [{ code: 'unsupported-archive', detail: 'the archive announces ZIP64 extensions' }] }
  }
  if (count > limits.maxArchiveEntries) {
    return {
      entries,
      problems: [{
        code: 'too-large',
        detail: `the archive declares ${String(count)} entries, above the ${String(limits.maxArchiveEntries)}-entry budget`,
      }],
    }
  }
  if (directoryOffset + count * CENTRAL_HEADER_LENGTH > view.byteLength) {
    return { entries, problems: [{ code: 'not-a-zip', detail: 'the central directory lies outside the archive' }] }
  }
  let total = 0
  let cursor = directoryOffset
  for (let index = 0; index < count; index += 1) {
    const record = readCentralRecord(view, bytes, cursor, problems)
    if (record === undefined) break
    cursor = record.next
    const remaining = limits.maxUncompressedBytes - total
    if (record.uncompressedSize > remaining) {
      problems.push({
        code: 'too-large',
        part: record.name,
        detail: `the entry declares ${String(record.uncompressedSize)} uncompressed bytes, above the ${String(Math.max(0, remaining))} bytes left of the budget`,
      })
      break
    }
    // `inflateRawSync` rejects `maxOutputLength: 0`, so an entry that arrives
    // with the budget exactly spent may still produce the one byte such an
    // entry can hold.
    const entry = readEntry(bytes, view, record, problems, Math.max(1, remaining))
    if (entry !== undefined) {
      entries.push(entry)
      total += entry.data.length
    }
  }
  return { entries, problems }
}
