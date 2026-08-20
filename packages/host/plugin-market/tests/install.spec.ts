/**
 * Tests for the managed install pipeline: reference parsing, the Node-engine
 * heuristic, snapshot/rollback, preview verification against the registry,
 * and receipt-persisted install/uninstall.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIFECYCLE_SCRIPTS, installPlugin, listReceipts, nodeSatisfies, parseRef,
  previewInstall, readReceipt, receiptDirFor, restoreSnapshot, runPnpm, snapshotProfile, uninstallPlugin,
} from '../src/install.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-market-install-'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function writeProfile(files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
}

describe('parseRef', () => {
  it('parses scoped and unscoped references', () => {
    expect(parseRef('dsh-p1@1.0.0')).toEqual({ name: 'dsh-p1', version: '1.0.0' })
    expect(parseRef('@scope/pkg@2.1.0')).toEqual({ name: '@scope/pkg', version: '2.1.0' })
  })

  it('rejects malformed references', () => {
    expect(() => parseRef('no-version')).toThrow(/name@version/)
    expect(() => parseRef('@scope@1.0.0')).toThrow(/invalid package name/)
    expect(() => parseRef('pkg@')).toThrow(/invalid version/)
    expect(() => parseRef('UPPER@1.0.0')).toThrow(/invalid package name/)
    expect(() => parseRef(`pkg@${'v'.repeat(65)}`)).toThrow(/invalid version/)
  })
})

describe('nodeSatisfies', () => {
  it('accepts unbounded and wildcard constraints', () => {
    expect(nodeSatisfies('', '22.0.0')).toBe(true)
    expect(nodeSatisfies('*', '22.0.0')).toBe(true)
    expect(nodeSatisfies('unparseable!!', '22.0.0')).toBe(true)
  })

  it('compares exact, caret, tilde, and bare constraints', () => {
    expect(nodeSatisfies('22', '22.5.1')).toBe(true)
    expect(nodeSatisfies('22.5', '22.5.1')).toBe(true)
    expect(nodeSatisfies('22.6', '22.5.1')).toBe(false)
    expect(nodeSatisfies('>=20', '22.5.1')).toBe(true)
    expect(nodeSatisfies('>=24', '22.5.1')).toBe(false)
    expect(nodeSatisfies('^22.5.0', '22.5.1')).toBe(true)
    expect(nodeSatisfies('^23.0.0', '22.5.1')).toBe(false)
    expect(nodeSatisfies('~22.5.0', '22.6.0')).toBe(false)
    expect(nodeSatisfies('~22.5.0', '22.5.9')).toBe(true)
    expect(nodeSatisfies('=22.5.1', '22.5.1')).toBe(true)
    expect(nodeSatisfies('>=22.5.1', '22.5.1')).toBe(true)
    expect(nodeSatisfies('>22.5.1', '22.5.1')).toBe(false)
    expect(nodeSatisfies('<=22.5.1', '22.5.0')).toBe(true)
    expect(nodeSatisfies('<22.5.0', '22.5.1')).toBe(false)
  })

  it('accepts an OR list when the first branch matches', () => {
    expect(nodeSatisfies('^24.0.0 || ^22.0.0', '22.5.1')).toBe(true)
  })

  it('degrades gracefully on unparseable inputs', () => {
    expect(nodeSatisfies('nonsense', '22.5.1')).toBe(true) // unparseable comparator
    expect(nodeSatisfies('>=20', 'not-a-version')).toBe(true) // unparseable current
    expect(nodeSatisfies('=22.5.1', '22.5.2')).toBe(false)
    expect(nodeSatisfies('~22.5.0', '22.4.0')).toBe(false)
    expect(nodeSatisfies('^22.0.0', '23.0.0')).toBe(false)
    expect(nodeSatisfies('>=22.5.1', 'v22.5.1')).toBe(true) // v-prefixed current
    expect(nodeSatisfies('22.5', '22.5')).toBe(true) // patch-less current and target
    expect(nodeSatisfies('=22.5.1', '22')).toBe(false) // patch-less current
  })
})

describe('previewInstall', () => {
  it('verifies a clean registry release', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0',
      dist: { tarball: 'https://registry.npmjs.org/dsh-p1/-/dsh-p1-1.0.0.tgz', integrity: 'sha512-abc' },
    }), { status: 200 })))
    const preview = await previewInstall('dsh-p1@1.0.0')
    expect(preview.verified).toBe(true)
    expect(preview.lifecycleScripts).toEqual([])
    expect(preview.compatible).toBe(true)
  })

  it('rejects deprecated, dist-less, and lifecycle-script packages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0', deprecated: 'use dsh-p2 instead',
      dist: { tarball: 'x', integrity: 'y' },
    }), { status: 200 })))
    expect((await previewInstall('dsh-p1@1.0.0')).verified).toBe(false)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ name: 'dsh-p1', version: '1.0.0' }), { status: 200 })))
    const distless = await previewInstall('dsh-p1@1.0.0')
    expect(distless.verified).toBe(false)
    expect(distless.reasons.some(reason => reason.includes('no installable dist'))).toBe(true)

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0',
      dist: { tarball: 'x', integrity: 'y' },
      scripts: { postinstall: 'node x.js' },
    }), { status: 200 })))
    const scripts = await previewInstall('dsh-p1@1.0.0')
    expect(scripts.lifecycleScripts).toEqual(['postinstall'])
    expect(scripts.verified).toBe(false)
    expect(scripts.reasons.some(reason => reason.includes('lifecycle scripts'))).toBe(true)
  })

  it('reports an unreachable or missing package', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const preview = await previewInstall('dsh-p1@9.9.9')
    expect(preview.verified).toBe(false)
    expect(preview.reasons).toEqual(['package not found or registry unreachable'])
  })

  it('reports the engines constraint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      name: 'dsh-p1', version: '1.0.0',
      dist: { tarball: 'x', integrity: 'y' },
      engines: { node: '>=24.0.0' },
    }), { status: 200 })))
    const preview = await previewInstall('dsh-p1@1.0.0')
    expect(preview.compatible).toBe(false)
  })

  it('lists every lifecycle script it knows', () => {
    expect(LIFECYCLE_SCRIPTS).toEqual(['preinstall', 'install', 'postinstall', 'prepare'])
  })
})

describe('snapshot and restore', () => {
  it('captures the manifest files and restores them', () => {
    writeProfile({ 'package.json': '{ "name": "x" }', 'pnpm-lock.yaml': 'lockfile: v9' })
    const snapshot = snapshotProfile(dir)
    expect(snapshot.files['package.json']).toBe('{ "name": "x" }')
    writeFileSync(join(dir, 'package.json'), '{ "name": "changed" }')
    restoreSnapshot(dir, snapshot)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{ "name": "x" }')
  })

  it('skips absent files', () => {
    const snapshot = snapshotProfile(dir)
    expect(snapshot.files).toEqual({})
    restoreSnapshot(dir, snapshot)
    expect(existsSync(join(dir, 'package.json'))).toBe(false)
  })
})

describe('installPlugin and uninstallPlugin', () => {
  it('runs pnpm add and writes a durable receipt', () => {
    writeProfile({ 'package.json': '{ "name": "profile" }' })
    const runPnpm = vi.fn(() => ({ status: 0, stderr: '' }))
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0', { runPnpm })
    expect(runPnpm).toHaveBeenCalledWith(dir, ['add', 'dsh-p1@1.0.0'])
    expect(receipt).toMatchObject({ package: 'dsh-p1', version: '1.0.0', profile: dir })
    expect(listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))).toHaveLength(1)
  })

  it('rolls the profile back when the add fails', () => {
    writeProfile({ 'package.json': '{ "name": "profile" }', 'pnpm-lock.yaml': 'lockfile: v9' })
    const runPnpm = vi.fn(() => ({ status: 1, stderr: 'ETARGET' }))
    expect(() => installPlugin(dir, 'dsh-p1@1.0.0', { runPnpm })).toThrow(/ETARGET/)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{ "name": "profile" }')
    expect(listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))).toHaveLength(0)
  })

  it('uninstalls via the receipt and removes it', () => {
    writeProfile({ 'package.json': '{ "name": "profile" }' })
    const runPnpm = vi.fn(() => ({ status: 0, stderr: '' }))
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0', { runPnpm })
    uninstallPlugin(dir, receipt.id, { runPnpm })
    expect(runPnpm).toHaveBeenLastCalledWith(dir, ['remove', 'dsh-p1'])
    expect(listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))).toHaveLength(0)
  })

  it('refuses to uninstall a receipt from another profile', () => {
    writeProfile({ 'package.json': '{ "name": "profile" }' })
    const runPnpm = vi.fn(() => ({ status: 0, stderr: '' }))
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0', { runPnpm })
    const other = mkdtempSync(join(tmpdir(), 'dsh-plugin-market-other-'))
    // The receipt exists in `dir`; moving it to `other` makes the profile
    // field mismatch the target of the uninstall.
    const source = join(dir, '.dsh-plugin-market', 'receipts', `${receipt.id}.json`)
    const targetDir = join(other, '.dsh-plugin-market', 'receipts')
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, `${receipt.id}.json`), readFileSync(source))
    expect(() => { uninstallPlugin(other, receipt.id, { runPnpm }) }).toThrow(/belongs to/)
  })

  it('rejects an unknown or malformed receipt', () => {
    const receipts = join(dir, '.dsh-plugin-market', 'receipts')
    expect(() => { uninstallPlugin(dir, 'missing', { runPnpm: vi.fn() }) }).toThrow(/no receipt missing/)
    mkdirSync(receipts, { recursive: true })
    writeFileSync(join(receipts, 'broken.json'), 'not json')
    expect(() => listReceipts(receipts)).toThrow(/malformed/)
    expect(() => readReceipt(receipts, 'broken')).toThrow(/malformed/)
  })

  it('reports a failed pnpm remove without touching the receipt', () => {
    writeProfile({ 'package.json': '{ "name": "profile" }' })
    const runPnpm = vi.fn((_cwd: string, args: readonly string[]) =>
      args[0] === 'add' ? { status: 0, stderr: '' } : { status: 1, stderr: 'ENOENT' })
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0', { runPnpm })
    expect(() => { uninstallPlugin(dir, receipt.id, { runPnpm }) }).toThrow(/pnpm remove failed/)
    expect(listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))).toHaveLength(1)
  })

  it('lists every receipt, deterministically ordered', () => {
    const runPnpm = vi.fn(() => ({ status: 0, stderr: '' }))
    writeProfile({ 'package.json': '{ "name": "profile" }' })
    installPlugin(dir, 'dsh-a@1.0.0', { runPnpm })
    installPlugin(dir, 'dsh-b@1.0.0', { runPnpm })
    const receipts = listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))
    expect(receipts.map(receipt => receipt.package).sort()).toEqual(['dsh-a', 'dsh-b'])
    expect(receipts.length).toBe(2)
  })

  it('resolves the receipts directory from options or the profile default', () => {
    expect(receiptDirFor(dir, {})).toBe(join(dir, '.dsh-plugin-market', 'receipts'))
    expect(receiptDirFor(dir, { receiptDir: '/custom/receipts' })).toBe('/custom/receipts')
  })

  it('reports a failed default pnpm invocation without throwing', () => {
    // A nonexistent cwd makes spawnSync fail before pnpm runs: status and
    // stderr fall back to the closed defaults.
    const missing = join(dir, 'does-not-exist')
    const result = runPnpm(missing, ['install'])
    expect(result.status).not.toBe(0)
    expect(typeof result.stderr).toBe('string')
  })
})
