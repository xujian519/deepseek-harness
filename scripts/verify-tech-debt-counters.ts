/**
 * Ledger counter gate.
 *
 * `docs/TECH_DEBT.md` states the counts the repository reads to decide whether
 * structural debt and suppression markers are worsening or converging: the
 * structure report's long functions and large files, the `v8 ignore` and
 * `@ts-expect-error` occurrences, and the `packages/patent` package
 * directories. The ledger writes them by hand, so they age silently; the
 * 2026-10-10 scan found all of them stale.
 *
 * The ledger declares the current values in one marked table, and this gate
 * recomputes every row: the structure figures come from the same
 * `reportStructure` the report script prints, the marker counts enumerate
 * tracked files through `git ls-files` and then read them (a working-tree glob
 * would count `apps/desktop/.desktop-build` build residue), and the package
 * count reads `packages/patent` directly. A declared row with no definition, a
 * definition with no row, and any value that disagrees with the tree all fail.
 *
 * Dated sections of the ledger keep the figures measured on their own date;
 * this gate checks the current declaration, not history.
 * @module scripts/verify-tech-debt-counters
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { reportStructure, type StructureReport } from './report-structure.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** Ledger carrying the declared counts. */
export const LEDGER_PATH = 'docs/TECH_DEBT.md'

/** Opens the declaration table inside the ledger. */
export const BLOCK_START = '<!-- tech-debt-counters:start -->'

/** Closes the declaration table inside the ledger. */
export const BLOCK_END = '<!-- tech-debt-counters:end -->'

/**
 * Runs one command in the repository and returns its stdout.
 * @param command - executable name.
 * @param args - arguments, passed without a shell.
 * @returns the command's stdout.
 */
export type CommandRunner = (command: string, args: readonly string[]) => string

/** Inputs one counter's recomputation reads. */
export interface CounterContext {
  /** Repository root. */
  readonly root: string
  /** Command runner for the enumerations over tracked files. */
  readonly run: CommandRunner
  /** Structure report, computed once for the counters that read it. */
  readonly structure: StructureReport
}

/** One count the ledger declares, with the recomputation this gate runs. */
export interface CounterDefinition {
  /** Row key as written in the ledger table. */
  readonly key: string
  /** What the value counts, printed beside a mismatch. */
  readonly measures: string
  /**
   * Recompute the current value.
   * @param context - repository root, command runner, and structure report.
   * @returns the current value.
   */
  readonly measure: (context: CounterContext) => number
}

/** One row of the ledger's declaration table. */
export interface DeclaredCounter {
  /** Row key. */
  readonly key: string
  /** Declared value. */
  readonly value: number
}

/** Comparison of the declared rows against the recomputed values. */
export interface CounterDiff {
  /** Declared keys no definition covers. */
  readonly unknown: readonly string[]
  /** Definitions the ledger does not declare. */
  readonly missing: readonly string[]
  /** Declared values that disagree with the tree. */
  readonly mismatched: readonly {
    readonly key: string
    readonly declared: number
    readonly actual: number
    readonly measures: string
  }[]
}

/**
 * Translate one git pathspec into a matcher over tracked paths.
 *
 * Git matches a pathspec with `*` spanning path separators, so the package
 * source pathspec admits nested sources; a segment-wise glob would under-count.
 * @param pattern - pathspec as written in the ledger or in this module.
 * @returns a predicate over repository-relative paths.
 */
export function pathspecMatcher(pattern: string): (path: string) => boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, String.raw`\$&`)
  const matcher = new RegExp(`^${escaped.replaceAll('*', '.*').replaceAll('?', '.')}$`, 'u')
  return path => matcher.test(path)
}

/**
 * List the repository's tracked files.
 * @param run - command runner; `git ls-files` already runs inside the repository.
 * @returns repository-relative paths, in `git ls-files` order.
 */
export function listTrackedFiles(run: CommandRunner): string[] {
  return run('git', ['ls-files', '-z']).split('\0').filter(path => path !== '')
}

