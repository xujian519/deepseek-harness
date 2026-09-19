/**
 * Platform- and account-dependent host branches that no single runner reaches
 * on its own: the Windows spawn-helper skip, the POSIX spawn-helper chmod (the
 * artifact is macOS-only, so a Linux coverage runner never takes that path),
 * the Windows shell-argument shape, the login-shell fallback for an account
 * without a passwd shell, the case-insensitive checkout comparison on win32,
 * the `$DSH_HOME` fallback to the account home, and the Windows repair command
 * without its installer script. Each branch is pinned through an injected
 * platform/env or a delegated module mock.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureSpawnHelper, defaultShell, shellSpawnArgs } from '../src/pty-manager.ts'
import { findProfileDir, buildRepairCommand } from '../src/pty-deps.ts'
import * as git from '../src/git.ts'

/** The chmod spy the mocked `node:fs` records (the POSIX executable-bit fix). */
const chmodSyncSpy = vi.fn()

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: (path: unknown) => (String(path).includes('spawn-helper') ? true : actual.existsSync(path as never)),
    chmodSync: (path: unknown, mode?: unknown) => { chmodSyncSpy(path, mode); return undefined },
  }
})

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, userInfo: () => ({ shell: '' }) }
})

/** Run `fn` with `process.platform` reporting the given value. */
async function withPlatform<T>(platform: NodeJS.Platform, fn: () => T | Promise<T>): Promise<T> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    return await fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

describe('windows shell resolution', () => {
  it('leaves the spawn-helper executable bit alone on Windows', async () => {
    chmodSyncSpy.mockClear()
    await withPlatform('win32', () => { ensureSpawnHelper() })
    expect(chmodSyncSpy).not.toHaveBeenCalled()
  })

  it('starts Windows shells without the POSIX login flag', async () => {
    await withPlatform('win32', () => {
      expect(shellSpawnArgs()).toEqual([])
    })
  })

  it('keeps the configured shell arguments on every platform', async () => {
    await withPlatform('win32', () => {
      expect(shellSpawnArgs(['-NoLogo'])).toEqual(['-NoLogo'])
    })
  })
})

describe('spawn-helper executable bit', () => {
  it('restores it on POSIX from a runner that has no helper on disk', async () => {
    chmodSyncSpy.mockClear()
    await withPlatform('linux', () => { ensureSpawnHelper() })
    // The mocked `node:fs` reports every spawn-helper candidate present, so the
    // macOS artifact's path runs on any host; the `prebuilds/linux` prefix
    // proves the injected platform, not this machine's layout, drove the call.
    expect(chmodSyncSpy).toHaveBeenCalledWith(expect.stringContaining(join('prebuilds', 'linux')), 0o755)
  })
})

describe('login shell fallback', () => {
  it('falls back to /bin/bash when the account has no login shell', () => {
    // userInfo() reports an empty shell (services and containers often start
    // dsh without one, and some chroots have no passwd entry at all).
    expect(defaultShell({ platform: 'linux', env: {} })).toBe('/bin/bash')
  })
})

describe('profile directory fallbacks', () => {
  it('falls back to the account home when DSH_HOME is set but empty', () => {
    const previousHome = process.env.HOME
    const previousUserProfile = process.env.USERPROFILE
    const previousDshHome = process.env.DSH_HOME
    process.env.HOME = mkdtempSync(join(tmpdir(), 'dsh-sidebar-home-'))
    process.env.USERPROFILE = process.env.HOME
    process.env.DSH_HOME = ''
    try {
      // No ancestor of the ghost module is a profile root, and the fallback
      // under the account home has no profile either.
      expect(findProfileDir(join(tmpdir(), 'dsh-sidebar-ghost', String(process.pid), 'mod.js'))).toBeNull()
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousUserProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = previousUserProfile
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
    }
  })

  it('falls back to the plugin command when the Windows installer script is absent', () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), 'dsh-sidebar-winroot-'))
    try {
      const { command, note } = buildRepairCommand({ pluginRoot, profileDir: null, platform: 'win32' })
      expect(command).toBe('dsh plugin --profile "web" install')
      expect(note).toContain('allowBuilds')
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true })
    }
  })
})

describe('cross-platform checkout identity', () => {
  let root: string
  let main: string
  let linked: string

  const IDENTITY = {
    GIT_AUTHOR_NAME: 'dsh-better-sidebar-test',
    GIT_AUTHOR_EMAIL: 'test@dsh.invalid',
    GIT_COMMITTER_NAME: 'dsh-better-sidebar-test',
    GIT_COMMITTER_EMAIL: 'test@dsh.invalid',
  }

  const gitRun = (cwd: string, args: string[]): void => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...IDENTITY } })
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'dsh-sidebar-identity-'))
    // git reports checkout roots through resolved symlinks (macOS /var is
    // /private/var), so the fixture compares against real paths.
    const mainPath = join(root, 'main')
    const linkedPath = join(root, 'linked')
    mkdirSync(mainPath, { recursive: true })
    main = realpathSync(mainPath)
    gitRun(main, ['init', '-q'])
    gitRun(main, ['checkout', '-q', '-b', 'main'])
    writeFileSync(join(main, 'a.txt'), 'one\n')
    gitRun(main, ['add', '-A'])
    gitRun(main, ['commit', '-q', '-m', 'base'])
    gitRun(main, ['worktree', 'add', '-q', '-b', 'feature', linkedPath])
    linked = realpathSync(linkedPath)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('matches a checkout selected in a different letter case on win32', async () => {
    const requested = linked.toUpperCase()
    if (requested === linked) return
    // A Windows caller may report the same checkout with different casing;
    // the identity comparison must accept it there — and only there.
    await withPlatform('win32', async () => {
      await expect(git.resolveWorktree(main, requested)).resolves.toBe(linked)
    })
    await expect(git.resolveWorktree(main, requested)).rejects.toMatchObject({ code: 'git-worktree' })
  })
})
