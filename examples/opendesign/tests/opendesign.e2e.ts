import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('./fixtures/opendesign-driver.ts', import.meta.url))
const configPath = fileURLToPath(new URL('./fixtures/smoke.cordis.yml', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('./fixtures/od-root', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

describe('opendesign overlay keyless smoke', () => {
  it('catalogs the OpenDesign skills and design-template roots when OPEN_DESIGN_DIR is set', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'opendesign',
      tempDirPrefix: 'opendesign-smoke-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      env: { OPEN_DESIGN_DIR: fixtureRoot },
    })
    expect(stderr).toBe('')
    expect(stdout).toBe('SKILL_CATALOG od-dashboard,od-deck,od-lp-copy\n')
  })

  it('registers an explicit empty catalog when OPEN_DESIGN_DIR is unset', async () => {
    const { stdout, stderr } = await runLoaderSmoke({
      label: 'opendesign',
      tempDirPrefix: 'opendesign-smoke-',
      binScript,
      libBinScript: binScript,
      configPath,
      tsconfigPath,
      env: { OPEN_DESIGN_DIR: '' },
    })
    expect(stderr).toBe('')
    expect(stdout).toBe('SKILL_CATALOG \n')
  })
}, LOADER_SMOKE_TEST_TIMEOUT_MS * 2)