/**
 * Count the lines of the tracked files matching a pathspec that carry a marker.
 * @param root - repository root.
 * @param run - command runner.
 * @param pathspecs - tracked-file pathspecs, with git's glob semantics.
 * @param needle - substring a line must contain to be counted.
 * @returns the number of matching lines.
 */
export function countMarkerLines(
  root: string,
  run: CommandRunner,
  pathspecs: readonly string[],
  needle: string,
): number {
  const excluded = pathspecs.filter(pathspec => pathspec.startsWith(':!')).map(pathspec => pathspecMatcher(pathspec.slice(2)))
  const matchers = pathspecs.filter(pathspec => !pathspec.startsWith(':!')).map(pathspecMatcher)
  let lines = 0
  for (const path of listTrackedFiles(run)) {
    if (excluded.some(matches => matches(path))) continue
    if (!matchers.some(matches => matches(path))) continue
    for (const line of readFileSync(resolve(root, path), 'utf8').split('\n')) {
      if (line.includes(needle)) lines += 1
    }
  }
  return lines
}

/**
 * Sources of this gate itself.
 *
 * The marker counters count lines holding a literal needle. These two files
 * hold that literal as the needle and as an expected value, so counting them
 * would count the counter's own text rather than a suppression site; they stay
 * outside every marker count.
 */
export const INSTRUMENT_SOURCES: readonly string[] = [
  'scripts/verify-tech-debt-counters.ts',
  'scripts/verify-tech-debt-counters.spec.ts',
]

/** The counts the ledger declares, each with the recomputation this gate runs. */
export const COUNTERS: readonly CounterDefinition[] = [
  {
    key: 'structure.long-functions',
    measures: 'function declarations longer than 150 lines over the shipped sources',
    measure: context => context.structure.longFunctions.length,
  },
  {
    key: 'structure.large-files',
    measures: 'non-generated source files longer than 800 lines over the shipped sources',
    measure: context => context.structure.largeFiles.length,
  },
  {
    key: 'lint.v8-ignore',
    measures: 'lines carrying a `v8 ignore` directive in shipped package sources',
    measure: context => countMarkerLines(context.root, context.run, ['packages/*/*/src/*.ts'], 'v8 ignore'),
  },
  {
    key: 'lint.ts-expect-error',
    measures: 'lines carrying `@ts-expect-error` across tracked TypeScript except this gate',
    measure: context => countMarkerLines(
      context.root,
      context.run,
      ['*.ts', '*.tsx', ...INSTRUMENT_SOURCES.map(path => `:!${path}`)],
      '@ts-expect-error',
    ),
  },
  {
    key: 'packages.patent-directories',
    measures: 'package directories under packages/patent',
    measure: context => readdirSync(resolve(context.root, 'packages/patent'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .length,
  },
]

/**
 * Read the ledger's declaration table.
 * @param ledger - the ledger's raw text.
 * @returns the declared rows, in table order.
 * @throws Error when the table is absent, repeated, or malformed.
 */
export function parseCounterBlock(ledger: string): DeclaredCounter[] {
  const lines = ledger.split('\n')
  const starts = lines.flatMap((line, index) => line.trim() === BLOCK_START ? [index] : [])
  const ends = lines.flatMap((line, index) => line.trim() === BLOCK_END ? [index] : [])
  if (starts.length !== 1 || ends.length !== 1) {
    throw new Error(
      `${LEDGER_PATH}: expected exactly one ${BLOCK_START} … ${BLOCK_END} block,`
      + ` found ${String(starts.length)} start(s) and ${String(ends.length)} end(s)`,
    )
  }
  const start = starts[0] as number
  const end = ends[0] as number
  if (end < start) throw new Error(`${LEDGER_PATH}: the counter block closes before it opens`)
  const rows: DeclaredCounter[] = []
  const seen = new Set<string>()
  for (const [offset, line] of lines.slice(start + 1, end).entries()) {
    const text = line.trim()
    const location = `${LEDGER_PATH}:${String(start + offset + 2)}`
    if (text === '' || text === '| 计数 | 值 |' || /^\| -+ \| -+ \|$/u.test(text)) continue
    const row = /^\| `([^`]+)` \| (\d+) \|$/u.exec(text)
    if (row === null) {
      throw new Error(`${location}: expected a table row naming one counter key and its value, got ${JSON.stringify(text)}`)
    }
    const key = row[1] as string
    if (seen.has(key)) throw new Error(`${location}: duplicate counter row \`${key}\``)
    seen.add(key)
    rows.push({ key, value: Number(row[2]) })
  }
  if (rows.length === 0) throw new Error(`${LEDGER_PATH}: the counter block declares no row`)
  return rows
}

