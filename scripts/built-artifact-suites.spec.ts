import { describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  discoverBuiltArtifactSuites,
  isBuiltArtifactSuite,
  summarizeBuiltArtifactSuiteRuns,
} from './built-artifact-suites.ts'
import { familyOf } from './run-built-artifact-suites.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** One `skipIf`-guarded suite body, shaped like the files the rule admits. */
const artifactGuard = (guard: string): string => `describe.skipIf(${guard})('built lib', () => { it('loads', () => {}) })\n`

describe('built-artifact suite discovery', () => {
  it('admits a guard naming a build product', () => {
    expect(isBuiltArtifactSuite('packages/x/tests/plain.spec.ts', artifactGuard('!existsSync(builtLib)'))).toBe(true)
    expect(isBuiltArtifactSuite('packages/x/tests/plain.spec.ts', artifactGuard('!requiredArtifacts'))).toBe(true)
    expect(isBuiltArtifactSuite('packages/x/tests/plain.spec.ts', artifactGuard("!existsSync(join(root, 'lib/bin.js'))"))).toBe(true)
  })

  it('admits a suite chosen by a build-product identifier', () => {
    const source = ";(subjectBuilt ? describe : describe.skip)('packed image', () => { it('x', () => {}) })\n"
    expect(isBuiltArtifactSuite('packages/x/tests/image-loadable.spec.ts', source)).toBe(true)
  })

  it('admits a build-product file name whose guard is not a platform or env selection', () => {
    expect(isBuiltArtifactSuite('packages/x/tests/bundle-split.client.spec.ts', artifactGuard('!existsSync(entryPath)'))).toBe(true)
  })

  it('excludes platform, env, record-mode, and tool-presence selections', () => {
    expect(isBuiltArtifactSuite('packages/x/tests/pwsh.spec.ts', artifactGuard("process.platform === 'win32'"))).toBe(false)
    expect(isBuiltArtifactSuite('packages/x/tests/key.e2e.ts', artifactGuard('!process.env.DEEPSEEK_API_KEY'))).toBe(false)
    expect(isBuiltArtifactSuite('apps/web/tests/seeded-history.e2e.ts', artifactGuard("MODE !== 'record'"))).toBe(false)
    expect(isBuiltArtifactSuite('packages/x/tests/real-render.spec.ts', artifactGuard('!hasDot'))).toBe(false)
    expect(isBuiltArtifactSuite('packages/x/tests/plain.spec.ts', artifactGuard("process.platform === 'win32' || !existsSync('/bin/zsh')"))).toBe(false)
    expect(isBuiltArtifactSuite('packages/x/tests/plain.spec.ts', 'describe("no guard", () => { it("x", () => {}) })\n')).toBe(false)
  })

  it('finds the suites whose skip hides a missing build in the real tree', () => {
    const suites = discoverBuiltArtifactSuites(ROOT)
    expect(suites).toContain('apps/cli/tests/built-bin.e2e.ts')
    expect(suites).toContain('packages/experimental/webworker-packer/tests/image-loadable.spec.ts')
    expect(suites).toContain('packages/client/ui-sidebar-terminal/tests/bundle-split.client.spec.ts')
    expect(suites).not.toContain('apps/web/tests/seeded-history.e2e.ts')
    expect(suites).not.toContain('packages/llm/llm-deepseek/tests/runtime.e2e.ts')
    expect(suites.length).toBeGreaterThanOrEqual(27)
  })
})

describe('built-artifact suite families', () => {
  it('classifies each suite by the config that collects it', () => {
    expect(familyOf('apps/cli/tests/built-bin.e2e.ts')).toBe('e2e')
    expect(familyOf('apps/cli/tests/web-browser-open.expected.e2e.ts')).toBe('expected')
    expect(familyOf('packages/client/ui-sidebar-terminal/tests/bundle-split.client.spec.ts')).toBe('spec')
  })
})

describe('built-artifact suite reporting', () => {
  it('counts executed passes, including the failures that still executed', () => {
    const runs = summarizeBuiltArtifactSuiteRuns(['a/b.spec.ts'], [{
      name: './a/b.spec.ts',
      assertionResults: [{ status: 'passed' }, { status: 'failed' }, { status: 'skipped' }],
    }])
    expect(runs).toEqual([{ suite: 'a/b.spec.ts', passed: 1 }])
  })

  it('warns when the lane never ran a suite', () => {
    const runs = summarizeBuiltArtifactSuiteRuns(['a/b.spec.ts'], [{ name: './a/c.spec.ts', assertionResults: [{ status: 'passed' }] }])
    expect(runs[0]?.passed).toBeUndefined()
    expect(runs[0]?.warning).toContain('never ran it')
  })

  it('warns when a suite ran nothing because its build product is missing', () => {
    const runs = summarizeBuiltArtifactSuiteRuns(['a/b.spec.ts'], [{ name: './a/b.spec.ts', assertionResults: [{ status: 'skipped' }] }])
    expect(runs[0]?.passed).toBe(0)
    expect(runs[0]?.warning).toContain('build product is still missing')
  })
})
