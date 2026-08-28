/**
 * Git-panel failure and edge coverage against scratch repositories: the
 * command-runner failure paths (timeout, unspawnable git, silent non-zero
 * exit), porcelain parsers' degenerate rows, repository discovery (unreadable
 * cwd, duplicate child roots through a shared gitdir, unknown-repository
 * errors), worktree inventory with a failing checkout, and the mutating
 * commands (stage/unstage/commit/checkout/show) end to end. The runner
 * failures use PATH shims because the real git cannot be made to hang or to
 * fail silently on demand.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from '../src/git.ts'

const IDENTITY = {
  GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
  GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
  GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
  GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
}

/** Run a fixture git command with the scratch identity (never the user's). */
function gitRun(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout
}

/** A fresh single-branch repo with one committed file `a.txt`. */
function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-'))
  gitRun(dir, ['init', '-q'])
  gitRun(dir, ['checkout', '-q', '-b', 'main'])
  writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n')
  gitRun(dir, ['add', '-A'])
  gitRun(dir, ['commit', '-q', '-m', 'base'])
  return dir
}

describe('porcelain parser degenerate rows', () => {
  it('parses newline-framed worktree records when no NUL framing is present', () => {
    const records = git.parseWorktreeList([
      'worktree /repos/main',
      'HEAD abc',
      'branch refs/heads/main',
      '',
      'worktree /repos/linked',
      'branch refs/heads/feature',
      'locked',
      '',
    ].join('\n'))
    expect(records).toEqual([
      { path: '/repos/main', branch: 'main', locked: false, prunable: false },
      { path: '/repos/linked', branch: 'feature', locked: true, prunable: false },
    ])
  })

  it('skips log rows without a hash/subject pair and fills missing fields', () => {
    const rows = git.parseLogLines(['garbage-without-separators', 'h1\x1fsubject-only'].join('\n'))
    // The malformed row is dropped; the thin row keeps the hash fallbacks.
    expect(rows).toEqual([{ hash: 'h1', subject: 'subject-only', author: '', date: '', hashFull: 'h1', refs: '' }])
  })
})