/**
 * Compare declared rows against recomputed values.
 * @param declared - rows read from the ledger.
 * @param actual - recomputed value per counter key.
 * @returns the disagreements; every field is empty when the ledger is current.
 */
export function diffCounters(
  declared: readonly DeclaredCounter[],
  actual: ReadonlyMap<string, number>,
): CounterDiff {
  const definitions = new Map(COUNTERS.map(counter => [counter.key, counter]))
  const declaredKeys = new Set(declared.map(row => row.key))
  return {
    unknown: declared.filter(row => !definitions.has(row.key)).map(row => row.key),
    missing: COUNTERS.filter(counter => !declaredKeys.has(counter.key)).map(counter => counter.key),
    mismatched: declared.flatMap((row) => {
      const definition = definitions.get(row.key)
      const value = actual.get(row.key)
      if (definition === undefined || value === undefined || value === row.value) return []
      return [{ key: row.key, declared: row.value, actual: value, measures: definition.measures }]
    }),
  }
}

/**
 * Recompute every counter.
 * @param root - repository root.
 * @param run - command runner.
 * @returns the current value per counter key.
 */
export function measureCounters(root: string, run: CommandRunner): Map<string, number> {
  const context: CounterContext = { root, run, structure: reportStructure(root) }
  return new Map(COUNTERS.map(counter => [counter.key, counter.measure(context)]))
}

/**
 * Compare the ledger's declaration against the working tree.
 * @param root - repository root.
 * @param run - command runner.
 * @returns the diff between the ledger and the tree.
 */
export function checkLedgerCounters(root: string, run: CommandRunner): CounterDiff {
  const declared = parseCounterBlock(readFileSync(resolve(root, LEDGER_PATH), 'utf8'))
  return diffCounters(declared, measureCounters(root, run))
}

/** Tracked-path listing for this repository exceeds the 1 MiB default stdout buffer. */
const GIT_STDOUT_BUFFER = 64 * 1024 * 1024

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const run: CommandRunner = (command, args) => execFileSync(command, [...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: GIT_STDOUT_BUFFER,
  })
  const actual = measureCounters(ROOT, run)
  const diff = diffCounters(parseCounterBlock(readFileSync(resolve(ROOT, LEDGER_PATH), 'utf8')), actual)
  if (diff.mismatched.length > 0 || diff.unknown.length > 0 || diff.missing.length > 0) {
    process.stderr.write(`verify-tech-debt-counters: ${LEDGER_PATH} disagrees with the tree:\n`)
    for (const row of diff.mismatched) {
      process.stderr.write(
        `  \`${row.key}\`: declared ${String(row.declared)}, measured ${String(row.actual)} (${row.measures})\n`,
      )
    }
    for (const key of diff.unknown) {
      process.stderr.write(`  \`${key}\`: no recomputation is defined for this row; drop it or define the counter\n`)
    }
    for (const key of diff.missing) {
      process.stderr.write(`  \`${key}\`: the ledger declares no row for this counter\n`)
    }
    process.exit(1)
  }
  process.stdout.write(
    `verify-tech-debt-counters: ${String(actual.size)} declared counter(s) match ${LEDGER_PATH}.\n`,
  )
}
