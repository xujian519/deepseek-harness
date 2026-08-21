/**
 * ego lite backend — the macOS-first choice for the download tools.
 *
 * Probes independently of @deepseek-ai/dsh-patent-data (which owns the ego
 * session that executes scripts): platform must be darwin and the CLI must be
 * on PATH; an optional connection probe spawns `ego-browser nodejs` with an
 * inline cliLog marker. Capability bits are all on (download interception,
 * screencast, handoff, site tools, login state, anti-bot).
 * @module @deepseek-ai/dsh-browser-backend/ego
 */

import { spawnSync } from 'node:child_process'
import type { BrowserBackend, BrowserBackendProbe } from './types.ts'

/** Connection-probe marker emitted by an inline ego-browser cliLog. */
const EGO_DOCTOR_MARKER = 'EGO_DOCTOR_OK'

/** Result of one connection probe (doctorCheck only). */
export type EgoConnectionProbe = {
  ok: boolean
  detail: string
}

/** ego-browser backend options (test injection). */
export type EgoBackendOptions = {
  /** Platform override (tests); defaults to process.platform. */
  platform?: NodeJS.Platform
  /** Run the connection probe after the CLI check (slower but more accurate). */
  doctorCheck?: boolean
  /** Executable presence check; defaults to spawnSync `which`. */
  isCommandExecutable?: (command: string) => boolean
  /** Connection probe; runs only when doctorCheck is true. */
  runConnectionProbe?: () => EgoConnectionProbe
}

/** Default `which` check via spawnSync. */
function which(command: string): boolean {
  try {
    return spawnSync('which', [command], { timeout: 3_000 }).status === 0
  } catch {
    return false
  }
}

/** Default connection probe: run ego-browser nodejs with an inline cliLog marker. */
function defaultConnectionProbe(): EgoConnectionProbe {
  try {
    const result = spawnSync('ego-browser', ['nodejs', '-e', `cliLog('${EGO_DOCTOR_MARKER}')`], {
      encoding: 'utf8',
      timeout: 8_000,
    })
    const ok = result.status === 0 && result.stdout.includes(EGO_DOCTOR_MARKER)
    return {
      ok,
      detail: ok
        ? 'connection probe ok'
        : `connection probe failed (exit ${result.status ?? 'null'}${result.stderr.trim() ? `: ${result.stderr.trim()}` : ''})`,
    }
  } catch (error) {
    return { ok: false, detail: `connection probe threw: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * ego lite backend with macOS platform gate and CLI presence probe.
 * @param options - platform/doctor overrides and test injections.
 * @returns a backend whose probe reports ok only when the platform is darwin
 * and the CLI is present (and, with doctorCheck, connects).
 */
export function createEgoBackend(options: EgoBackendOptions = {}): BrowserBackend {
  const platform = options.platform ?? process.platform
  const commandCheck = options.isCommandExecutable ?? which
  const probeConnection = options.runConnectionProbe ?? defaultConnectionProbe
  return {
    id: 'ego',
    label: 'ego lite',
    capabilities: {
      downloadInterception: true,
      screencast: true,
      handoff: true,
      siteTools: true,
      loginState: true,
      antiBot: true,
    },
    probe(): BrowserBackendProbe {
      if (platform !== 'darwin') {
        return {
          status: 'missing',
          detail: 'ego-browser (ego lite) only supports macOS.',
          installHint: 'https://lite.ego.app/',
        }
      }
      if (!commandCheck('ego-browser')) {
        return {
          status: 'missing',
          detail: 'ego-browser CLI not found. Install ego lite and confirm ego-browser is on the PATH.',
          installHint: 'https://lite.ego.app/',
        }
      }
      if (options.doctorCheck === true) {
        const probe = probeConnection()
        if (!probe.ok) {
          return {
            status: 'warn',
            detail: `CLI present but connection probe failed — launch ego lite and retry: ${probe.detail}`,
            installHint: 'https://lite.ego.app/',
          }
        }
        return { status: 'ok', detail: `macOS · CLI available · ${probe.detail}` }
      }
      return { status: 'ok', detail: 'macOS · CLI available' }
    },
  }
}
