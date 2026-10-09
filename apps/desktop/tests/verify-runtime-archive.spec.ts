/** Beside-archive runtime payloads must match the preparation record exactly. */

import { createHash } from 'node:crypto'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { verifyBesideArchive, isPackagerIgnored } from '../scripts/verify-runtime-archive.ts'
import type { DesktopRuntimeFile } from '../src/runtime-tree.ts'

const ENGINE = 'node_modules/@deepseek-ai/libreoffice-kit-darwin-arm64/bin/libreoffice-kit'

/** Lay down one beside-archive payload and the record that describes it. */
function fixture() {
  const resources = mkdtempSync(join(tmpdir(), 'dsh-beside-archive-'))
  onTestFinished(() => { rmSync(resources, { recursive: true, force: true }) })
  const physical = join(resources, ...ENGINE.split('/'))
  mkdirSync(dirname(physical), { recursive: true })
  const body = Buffer.from('engine payload')
  writeFileSync(physical, body, { mode: 0o755 })
  const record: DesktopRuntimeFile = {
    path: ENGINE,
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
    executable: process.platform !== 'win32' && (lstatSync(physical).mode & 0o111) !== 0,
  }
  return { resources, physical, record, beside: new Map([[ENGINE, record]]) }
}

it('accepts the prepared payload at its relative path', async () => {
  const f = fixture()
  await expect(verifyBesideArchive(f.resources, f.beside)).resolves.toBeUndefined()
})

it('rejects bytes the preparation record does not describe', async () => {
  const f = fixture()
  writeFileSync(f.physical, 'tampered payload', { mode: 0o755 })
  await expect(verifyBesideArchive(f.resources, f.beside))
    .rejects.toThrow('desktop runtime: beside-archive integrity verification failed')
})

it('rejects a prepared payload the application is missing', async () => {
  const f = fixture()
  rmSync(f.physical)
  await expect(verifyBesideArchive(f.resources, f.beside))
    .rejects.toThrow('desktop runtime: prepared file is absent from the application')
})

it('rejects an executable permission the preparation record disagrees with', async () => {
  const f = fixture()
  const beside = new Map([[f.record.path, { ...f.record, executable: !f.record.executable }]])
  await expect(verifyBesideArchive(f.resources, beside))
    .rejects.toThrow('desktop runtime: beside-archive integrity verification failed')
})

it('rejects a file the preparation record does not list', async () => {
  const f = fixture()
  writeFileSync(join(dirname(f.physical), 'unprepared'), 'extra')
  await expect(verifyBesideArchive(f.resources, f.beside))
    .rejects.toThrow('desktop runtime: unexpected beside-archive entry')
})

it('rejects a path that is not a file', async () => {
  const f = fixture()
  rmSync(f.physical)
  mkdirSync(f.physical)
  await expect(verifyBesideArchive(f.resources, f.beside))
    .rejects.toThrow('desktop runtime: beside-archive entry is not a file')
})

it('recognizes the names and extensions the packager drops', () => {
  expect(isPackagerIgnored('node_modules/cheerio/node_modules/undici/lib/llhttp/.gitkeep')).toBe(true)
  expect(isPackagerIgnored('node_modules/x/package-lock.json')).toBe(true)
  expect(isPackagerIgnored('node_modules/.github/workflows/release.yml')).toBe(true)
  expect(isPackagerIgnored('node_modules/@deepseek-ai/dsh/lib/types/index.d.ts')).toBe(true)
  expect(isPackagerIgnored('node_modules/native/binding.cc')).toBe(true)
})

it('keeps the files the packager carries', () => {
  expect(isPackagerIgnored('lib/index.js')).toBe(false)
  expect(isPackagerIgnored('node_modules/@deepseek-ai/dsh/dist/index.mjs')).toBe(false)
  expect(isPackagerIgnored('node_modules/native/obj')).toBe(false)
})
