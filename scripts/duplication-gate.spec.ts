import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BASELINE_PATH,
  TIGHTENED_DOMAINS,
  TIGHTENED_MIN_LINES,
  TIGHTENED_MIN_TOKENS,
  crossDomainPairs,
  detectClonePairs,
  diffClonePairs,
  normalizeDuplicatePath,
  readBaseline,
  runDuplicationGate,
} from './duplication-gate.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_WIDE_THRESHOLDS = { minTokens: 60, minLines: 6 }
const TIGHTENED_THRESHOLDS = { minTokens: TIGHTENED_MIN_TOKENS, minLines: TIGHTENED_MIN_LINES }

let fixture: string | undefined

afterEach(() => {
  if (fixture !== undefined) rmSync(fixture, { recursive: true, force: true })
  fixture = undefined
})

/** A workspace with an intra-domain clone per domain and one cross-domain clone. */
function writeFixture(): string {
  fixture = mkdtempSync(join(tmpdir(), 'dsh-duplication-gate-'))
  writeFileSync(join(fixture, '.jscpd.json'), JSON.stringify({
    minTokens: 60,
    minLines: 6,
    mode: 'mild',
    format: ['typescript'],
    pattern: '**/*.ts',
    ignore: ['**/tests/**'],
    ignorePattern: ['(?s)/\\* jscpd:ignore-start \\*/.*?/\\* jscpd:ignore-end \\*/'],
  }))
  mkdirSync(join(fixture, 'packages/patent'), { recursive: true })
  mkdirSync(join(fixture, 'packages/legal'), { recursive: true })
  mkdirSync(join(fixture, 'packages/document'), { recursive: true })
  // A shared 32-token block: reported by the tightened pass, under the repo-wide floor.
  const shared = [
    'const limits = resolveLimits(config)',
    'const queue = createQueue(limits.maxQueued)',
    'for (const job of pending) {',
    '  if (!queue.accepts(job)) break',
    '  await queue.push(job)',
    '}',
    'return queue.drain()',
  ].join('\n')
  // A second block so patent and legal each carry their own intra-domain clone.
  const legalShared = [
    'const entries = await loadEntries(sourcePath)',
    'const index = new Map<string, string>()',
    'for (const entry of entries) {',
    '  if (entry.text === undefined) continue',
    '  index.set(entry.key, entry.text)',
    '}',
    'return index.size',
  ].join('\n')
  writeFileSync(join(fixture, 'packages/patent/alpha.ts'), `export function alpha(config: unknown) {\n${shared}\n}\n`)
  writeFileSync(join(fixture, 'packages/patent/beta.ts'), `export function beta(config: unknown) {\n${shared}\n}\nexport const extra = 1\n`)
  writeFileSync(join(fixture, 'packages/legal/alpha.ts'), `export function legalAlpha(source: string) {\n${legalShared}\n}\n`)
  writeFileSync(join(fixture, 'packages/legal/beta.ts'), `export function legalBeta(source: string) {\n${legalShared}\n}\n`)
  // Shares the patent block, so it pairs across the domain split.
  writeFileSync(join(fixture, 'packages/legal/cross.ts'), `export function cross(config: unknown) {\n${shared}\n}\n`)
  // Long enough for jscpd to count the file as scanned, unlike a one-line stub.
  writeFileSync(join(fixture, 'packages/document/solo.ts'), [
    'export function solo(value: number): number {',
    '  const doubled = value * 2',
    '  const shifted = doubled + 1',
    '  return shifted % 7',
    '}',
    'export const soloLabel = "document"',
    '',
  ].join('\n'))
  mkdirSync(join(fixture, 'scripts'), { recursive: true })
  writeFileSync(join(fixture, 'scripts/gamma.ts'), 'export const gamma = 1\n')
  return fixture
}

