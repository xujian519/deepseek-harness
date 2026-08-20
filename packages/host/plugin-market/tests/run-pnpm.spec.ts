/**
 * Tests for the default pnpm runner and the no-options install paths, with
 * node:child_process mocked so the default runner never touches a real pnpm.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installPlugin, listReceipts, runPnpm, uninstallPlugin } from '../src/install.ts'

const mocks = vi.hoisted(() => ({ spawnSync: vi.fn() }))

vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }))

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-market-runpnpm-'))
  writeFileSync(join(dir, 'package.json'), '{ "name": "profile" }')
})

describe('runPnpm (default runner)', () => {
  it('maps a successful spawn to its status and stderr', () => {
    mocks.spawnSync.mockReturnValue({ status: 0, stderr: '' })
    expect(runPnpm(dir, ['--version'])).toEqual({ status: 0, stderr: '' })
    expect(mocks.spawnSync).toHaveBeenCalledWith('pnpm', ['--version'], { cwd: dir, stdio: 'pipe', encoding: 'utf8' })
  })

  it('normalizes a spawn failure to a non-zero status and empty stderr', () => {
    mocks.spawnSync.mockReturnValue({ status: null, stderr: null, error: new Error('ENOENT') })
    const result = runPnpm(dir, ['install'])
    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
  })

  it('runs the add through the default runner and reports empty stderr failures', () => {
    mocks.spawnSync.mockReturnValueOnce({ status: 0, stderr: '' }).mockReturnValueOnce({ status: 1, stderr: '' })
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0')
    expect(receipt.package).toBe('dsh-p1')
    expect(() => installPlugin(dir, 'dsh-p2@1.0.0')).toThrow(/no stderr/)
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toEqual({ name: 'profile' })
  })

  it('runs the remove through the default runner and keeps the receipt on failure', () => {
    mocks.spawnSync.mockReturnValueOnce({ status: 0, stderr: '' }).mockReturnValueOnce({ status: 1, stderr: '' })
    const receipt = installPlugin(dir, 'dsh-p1@1.0.0')
    expect(() => { uninstallPlugin(dir, receipt.id) }).toThrow(/no stderr/)
    expect(listReceipts(join(dir, '.dsh-plugin-market', 'receipts'))).toHaveLength(1)
    expect(existsSync(join(dir, '.dsh-plugin-market', 'receipts', `${receipt.id}.json`))).toBe(true)
  })
})
