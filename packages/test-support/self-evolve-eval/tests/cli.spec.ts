import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const cliPath = join(import.meta.dirname, '..', 'src', 'cli.ts')

function runCli(...args: string[]): string {
  return execFileSync('pnpm', ['--silent', 'exec', 'tsx', cliPath, ...args], { encoding: 'utf8' })
}

describe('campaign CLI subcommand', () => {
  it('reports the plan in dry-run, reading the subset but not the manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-cli-'))
    try {
      const subset = join(root, 'subset.json')
      await writeFile(subset, JSON.stringify([
        { instanceId: 't-1', repo: 'a/b', baseCommit: 'c', failToPass: ['tests/test_1.py'], passToPass: [] },
        { instanceId: 't-2', repo: 'a/b', baseCommit: 'c', failToPass: ['tests/test_2.py'], passToPass: [] },
      ]))
      const out = runCli(
        'campaign',
        '--manifest', join(root, 'nonexistent-manifest.jsonl'),
        '--subset', subset,
        '--results', join(root, 'results.json'),
        '--stats', join(root, 'stats.jsonl'),
        '--work-dir', join(root, 'work'),
        '--dry-run',
      )
      expect(out).toContain('campaign (dry run): 2 task(s), 4 arm run(s)')
      expect(out).toMatch(/planned=2 armRuns=4/)
      expect(out).toContain('t-1 a/b@c')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an unknown arm mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-cli-'))
    try {
      const subset = join(root, 'subset.json')
      await writeFile(subset, JSON.stringify([]))
      let threw = false
      try {
        runCli(
          'campaign', '--arm', 'sideways',
          '--manifest', join(root, 'm.jsonl'), '--subset', subset,
          '--results', join(root, 'r.json'), '--stats', join(root, 's.jsonl'),
          '--work-dir', join(root, 'w'), '--dry-run',
        )
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
