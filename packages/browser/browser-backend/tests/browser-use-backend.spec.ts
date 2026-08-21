import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createBrowserUseBackend } from '../src/browser-use-backend.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

describe('createBrowserUseBackend', () => {
  it('reports ok when the version probe succeeds', async () => {
    const backend = createBrowserUseBackend({ probeVersion: () => ({ status: 0, error: null, stdout: '0.1.8\n', stderr: '' }) })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toBe('0.1.8')
  })

  it('reports ok with a default detail when stdout is empty', async () => {
    const backend = createBrowserUseBackend({ probeVersion: () => ({ status: 0, error: null, stdout: '', stderr: '' }) })
    expect((await backend.probe()).detail).toBe('available')
  })

  it('reports missing with the stderr detail and install hint when the CLI is absent', async () => {
    const backend = createBrowserUseBackend({
      probeVersion: () => ({ status: 1, error: null, stdout: '', stderr: 'not found' }),
    })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toBe('not found')
    expect(probe.installHint).toBe('https://github.com/browser-use/browser-harness')
  })

  it('reports missing with a default detail when the probe has no output at all', async () => {
    const backend = createBrowserUseBackend({
      probeVersion: () => ({ status: 2, error: new Error('ENOENT'), stdout: '', stderr: '' }),
    })
    expect((await backend.probe()).detail).toBe('browser-use CLI not found')
  })

  it('carries the fallback capability set', () => {
    const backend = createBrowserUseBackend({ probeVersion: () => ({ status: 0, error: null, stdout: '', stderr: '' }) })
    expect(backend.capabilities).toEqual({
      downloadInterception: false,
      screencast: false,
      handoff: false,
      siteTools: false,
      loginState: true,
      antiBot: true,
    })
  })
})

describe('default version probe', () => {
  it('reports ok from the real spawnSync path', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, error: null, stdout: '0.1.8\n', stderr: '' } as never)
    const backend = createBrowserUseBackend()
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toBe('0.1.8')
  })

  it('reports missing when the probe carries a non-null error', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: null, error: new Error('ENOENT'), stdout: '', stderr: '' } as never)
    const backend = createBrowserUseBackend()
    expect((await backend.probe()).status).toBe('missing')
  })

  it('tolerates a throwing spawnSync', async () => {
    vi.mocked(spawnSync).mockImplementation(() => { throw new Error('boom') })
    const backend = createBrowserUseBackend()
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
  })
})
