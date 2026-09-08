/**
 * The macOS system-CLI runner for the native tools. Every call spawns an
 * absolute executable with an argv array — never a shell string — so model
 * text reaches the system only as one argv element or as stdin bytes.
 * @module @deepseek-ai/dsh-macos-tools/runner
 */

import { execFile } from 'node:child_process'

/** Options for one CLI invocation. */
export interface CliRunOptions {
  /** Hard timeout in milliseconds; the child is killed when it expires. */
  timeoutMs: number
  /** Caller-owned cancellation; aborting kills the child. */
  signal: AbortSignal
  /** Bytes written to the child's stdin before it is closed, when present. */
  input?: string
}

/**
 * One system-CLI invocation.
 * @param command - absolute executable path.
 * @param args - argv elements, each passed verbatim without shell interpretation.
 * @param options - timeout, cancellation, and optional stdin input.
 * @returns the child's stdout.
 * @throws when the child exits non-zero, times out, or is aborted; the message
 *   carries the command line and stderr tail reported by `execFile`.
 */
export type CliRunner = (command: string, args: readonly string[], options: CliRunOptions) => Promise<{ stdout: string }>

/** Stdout cap for one command; the largest output here is a clipboard read. */
const MAX_BUFFER_BYTES = 8 * 1024 * 1024

/**
 * The production runner over `child_process.execFile`.
 * @returns a runner resolving stdout on exit code 0 and rejecting otherwise.
 */
export function createExecFileRunner(): CliRunner {
  return (command, args, options) => new Promise((resolve, reject) => {
    const child = execFile(command, [...args], {
      timeout: options.timeoutMs,
      signal: options.signal,
      maxBuffer: MAX_BUFFER_BYTES,
      encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        // error.message carries the command line and the child's stderr tail.
        reject(new Error(error.message))
        return
      }
      resolve({ stdout })
    })
    if (options.input !== undefined) {
      // stdio defaults to pipe, so stdin exists; @types/node types it
      // unconditionally nullable and execFile has no narrowing overload.
      // oxlint-disable-next-line no-non-null-assertion
      const stdin = child.stdin!
      // EPIPE when the child exits before draining stdin: the callback above
      // already carries that failure, so the stream error is only contained.
      stdin.on('error', () => {})
      stdin.write(options.input)
      stdin.end()
    }
  })
}
