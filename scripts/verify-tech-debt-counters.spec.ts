import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BLOCK_END,
  BLOCK_START,
  INSTRUMENT_SOURCES,
  STRUCTURE_BLOCK_END,
  STRUCTURE_BLOCK_START,
  checkLedgerCounters,
  checkStructureBaseline,
  countMarkerLines,
  diffCounters,
  listTrackedFiles,
  measureStructureBaseline,
  parseCounterBlock,
  parseStructureBlock,
  pathspecMatcher,
  structureBaselineClean,
  type CommandRunner,
  type StructureRulingRow,
} from './verify-tech-debt-counters.ts'
import type { StructureReport } from './report-structure.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Create a throwaway repository root holding the given files. */
function fixtureRoot(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-counters-'))
  roots.push(root)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** A command runner that reports the given tracked paths and nothing else. */
function trackedRunner(paths: readonly string[]): CommandRunner {
  return (command, args) => {
    expect([command, ...args]).toEqual(['git', 'ls-files', '-z'])
    return paths.map(path => `${path}\0`).join('')
  }
}

/** Render a ledger whose structure block declares the given rows. */
function structureLedger(
  rows: readonly string[],
  markers: readonly [string, string] = [STRUCTURE_BLOCK_START, STRUCTURE_BLOCK_END],
): string {
  return [
    '# Ledger',
    '',
    'Prose before the table.',
    '',
    markers[0],
    '| 文件 | 裁定 | 上限 | 理由 |',
    '| --- | --- | ---: | --- |',
    ...rows,
    markers[1],
    '',
  ].join('\n')
}

/** An empty structure report carrying only the oversized-file list under test. */
function structureReport(largeFiles: StructureReport['largeFiles']): StructureReport {
  return { scanned: 0, testFiles: 0, generatedFiles: 0, longFunctions: [], largeFiles, generatedLargeFiles: [] }
}

/** Render a ledger whose counter block declares the given rows. */
function ledger(rows: readonly string[], markers: readonly [string, string] = [BLOCK_START, BLOCK_END]): string {
  return [
    '# Ledger',
    '',
    'Prose before the table.',
    '',
    markers[0],
    '| 计数 | 值 |',
    '| --- | --- |',
    ...rows,
    markers[1],
    '',
    'Prose after the table.',
    '',
  ].join('\n')
}

describe('ledger counter gate', () => {
  it('matches a pathspec whose star spans path separators, as git does', () => {
    const matches = pathspecMatcher('packages/*/*/src/*.ts')
    expect(matches('packages/patent/patent-core/src/index.ts')).toBe(true)
    expect(matches('packages/patent/patent-core/src/deep/index.ts')).toBe(true)
    expect(matches('packages/patent/patent-core/src/index.tsx')).toBe(false)
    expect(matches('apps/web/tests/index.ts')).toBe(false)
  })

  it('translates `?` to one character and keeps a literal dot', () => {
    const matches = pathspecMatcher('scripts/verify-?.ts')
    expect(matches('scripts/verify-a.ts')).toBe(true)
    expect(matches('scripts/verify-ab.ts')).toBe(false)
    expect(matches('scripts/verifyXaXts')).toBe(false)
  })

  it('splits tracked paths on the NUL separator', () => {
    expect(listTrackedFiles(trackedRunner(['a.ts', 'b/c.ts']))).toEqual(['a.ts', 'b/c.ts'])
  })

  it('counts the marker lines of matching tracked files only', () => {
    const root = fixtureRoot({
      'packages/a/b/src/one.ts': 'const a = 1\n// v8 ignore -- two hops\n// v8 ignore -- one hop\n',
      'packages/a/b/src/two.tsx': '// v8 ignore -- not a .ts source\n',
      'packages/a/b/tests/three.ts': '// v8 ignore -- outside src\n',
    })
    const runner = trackedRunner([
      'packages/a/b/src/one.ts',
      'packages/a/b/src/two.tsx',
      'packages/a/b/tests/three.ts',
    ])
    expect(countMarkerLines(root, runner, ['packages/*/*/src/*.ts'], 'v8 ignore')).toBe(2)
  })

  it('leaves the gate\'s own sources out of the marker count', () => {
    const root = fixtureRoot({
      'scripts/verify-tech-debt-counters.ts': "const needle = '@ts-expect-error'\n",
      'scripts/verify-tech-debt-counters.spec.ts': "// '@ts-expect-error' expected\n",
      'packages/a/tests/probe.ts': '// @ts-expect-error probe\n',
    })
    const runner = trackedRunner([
      'scripts/verify-tech-debt-counters.ts',
      'scripts/verify-tech-debt-counters.spec.ts',
      'packages/a/tests/probe.ts',
    ])
    const pathspecs = ['*.ts', ...INSTRUMENT_SOURCES.map(path => `:!${path}`)]
    expect(countMarkerLines(root, runner, pathspecs, '@ts-expect-error')).toBe(1)
  })

  it('reads the declared keys and values', () => {
    expect(parseCounterBlock(ledger([
      '| `structure.large-files` | 71 |',
      '| `packages.patent-directories` | 16 |',
    ]))).toEqual([
      { key: 'structure.large-files', value: 71 },
      { key: 'packages.patent-directories', value: 16 },
    ])
  })

  it('rejects a ledger with no counter block', () => {
    expect(() => parseCounterBlock('# Ledger\n\nNo table here.\n'))
      .toThrow(/expected exactly one .* found 0 start\(s\) and 0 end\(s\)/)
  })

  it('rejects a ledger repeating the counter block', () => {
    const twice = `${ledger(['| `lint.v8-ignore` | 1 |'])}\n${BLOCK_START}\n${BLOCK_END}\n`
    expect(() => parseCounterBlock(twice)).toThrow(/found 2 start\(s\) and 2 end\(s\)/)
  })

  it('rejects a row whose key is not one code span', () => {
    expect(() => parseCounterBlock(ledger(['| structure.large-files | 71 |'])))
      .toThrow(/expected a table row naming one counter key and its value/)
  })

  it('rejects a row carrying a fourth cell', () => {
    expect(() => parseCounterBlock(ledger(['| `structure.large-files` | 71 | `pnpm run report:structure` |'])))
      .toThrow(/expected a table row naming one counter key and its value/)
  })

  it('rejects a value that is not a number', () => {
    expect(() => parseCounterBlock(ledger(['| `structure.large-files` | many |'])))
      .toThrow(/expected a table row naming one counter key and its value/)
  })

  it('rejects a repeated counter row', () => {
    expect(() => parseCounterBlock(ledger([
      '| `lint.v8-ignore` | 1135 |',
      '| `lint.v8-ignore` | 1135 |',
    ]))).toThrow(/duplicate counter row `lint.v8-ignore`/)
  })

  it('rejects a counter block that declares no row', () => {
    expect(() => parseCounterBlock(ledger([]))).toThrow(/the counter block declares no row/)
  })

  it('reports a value that disagrees with the tree', () => {
    const declared = parseCounterBlock(ledger(['| `structure.long-functions` | 182 |']))
    const diff = diffCounters(declared, new Map([['structure.long-functions', 183]]))
    expect(diff.mismatched).toEqual([{
      key: 'structure.long-functions',
      declared: 182,
      actual: 183,
      measures: 'function declarations longer than 150 lines over the shipped sources',
    }])
  })

  it('reports an undeclared counter and a row with no definition', () => {
    const declared = parseCounterBlock(ledger(['| `lint.unheard-of` | 1 |']))
    const diff = diffCounters(declared, new Map())
    expect(diff.unknown).toEqual(['lint.unheard-of'])
    expect(diff.missing).toContain('structure.large-files')
    expect(diff.mismatched).toEqual([])
  })

  it('accepts a ledger whose every row matches the tree', () => {
    const root = fixtureRoot({
      'docs/TECH_DEBT.md': ledger([
        '| `structure.long-functions` | 0 |',
        '| `structure.large-files` | 0 |',
        '| `structure.patent-large-files` | 0 |',
        '| `lint.v8-ignore` | 1 |',
        '| `lint.ts-expect-error` | 0 |',
        '| `packages.patent-directories` | 2 |',
      ]),
      'packages/a/b/src/probe.ts': '// v8 ignore -- probe\n',
      'packages/patent/patent-core/package.json': '{}\n',
      'packages/patent/patent-tools/package.json': '{}\n',
    })
    const runner = trackedRunner(['packages/a/b/src/probe.ts'])
    const diff = checkLedgerCounters(root, runner)
    expect(diff).toEqual({ unknown: [], missing: [], mismatched: [] })
  })

  it('fails the same ledger when one declared value drifts', () => {
    const root = fixtureRoot({
      'docs/TECH_DEBT.md': ledger([
        '| `structure.long-functions` | 0 |',
        '| `structure.large-files` | 0 |',
        '| `structure.patent-large-files` | 0 |',
        '| `lint.v8-ignore` | 1135 |',
        '| `lint.ts-expect-error` | 0 |',
        '| `packages.patent-directories` | 2 |',
      ]),
      'packages/a/b/src/probe.ts': '// v8 ignore -- probe\n',
      'packages/patent/patent-core/package.json': '{}\n',
      'packages/patent/patent-tools/package.json': '{}\n',
    })
    const runner = trackedRunner(['packages/a/b/src/probe.ts'])
    expect(checkLedgerCounters(root, runner).mismatched).toEqual([{
      key: 'lint.v8-ignore',
      declared: 1135,
      actual: 1,
      measures: 'lines carrying a `v8 ignore` directive in shipped package sources',
    }])
  })

  it('reads structure rulings from the ledger table', () => {
    expect(parseStructureBlock(structureLedger([
      '| `packages/patent/a.ts` | 接受 | 1304 | 法条与计算同址 |',
      '| `packages/patent/b.ts` | 拆分 | 800 | 交付链已分拆 |',
    ]))).toEqual([
      { path: 'packages/patent/a.ts', ruling: 'accept', cap: 1304, reason: '法条与计算同址' },
      { path: 'packages/patent/b.ts', ruling: 'split', cap: 800, reason: '交付链已分拆' },
    ])
  })

  it('rejects a structure block with no table, a repeated block, or no row', () => {
    expect(() => parseStructureBlock('# Ledger\n')).toThrow(/expected exactly one .*structure-baseline:start.* found 0 start/)
    expect(() => parseStructureBlock(`${structureLedger(['| `packages/patent/a.ts` | 接受 | 900 | x |'])}\n${STRUCTURE_BLOCK_START}\n${STRUCTURE_BLOCK_END}\n`))
      .toThrow(/found 2 start\(s\) and 2 end\(s\)/)
    expect(() => parseStructureBlock(structureLedger([]))).toThrow(/the structure block declares no row/)
  })

  it('rejects a malformed, duplicated, out-of-scope, or unreasoned structure row', () => {
    expect(() => parseStructureBlock(structureLedger(['| packages/patent/a.ts | 接受 | 900 | x |'])))
      .toThrow(/expected a row naming one path/)
    expect(() => parseStructureBlock(structureLedger([
      '| `packages/patent/a.ts` | 接受 | 900 | x |',
      '| `packages/patent/a.ts` | 接受 | 900 | y |',
    ]))).toThrow(/duplicate structure row/)
    expect(() => parseStructureBlock(structureLedger(['| `packages/core/a.ts` | 接受 | 900 | x |'])))
      .toThrow(/outside the audited domains/)
    expect(() => parseStructureBlock(structureLedger(['| `packages/patent/a.ts` | 接受 | 900 |  |'])))
      .toThrow(/expected a row naming one path/)
    expect(() => parseStructureBlock(structureLedger(['| `packages/patent/a.ts` | 保留 | 900 | x |'])))
      .toThrow(/expected a row naming one path/)
  })

  it('accepts rulings at their ceiling and split targets at the threshold', () => {
    const rows: StructureRulingRow[] = [
      { path: 'packages/patent/a.ts', ruling: 'accept', cap: 1304, reason: 'x' },
      { path: 'packages/patent/b.ts', ruling: 'split', cap: 800, reason: 'y' },
    ]
    const sizes = new Map([['packages/patent/a.ts', 1304], ['packages/patent/b.ts', 800]])
    expect(measureStructureBaseline(rows, [], path => sizes.get(path))).toEqual({
      missing: [], unruled: [], overCap: [], stale: [],
    })
  })

  it('reports over-cap growth, stale accepted rows, unruled files, and missing paths', () => {
    const rows: StructureRulingRow[] = [
      { path: 'packages/patent/a.ts', ruling: 'accept', cap: 1304, reason: 'x' },
      { path: 'packages/patent/b.ts', ruling: 'split', cap: 800, reason: 'y' },
      { path: 'packages/patent/gone.ts', ruling: 'accept', cap: 900, reason: 'z' },
    ]
    const sizes = new Map([
      ['packages/patent/a.ts', 700],
      ['packages/patent/b.ts', 801],
    ])
    const diff = measureStructureBaseline(
      rows,
      [
        { path: 'packages/patent/c.ts', lines: 900 },
        { path: 'packages/legal/d.ts', lines: 850 },
        { path: 'packages/core/e.ts', lines: 900 },
      ],
      path => sizes.get(path),
    )
    expect(diff.missing).toEqual(['packages/patent/gone.ts'])
    expect(diff.overCap).toEqual([{ path: 'packages/patent/b.ts', ruling: 'split', cap: 800, lines: 801 }])
    expect(diff.stale).toEqual([{ path: 'packages/patent/a.ts', lines: 700 }])
    expect(diff.unruled).toEqual([
      { path: 'packages/patent/c.ts', lines: 900 },
      { path: 'packages/legal/d.ts', lines: 850 },
    ])
    expect(structureBaselineClean(diff)).toBe(false)
  })

  it('checks the ledger against the tree and reads split targets below the threshold', () => {
    const root = fixtureRoot({
      'docs/TECH_DEBT.md': structureLedger([
        '| `packages/patent/a.ts` | 接受 | 900 | 单一职责 |',
        '| `packages/patent/b.ts` | 拆分 | 800 | 已分拆 |',
      ]),
      'packages/patent/a.ts': 'export const a = 1\n',
      'packages/patent/b.ts': 'export const b = 1\n',
    })
    const structure = structureReport([{ path: 'packages/patent/a.ts', lines: 900 }])
    expect(checkStructureBaseline(root, structure)).toEqual({
      missing: [], unruled: [], overCap: [], stale: [],
    })
  })
})
