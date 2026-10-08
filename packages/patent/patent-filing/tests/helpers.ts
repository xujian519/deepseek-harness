/**
 * Test doubles for the subprocess seam: canned stdout plus recorded argv.
 * @module @deepseek-ai/dsh-patent-filing/tests/helpers
 */

import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessSpawner } from '@deepseek-ai/dsh-patent-filing'

/** Exit facts for a settled handle. */
export interface HandleFacts {
  /** Process exit code; null when the process was signalled. */
  exitCode: number | null
  /** Terminating signal name, or null when it exited on its own. */
  signal: NodeJS.Signals | null
  /** Streams to report as collected; omit one to model an uncollected stream. */
  streams?: { stdout?: boolean; stderr?: boolean }
  /** Resolve `done` after this many milliseconds instead of immediately. */
  delayMs?: number
  /** Text the stderr stream carries; defaults to empty. */
  stderr?: string
}

/** A settled handle carrying `stdout`/`stderr` text and the given exit facts. */
export function stdoutHandle(stdout: string, facts: HandleFacts = { exitCode: 0, signal: null }): SubprocessHandle {
  const streams = facts.streams ?? {}
  const reader = (text: string): { readFrom: (from: number) => { text: string; nextOffset: number; lossy: boolean } } => ({
    readFrom: (from: number) => ({ text: text.slice(from), nextOffset: text.length, lossy: false }),
  })
  const done = facts.delayMs === undefined
    ? Promise.resolve({ exitCode: facts.exitCode, signal: facts.signal })
    : new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      setTimeout(() => { resolve({ exitCode: facts.exitCode, signal: facts.signal }) }, facts.delayMs)
    })
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      ...(streams.stdout === false ? {} : { stdout: reader(stdout) }),
      ...(streams.stderr === false ? {} : { stderr: reader(facts.stderr ?? '') }),
    },
    done,
    terminate() {},
    waitForExit: () => Promise.resolve(true),
  }
}

/** A spawner whose spawn delegates to onSpawn and records every spec. */
export function fakeSubprocess(
  onSpawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
): { spawner: SubprocessSpawner; calls: SubprocessSpawnSpec[] } {
  const calls: SubprocessSpawnSpec[] = []
  const spawner: SubprocessSpawner = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      calls.push(spec)
      return onSpawn(spec)
    },
  }
  return { spawner, calls }
}

/** The argv a recorded call spawned. */
export function argvOf(spec: SubprocessSpawnSpec): string[] {
  return [...spec.argv]
}
