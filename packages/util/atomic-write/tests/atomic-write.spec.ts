import { lstat, mkdir, mkdtemp, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { withFileLock, writeFileAtomic } from '../src/index.ts'

const openState = vi.hoisted(() => ({ file: 0, dir: 0, failFile: false, failDir: '' }))

// `FileHandle` is not exported at runtime, so the fsync contract is observed
// by wrapping `open` and counting each returned handle's sync calls. The temp
// inode opens with `wx`; the parent directory opens with `r`. `failDir` holds
// an errno code the directory fsync throws.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    open: (async (path: string, flag: string, mode?: number) => {
      const handle = await actual.open(path, flag, mode)
      const sync = handle.sync.bind(handle)
      handle.sync = async () => {
        if (flag === 'wx') {
          openState.file++
          if (openState.failFile) throw new Error('disk error')
        } else {
          openState.dir++
          if (openState.failDir !== '') {
            throw Object.assign(new Error(`dir fsync: ${openState.failDir}`), { code: openState.failDir })
          }
        }
        await sync()
      }
      return handle
    }) as typeof actual.open,
  }
})

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-atomic-write-'))
}

describe('writeFileAtomic', () => {
  it('creates the file and its parents with exactly the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'nested', 'deep', 'doc.yaml')
    await writeFileAtomic(target, 'a: 1\n', { mode: 0o600 })
    expect(await readFile(target, 'utf8')).toBe('a: 1\n')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces existing content and narrows a wider-permission file to the stated mode', async () => {
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await writeFile(target, 'old', { mode: 0o644 })
    await writeFileAtomic(target, 'new', { mode: 0o600 })
    expect(await readFile(target, 'utf8')).toBe('new')
    if (process.platform !== 'win32') expect((await stat(target)).mode & 0o777).toBe(0o600)
  })

  it('replaces a symlinked target itself without writing through to the referent', async () => {
    const dir = await scratch()
    const victim = join(dir, 'victim')
    await writeFile(victim, 'victim-content')
    const target = join(dir, 'doc.yaml')
    await symlink(victim, target)
    await writeFileAtomic(target, 'replaced', { mode: 0o600 })
    expect((await lstat(target)).isSymbolicLink()).toBe(false)
    expect(await readFile(target, 'utf8')).toBe('replaced')
    expect(await readFile(victim, 'utf8')).toBe('victim-content')
  })

  it('leaves no temp sibling and rethrows when the rename fails', async () => {
    const dir = await scratch()
    const target = join(dir, 'occupied')
    await mkdir(target)
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).rejects.toThrow()
    expect((await readdir(dir)).filter(entry => entry.includes('.tmp'))).toEqual([])
  })

  it('fsyncs the replacement inode and, off Windows, its parent directory', async () => {
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await writeFileAtomic(target, 'content', { mode: 0o600 })
    // One fsync flushes the temp inode before the rename; a second flushes
    // the parent directory so the rename entry itself survives a crash.
    expect(openState.file).toBe(1)
    expect(openState.dir).toBe(process.platform === 'win32' ? 0 : 1)
    expect(await readFile(target, 'utf8')).toBe('content')
  })

  it('removes the temp file and rethrows when the fsync fails', async () => {
    openState.failFile = true
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).rejects.toThrow('disk error')
    expect(openState.file).toBe(1)
    expect(await readdir(dir)).toEqual([])
  })

  it('forgives an unsupported directory fsync and reports the write as successful', async () => {
    openState.failDir = 'EINVAL'
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).resolves.toBeUndefined()
    expect(await readFile(target, 'utf8')).toBe('content')
    expect(openState.file).toBe(1)
    expect(openState.dir).toBe(process.platform === 'win32' ? 0 : 1)
  })

  it.skipIf(process.platform === 'win32')('rethrows a real directory fsync failure after the rename commit', async () => {
    openState.failDir = 'EIO'
    const dir = await scratch()
    const target = join(dir, 'doc.yaml')
    await expect(writeFileAtomic(target, 'content', { mode: 0o600 })).rejects.toThrow('dir fsync: EIO')
    // The rename already committed; only the crash-durability flush failed,
    // so the target holds the new content and no temp sibling remains.
    expect(await readFile(target, 'utf8')).toBe('content')
    expect((await readdir(dir)).filter(entry => entry.includes('.tmp'))).toEqual([])
  })
})

beforeEach(() => {
  openState.file = 0
  openState.dir = 0
  openState.failFile = false
  openState.failDir = ''
})

describe('withFileLock', () => {
  it('rejects an invalid parent hierarchy before running the operation', async () => {
    const dir = await scratch()
    const parent = join(dir, 'not-a-directory')
    await writeFile(parent, 'occupied')
    let called = false

    await expect(withFileLock(join(parent, 'document'), async () => {
      called = true
    })).rejects.toThrow(/ENOENT|ENOTDIR|not a directory/i)
    expect(called).toBe(false)
  })
})
