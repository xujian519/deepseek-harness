/**
 * dsh backend child-process control for the desktop shell: spawn the backend,
 * discover the bound URL from its readiness line, report exits, and dispose
 * the child on app shutdown.
 * @module @deepseek-ai/dsh-desktop/server-manager
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'

/** Spawn inputs for the dsh backend child process. */
export interface BackendSpawnOptions {
  /** Node binary to run: the packaged runtime, or dev PATH node. */
  nodeBin: string
  /** Backend entry: built `apps/cli/lib/bin.js`, or source `apps/cli/src/bin.ts`. */
  entry: string
  /** Node loader arguments inserted before the entry (the dev tsx hook; empty when packaged). */
  loaderArgs: readonly string[]
  /** Profile name to boot. */
  profile: string
  /** Inner app arguments, e.g. `['--port', '0']`. */
  args: readonly string[]
  /** Working directory for the backend process. */
  cwd: string
}

/** One backend process exit, as `child_process` reports it. */
interface BackendExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** The spawned backend handle. */
export interface DesktopBackend {
  /** The bound Web URL, resolved once the `dsh web:` readiness line appears. */
  readonly ready: Promise<string>
  /** Observe process exit (including a spawn failure, reported with null code). */
  onExit(callback: (exit: BackendExit) => void): void
  /** Terminate the child (SIGTERM, escalated to SIGKILL after a grace period). */
  dispose(): Promise<void>
}

/** The dsh web runtime's readiness line: `dsh web: http://127.0.0.1:PORT`. */
const URL_LINE = /^dsh web: (https?:\/\/\S+)/

/**
 * Spawn a dsh backend and resolve once the readiness line names the bound
 * URL. stdout is echoed to the parent until the child exits; stderr is always
 * echoed. The readiness promise rejects when the process exits or fails to
 * spawn before a URL line appears.
 * @param options - spawn inputs.
 * @returns the backend handle.
 */
export function startDshBackend(options: BackendSpawnOptions): DesktopBackend {
  let resolveReady: (url: string) => void = () => {}
  let rejectReady: (error: Error) => void = () => {}
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const exitCallbacks = new Set<(exit: BackendExit) => void>()
  let exited = false
  let resolved = false

  const child: ChildProcess = spawn(
    options.nodeBin,
    [...options.loaderArgs, options.entry, '--profile', options.profile, ...options.args],
    {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  let stdoutBuffer = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    process.stdout.write(chunk)
    if (resolved) return
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const match = URL_LINE.exec(line)
      if (match === null) continue
      resolved = true
      resolveReady(match[1] ?? '')
      break
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => process.stderr.write(chunk))

  const finish = (exit: BackendExit): void => {
    if (exited) return
    exited = true
    if (!resolved) rejectReady(new Error(`dsh backend exited before reporting a URL (code ${String(exit.code)}, signal ${String(exit.signal)})`))
    for (const callback of exitCallbacks) callback(exit)
  }
  child.on('exit', (code, signal) => { finish({ code, signal }) })
  child.on('error', (error) => {
    if (!exited) finish({ code: null, signal: null })
    else if (!resolved) rejectReady(new Error(`failed to spawn dsh backend: ${error.message}`))
  })

  return {
    ready,
    onExit(callback) {
      exitCallbacks.add(callback)
    },
    async dispose() {
      if (exited) return
      child.kill('SIGTERM')
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))])
      if (child.exitCode === null) child.kill('SIGKILL')
    },
  }
}
