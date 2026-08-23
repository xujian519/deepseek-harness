import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeSwebenchRow, readManifestRows } from '../src/campaign/manifest.ts'
import { runCampaign } from '../src/campaign/orchestrate.ts'

/**
 * Real-process e2e for the local-path campaign runner: clone the task repo,
 * create a task venv, run one agent arm through `dsh --profile headless`,
 * collect the prediction, and settle the local pytest verdict. This is the
 * keyed evidence that the runner is real — it cannot run without a model key
 * and network. It self-skips without $DEEPSEEK_API_KEY or the exported SWE-bench
 * manifest at $SELF_EVOLVE_E2E_MANIFEST (export command in the README).
 *
 * The paired-arm and evolved-overlay logic are unit-tested separately; this
 * exercises the agent run end to end.
 */

const KEY = process.env.DEEPSEEK_API_KEY
const MANIFEST = process.env.SELF_EVOLVE_E2E_MANIFEST

describe.skipIf(!KEY || !MANIFEST)('self-evolve campaign e2e (real process, keyed)', () => {
  it('runs the first manifest task through the local pipeline to a verdict', async () => {
    const root = await mkdtemp(join(tmpdir(), 'self-evolve-e2e-'))
    try {
      const rows = await readManifestRows(MANIFEST as string)
      expect(rows.length).toBeGreaterThan(0)
      const row = normalizeSwebenchRow(rows[0] as Record<string, unknown>)
      if (row === null) throw new Error('self-evolve-eval e2e: first manifest row is incomplete (needs repo, base_commit, problem_statement, test_patch)')

      const subsetPath = join(root, 'subset.json')
      await writeFile(subsetPath, JSON.stringify([
        {
          instanceId: row.instanceId,
          repo: row.repo,
          baseCommit: row.baseCommit,
          failToPass: row.failToPass,
          passToPass: row.passToPass,
        },
      ]))

      const summary = await runCampaign({
        manifestPath: resolve(MANIFEST as string),
        subsetPath,
        resultsPath: join(root, 'results.json'),
        statsPath: join(root, 'stats.jsonl'),
        workDir: join(root, 'work'),
        armMode: 'baseline',
        profile: 'headless',
        dshEntry: resolve('apps/cli/src/bin.ts'),
        tsxImport: 'tsx/esm',
        buildCommandTemplate: '{python} -m compileall -q .',
        pythonVersion: '3.11',
        envTool: 'venv',
        concurrency: 1,
        agentTimeoutMs: 30 * 60 * 1000,
        verifyTimeoutMs: 30 * 60 * 1000,
        setupTimeoutMs: 10 * 60 * 1000,
        installTimeoutMs: 20 * 60 * 1000,
        skipExisting: false,
        keepWork: false,
        dryRun: false,
      })

      // The pipeline reached a per-arm verdict: no infra (env/manifest) error,
      // and the arm settled a boolean (a failed agent is a failed verdict, not
      // an infrastructure failure).
      expect(summary.infraErrors).toBe(0)
      const results = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as {
        tasks: Array<Record<string, unknown>>
      }
      expect(results.tasks).toHaveLength(1)
      expect(typeof results.tasks[0]?.baselinePassed).toBe('boolean')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 40 * 60 * 1000)
})
