/**
 * Preload bundling: the sandboxed preload may only require `electron` (plus a
 * few Node built-ins). Bundling the real `electron` package into the output
 * would inline the module shim that resolves the Electron binary path and
 * crash sandboxed preloads, so the build script must keep `electron` external.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'

const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
  scripts: { build: string }
}

describe('preload bundling', () => {
  it('keeps electron external in the build script and the emitted bundle', async () => {
    expect(packageJson.scripts.build).toContain('--external:electron')

    const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/preload.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
      external: ['electron'],
    })
    const output = result.outputFiles[0]?.text ?? ''
    expect(output).toContain('require("electron")')
    expect(output).not.toContain('Electron failed to install correctly')
  })

  it('exposes the closed bridge surface including printHtmlToPdf', async () => {
    const exposed = vi.hoisted(() => ({ channels: [] as string[] }))
    vi.mock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (key: string, api: Record<string, unknown>) => {
          exposed.channels.push(key, ...Object.keys(api))
        },
      },
      ipcRenderer: { invoke: (channel: string) => channel },
    }))
    await import('../src/preload.ts')
    expect(exposed.channels).toEqual(['desktop', 'ping', 'printHtmlToPdf'])
  })
})
