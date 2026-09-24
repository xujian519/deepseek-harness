/**
 * Cross-file clone gate.
 *
 * One repo-wide pass keeps the long-standing threshold behavior, then a
 * tightened pass runs over the domains whose real clones sat below that
 * threshold and compares the reported clone pairs against the checked-in
 * baseline. The tightened pass ignores `jscpd:ignore` markers on purpose: in
 * these domains an accepted clone is registered by naming its file pair in the
 * baseline, so a one-sided marker can never quietly hide a new pair.
 *
 * Regenerate the baseline with `pnpm run duplication:baseline` after reviewing
 * every added pair.
 *
 * @module dsh-scripts/duplication-gate
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root, derived from this module's location. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Roots of the repo-wide pass: the same corpus the historical gate covered. */
const REPO_WIDE_ROOTS: readonly string[] = ['packages', 'scripts']

/**
 * Domains whose real clones stayed invisible under the repo-wide threshold.
 * Each is passed as its own jscpd root so reported paths are stable.
 */
export const TIGHTENED_DOMAINS: readonly string[] = ['packages/patent', 'packages/document']

/** Token floor of the tightened pass; below the repo-wide `.jscpd.json` floor. */
export const TIGHTENED_MIN_TOKENS = 30

/** Printed-line floor of the tightened pass. */
export const TIGHTENED_MIN_LINES = 5

/** Checked-in record of the clone pairs the tightened pass is allowed to report. */
export const BASELINE_PATH = 'scripts/duplication-baseline.json'

/** Accepted clone pairs plus the tightened thresholds they were recorded under. */
interface DuplicationBaseline {
  minTokens: number
  minLines: number
  pairs: string[]
}

/** One jscpd duplicate entry, as the JSON reporter writes it. */
interface JscpdDuplicate {
  firstFile: { name: string }
  secondFile: { name: string }
}

/** The subset of the jscpd JSON report this gate reads. */
interface JscpdReport {
  duplicates: JscpdDuplicate[]
  statistics: { total: { sources: number } }
}

/** Thresholds for one jscpd pass. */
export interface PassThresholds {
  minTokens: number
  minLines: number
}

/** Result of comparing reported clone pairs against the baseline. */
export interface ClonePairDiff {
  /** Pairs the gate must reject because the baseline does not accept them. */
  added: string[]
  /** Baseline entries the tightened pass no longer reports. */
  stale: string[]
}

/**
 * Normalize one reported duplicate into an unordered, repo-relative pair key.
 * @param duplicate - one entry from the jscpd JSON report.
 * @param root - repo-relative root the pass ran over.
 * @returns `a|b` with the lexicographically smaller path first.
 */
function pairKey(duplicate: JscpdDuplicate, root: string): string {
  const paths = [duplicate.firstFile.name, duplicate.secondFile.name]
    .map(name => name.replaceAll('\\', '/'))
    .map(name => name.startsWith('packages/') || name.startsWith('scripts/') ? name : `${root}/${name}`)
    .sort()
  /* v8 ignore next -- jscpd reports two files per duplicate, so both entries exist. */
  return `${paths[0] ?? ''}|${paths[1] ?? ''}`
}

/**
 * Compare reported clone pairs against the accepted baseline.
 * @param baseline - accepted pair keys.
 * @param current - pair keys the tightened pass reported.
 * @returns pairs to reject and baseline entries that went stale.
 */
export function diffClonePairs(baseline: readonly string[], current: readonly string[]): ClonePairDiff {
  const accepted = new Set(baseline)
  const reported = new Set(current)
  return {
    added: [...reported].filter(pair => !accepted.has(pair)).sort(),
    stale: [...accepted].filter(pair => !reported.has(pair)).sort(),
  }
}

/**
 * Locate the jscpd executable: this repo's workspace bin first, then `PATH`.
 * Resolved relative to this module so a pass over a fixture tree still runs the
 * installed binary.
 * @returns an executable name or absolute path usable by `spawnSync`.
 */
function jscpdExecutable(): string {
  const name = process.platform === 'win32' ? 'jscpd.cmd' : 'jscpd'
  const workspaceBin = join(ROOT, 'node_modules', '.bin', name)
  return existsSync(workspaceBin) ? workspaceBin : name
}

/**
 * Run one jscpd pass and return the pairs it reported.
 * @param root - repo root the pass runs in.
 * @param roots - repo-relative directories to scan.
 * @param thresholds - token and line floors for this pass.
 * @param options - marker masking and extra ignore patterns.
 * @returns reported pair keys, sorted.
 */
