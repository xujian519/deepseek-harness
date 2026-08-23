import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { indexSwebenchRows, normalizeSwebenchRow, readManifestRows } from '../src/campaign/manifest.ts'
import { mergeArmOutcome, type PartialTaskOutcome } from '../src/campaign/merge.ts'
import { renderEvolvedOverlay } from '../src/campaign/overlay.ts'
import { planCampaign, runCampaign } from '../src/campaign/orchestrate.ts'
import { parseTestPatchFiles } from '../src/campaign/patch.ts'
import type { EvalTask } from '../src/types.ts'

const CAMPAIGN_OPTIONS = {
  manifestPath: '/nonexistent-manifest.jsonl',
  subsetPath: '/nonexistent-subset.json',
  resultsPath: '/nonexistent-results.json',
  statsPath: '/nonexistent-stats.jsonl',
  workDir: '/nonexistent-work',
  armMode: 'both' as const,
  profile: 'headless',
  dshEntry: '/nonexistent/bin.ts',
  tsxImport: '/nonexistent/tsx.js',
  buildCommandTemplate: '{python} -m compileall -q .',
  pythonVersion: '3.11',
  envTool: 'uv' as const,
  concurrency: 2,
  agentTimeoutMs: 60_000,
  verifyTimeoutMs: 60_000,
  setupTimeoutMs: 60_000,
  installTimeoutMs: 60_000,
  skipExisting: false,
  keepWork: true,
  dryRun: true,
}

describe('parseTestPatchFiles', () => {
  it('extracts b-side paths from diff headers and dedupes', () => {
    const listed = parseTestPatchFiles(
      ['diff --git a/tests/a.py b/tests/a.py', '--- a/tests/a.py', '+++ b/tests/a.py',
        'diff --git a/tests/b.py b/tests/b.py', '--- a/tests/b.py', '+++ b/tests/b.py'].join('\n'),
    )
    expect(listed).toEqual(['tests/a.py', 'tests/b.py'])
  })

  it('handles new files and quoted paths with spaces', () => {
    const listed = parseTestPatchFiles(
      ['diff --git a/tests/new/test_x.py b/tests/new/test_x.py', 'new file mode 100644', '--- /dev/null', '+++ b/tests/new/test_x.py',
        'diff --git "a/tests/my file.py" "b/tests/my file.py"', '--- a/tests/my file.py', '+++ b/tests/my file.py'].join('\n'),
    )
    expect(listed).toEqual(['tests/new/test_x.py', 'tests/my file.py'])
  })

  it('returns an empty list for a patch with no diffs', () => {
    expect(parseTestPatchFiles('---\n+++\n')).toEqual([])
  })

  it('skips a diff header without a b-side split', () => {
    expect(parseTestPatchFiles('diff --git a/tests/a.py\n')).toEqual([])
  })

  it('skips an empty b-side path and dedupes repeated paths', () => {
    expect(parseTestPatchFiles(['diff --git a/foo b/', 'diff --git a/x.py b/x.py', 'diff --git a/x.py b/x.py'].join('\n'))).toEqual(['x.py'])
  })
})

describe('renderEvolvedOverlay', () => {
  it('renders both bundle rows and the build command', () => {
    const overlay = renderEvolvedOverlay({ buildCommand: '/work/.venv/bin/python -m compileall -q .' })
    expect(overlay).toContain('- insert:')
    expect(overlay).toContain("name: '@deepseek-ai/dsh-self-evolve-basic'")
    expect(overlay).toContain("name: '@deepseek-ai/dsh-tool-self-evolve'")
    expect(overlay).toContain("buildCommand: '/work/.venv/bin/python -m compileall -q .'")
  })

  it('escapes single quotes in the build command (YAML single-quoted scalar)', () => {
    const overlay = renderEvolvedOverlay({ buildCommand: "python -X dev 'a b'" })
    expect(overlay).toContain("buildCommand: 'python -X dev ''a b'''")
  })
})

describe('mergeArmOutcome', () => {
  it('appends a row for an unknown task keeping the other arm open', () => {
    const merged = mergeArmOutcome([], 't-1', 'baseline', true)
    expect(merged).toEqual([{ taskId: 't-1', baselinePassed: true }])
  })

  it('updates the arm in place and preserves the other arm verdict', () => {
    const rows: PartialTaskOutcome[] = [{ taskId: 't-1', baselinePassed: true }]
    const merged = mergeArmOutcome(rows, 't-1', 'evolved', false, 'no prediction')
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual({ taskId: 't-1', baselinePassed: true, evolvedPassed: false, evolvedError: 'no prediction' })
  })

  it('keeps an infra-only failure retryable (no boolean) and later folds the verdict in', () => {
    const infra = mergeArmOutcome([], 't-1', 'baseline', undefined, 'env: clone failed')
    expect(infra[0]).toEqual({ taskId: 't-1', baselineError: 'env: clone failed' })
    const settled = mergeArmOutcome(infra, 't-1', 'baseline', false)
    expect(settled[0]).toEqual({ taskId: 't-1', baselineError: 'env: clone failed', baselinePassed: false })
  })

  it('appends a bare task row when no verdict or error is supplied', () => {
    expect(mergeArmOutcome([], 't-9', 'baseline')).toEqual([{ taskId: 't-9' }])
  })

  it('sets both the evolved verdict and its error together', () => {
    const merged = mergeArmOutcome([], 't-2', 'evolved', true, 'note')
    expect(merged[0]).toEqual({ taskId: 't-2', evolvedPassed: true, evolvedError: 'note' })
  })

  it('preserves sibling rows when updating one task', () => {
    const merged = mergeArmOutcome(
      [{ taskId: 'a', baselinePassed: true }, { taskId: 'b', baselinePassed: false }],
      'a',
      'evolved',
      true,
    )
    expect(merged).toEqual([
      { taskId: 'a', baselinePassed: true, evolvedPassed: true },
      { taskId: 'b', baselinePassed: false },
    ])
  })
})

