/**
 * Cross-file clone gate.
 *
 * One repo-wide pass keeps the long-standing threshold behavior, then a
 * tightened pass runs over the domains whose real clones sat below that
 * threshold and compares the reported clone pairs against the checked-in
 * baseline. A second tightened invocation scans every tightened domain at once
 * so clones that span two domains are compared too. Both tightened passes
 * ignore `jscpd:ignore` markers on purpose: in these domains an accepted clone
 * is registered by naming its file pair in the baseline, so a one-sided marker
 * can never quietly hide a new pair.
 *
 * Regenerate the baseline with `pnpm run duplication:baseline` after reviewing
 * every added pair.
 *
 * @module dsh-scripts/duplication-gate
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repo root, derived from this module's location. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Roots of the repo-wide pass: the same corpus the historical gate covered. */
const REPO_WIDE_ROOTS: readonly string[] = ['packages', 'scripts']

/**
 * Domains whose real clones stayed invisible under the repo-wide threshold.
 * Each is passed as its own jscpd root so reported paths are stable, and the
 * whole set is scanned once more for pairs that span two of them.
 */
export const TIGHTENED_DOMAINS: readonly string[] = ['packages/patent', 'packages/legal', 'packages/document']

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
  /** Pairs whose two files sit in the same tightened domain. */
  pairs: string[]
  /** Pairs whose two files sit in different tightened domains. */
  crossDomainPairs: string[]
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
 * Normalize one jscpd-reported file name to a repo-relative POSIX path.
 * @param name - file name as jscpd reported it, possibly with backslashes.
 * @param root - repo root the pass ran in.
 * @param scanRoots - repo-relative directories the pass scanned.
 * @returns the repo-relative path, or the normalized name when no scan root contains it.
 */
export function normalizeDuplicatePath(name: string, root: string, scanRoots: readonly string[]): string {
  const posix = name.replaceAll('\\', '/')
  if (scanRoots.some(scanRoot => posix === scanRoot || posix.startsWith(`${scanRoot}/`))) return posix
  if (isAbsolute(posix)) {
    const fromRoot = relative(root, posix).replaceAll('\\', '/')
    if (fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith('../')) return fromRoot
  }
  // A bare name is relative to one scanned root; pick the root that contains it instead of assuming the first.
  const owner = scanRoots.find(scanRoot => existsSync(join(root, scanRoot, posix)))
  return owner === undefined ? posix : `${owner}/${posix}`
}

/**
 * Normalize one reported duplicate into an unordered, repo-relative pair key.
 * @param duplicate - one entry from the jscpd JSON report.
 * @param root - repo root the pass ran in.
 * @param scanRoots - repo-relative directories the pass scanned.
 * @returns `a|b` with the lexicographically smaller path first.
 */
function pairKey(duplicate: JscpdDuplicate, root: string, scanRoots: readonly string[]): string {
  const paths = [duplicate.firstFile.name, duplicate.secondFile.name]
    .map(name => normalizeDuplicatePath(name, root, scanRoots))
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
 * Package group a repo-relative path belongs to.
 * @param path - repo-relative POSIX path as reported by the tightened pass.
 * @returns `packages/<group>` for a workspace package, otherwise the first segment.
 */
function domainOf(path: string): string {
  const segments = path.split('/')
  return segments[0] === 'packages' ? `packages/${segments[1] ?? ''}` : (segments[0] ?? '')
}

/**
 * Keep only the clone pairs whose two files sit in different tightened domains.
 * A per-domain pass cannot report these: jscpd only compares files inside the
 * roots of one invocation.
 * @param pairs - pair keys as {@link pairKey} reports them.
 * @returns the cross-domain subset, sorted.
 */
export function crossDomainPairs(pairs: readonly string[]): string[] {
  return pairs
    .filter((pair) => {
      const [first, second] = pair.split('|')
      return first !== undefined && second !== undefined && domainOf(first) !== domainOf(second)
    })
    .sort()
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
    for (const duplicate of report.duplicates) pairs.add(pairKey(duplicate, root, roots))
    return [...pairs].sort()
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }
}

/** Thresholds every tightened and cross-domain pass runs with. */
const TIGHTENED_THRESHOLDS: PassThresholds = { minTokens: TIGHTENED_MIN_TOKENS, minLines: TIGHTENED_MIN_LINES }

