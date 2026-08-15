/**
 * dsh backend child-process control: readiness discovery from the URL line,
 * exit reporting, and rejection when the backend exits before readiness.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startDshBackend } from '../src/server-manager.ts'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  dirs.length = 0
})

/** Stage a backend fixture script and return its path. */
function fixture(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-'))
  dirs.push(dir)
  const file = join(dir, 'backend.mjs')
  writeFileSync(file, script)
  return file
}

describe('startDshBackend', () => {
  it('resolves ready from the URL readiness line and reports exit', async () => {
    const entry = fixture("console.log('dsh web: http://127.0.0.1:12345')\nsetInterval(() => {}, 1000)\n")
    const backend = startDshBackend({
      nodeBin: process.execPath,
      entry,
      loaderArgs: [],
      profile: 'test',
      args: [],
      cwd: join(entry, '..'),
    })
    await expect(backend.ready).resolves.toBe('http://127.0.0.1:12345')
    const exited = new Promise<void>((resolve) => {
      backend.onExit(() => { resolve() })
    })
    await backend.dispose()
    await exited
  })

  it('rejects ready when the backend exits before reporting a URL', async () => {
    const entry = fixture("console.log('no url line')\n")
    const backend = startDshBackend({
      nodeBin: process.execPath,
      entry,
      loaderArgs: [],
      profile: 'test',
      args: [],
      cwd: join(entry, '..'),
    })
    await expect(backend.ready).rejects.toThrow(/exited before reporting a URL/)
  })
})
