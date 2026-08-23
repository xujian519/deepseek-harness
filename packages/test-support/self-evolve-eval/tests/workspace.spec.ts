import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SwebenchRow } from '../src/campaign/manifest.ts'
import { collectPrediction, verifyVerdict, type PreparedWorkspace } from '../src/campaign/workspace.ts'

/** Run `git` in `cwd` and return its stdout (throws on non-zero exit). */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** Init a temp git repo with one committed `app.py`, returning its HEAD. */
async function initRepo(root: string): Promise<{ repo: string; baseCommit: string }> {
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  await writeFile(join(repo, 'app.py'), 'x = 1\n')
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.email', 'a@b.c')
  git(repo, 'config', 'user.name', 'test')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'base')
  return { repo, baseCommit: git(repo, 'rev-parse', 'HEAD').trim() }
}

function row(baseCommit: string, overrides: Partial<SwebenchRow> = {}): SwebenchRow {
  return {
    instanceId: 't-1',
    repo: 'a/b',
    baseCommit,
    problemStatement: 'problem',
    testPatch: '',
    failToPass: [],
    passToPass: [],
    ...overrides,
  }
}

describe('collectPrediction', () => {
  it('excludes the test_patch files and .dsh from the prediction diff', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-pred-'))
    try {
      const { repo } = await initRepo(root)
      await writeFile(join(repo, 'app.py'), 'x = 1\ny = 2\n')
      mkdirSync(join(repo, 'tests'), { recursive: true })
      await writeFile(join(repo, 'tests', 'test_x.py'), 'def test():\n    pass\n')
      mkdirSync(join(repo, '.dsh'), { recursive: true })
      await writeFile(join(repo, '.dsh', 'id'), 'ignore\n')
      const predictionPath = join(root, 'prediction.patch')
      const workspace: PreparedWorkspace = {
        taskId: 't-1', taskDir: root, repoBase: repo, repoArms: { baseline: repo, evolved: repo },
        venv: '', venvPython: '', testPatchPath: '', testPatchFiles: ['tests/test_x.py'], row: row('c'),
      }
      const out = await collectPrediction(workspace, 'baseline', predictionPath)
      expect(out).toBe(predictionPath)
      const text = await readFile(predictionPath, 'utf8')
      expect(text).toContain('y = 2')
      expect(text).not.toContain('test_x')
      expect(text).not.toContain('ignore')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('returns null when only excluded paths changed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-empty-'))
    try {
      const { repo } = await initRepo(root)
      mkdirSync(join(repo, '.dsh'), { recursive: true })
      await writeFile(join(repo, '.dsh', 'id'), 'ignore\n')
      const workspace: PreparedWorkspace = {
        taskId: 't-1', taskDir: root, repoBase: repo, repoArms: { baseline: repo, evolved: repo },
        venv: '', venvPython: '', testPatchPath: '', testPatchFiles: [], row: row('c'),
      }
      expect(await collectPrediction(workspace, 'baseline', join(root, 'p.patch'))).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('verifyVerdict', () => {
  async function scaffold(root: string, stubExit: number): Promise<{
    workspace: PreparedWorkspace
    predictionPath: string
    logPath: string
  }> {
    const { repo, baseCommit } = await initRepo(root)
    const taskDir = join(root, 'task')
    mkdirSync(taskDir, { recursive: true })

    // test_patch adds a test file; prediction appends a line to app.py.
    mkdirSync(join(repo, 'tests'), { recursive: true })
    await writeFile(join(repo, 'tests', 'test_app.py'), 'def test_x():\n    assert True\n')
    git(repo, 'add', '-N', 'tests/test_app.py')
    const testPatch = git(repo, 'diff', '--', 'tests/test_app.py')
    git(repo, 'reset', '--hard', '-q', 'HEAD')
    git(repo, 'clean', '-fdq')

    await writeFile(join(repo, 'app.py'), 'x = 1\ny = 2\n')
    const prediction = git(repo, 'diff', '--', 'app.py')
    git(repo, 'checkout', '--', 'app.py')

    const testPatchPath = join(taskDir, 'test.patch')
    const predictionPath = join(taskDir, 'prediction.patch')
    const venvPython = join(taskDir, 'venv-python')
    const logPath = join(taskDir, 'verify.log')
    await writeFile(testPatchPath, testPatch)
    await writeFile(predictionPath, prediction)
    await writeFile(venvPython, `#!/bin/sh\nexit ${stubExit}\n`)
    chmodSync(venvPython, 0o755)

    return {
      workspace: {
        taskId: 't-1', taskDir, repoBase: repo, repoArms: { baseline: repo, evolved: repo },
        venv: join(taskDir, '.venv'), venvPython, testPatchPath, testPatchFiles: ['tests/test_app.py'],
        row: row(baseCommit, {
          testPatch, failToPass: ['tests/test_app.py::test_x'],
        }),
      },
      predictionPath,
      logPath,
    }
  }

  it('passes when the pytest stub exits 0', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-verify-'))
    try {
      const { workspace, predictionPath, logPath } = await scaffold(root, 0)
      const verdict = await verifyVerdict(workspace, 'baseline', predictionPath, 60_000, logPath)
      expect(verdict.passed).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails and reports the exit code when the pytest stub exits non-zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-verify-'))
    try {
      const { workspace, predictionPath, logPath } = await scaffold(root, 3)
      const verdict = await verifyVerdict(workspace, 'baseline', predictionPath, 60_000, logPath)
      expect(verdict.passed).toBe(false)
      expect(verdict.detail).toContain('pytest exited 3')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