/**
 * Read the checked-in accepted-pair baseline.
 * The file is a durable boundary: a missing list is rejected instead of being
 * read as "nothing accepted", which would silently pass a new clone.
 * @param root - repo root holding the baseline file.
 * @returns the recorded thresholds and accepted pairs.
 * @throws Error when the file does not hold both accepted-pair lists.
 */
export function readBaseline(root: string): DuplicationBaseline {
  const parsed = JSON.parse(readFileSync(join(root, BASELINE_PATH), 'utf8')) as Partial<DuplicationBaseline>
  for (const field of ['pairs', 'crossDomainPairs'] as const) {
    if (!Array.isArray(parsed[field])) {
      throw new Error(`duplication-gate: ${BASELINE_PATH} 缺少 ${field} 数组；用 \`pnpm run duplication:baseline\` 重新生成`)
    }
  }
  return parsed as DuplicationBaseline
}

/** Report the pairs a per-domain tightened pass accepts. */
function detectTightenedPairs(root: string): string[] {
  return TIGHTENED_DOMAINS.flatMap(domain => detectClonePairs(
    root,
    [domain],
    TIGHTENED_THRESHOLDS,
    { maskMarkers: false },
  ))
}

/** Report the cross-domain pairs one pass over every tightened domain finds. */
function detectCrossDomainPairs(root: string): string[] {
  return crossDomainPairs(detectClonePairs(
    root,
    TIGHTENED_DOMAINS,
    TIGHTENED_THRESHOLDS,
    { maskMarkers: false },
  ))
}

/**
 * Regenerate the baseline from the tightened and cross-domain passes and write
 * it to disk.
 * @param root - repo root holding the baseline file.
 */
function writeBaseline(root: string): void {
  const baseline: DuplicationBaseline = {
    minTokens: TIGHTENED_MIN_TOKENS,
    minLines: TIGHTENED_MIN_LINES,
    pairs: [...new Set(detectTightenedPairs(root))].sort(),
    crossDomainPairs: detectCrossDomainPairs(root),
  }
  writeFileSync(join(root, BASELINE_PATH), `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write(
    `duplication-gate: recorded ${String(baseline.pairs.length)} accepted pair(s) and ${String(baseline.crossDomainPairs.length)} cross-domain pair(s) in ${BASELINE_PATH}\n`,
  )
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
  const tightened = detectTightenedPairs(root)
  const tightenedDiff = diffClonePairs(baseline.pairs, tightened)
  if (tightenedDiff.added.length > 0) {
    failures.push(`tightened pass reported ${String(tightenedDiff.added.length)} pair(s) outside ${BASELINE_PATH}:\n${tightenedDiff.added.map(pair => `  ${pair}`).join('\n')}`)
  }
  if (tightenedDiff.stale.length > 0) {
    failures.push(`${BASELINE_PATH} lists ${String(tightenedDiff.stale.length)} pair(s) the tightened pass no longer reports:\n${tightenedDiff.stale.map(pair => `  ${pair}`).join('\n')}`)
  }

  const cross = detectCrossDomainPairs(root)
  const crossDiff = diffClonePairs(baseline.crossDomainPairs, cross)
  if (crossDiff.added.length > 0) {
    failures.push(`cross-domain pass reported ${String(crossDiff.added.length)} pair(s) outside ${BASELINE_PATH}:\n${crossDiff.added.map(pair => `  ${pair}`).join('\n')}`)
  }
  if (crossDiff.stale.length > 0) {
    failures.push(`${BASELINE_PATH} lists ${String(crossDiff.stale.length)} cross-domain pair(s) the pass no longer reports:\n${crossDiff.stale.map(pair => `  ${pair}`).join('\n')}`)
  }

  for (const failure of failures) process.stderr.write(`duplication-gate: ${failure}\n`)
  if (failures.length === 0) {
    process.stdout.write(`duplication-gate: 0 repo-wide clones; ${String(tightened.length)} tightened-domain pair(s) and ${String(cross.length)} cross-domain pair(s) match ${BASELINE_PATH}\n`)
  }
  return failures.length === 0 ? 0 : 1
}

/* v8 ignore start -- CLI entry: covered by scripts/duplication-gate.spec.ts through runDuplicationGate. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) writeBaseline(ROOT)
  else process.exitCode = runDuplicationGate(ROOT)
}
/* v8 ignore stop */
