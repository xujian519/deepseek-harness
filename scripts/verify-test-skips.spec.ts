import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readSkipReport, verifyTestSkips } from './verify-test-skips.ts'

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One result entry: a file name relative to the temporary root and its case statuses. */
interface ResultEntry {
  name: string
  statuses: string[]
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-test-skips-'))
  roots.push(root)
  mkdirSync(join(root, 'scripts'), { recursive: true })
  return root
}

function writeBaseline(root: string, baseline: unknown): void {
  writeFileSync(join(root, 'scripts/test-skip-baseline.json'), JSON.stringify(baseline))
}

function writeReport(root: string, results: readonly ResultEntry[]): string {
  const path = join(root, 'report.json')
  writeFileSync(path, JSON.stringify({
    numTotalTests: results.reduce((total, entry) => total + entry.statuses.length, 0),
    numPendingTests: results.reduce((total, entry) => total + entry.statuses.filter(status => status === 'skipped').length, 0),
    testResults: results.map(entry => ({
      name: join(root, entry.name),
      assertionResults: entry.statuses.map((status, index) => ({ title: `case ${String(index)}`, status })),
    })),
  }))
  return path
}

function budget(cases: number, skipped: number): { cases: number; skipped: number } {
  return { cases, skipped }
}

describe('skip report inventory', () => {
  it('counts skipped cases per file and lists the largest first', () => {
    const root = makeRoot()
    const path = writeReport(root, [
      { name: 'small.spec.ts', statuses: ['passed', 'skipped'] },
      { name: 'large.spec.ts', statuses: ['skipped', 'skipped', 'skipped', 'passed'] },
      { name: 'clean.spec.ts', statuses: ['passed'] },
    ])
    const report = readSkipReport(path, root)
    expect(report.cases).toBe(7)
    expect(report.skipped).toBe(4)
    expect(report.files).toEqual([
      { file: 'large.spec.ts', skipped: 3 },
      { file: 'small.spec.ts', skipped: 1 },
    ])
  })

  it('treats a pending case as skipped', () => {
    const root = makeRoot()
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['pending'] }])
    expect(readSkipReport(path, root).files).toEqual([{ file: 'a.spec.ts', skipped: 1 }])
  })

  it('rejects a report that names no test result, so an empty run cannot pass silently', () => {
    const root = makeRoot()
    const path = join(root, 'empty.json')
    writeFileSync(path, JSON.stringify({ numTotalTests: 0, numPendingTests: 0, testResults: [] }))
    expect(() => readSkipReport(path, root)).toThrow(/names no test result/u)
  })

  it('rejects a report missing its totals', () => {
    const root = makeRoot()
    const path = join(root, 'bad.json')
    writeFileSync(path, JSON.stringify({ testResults: [{ name: 'a.spec.ts', assertionResults: [] }] }))
    expect(() => readSkipReport(path, root)).toThrow(/missing numTotalTests or numPendingTests/u)
  })

  it('rejects a report whose file entry has no name', () => {
    const root = makeRoot()
    const path = join(root, 'nameless.json')
    writeFileSync(path, JSON.stringify({ numTotalTests: 1, numPendingTests: 1, testResults: [{ assertionResults: [] }] }))
    expect(() => readSkipReport(path, root)).toThrow(/missing a file name/u)
  })
})

describe('skip budget enforcement', () => {
  it('accepts a run that skips exactly the recorded budget', () => {
    const root = makeRoot()
    writeBaseline(root, { [process.platform]: budget(3, 2) })
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['passed', 'skipped', 'skipped'] }])
    expect(verifyTestSkips(root, path)).toBe(2)
  })

  it('rejects a run that skips more than the recorded budget and names the files', () => {
    const root = makeRoot()
    writeBaseline(root, { [process.platform]: budget(4, 2) })
    const path = writeReport(root, [
      { name: 'a.spec.ts', statuses: ['skipped', 'skipped'] },
      { name: 'b.spec.ts', statuses: ['skipped'] },
      { name: 'c.spec.ts', statuses: ['passed'] },
    ])
    expect(() => verifyTestSkips(root, path)).toThrow(/skipped 1 case\(s\) more/u)
    expect(() => verifyTestSkips(root, path)).toThrow(/a\.spec\.ts/u)
  })

  it('accepts a run below the recorded budget', () => {
    const root = makeRoot()
    writeBaseline(root, { [process.platform]: budget(3, 3) })
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['passed', 'skipped', 'passed'] }])
    expect(verifyTestSkips(root, path)).toBe(1)
  })

  it('rejects a platform with no recorded budget and reports the run', () => {
    const root = makeRoot()
    writeBaseline(root, { plan9: budget(1, 0) })
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['skipped'] }])
    expect(() => verifyTestSkips(root, path)).toThrow(/has no recorded budget/u)
    expect(() => verifyTestSkips(root, path)).toThrow(/this run: 1 skipped of 1/u)
  })

  it('rejects a baseline whose skipped count exceeds its case count', () => {
    const root = makeRoot()
    writeBaseline(root, { [process.platform]: budget(1, 5) })
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['skipped'] }])
    expect(() => verifyTestSkips(root, path)).toThrow(/invalid baseline budget/u)
  })

  it('records the observed budget on update and keeps the other platforms', () => {
    const root = makeRoot()
    writeBaseline(root, { plan9: budget(1, 0) })
    const path = writeReport(root, [{ name: 'a.spec.ts', statuses: ['passed', 'skipped', 'skipped'] }])
    expect(verifyTestSkips(root, path, true)).toBe(2)
    const written: unknown = JSON.parse(readFileSync(join(root, 'scripts/test-skip-baseline.json'), 'utf8'))
    expect(written).toEqual({ plan9: budget(1, 0), [process.platform]: budget(3, 2) })
  })
})
