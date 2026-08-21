/**
 * browser-use backend — the browser fallback channel (browser-harness CLI).
 *
 * Probe runs `browser-use --version` under a temporary HOME/XDG so the CLI's
 * first-run config-directory write cannot fail the probe inside read-only
 * HOME / sandbox / CI environments. Capability bits follow the Sati POC
 * mapping: login state and anti-bot are true (real Chrome), download
 * interception and screencast are false — downloads go through link
 * extraction + fetch instead.
 * @module @deepseek-ai/dsh-browser-backend/browser-use
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type { BrowserBackend, BrowserBackendProbe } from './types.ts'

/** Version-probe result (test injection). */
export type VersionProbeResult = {
  status: number | null
  error: Error | null
  stdout: string
  stderr: string
}

/** browser-use backend options (test injection). */
export type BrowserUseBackendOptions = {
  /** Version probe; defaults to spawnSync `browser-use --version` with a temp HOME/XDG. */
  probeVersion?: () => VersionProbeResult
}

/** Default version probe: run `browser-use --version` under a temporary HOME/XDG. */
function defaultProbeVersion(): VersionProbeResult {
  const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-bu-probe-'))
  let result: SpawnSyncReturns<string>
  try {
    result = spawnSync('browser-use', ['--version'], {
      shell: true,
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        HOME: tmpHome,
        XDG_CONFIG_HOME: join(tmpHome, '.config'),
        XDG_CACHE_HOME: join(tmpHome, '.cache'),
      },
    })
  } catch (error) {
    return { status: null, error: error as Error, stdout: '', stderr: '' }
  } finally {
    rmSync(tmpHome, { recursive: true, force: true })
  }
  return { status: result.status, error: result.error ?? null, stdout: result.stdout, stderr: result.stderr }
}

/**
 * browser-use backend probing the browser-harness CLI.
 * @param options - version-probe override (tests).
 * @returns a backend whose probe reports ok when the CLI answers --version.
 */
export function createBrowserUseBackend(options: BrowserUseBackendOptions = {}): BrowserBackend {
  const probeVersion = options.probeVersion ?? defaultProbeVersion
  return {
    id: 'browser-use',
    label: 'browser-use',
    capabilities: {
      downloadInterception: false,
      screencast: false,
      handoff: false,
      siteTools: false,
      loginState: true,
      antiBot: true,
    },
    probe(): BrowserBackendProbe {
      const result = probeVersion()
      const detail = result.stderr.trim() || result.stdout.trim()
      if (result.error !== null || result.status !== 0) {
        return {
          status: 'missing',
          detail: detail || 'browser-use CLI not found',
          installHint: 'https://github.com/browser-use/browser-harness',
        }
      }
      return { status: 'ok', detail: detail || 'available' }
    },
  }
}
