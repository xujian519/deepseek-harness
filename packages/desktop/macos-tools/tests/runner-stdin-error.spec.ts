import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createExecFileRunner } from '../src/runner.ts'

/**
 * Stubbed child stdio puts the stdin write error at a chosen point, so the
 * containment runs on every platform and load instead of waiting for a real
 * child to exit while its stdin write is still pending. The real-child cases
 * stay in macos-tools.spec.ts.
 */
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return { ...original, execFile: execFileMock }
})

/** What `execFile` hands the runner: the child's exit error and captured stdout. */
type ExitReport = (error: Error | null, stdout: string) => void

/** The stdin surface `createExecFileRunner` drives, with its calls recorded. */
interface FakeStdin extends EventEmitter {
  write: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

/** Stub one `execFile` call; the returned `reportExit` completes it. */
function stubExecFileCall(): { stdin: FakeStdin; reportExit: ExitReport } {
  const stdin: FakeStdin = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn() })
  let report: ExitReport | undefined
  execFileMock.mockImplementation((_command: string, _args: readonly string[], _options: unknown, callback: ExitReport) => {
    report = callback
    return { stdin }
  })
  return { stdin, reportExit: (error, stdout) => { report?.(error, stdout) } }
}

const signal = new AbortController().signal

describe('createExecFileRunner stdin containment', () => {
  it('contains a stdin write error raised before the child exit is reported', async () => {
    const { stdin, reportExit } = stubExecFileCall()
    const run = createExecFileRunner()

    const pending = run('/usr/bin/true', [], { timeoutMs: 5_000, signal, input: 'payload' })
    expect(stdin.write).toHaveBeenCalledWith('payload')
    expect(stdin.end).toHaveBeenCalledTimes(1)

    // The child exits without draining stdin, so its pipe write fails while the
    // exit is still unreported. Without the runner's listener this emit reaches
    // the process as an unhandled 'error' event instead of letting the child's
    // own exit decide the result.
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
    expect(() => stdin.emit('error', epipe)).not.toThrow()
    reportExit(null, '')

    await expect(pending).resolves.toEqual({ stdout: '' })
  })
})
