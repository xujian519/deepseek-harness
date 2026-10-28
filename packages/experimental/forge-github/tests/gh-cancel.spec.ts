/** Cancelling before the child has a pid: execa assigns one only after a successful spawn. */
import { describe, expect, it, vi } from 'vitest'
import { ghRunner } from '../src/gh.ts'

vi.mock('execa', () => ({
  execa: () => Object.assign(
    Promise.resolve({ exitCode: 0, isCanceled: false, isMaxBuffer: false, stdout: '', stderr: '' }),
    { pid: undefined },
  ),
}))

describe('gh runner cancellation', () => {
  it('ignores a cancel that lands before the child has a pid', async () => {
    const run = ghRunner({ ghCommand: 'gh', timeoutMs: 5_000, maxOutputBytes: 1_000 })
    const controller = new AbortController()
    const result = run(['api', 'user'], controller.signal)

    controller.abort(new Error('cancelled before spawn'))

    await expect(result).resolves.toEqual({ exitCode: 0, stdout: '', stderr: '' })
  })
})
