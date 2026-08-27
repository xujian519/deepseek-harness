/**
 * EgoExtractor — run the `ego-browser` CLI to open a page and extract one value
 * with a `js(...)` expression, emitted as an `EGO_EXTRACT:<value>` cliLog
 * marker. It is the ego complement to {@link BrowserUseExtractor}: both open a
 * page and read one value, but ego uses the browser's task-space/login state
 * and reports through cliLog instead of a stdout marker.
 * @module @deepseek-ai/dsh-browser-backend/ego-extractor
 */

import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ExtractOptions, ExtractResult, PageExtractor, ScriptRun } from './browser-use-extractor.ts'

/** Marker line prefix emitted by the extraction cliLog. */
export const EGO_EXTRACT_MARKER = 'EGO_EXTRACT:'

/** Task-space domain for one-shot page extraction, kept apart from download spaces. */
const EXTRACT_TASK_SPACE = 'sati-page-extract'

/** Extract options (command name, home dir, and script-runner injection). */
export type EgoExtractorOptions = {
  /** CLI command name (default "ego-browser"). */
  commandName?: string
  /** Home directory locating `~/.local/bin` (default os.homedir()). */
  homeDir?: string
  /** Script runner; defaults to spawn with PATH injection and capped output collection. */
  run?: ScriptRun
}

/**
 * Build the ego-browser heredoc script that opens a URL, waits for load, and
 * cliLogs the js-expression value after the EGO_EXTRACT marker.
 * @param url - the page to open.
 * @param jsExpr - the JavaScript expression whose string value is extracted.
 * @param timeoutMs - per-tab load timeout in ms.
 * @returns the script body to pipe to `ego-browser nodejs` stdin.
 */
export function buildEgoExtractScript(url: string, jsExpr: string, timeoutMs: number): string {
  return [
    `const task = await useOrCreateTaskSpace('${EXTRACT_TASK_SPACE}')`,
    'try {',
    `  await openOrReuseTab(${JSON.stringify(url)}, { wait: true, timeout: ${timeoutMs} })`,
    `  const value = await js(${JSON.stringify(jsExpr)})`,
    `  cliLog('${EGO_EXTRACT_MARKER}' + (value == null ? '' : String(value)))`,
    '} finally {',
    '  await completeTaskSpace(task.id, { keep: false })',
    '}',
  ].join('\n')
}

/** PATH delimiter per platform (Windows ';', elsewhere ':'). */
function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === 'win32' ? ';' : ':'
}

/** Default script runner: spawn the CLI, inject ~/.local/bin into PATH, write the script to stdin. */
function defaultRun(commandName: string, homeDir: string): ScriptRun {
  return (script, options) =>
    new Promise((resolve) => {
      const env = { ...process.env }
      const basePath = env.PATH ?? ''
      const segments = basePath.length > 0 ? basePath.split(pathDelimiter(process.platform)) : []
      const localBin = join(homeDir, '.local', 'bin')
      if (!segments.includes(localBin)) {
        env.PATH = [...segments, localBin].join(pathDelimiter(process.platform))
      }
      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, options.timeoutMs)
      timer.unref()
      const onCallerAbort = (): void => { controller.abort() }
      options.signal?.addEventListener('abort', onCallerAbort, { once: true })
      if (options.signal?.aborted === true) controller.abort()
      const child = spawn(commandName, ['nodejs'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: controller.signal,
        env,
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < options.maxOutputBytes) {
          stdout += chunk.toString('utf8').slice(0, options.maxOutputBytes - stdout.length)
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < options.maxOutputBytes) {
          stderr += chunk.toString('utf8').slice(0, options.maxOutputBytes - stderr.length)
        }
      })
      child.on('error', (error: Error) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onCallerAbort)
        resolve({ exitCode: null, stdout, stderr: stderr || error.message, timedOut })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onCallerAbort)
        resolve({ exitCode: code, stdout, stderr, timedOut })
      })
      // stdin write after the child exited would throw EPIPE; the close result already carries the failure.
      child.stdin.on('error', () => {})
      child.stdin.write(script + '\n')
      child.stdin.end()
    })
}

/** Last marker value in the stdout; absent marker → undefined. */
function markerValue(stdout: string): string | null | undefined {
  let value: string | null | undefined
  for (const line of stdout.split('\n')) {
    if (line.startsWith(EGO_EXTRACT_MARKER)) value = line.slice(EGO_EXTRACT_MARKER.length)
  }
  return value
}

/**
 * Extract one value from a page through the ego-browser runtime. A missing
 * marker or a non-zero exit reports the failure; a marker with an empty value
 * means the page had no match (ok with value null).
 */
export class EgoExtractor implements PageExtractor {
  private readonly run: ScriptRun

  /**
   * @param options - CLI command name, home dir, and script-runner injection.
   */
  constructor(options: EgoExtractorOptions = {}) {
    this.run = options.run ?? defaultRun(options.commandName ?? 'ego-browser', options.homeDir ?? homedir())
  }

  /**
   * Open a URL and extract the js-expression value.
   * @param url - the page to open.
   * @param jsExpr - the JavaScript expression whose string value is extracted.
   * @param options - timeout/cancel/output cap.
   * @returns the extracted value, or the failure.
   */
  async extract(url: string, jsExpr: string, options: ExtractOptions = {}): Promise<ExtractResult> {
    const timeoutMs = options.timeoutMs ?? 60_000
    const result = await this.run(buildEgoExtractScript(url, jsExpr, timeoutMs), {
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      maxOutputBytes: options.maxOutputBytes ?? 1_000_000,
    })
    const value = markerValue(result.stdout)
    if (value !== undefined) return { ok: true, value: value === '' ? null : value }
    if (result.timedOut) return { ok: false, error: 'ego-browser timed out', timedOut: true }
    const detail = result.stderr.trim()
    return { ok: false, error: `ego-browser exited ${result.exitCode ?? 'null'}${detail ? `: ${detail}` : ''}` }
  }
}
