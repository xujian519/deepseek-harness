/**
 * Packaging manifest: electron-builder must bundle every main-process runtime
 * module. Missing a dependency here produces an [ERR_MODULE_NOT_FOUND] in the
 * packaged app, so the config is treated as part of the build contract.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

interface ElectronBuilderConfig {
  files?: string[]
}

const config = yaml.load(
  readFileSync(fileURLToPath(new URL('../electron-builder.yml', import.meta.url)), 'utf8'),
) as ElectronBuilderConfig

describe('electron-builder packaging manifest', () => {
  it('includes every main-process runtime module', () => {
    expect(config.files).toEqual(
      expect.arrayContaining(['dist/main.js', 'dist/server-manager.js', 'dist/preload.cjs', 'package.json']),
    )
  })

  it('includes the tray icon assets the main process loads at runtime', () => {
    expect(config.files).toEqual(
      expect.arrayContaining(['assets/tray.png', 'assets/trayTemplate.png', 'assets/trayTemplate@2x.png']),
    )
  })
})
