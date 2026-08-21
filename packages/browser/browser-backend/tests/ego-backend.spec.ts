import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createEgoBackend } from '../src/ego-backend.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

describe('createEgoBackend', () => {
  it('reports missing off-darwin with the lite install hint', async () => {
    const backend = createEgoBackend({ platform: 'linux' })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toContain('only supports macOS')
    expect(probe.installHint).toBe('https://lite.ego.app/')
  })

  it('reports missing when the CLI is absent on darwin', async () => {
    const backend = createEgoBackend({ platform: 'darwin', isCommandExecutable: () => false })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toContain('CLI not found')
  })

  it('reports ok when the CLI is present without doctorCheck', async () => {
    const backend = createEgoBackend({ platform: 'darwin', isCommandExecutable: () => true })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toBe('macOS · CLI available')
  })

  it('reports ok when the doctor connection probe succeeds', async () => {
    const backend = createEgoBackend({
      platform: 'darwin',
      doctorCheck: true,
      isCommandExecutable: () => true,
      runConnectionProbe: () => ({ ok: true, detail: 'connection probe ok' }),
    })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toContain('connection probe ok')
  })

  it('reports warn when the doctor connection probe fails', async () => {
    const backend = createEgoBackend({
      platform: 'darwin',
      doctorCheck: true,
      isCommandExecutable: () => true,
      runConnectionProbe: () => ({ ok: false, detail: 'spawn boom' }),
    })
    const probe = await backend.probe()
    expect(probe.status).toBe('warn')
    expect(probe.detail).toContain('spawn boom')
  })

  it('carries the full capability set', () => {
    const backend = createEgoBackend({ platform: 'darwin' })
    expect(backend.capabilities).toEqual({
      downloadInterception: true,
      screencast: true,
      handoff: true,
      siteTools: true,
      loginState: true,
      antiBot: true,
    })
    expect(backend.id).toBe('ego')
    expect(backend.label).toBe('ego lite')
  })
})

describe('default probe implementations', () => {
  it('finds the CLI through the real which check', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never)
    const backend = createEgoBackend({ platform: 'darwin' })
    expect((await backend.probe()).status).toBe('ok')
  })

  it('reports missing when which fails', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as never)
    const backend = createEgoBackend({ platform: 'darwin' })
    expect((await backend.probe()).status).toBe('missing')
  })

  it('tolerates a throwing which', async () => {
    vi.mocked(spawnSync).mockImplementation(() => { throw new Error('boom') })
    const backend = createEgoBackend({ platform: 'darwin' })
    expect((await backend.probe()).status).toBe('missing')
  })

  it('runs the real connection probe to ok', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockReturnValueOnce({ status: 0, stdout: 'EGO_DOCTOR_OK', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('ok')
  })

  it('reports warn when the real connection probe fails', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'refused' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe throws', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockImplementationOnce(() => { throw new Error('spawn boom') })
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe fails with empty stderr', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe exits null with undefined streams', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockReturnValueOnce({ status: null, stdout: undefined, stderr: undefined } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the probe exits ok without the marker and undefined stdout', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockReturnValueOnce({ status: 0, stdout: undefined, stderr: undefined } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe throws a non-Error', async () => {
    vi.mocked(spawnSync)
      .mockReturnValueOnce({ status: 0 } as never)
      .mockImplementationOnce(() => { throw 'plain string' })
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true })
    expect((await backend.probe()).status).toBe('warn')
  })
})
