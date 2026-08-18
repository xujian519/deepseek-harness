/**
 * Unit tests for the desktop Node runtime download helper: spec derivation,
 * checksum parsing, and the download/extract/verify pipeline with stubbed
 * network access.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checksumForFile, downloadNode, fetchBuffer, nodeDownloadSpec, sha256Of,
} from './desktop-download-node.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('nodeDownloadSpec', () => {
  it('derives the darwin-arm64 tar.gz spec with the resources layout', () => {
    const spec = nodeDownloadSpec('darwin-arm64', 'v24.19.0')
    expect(spec).toMatchObject({
      platform: 'darwin-arm64',
      version: 'v24.19.0',
      fileName: 'node-v24.19.0-darwin-arm64.tar.gz',
      archiveType: 'tar.gz',
      innerNodePath: 'node-v24.19.0-darwin-arm64/bin/node',
      relNodePath: 'bin/node',
      downloadUrl: 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-arm64.tar.gz',
      checksumUrl: 'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt',
    })
  })

  it('derives the win-x64 zip spec with the node.exe layout', () => {
    const spec = nodeDownloadSpec('win-x64', '24.19.0')
    expect(spec).toMatchObject({
      version: 'v24.19.0',
      archiveType: 'zip',
      innerNodePath: 'node-v24.19.0-win-x64/node.exe',
      relNodePath: 'node.exe',
    })
  })

  it('rejects unknown platforms', () => {
    expect(() => nodeDownloadSpec('darwin-ppc', 'v24.19.0')).toThrow(/unsupported/)
  })
})

describe('checksumForFile', () => {
  it('finds the line for a file name', () => {
    const text = 'a'.repeat(64) + '  node-v24.19.0-darwin-arm64.tar.gz\n' + 'b'.repeat(64) + '  other.bin\n'
    expect(checksumForFile(text, 'node-v24.19.0-darwin-arm64.tar.gz')).toBe('a'.repeat(64))
  })

  it('returns undefined when the file is absent', () => {
    expect(checksumForFile('', 'missing.bin')).toBeUndefined()
  })
})

describe('sha256Of', () => {
  it('digests a known empty input', () => {
    expect(sha256Of(Buffer.alloc(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

/** Build a real gzip archive containing a node binary placeholder. */
function rootSegment(innerNodePath: string): string {
  const segment = innerNodePath.split('/')[0]
  if (segment === undefined) {
    throw new Error(`invalid inner node path: ${innerNodePath}`)
  }
  return segment
}

function makeTarGz(innerNodePath: string, payload: string, archivePath: string): void {
  const staging = mkdtempSync(join(tmpdir(), 'node-fixture-'))
  try {
    const inner = join(staging, innerNodePath)
    mkdirSync(dirname(inner), { recursive: true })
    writeFileSync(inner, payload)
    const result = spawnSync('tar', ['-czf', archivePath, '-C', staging, rootSegment(innerNodePath)])
    expect(result.status).toBe(0)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

describe('downloadNode', () => {
  it('skips the download when the target binary already exists', async () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'node-target-'))
    try {
      const spec = nodeDownloadSpec('darwin-arm64', 'v24.19.0')
      const existing = join(targetDir, spec.relNodePath)
      mkdirSync(dirname(existing), { recursive: true })
      writeFileSync(existing, 'node')
      const fetchSpy = vi.fn(async () => { throw new Error('network must not be touched') })
      vi.stubGlobal('fetch', fetchSpy)
      await expect(downloadNode({ spec, targetDir })).resolves.toBe(existing)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('fails when the archive checksum does not match', async () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'node-target-'))
    try {
      const spec = nodeDownloadSpec('darwin-arm64', 'v24.19.0')
      const archive = Buffer.from('not a real archive')
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => (url.endsWith('SHASUMS256.txt')
          ? Buffer.from(`${'0'.repeat(64)}  ${spec.fileName}\n`)
          : archive),
      })))
      await expect(downloadNode({ spec, targetDir })).rejects.toThrow(/checksum mismatch/)
      expect(existsSync(join(targetDir, spec.relNodePath))).toBe(false)
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })

  it('downloads, verifies, and extracts the node binary', async () => {
    const targetDir = mkdtempSync(join(tmpdir(), 'node-target-'))
    try {
      const spec = nodeDownloadSpec('darwin-arm64', 'v24.19.0')
      const archivePath = join(tmpdir(), 'node-fixture-archive.tar.gz')
      rmSync(archivePath, { force: true })
      makeTarGz(spec.innerNodePath, 'node payload', archivePath)
      const archive = Buffer.from(readFileSync(archivePath))
      rmSync(archivePath, { force: true })
      const shasums = `${sha256Of(archive)}  ${spec.fileName}\n`
      vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => (url.endsWith('SHASUMS256.txt') ? Buffer.from(shasums) : archive),
      })))
      const target = await downloadNode({ spec, targetDir })
      expect(target).toBe(join(targetDir, 'bin', 'node'))
      expect(readFileSync(target, 'utf8')).toBe('node payload')
    } finally {
      rmSync(targetDir, { recursive: true, force: true })
    }
  })
})

describe('fetchBuffer', () => {
  it('throws on non-2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })))
    await expect(fetchBuffer('https://example.invalid/x')).rejects.toThrow(/404/)
  })
})