describe('manifest rows', () => {
  const valid = {
    instance_id: 'django__django-1',
    repo: 'django/django',
    base_commit: 'abc123',
    problem_statement: 'Fix the bug.',
    test_patch: 'diff --git a/tests/x.py b/tests/x.py',
    install: 'pip install -e .',
    FAIL_TO_PASS: ['tests/x.py::test_1', 7],
    PASS_TO_PASS: ['tests/x.py::test_2'],
  }

  it('normalizes a full row and filters non-string test ids', () => {
    const row = normalizeSwebenchRow(valid)
    expect(row).not.toBeNull()
    expect(row?.failToPass).toEqual(['tests/x.py::test_1'])
    expect(row?.install).toBe('pip install -e .')
  })

  it('omits install when absent and tolerates a non-array failToPass/passToPass', () => {
    const row = normalizeSwebenchRow({ ...valid, install: undefined, FAIL_TO_PASS: 'not-an-array', PASS_TO_PASS: 7 })
    expect(row).not.toBeNull()
    expect(row?.install).toBeUndefined()
    expect(row?.failToPass).toEqual([])
    expect(row?.passToPass).toEqual([])
  })

  it('returns null when a field the campaign needs is missing', () => {
    expect(normalizeSwebenchRow({ ...valid, problem_statement: undefined })).toBeNull()
    expect(normalizeSwebenchRow({ ...valid, test_patch: '' })).toBeNull()
  })

  it('indexes by instance id and drops rows without one', () => {
    const index = indexSwebenchRows([valid, { repo: 'x/y' }, { ...valid, instance_id: 'a__b-2' }])
    expect(index.has('django__django-1')).toBe(true)
    expect(index.has('a__b-2')).toBe(true)
    expect(index.size).toBe(2)
  })

  it('reads JSONL manifests', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'self-evolve-eval-'))
    try {
      const path = join(temp, 'rows.jsonl')
      await writeFile(path, `${JSON.stringify(valid)}\n\n${JSON.stringify({ instance_id: 'a__b-2' })}\n`)
      const rows = await readManifestRows(path)
      expect(rows).toHaveLength(2)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('reads a JSON array manifest, filtering non-record elements', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'self-evolve-eval-'))
    try {
      const path = join(temp, 'rows.json')
      await writeFile(path, JSON.stringify([valid, 'nope', null]))
      const rows = await readManifestRows(path)
      expect(rows).toHaveLength(1)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('skips non-record lines in a JSONL manifest', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'self-evolve-eval-'))
    try {
      const path = join(temp, 'rows.jsonl')
      await writeFile(path, `${JSON.stringify(valid)}\nnull\n"nope"\n`)
      const rows = await readManifestRows(path)
      expect(rows).toHaveLength(1)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})

describe('planCampaign', () => {
  const tasks: EvalTask[] = [{ instanceId: 't-1', repo: 'a/b', baseCommit: 'c', failToPass: [], passToPass: [] }]

  it('plans both arms for armMode both', () => {
    const plan = planCampaign(tasks, 'both')
    expect(plan[0]?.arms).toEqual(['baseline', 'evolved'])
  })

  it('plans a single arm otherwise', () => {
    expect(planCampaign(tasks, 'baseline')[0]?.arms).toEqual(['baseline'])
    expect(planCampaign(tasks, 'evolved')[0]?.arms).toEqual(['evolved'])
  })
})

describe('runCampaign dry-run', () => {
  it('reports the plan without reading the manifest', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'self-evolve-eval-'))
    try {
      const subsetPath = join(temp, 'subset.json')
      await writeFile(subsetPath, JSON.stringify([
        { instanceId: 't-1', repo: 'a/b', baseCommit: 'c', failToPass: ['x'], passToPass: [] },
        { instanceId: 't-2', repo: 'a/b', baseCommit: 'c', failToPass: ['x'], passToPass: [] },
      ]))
      const summary = await runCampaign({ ...CAMPAIGN_OPTIONS, subsetPath })
      expect(summary.planned).toBe(2)
      expect(summary.armRuns).toBe(4)
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})
