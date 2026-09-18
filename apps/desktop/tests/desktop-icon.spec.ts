/**
 * Packaging icon selection: releases ship the brand icons bundled in
 * apps/desktop/assets unless DSH_DESKTOP_ICON_DIR overrides them.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const UNSIGNED_MAC_ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.example.desktop',
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_UNSIGNED: '1',
  // Packaging resolves mandatory-update policy metadata before any artifact work.
  DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN: 'https://policy.example.invalid',
}

function portablePath(value: string): string {
  return value.replaceAll('\\', '/')
}

describe('desktop packaging icons', () => {
  const createdDirs: string[] = []

  beforeAll(() => {
    // The config module builds its default export from process.env at import;
    // unsigned mode keeps that import free of signing and notary inputs. The
    // target platform is part of that environment: without it the default
    // export resolves to the build host and throws on a non-packaging host.
    vi.stubEnv('DSH_DESKTOP_APP_ID', UNSIGNED_MAC_ENVIRONMENT.DSH_DESKTOP_APP_ID)
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', UNSIGNED_MAC_ENVIRONMENT.DSH_DESKTOP_TARGET_PLATFORM)
    vi.stubEnv('DSH_DESKTOP_UNSIGNED', UNSIGNED_MAC_ENVIRONMENT.DSH_DESKTOP_UNSIGNED)
    vi.stubEnv(
      'DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN',
      UNSIGNED_MAC_ENVIRONMENT.DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN,
    )
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await Promise.all(createdDirs.map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('ships the bundled brand icons when the environment sets no icon directory', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const mac = createElectronBuilderConfig(UNSIGNED_MAC_ENVIRONMENT, 'darwin', 'arm64')
    expect(portablePath(mac.mac.icon)).toMatch(/\/apps\/desktop\/assets\/icon\.icns$/u)
    const win = createElectronBuilderConfig({
      ...UNSIGNED_MAC_ENVIRONMENT,
      DSH_DESKTOP_TARGET_PLATFORM: 'win32',
    }, 'win32', 'x64')
    expect(portablePath(win.win.icon)).toMatch(/\/apps\/desktop\/assets\/icon\.ico$/u)
  })

  it('prefers an environment icon directory over the bundled icons', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const iconDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-icons-'))
    createdDirs.push(iconDir)
    await writeFile(join(iconDir, 'icon.icns'), '')
    await writeFile(join(iconDir, 'icon.ico'), '')
    const config = createElectronBuilderConfig({
      ...UNSIGNED_MAC_ENVIRONMENT,
      DSH_DESKTOP_ICON_DIR: iconDir,
    }, 'darwin', 'arm64')
    expect(config.mac.icon).toBe(join(iconDir, 'icon.icns'))
  })

  it('rejects an environment icon directory missing a required file', async () => {
    const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
    const emptyDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-icons-empty-'))
    createdDirs.push(emptyDir)
    expect(() => createElectronBuilderConfig({
      ...UNSIGNED_MAC_ENVIRONMENT,
      DSH_DESKTOP_ICON_DIR: emptyDir,
    }, 'darwin', 'arm64')).toThrow(/does not contain icon\.icns/u)
  })
})
