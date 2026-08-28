/**
 * ego lite backend — the first-choice backend for the download tools.
 *
 * Probes independently of @deepseek-ai/dsh-patent-data (which owns the ego
 * session that executes scripts): the platform must be macOS or Windows and
 * the CLI must be resolvable; an optional connection probe spawns
 * `ego-browser nodejs` with an inline cliLog marker. Capability bits are all
 * on (download interception, screencast, handoff, site tools, login state,
 * anti-bot).
 *
 * The CLI lookup is aligned with the execution session (EgoBrowserSession):
 * it searches `<homeDir>/.local/bin` then each PATH segment, so a CLI installed
 * in the standard local bin is found even when it is not on the harness PATH.
 * This keeps the availability probe consistent with what actually runs.
 * @module @deepseek-ai/dsh-browser-backend/ego
 */

import { spawnSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathDelimiter } from './run-script.ts'
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
  /** Home directory locating `~/.local/bin` (default os.homedir()). */
  homeDir?: string
  /** Command resolvability check; aligns with the execution session lookup. */
  isCommandExecutable?: (command: string) => boolean
  /** Connection probe; runs only when doctorCheck is true. */
  runConnectionProbe?: () => EgoConnectionProbe
}

/** File names a command may resolve to on the platform. */
function commandNames(command: string, platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`] : [command]
}

/** Whether a path is usable as a command on the platform. */
function isUsableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    // Windows scripts carry no executable bit; presence is the usable signal.
    accessSync(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Platforms the ego lite CLI supports. */
const SUPPORTED_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['darwin', 'win32'])

/** Human label for a supported platform. */
function platformLabel(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'macOS' : 'Windows'
}

/** Default command lookup: `<homeDir>/.local/bin` then each PATH segment. */
function defaultIsCommandExecutable(command: string, platform: NodeJS.Platform, homeDir: string): boolean {
  const dirs = [
    join(homeDir, '.local', 'bin'),
    ...(process.env.PATH ?? '').split(pathDelimiter(platform)).filter(segment => segment.length > 0),
  ]
  for (const dir of dirs) {
    for (const name of commandNames(command, platform)) {
      if (isUsableFile(join(dir, name), platform)) return true
    }
  }
  return false
}

/** Default connection probe: run ego-browser nodejs with an inline cliLog marker. */
function defaultConnectionProbe(platform: NodeJS.Platform): EgoConnectionProbe {
  try {
    const result = spawnSync('ego-browser', ['nodejs', '-e', `cliLog('${EGO_DOCTOR_MARKER}')`], {
      encoding: 'utf8',
      timeout: 8_000,
      // Windows commands are frequently .cmd wrappers, which need the shell.
      ...(platform === 'win32' ? { shell: true } : {}),
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
 * ego lite backend with platform gate and CLI presence probe.
 * @param options - platform/doctor/home overrides and test injections.
 * @returns a backend whose probe reports ok only on a supported platform with
 * an available CLI (and, with doctorCheck, a working connection).
 */
export function createEgoBackend(options: EgoBackendOptions = {}): BrowserBackend {
  const platform = options.platform ?? process.platform
  const homeDir = options.homeDir ?? homedir()
  const commandCheck = options.isCommandExecutable ?? (command => defaultIsCommandExecutable(command, platform, homeDir))
  const probeConnection = options.runConnectionProbe ?? (() => defaultConnectionProbe(platform))
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
      if (!SUPPORTED_PLATFORMS.has(platform)) {
        return {
          status: 'missing',
          detail: 'ego-browser (ego lite) only supports macOS and Windows.',
          installHint: 'https://lite.ego.app/',
        }
      }
      if (!commandCheck('ego-browser')) {
        return {
          status: 'missing',
          detail: 'ego-browser CLI not found. Install ego lite and confirm ego-browser is on the PATH (usually ~/.local/bin/ego-browser).',
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
        return { status: 'ok', detail: `${platformLabel(platform)} · CLI available · ${probe.detail}` }
      }
      return { status: 'ok', detail: `${platformLabel(platform)} · CLI available` }
    },
  }
}
