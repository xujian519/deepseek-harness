/**
 * Unified ego-browser (ego-lite) execution session: availability checks, a
 * connection probe, session-scoped task-space naming, and verbatim script runs
 * over a spawn-capable runner. The runner defaults to the subprocess-backed
 * adapter the service injects; the script passes through stdin verbatim (the
 * single-quoted heredoc is replaced by the subprocess seam's batch stdin, so
 * the script is never shell-expanded).
 * @module @deepseek-ai/dsh-patent-data/ego-session
 */

import { accessSync, constants as fsConstants, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EgoAvailability, EgoRunOptions, EgoScriptResult, EgoSessionOptions, EgoSpawnRunner } from './types.ts'

const DEFAULT_COMMAND_NAME = 'ego-browser'
const DEFAULT_TIMEOUT_MS = 90_000
const DEFAULT_MAX_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 500_000
/** The ego-browser script delimiter name shared with the future ego_browser tool's input validation. */
export const EGO_HEREDOC_MARKER = 'EGO_SCRIPT_EOF'

/** Unified ego-browser execution session. Stateless; availability is checked per call. */
export class EgoBrowserSession {
  private readonly commandName: string
  private readonly defaultTimeoutMs: number
  private readonly maxTimeoutMs: number
  private readonly homeDir: string
  private readonly pathEntries: string[]
  private readonly maxOutputBytes: number
  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly runner: EgoSpawnRunner | undefined

  constructor(options: EgoSessionOptions = {}) {
    this.commandName = options.commandName ?? DEFAULT_COMMAND_NAME
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS
    this.homeDir = options.homeDir ?? homedir()
    this.pathEntries = options.pathEntries ?? [join(this.homeDir, '.local', 'bin')]
    this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.runner = options.runner
  }

  /**
   * Static availability check: the platform must be darwin and the CLI executable
   * must exist (checked live, never cached).
   * @param env - optional environment override for the PATH probe.
   * @returns ok, or the unavailable/setup_required reason.
   */
  checkAvailability(env?: NodeJS.ProcessEnv): EgoAvailability {
    if (this.platform !== 'darwin') {
      return {
        ok: false,
        code: 'unavailable',
        reason: 'ego-browser (ego lite) only supports macOS.',
      }
    }
    if (!this.isCommandExecutable(env ?? this.env)) {
      return {
        ok: false,
        code: 'setup_required',
        reason: 'ego-browser CLI not found. Install ego lite (https://lite.ego.app/), complete first-run onboarding, and confirm ego-browser is on the PATH (usually ~/.local/bin/ego-browser).',
      }
    }
    return { ok: true }
  }

  /**
   * Connection probe: run ego-browser with an inline cliLog and check for the probe marker.
   * @param timeoutMs - probe timeout (default 8_000).
   * @returns true when the probe exits 0 without timing out and emits the marker.
   */
  async runConnectionProbe(timeoutMs?: number): Promise<boolean> {
    const probeTimeout = timeoutMs ?? 8_000
    try {
      const result = await this.requireRunner().spawn({
        argv: [this.commandName, 'nodejs', '-e', "cliLog('EGO_DOCTOR_OK')"],
        cwd: process.cwd(),
        env: this.env,
        timeoutMs: probeTimeout,
      })
      if (result.timedOut || result.exitCode !== 0) return false
      return `${result.stdout}\n${result.stderr}`.includes('EGO_DOCTOR_OK')
    } catch {
      return false
    }
  }

  /**
   * Session-scoped task-space name: sati-<domain>[-<sessionId>]. One sessionId+domain
   * reuses one browser task space, preserving login state and open tabs across calls.
   * @param domain - the task-space domain (e.g. "patent-download").
   * @param sessionId - optional session id that scopes the space.
   * @returns the stable task-space name.
   */
  taskSpaceName(domain: string, sessionId?: string): string {
    const base = `sati-${domain}`
    if (sessionId) return `${base}-${sessionId}`
    return base
  }

  /**
   * Run an ego-browser script (the script body is stdin; the final result uses cliLog).
   * @param script - the verbatim ego-browser script body.
   * @param options - cwd, optional timeout, environment, and cancellation.
   * @returns the merged/truncated output plus stream and exit facts.
   */
  async runScript(script: string, options: EgoRunOptions): Promise<EgoScriptResult> {
    const timeoutMs = Math.min(options.timeoutMs ?? this.defaultTimeoutMs, this.maxTimeoutMs)
    const env = this.buildEnv(options.env ?? process.env)
    try {
      const result = await this.requireRunner().spawn({
        argv: [this.commandName, 'nodejs'],
        stdinData: script,
        cwd: options.cwd,
        env,
        timeoutMs,
        ...options.signal !== undefined ? { signal: options.signal } : {},
      })
      const combined = [result.stdout, result.stderr].filter(t => t.length > 0).join('\n')
      return {
        output: this.truncate(combined),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`ego-browser failed to start: ${message}`)
    }
  }

  /**
   * Extract the JSON payload of the first EGO_<TAG>:<json> line in the output.
   * @param output - the combined ego-browser output.
   * @param tag - the tag name (the payload prefix is EGO_<tag>:).
   * @returns the parsed payload, or null when absent or unparseable.
   */
  extractTaggedJson<T>(output: string, tag: string): T | null {
    const prefix = `EGO_${tag}:`
    for (const line of output.split('\n')) {
      const idx = line.indexOf(prefix)
      if (idx === -1) continue
      const payload = line.slice(idx + prefix.length).trim()
      try {
        return JSON.parse(payload) as T
      } catch {
        return null
      }
    }
    return null
  }

  /** Ensure an output directory exists (before downloads/screen captures). */
  ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true })
  }

  private requireRunner(): EgoSpawnRunner {
    if (this.runner === undefined) {
      throw new Error('ego-browser runner not configured; construct the session through ctx.patentData.createEgoSession')
    }
    return this.runner
  }

  private buildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const existingPath = base.PATH ?? ''
    const segments = existingPath.length > 0 ? existingPath.split(':') : []
    for (const entry of this.pathEntries) {
      if (entry && entry.length > 0 && !segments.includes(entry)) {
        segments.push(entry)
      }
    }
    return { ...base, PATH: segments.join(':') }
  }

  private isCommandExecutable(env: NodeJS.ProcessEnv): boolean {
    const localBin = join(this.homeDir, '.local', 'bin')
    const pathSegments = (env.PATH ?? '').split(':').filter(s => s.length > 0)
    const candidates = [
      join(localBin, this.commandName),
      ...pathSegments.map(segment => join(segment, this.commandName)),
    ]
    return candidates.some(isExecutableFile)
  }

  private truncate(text: string): string {
    return text.length > this.maxOutputBytes ? `${text.slice(0, this.maxOutputBytes)}…\n[output truncated]` : text
  }
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Normalize a patent number: trim, upper-case, and strip whitespace/separators.
 * @param value - the raw patent number.
 * @returns the normalized number.
 */
export function normalizePatentNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-:/]/g, '')
}
