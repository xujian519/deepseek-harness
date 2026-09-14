/**
 * The fixture's in-memory file system: the shared workspace-file reads and the
 * per-world directory-picker browse tree.
 */
import { describe, expect, it } from 'vitest'
import type { ConnectionRpcResult } from '../src/rpc.ts'
import {
  WORKSPACE_FILES_ROOT,
  createDirectoryPickerRemotes,
  workspaceFileRemotes,
} from '../src/client/fixture-file-system.ts'

const HOME = '/home/fixture'

/** The success value, or a thrown failure naming the code the remote reported. */
function ok<T>(result: ConnectionRpcResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}`)
  return result.value
}

describe('workspaceFileRemotes.list', () => {
  it('requires a path', () => {
    expect(workspaceFileRemotes.list('')).toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
  })

  it('refuses paths that leave the workspace', () => {
    expect(workspaceFileRemotes.list('../..')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/outside-workspace' },
    })
    expect(workspaceFileRemotes.list('/etc')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/outside-workspace' },
    })
  })

  it('reports an absent entry', () => {
    expect(workspaceFileRemotes.list('notes/missing.txt')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/not-found' },
    })
  })

  it('distinguishes a file from an entry of neither kind', () => {
    expect(workspaceFileRemotes.list('package.json')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/not-directory', details: { kind: 'file' } },
    })
    expect(workspaceFileRemotes.list('dev.sock')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/not-directory', details: { kind: 'other' } },
    })
    expect(workspaceFileRemotes.list('src/config.ts')).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/not-directory', details: { kind: 'file' } },
    })
  })

  it('walks the tree by workspace-relative and absolute path', () => {
    expect(ok(workspaceFileRemotes.list('notes'))).toMatchObject({
      path: 'notes',
      truncated: false,
      entries: [{ name: 'demo.txt' }, { name: 'new-demo.txt' }],
    })
    expect(ok(workspaceFileRemotes.list('src//lib')).entries).toHaveLength(24)
    expect(ok(workspaceFileRemotes.list('./notes')).path).toBe('notes')
    // The workspace root itself resolves to the tree's own root listing.
    expect(ok(workspaceFileRemotes.list(WORKSPACE_FILES_ROOT)).entries)
      .toEqual(ok(workspaceFileRemotes.list('/tmp/fixture/.')).entries)
  })

  it('cuts the one listing that exceeds the page', () => {
    expect(ok(workspaceFileRemotes.list('src/lib')).truncated).toBe(true)
  })
})

describe('workspaceFileRemotes.read', () => {
  it('passes a non-text failure through from stat', () => {
    expect(workspaceFileRemotes.read('notes/chart.png', {})).toMatchObject({
      ok: false,
      error: { code: 'workspace-file/not-text' },
    })
  })

  it('rejects an offset or limit outside the page', () => {
    const bad = [
      { offset: 1.5, limit: 1 },
      { offset: 0, limit: 1 },
      { offset: 1, limit: 1.5 },
      { offset: 1, limit: 0 },
      { offset: 1, limit: 5001 },
    ]
    for (const range of bad) {
      expect(workspaceFileRemotes.read('README.md', range)).toMatchObject({
        ok: false,
        error: { code: 'gateway/bad-request' },
      })
    }
  })

  it('pages a long file and reports end-of-file on both sides', () => {
    const first = ok(workspaceFileRemotes.read('notes/demo.txt', { limit: 2 }))
    expect(first.lines).toBe(2)
    expect(first.offset).toBe(1)
    expect(first.eof).toBe(false)

    const last = ok(workspaceFileRemotes.read('notes/demo.txt', { offset: 3, limit: 2 }))
    expect(last.offset).toBe(3)
    expect(last.text).not.toBe(first.text)
    expect(last.eof).toBe(false)

    const tail = ok(workspaceFileRemotes.read('notes/demo.txt', { offset: 12_005, limit: 1 }))
    expect(tail.lines).toBe(0)
    expect(tail.eof).toBe(true)
  })

  it('returns the whole short file under the default range', () => {
    const value = ok(workspaceFileRemotes.read('README.md', {}))
    expect(value.lines).toBe(4)
    expect(value.eof).toBe(true)
    expect(value.text.startsWith('# README.md')).toBe(true)
  })
})

describe('workspaceFileRemotes.stat', () => {
  it('requires a path', () => {
    expect(workspaceFileRemotes.stat('')).toMatchObject({
      ok: false,
      error: { code: 'gateway/bad-request' },
    })
  })

  it('refuses the binary extensions', () => {
    for (const path of ['notes/chart.png', 'notes/blob.bin']) {
      expect(workspaceFileRemotes.stat(path)).toMatchObject({
        ok: false,
        error: { code: 'workspace-file/not-text' },
      })
    }
  })

  it('normalizes a relative path and measures the text in bytes', () => {
    const relative = ok(workspaceFileRemotes.stat('README.md'))
    expect(relative.absolutePath).toBe('/README.md')
    expect(relative.version).toBe('fx-v1')
    expect(ok(workspaceFileRemotes.stat('/README.md')).absolutePath).toBe('/README.md')
    // The byte count is the UTF-8 length of the text `read` hands back.
    const page = ok(workspaceFileRemotes.read('README.md', {}))
    expect(relative.bytes).toBe(new TextEncoder().encode(page.text).byteLength)
    expect(ok(workspaceFileRemotes.stat('notes/demo.txt')).bytes).toBeGreaterThan(relative.bytes)
  })
})

describe('createDirectoryPickerRemotes', () => {
  it('picks a fixed project under the given home', () => {
    expect(ok(createDirectoryPickerRemotes(HOME).pick())).toBe(`${HOME}/Documents/project`)
  })

  it('lists the home by default, marking dot entries hidden', () => {
    const listing = ok(createDirectoryPickerRemotes(HOME).list())
    expect(listing.home).toBe(HOME)
    expect(listing.path).toBe(HOME)
    expect(listing.truncated).toBe(false)
    expect(listing.crumbs.map(c => c.path)).toEqual(['/', '/home', HOME])
    expect(listing.entries).toEqual([
      { name: '.config', path: `${HOME}/.config`, hidden: true },
      { name: 'Documents', path: `${HOME}/Documents`, hidden: false },
      { name: 'Downloads', path: `${HOME}/Downloads`, hidden: false },
    ])
  })

  it('refuses a level outside the tree', () => {
    expect(createDirectoryPickerRemotes(HOME).list('/nope')).toMatchObject({
      ok: false,
      error: { code: 'directory-picker/unreadable' },
    })
  })

  it('joins root children with a single separator', () => {
    const listing = ok(createDirectoryPickerRemotes(HOME).list('/'))
    expect(listing.entries).toEqual([{ name: 'home', path: '/home', hidden: false }])
    expect(listing.crumbs).toEqual([{ name: '/', path: '/', hidden: false }])
  })

  it('lists a known child that holds nothing yet as empty', () => {
    expect(ok(createDirectoryPickerRemotes(HOME).list(`${HOME}/Documents/project`)).entries).toEqual([])
  })

  it('creates a directory under an existing parent', () => {
    const picker = createDirectoryPickerRemotes(HOME)
    expect(ok(picker.createDirectory(`${HOME}/Documents`, 'fresh'))).toBe(`${HOME}/Documents/fresh`)
    expect(ok(picker.list(`${HOME}/Documents/fresh`)).entries).toEqual([])
  })

  it('creates a root child without minting a double separator', () => {
    const picker = createDirectoryPickerRemotes(HOME)
    expect(ok(picker.createDirectory('/', 'extra'))).toBe('/extra')
    expect(ok(picker.list('/')).entries.map(e => e.name)).toContain('extra')
  })

  it('reports a missing parent and an existing name', () => {
    const picker = createDirectoryPickerRemotes(HOME)
    expect(picker.createDirectory('/nope', 'child')).toMatchObject({
      ok: false,
      error: { code: 'directory-picker/create-failed' },
    })
    expect(picker.createDirectory(`${HOME}/Documents`, 'project')).toMatchObject({
      ok: false,
      error: { code: 'directory-picker/exists' },
    })
  })

  it('keeps created directories inside the world that made them', () => {
    const first = createDirectoryPickerRemotes(HOME)
    const second = createDirectoryPickerRemotes(HOME)
    expect(ok(first.createDirectory(`${HOME}/Documents`, 'scratch'))).toBe(`${HOME}/Documents/scratch`)
    expect(ok(first.list(`${HOME}/Documents`)).entries.map(e => e.name)).toContain('scratch')
    expect(ok(second.list(`${HOME}/Documents`)).entries.map(e => e.name)).not.toContain('scratch')
  })
})