export function detectClonePairs(
  root: string,
  roots: readonly string[],
  thresholds: PassThresholds,
  options: { maskMarkers: boolean },
): string[] {
  const base = JSON.parse(readFileSync(join(root, '.jscpd.json'), 'utf8')) as Record<string, unknown>
  const reportDir = mkdtempSync(join(tmpdir(), 'dsh-duplication-'))
  try {
    const config = {
      ...base,
      minTokens: thresholds.minTokens,
      minLines: thresholds.minLines,
      reporters: ['json'],
      output: reportDir,
      exitCode: 0,
      ...(options.maskMarkers ? {} : { ignorePattern: [] }),
    }
    const configPath = join(reportDir, 'config.json')
    writeFileSync(configPath, JSON.stringify(config))
    const result = spawnSync(
      jscpdExecutable(),
      ['--config', configPath, ...roots],
      { cwd: root, encoding: 'utf8', timeout: 300_000 },
    )
    if (result.error !== undefined) throw result.error
    const report = JSON.parse(readFileSync(join(reportDir, 'jscpd-report.json'), 'utf8')) as JscpdReport
    if (report.statistics.total.sources === 0) {
      throw new Error(`duplication-gate: ${roots.join(', ')} scanned no files; refusing to report an empty corpus`)
    }
    const pairs = new Set<string>()
    for (const duplicate of report.duplicates) pairs.add(pairKey(duplicate, roots[0] ?? ''))
    return [...pairs].sort()
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }
}

/**
 * Read the checked-in accepted-pair baseline.
 * @param root - repo root holding the baseline file.
 * @returns the recorded thresholds and accepted pairs.
 */
export function readBaseline(root: string): DuplicationBaseline {
  return JSON.parse(readFileSync(join(root, BASELINE_PATH), 'utf8')) as DuplicationBaseline
}

/**
 * Regenerate the baseline from the tightened pass and write it to disk.
 * @param root - repo root holding the baseline file.
 */
function writeBaseline(root: string): void {
  const pairs = TIGHTENED_DOMAINS.flatMap(domain => detectClonePairs(
    root,
    [domain],
    { minTokens: TIGHTENED_MIN_TOKENS, minLines: TIGHTENED_MIN_LINES },
    { maskMarkers: false },
  ))
  const baseline: DuplicationBaseline = {
    minTokens: TIGHTENED_MIN_TOKENS,
    minLines: TIGHTENED_MIN_LINES,
    pairs: [...new Set(pairs)].sort(),
  }
  writeFileSync(join(root, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write(`duplication-gate: recorded ${String(baseline.pairs.length)} accepted pair(s) in ${BASELINE_PATH}\n`)
}

/**
 * Run both passes and report every reason the gate fails.
 * @param root - repo root to scan.
 * @returns process exit code.
 */
export function runDuplicationGate(root: string): number {
  const repoWide = detectClonePairs(
    root,
    REPO_WIDE_ROOTS,
    JSON.parse(readFileSync(join(root, '.jscpd.json'), 'utf8')) as PassThresholds,
    { maskMarkers: true },
  )
  const failures: string[] = []
  if (repoWide.length > 0) {
    failures.push(`repo-wide pass reported ${String(repoWide.length)} clone pair(s):\n${repoWide.map(pair => `  ${pair}`).join('\n')}`)
  }

  const baseline = readBaseline(root)
  if (baseline.minTokens !== TIGHTENED_MIN_TOKENS || baseline.minLines !== TIGHTENED_MIN_LINES) {
    failures.push(
      `${BASELINE_PATH} records ${String(baseline.minTokens)} tokens / ${String(baseline.minLines)} lines but the gate runs ${String(TIGHTENED_MIN_TOKENS)} / ${String(TIGHTENED_MIN_LINES)}; regenerate with \`pnpm run duplication:baseline\``,
    )
  }
  const tightened = TIGHTENED_DOMAINS.flatMap(domain => detectClonePairs(
    root,
    [domain],
    { minTokens: TIGHTENED_MIN_TOKENS, minLines: TIGHTENED_MIN_LINES },
    { maskMarkers: false },
  ))
  const diff = diffClonePairs(baseline.pairs, tightened)
  if (diff.added.length > 0) {
    failures.push(`tightened pass reported ${String(diff.added.length)} pair(s) outside ${BASELINE_PATH}:\n${diff.added.map(pair => `  ${pair}`).join('\n')}`)
  }
  if (diff.stale.length > 0) {
    failures.push(`${BASELINE_PATH} lists ${String(diff.stale.length)} pair(s) the tightened pass no longer reports:\n${diff.stale.map(pair => `  ${pair}`).join('\n')}`)
  }

  for (const failure of failures) process.stderr.write(`duplication-gate: ${failure}\n`)
  if (failures.length === 0) {
    process.stdout.write(`duplication-gate: 0 repo-wide clones; ${String(tightened.length)} tightened-domain pair(s) match ${BASELINE_PATH}\n`)
  }
  return failures.length === 0 ? 0 : 1
}

/* v8 ignore start -- CLI entry: covered by scripts/duplication-gate.spec.ts through runDuplicationGate. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) writeBaseline(ROOT)
  else process.exitCode = runDuplicationGate(ROOT)
}
/* v8 ignore stop */
