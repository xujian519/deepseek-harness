/**
 * Test doubles for the subprocess seam and shared temp-dir helpers.
 * @module @deepseek-ai/dsh-patent-document/tests/helpers
 */

import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** A settled, exit-0 subprocess handle carrying no collected output. */
export function successHandle(): SubprocessHandle {
  return {
    pid: 42,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {},
    done: Promise.resolve({ exitCode: 0, signal: null }),
    terminate() {},
    waitForExit: () => Promise.resolve(true),
  }
}

/** A subprocess runtime whose spawn delegates to onSpawn and records every spec. */
export function fakeSubprocess(
  onSpawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
): { runtime: SubprocessRuntime; calls: SubprocessSpawnSpec[] } {
  const calls: SubprocessSpawnSpec[] = []
  const runtime = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      calls.push(spec)
      return onSpawn(spec)
    },
  } as unknown as SubprocessRuntime
  return { runtime, calls }
}

/** A subprocess runtime that fails any spawn — for html-only renders that must not reach Chrome. */
export function unusedSubprocess(): SubprocessRuntime {
  return fakeSubprocess(() => {
    throw new Error('subprocess.spawn must not be called for an html-only render')
  }).runtime
}