describe('duplication gate', () => {
  it('duplication 基线把新克隆对判为失败', () => {
    const diff = diffClonePairs(['a.ts|b.ts'], ['a.ts|b.ts', 'c.ts|d.ts'])
    expect(diff.added).toEqual(['c.ts|d.ts'])
    expect(diff.stale).toEqual([])
  })

  it('duplication 基线把不再报出的条目标记为过期', () => {
    const diff = diffClonePairs(['a.ts|b.ts', 'c.ts|d.ts'], ['a.ts|b.ts'])
    expect(diff.added).toEqual([])
    expect(diff.stale).toEqual(['c.ts|d.ts'])
  })

  it('收紧档报出仓库级阈值看不见的跨文件克隆', () => {
    const root = writeFixture()
    const tightened = detectClonePairs(root, ['packages/patent'], TIGHTENED_THRESHOLDS, { maskMarkers: false })
    expect(tightened).toContain('packages/patent/alpha.ts|packages/patent/beta.ts')
    const repoWide = detectClonePairs(root, ['packages/patent'], REPO_WIDE_THRESHOLDS, { maskMarkers: true })
    expect(repoWide).not.toContain('packages/patent/alpha.ts|packages/patent/beta.ts')
    // The gate rejects a reported pair that the baseline does not accept.
    expect(diffClonePairs([], tightened).added).toContain('packages/patent/alpha.ts|packages/patent/beta.ts')
  })

  it('收紧遍覆盖 legal 域，并把跨域克隆单独归类', () => {
    const root = writeFixture()
    const tightened = TIGHTENED_DOMAINS.flatMap(domain => detectClonePairs(
      root,
      [domain],
      TIGHTENED_THRESHOLDS,
      { maskMarkers: false },
    ))
    expect(tightened).toContain('packages/patent/alpha.ts|packages/patent/beta.ts')
    expect(tightened).toContain('packages/legal/alpha.ts|packages/legal/beta.ts')

    const cross = crossDomainPairs(detectClonePairs(
      root,
      TIGHTENED_DOMAINS,
      TIGHTENED_THRESHOLDS,
      { maskMarkers: false },
    ))
    expect(cross).toContain('packages/legal/cross.ts|packages/patent/alpha.ts')
    expect(cross).not.toContain('packages/legal/alpha.ts|packages/legal/beta.ts')
    expect(crossDomainPairs(['packages/patent/a.ts|packages/patent/b.ts', 'scripts/x.ts|scripts/y.ts']))
      .toEqual([])
  })

  it('缺少跨域清单的基线按损坏处理，而不是读成零接受', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-duplication-baseline-'))
    fixture = root
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, BASELINE_PATH), JSON.stringify({ minTokens: 30, minLines: 5, pairs: [] }))
    expect(() => readBaseline(root)).toThrow(/crossDomainPairs/)
  })

  it('裸文件名按实际所属 root 归一化，而不是一律挂到第一个 root', () => {
    const root = writeFixture()
    expect(normalizeDuplicatePath('gamma.ts', root, ['packages', 'scripts'])).toBe('scripts/gamma.ts')
    expect(normalizeDuplicatePath('alpha.ts', root, ['packages/patent'])).toBe('packages/patent/alpha.ts')
    expect(normalizeDuplicatePath('packages/patent/alpha.ts', root, ['packages', 'scripts']))
      .toBe('packages/patent/alpha.ts')
    expect(normalizeDuplicatePath(join(root, 'scripts/gamma.ts'), root, ['packages', 'scripts']))
      .toBe('scripts/gamma.ts')
    expect(normalizeDuplicatePath('missing.ts', root, ['packages', 'scripts'])).toBe('missing.ts')
  })

  it('拒绝空语料而不是把它当成零克隆', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-duplication-empty-'))
    fixture = root
    writeFileSync(join(root, '.jscpd.json'), JSON.stringify({
      minTokens: TIGHTENED_MIN_TOKENS,
      minLines: TIGHTENED_MIN_LINES,
      mode: 'mild',
      format: ['typescript'],
      pattern: '**/*.ts',
      ignore: ['**/tests/**'],
    }))
    expect(() => detectClonePairs(root, ['packages/patent'], TIGHTENED_THRESHOLDS, { maskMarkers: false }))
      .toThrow(/scanned no files/)
  })

  it('签入的基线与三域当前克隆对一致，且门禁整体通过', () => {
    const baseline = readBaseline(ROOT)
    expect(baseline.minTokens).toBe(TIGHTENED_MIN_TOKENS)
    expect(baseline.minLines).toBe(TIGHTENED_MIN_LINES)
    const current = TIGHTENED_DOMAINS.flatMap(domain => detectClonePairs(
      ROOT,
      [domain],
      TIGHTENED_THRESHOLDS,
      { maskMarkers: false },
    ))
    expect(diffClonePairs(baseline.pairs, current)).toEqual({ added: [], stale: [] })
    const cross = crossDomainPairs(detectClonePairs(
      ROOT,
      TIGHTENED_DOMAINS,
      TIGHTENED_THRESHOLDS,
      { maskMarkers: false },
    ))
    expect(diffClonePairs(baseline.crossDomainPairs, cross)).toEqual({ added: [], stale: [] })
    expect(runDuplicationGate(ROOT)).toBe(0)
  })

  it('基线文件只登记克隆对与阈值', () => {
    const baseline = readBaseline(ROOT)
    expect(Object.keys(baseline).sort()).toEqual(['crossDomainPairs', 'minLines', 'minTokens', 'pairs'])
    expect(BASELINE_PATH).toBe('scripts/duplication-baseline.json')
    expect(baseline.pairs.length).toBeGreaterThan(0)
    expect(baseline.crossDomainPairs.length).toBeGreaterThan(0)
    for (const pair of [...baseline.pairs, ...baseline.crossDomainPairs]) {
      expect(pair).toMatch(/^packages\/[^|]+\|[^|]+$/)
    }
  })
})