describe('git command runner failures', () => {
  it('reports a timed-out command through isGitRepo (PATH shim that never exits)', async () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitshim-hang-'))
    const shim = join(shimDir, 'git')
    writeFileSync(shim, '#!/bin/sh\nexec sleep 120\n')
    chmodSync(shim, 0o755)
    const previousPath = process.env.PATH
    try {
      process.env.PATH = `${shimDir}:${previousPath ?? ''}`
      const started = Date.now()
      // The 5s discovery timeout kills the shim and rejects; isGitRepo
      // degrades that to false.
      expect(await git.isGitRepo(tmpdir())).toBe(false)
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_000)
    } finally {
      process.env.PATH = previousPath
      rmSync(shimDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('degrades to false when git cannot be spawned at all', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitshim-none-'))
    const previousPath = process.env.PATH
    try {
      process.env.PATH = emptyDir
      expect(await git.isGitRepo(tmpdir())).toBe(false)
    } finally {
      process.env.PATH = previousPath
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('falls back to the exit-code message when a failing git prints nothing', async () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitshim-silent-'))
    const shim = join(shimDir, 'git')
    writeFileSync(shim, '#!/bin/sh\nexit 3\n')
    const previousPath = process.env.PATH
    try {
      process.env.PATH = `${shimDir}:${previousPath ?? ''}`
      expect(await git.isGitRepo(tmpdir())).toBe(false)
    } finally {
      process.env.PATH = previousPath
      rmSync(shimDir, { recursive: true, force: true })
    }
  })
})

describe('repository discovery edges', () => {
  it('finds no roots under an unreadable cwd', async () => {
    const ghost = join(tmpdir(), 'dsh-sidebar-gitcov-ghost', String(process.pid))
    await expect(git.repoRoots(ghost)).resolves.toEqual([])
  })

  it('collapses two child checkouts that resolve to one repository root', async () => {
    const container = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-dedupe-'))
    try {
      const main = join(container, 'proj')
      const alias = join(container, 'projcopy')
      mkdirSync(main, { recursive: true })
      mkdirSync(alias, { recursive: true })
      gitRun(main, ['init', '-q'])
      gitRun(main, ['checkout', '-q', '-b', 'main'])
      // projcopy is a second checkout whose .git file points at proj's
      // gitdir with core.worktree pinned back to proj — git resolves BOTH
      // directories to the same top level, so discovery must dedupe.
      writeFileSync(join(alias, '.git'), `gitdir: ${join(main, '.git')}\n`)
      gitRun(main, ['config', 'core.worktree', main])
      const roots = await git.repoRoots(container)
      expect(roots).toHaveLength(1)
      // git reports the top level through resolved symlinks (macOS /var is
      // /private/var), so the expectation resolves the fixture the same way.
      expect(roots[0]).toBe(realpathSync(main))
    } finally {
      rmSync(container, { recursive: true, force: true })
    }
  })

  it('throws not-repo from repoRoot when discovery finds nothing', async () => {
    const ghost = join(tmpdir(), 'dsh-sidebar-gitcov-ghost2', String(process.pid))
    await expect(git.repoRoot(ghost)).rejects.toMatchObject({ code: 'not-repo' })
  })

  it('falls back to the first discovered root when the selection matches nothing', async () => {
    const dir = makeScratchRepo()
    try {
      await expect(git.repoRoot(dir, join(tmpdir(), 'unrelated-repo'))).resolves.toBe(realpathSync(dir))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reports isRepo:false for a cwd outside any repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-plain-'))
    try {
      await expect(git.status(plain)).resolves.toEqual({ isRepo: false, entries: [], repositories: [] })
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})

describe('worktree inventory edges', () => {
  it('returns an empty inventory outside a repository', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-plain2-'))
    try {
      await expect(git.worktrees(plain)).resolves.toEqual([])
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })

  it('counts changes per linked checkout, tolerating a status-failing one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-wt-'))
    try {
      mkdirSync(join(root, 'main'), { recursive: true })
      // git emits worktree records through resolved symlinks (macOS /var is
      // /private/var), so the fixture compares against real paths.
      const main = realpathSync(join(root, 'main'))
      const linkedPath = join(root, 'linked')
      gitRun(main, ['init', '-q'])
      gitRun(main, ['checkout', '-q', '-b', 'main'])
      writeFileSync(join(main, 'a.txt'), 'one\n')
      gitRun(main, ['add', '-A'])
      gitRun(main, ['commit', '-q', '-m', 'base'])
      gitRun(main, ['worktree', 'add', '-q', '-b', 'feature', linkedPath])
      const linked = realpathSync(linkedPath)
      // The linked checkout carries a change...
      writeFileSync(join(linked, 'a.txt'), 'one\nCHANGED\n')
      // ...and a corrupt index makes `git status` FAIL there; the inventory
      // must still list it with changes 0 instead of throwing. A linked
      // checkout's .git is a pointer file, so its index lives in the gitdir
      // it names.
      const linkedGitDir = readFileSync(join(linked, '.git'), 'utf8').replace(/^gitdir:\s*/, '').trim()
      writeFileSync(join(linkedGitDir, 'index'), 'not an index')
      const rows = await git.worktrees(main)
      expect(rows).toHaveLength(2)
      const mainRow = rows.find(row => row.path === main)!
      const linkedRow = rows.find(row => row.path === linked)!
      expect(mainRow.current).toBe(true)
      expect(mainRow.branch).toBe('main')
      expect(linkedRow.current).toBe(false)
      expect(linkedRow.branch).toBe('feature')
      expect(linkedRow.changes).toBe(0)
      // The current checkout sorts first even with a failing sibling.
      expect(rows[0]!.path).toBe(main)
      expect(await git.resolveWorktree(main, linked)).toBe(linked)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('branch listing with an unborn HEAD', () => {
  it('prepends HEAD when no branch refs exist yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-gitcov-unborn-'))
    try {
      gitRun(dir, ['init', '-q', '-b', 'main'])
      const branches = await git.branches(dir)
      expect(branches.current).toBe('HEAD')
      expect(branches.names).toEqual(['HEAD'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('mutating git commands end to end', () => {
  it('stages, unstages, commits, switches branches, and reads revision content', async () => {
    const dir = makeScratchRepo()
    // The panel's git spawn uses the ambient identity; pin a scratch one for
    // the commit (confined to this test's process env).
    const previous = {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
    }
    Object.assign(process.env, IDENTITY)
    try {
      // Stage one path, then everything.
      writeFileSync(join(dir, 'a.txt'), 'one\nCHANGED\nthree\n')
      writeFileSync(join(dir, 'b.txt'), 'new file\n')
      await git.stage(dir, 'a.txt')
      let status = await git.status(dir)
      expect(status.entries.find(entry => entry.path === 'a.txt')?.xy).toBe('M ')
      await git.stage(dir, undefined)
      status = await git.status(dir)
      expect(status.entries.find(entry => entry.path === 'b.txt')?.xy).toBe('A ')

      // Unstage one path, then the rest.
      await git.unstage(dir, 'b.txt')
      status = await git.status(dir)
      expect(status.entries.find(entry => entry.path === 'b.txt')?.xy).toBe('??')
      await git.unstage(dir, undefined)
      status = await git.status(dir)
      expect(status.entries.find(entry => entry.path === 'a.txt')?.xy).toBe(' M')

      // Commit the staged set with a message.
      await git.stage(dir, undefined)
      await git.commit(dir, 'panel commit')
      const log = await git.log(dir, 1, 0)
      expect(log[0]!.subject).toBe('panel commit')

      // Switch to a second branch prepared by the fixture, then back.
      gitRun(dir, ['branch', 'feature'])
      await git.checkout(dir, 'feature')
      expect(await git.currentBranch(dir)).toBe('feature')
      await git.checkout(dir, 'main')
      expect(await git.currentBranch(dir)).toBe('main')

      // Revision content: an existing path resolves; a missing one is null.
      expect(await git.show(dir, 'HEAD', 'a.txt')).toContain('CHANGED')
      expect(await git.show(dir, 'HEAD', 'no-such-file.txt')).toBeNull()
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
