/**
 * External-open launch coverage: the OS opener is spawned detached with an
 * argv array, and a spawn failure (missing handler binary) is reported only
 * through the child's 'error' event — which the route has already outlived —
 * so launchExternal must still resolve. The child_process face is replaced
 * with a scripted fake because a real ENOENT cannot be produced for the
 * platform openers this host ships.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { launchExternal, revealCommand, validateExternalUrl } from '../src/open-external.ts'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void }
      child.unref = () => {}
      // The opener binary is missing: the failure arrives async, after the
      // route returned.
      queueMicrotask(() => child.emit('error', new Error('spawn ENOENT')))
      return child
    }),
  }
})

beforeEach(() => {
  vi.mocked(spawn).mockClear()
})

describe('launchExternal spawn-failure tolerance', () => {
  it('returns started:true and swallows the async spawn error (reveal)', async () => {
    const spec = revealCommand('/tmp/some-folder', process.platform)
    expect(launchExternal('reveal', '/tmp/some-folder')).toEqual({ started: true })
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(spec.command, spec.args, { detached: true, stdio: 'ignore' })
    // Let the scripted 'error' event fire; nothing may escape.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(launchExternal('reveal', '/tmp/some-folder')).toEqual({ started: true })
  })

  it('returns started:true for a url launch whose handler is missing', () => {
    expect(launchExternal('url', 'vscode://file/x.ts')).toEqual({ started: true })
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1)
  })
})

describe('validateExternalUrl rejection branch', () => {
  it('refuses a scheme-shaped string that is not a parseable URL', () => {
    // The scheme prefix passes the pattern but the authority is invalid.
    expect(() => validateExternalUrl('a://exa mple')).toThrow('invalid url')
  })
})
