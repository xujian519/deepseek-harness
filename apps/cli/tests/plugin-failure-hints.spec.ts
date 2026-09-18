/**
 * Tests for the pnpm failure hints printed by `dsh plugin` after a failed
 * forward: the git-hosted hint names the config home pnpm 10.x actually
 * enforces (the profile package.json field, not the workspace file its own
 * output points at), and the store hint names the migration path.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pnpmFailureHints } from '../src/plugin.ts'

const dir = join('/Users', 'test', '.dsh', 'profiles', 'web')

describe('pnpmFailureHints', () => {
  it('points the git-hosted prepare block at the package.json allowlist pnpm 10 enforces', () => {
    const stderr = 'ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED  Failed to prepare git-hosted package fetched from'
      + ' "https://codeload.github.com/omdsh-dev/dsh-genui/tar.gz/074b9333": The git-hosted package'
      + ' "@changfenhuang/dsh-genui@0.9.7" needs to execute build scripts but is not in the "onlyBuiltDependencies" allowlist.'
    const hints = pnpmFailureHints(stderr, dir)
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('pnpm.onlyBuiltDependencies')
    expect(hints[0]).toContain(join(dir, 'package.json'))
    expect(hints[0]).toContain('then re-run')
    // The previous hint sent users to allowBuilds in pnpm-workspace.yaml,
    // which pnpm 10.34 never consults for this check.
    expect(hints[0]).not.toContain('allowBuilds')
  })

  it('hints the store migration on an unexpected-store failure', () => {
    const stderr = 'ERR_PNPM_UNEXPECTED_STORE  Unexpected store location\n\n'
      + 'The dependencies at the profile are currently linked from the store at the v10 location.'
    const hints = pnpmFailureHints(stderr, dir)
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('pnpm install')
    expect(hints[0]).toContain(dir)
    expect(hints[0]).not.toContain('onlyBuiltDependencies')
  })

  it('prefers the store hint when both error classes appear', () => {
    const stderr = 'ERR_PNPM_UNEXPECTED_STORE Unexpected store location; also ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED'
    const hints = pnpmFailureHints(stderr, dir)
    expect(hints).toHaveLength(1)
    expect(hints[0]).toContain('pnpm install')
  })

  it('adds no hint for unrelated failures', () => {
    expect(pnpmFailureHints('ERR_NETWORK  A network error occurred while fetching', dir)).toEqual([])
    expect(pnpmFailureHints('', dir)).toEqual([])
  })
})
