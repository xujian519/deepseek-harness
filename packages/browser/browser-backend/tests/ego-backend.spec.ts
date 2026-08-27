import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { accessSync } from 'node:fs'
import { createEgoBackend } from '../src/ego-backend.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
vi.mock('node:fs', () => ({ accessSync: vi.fn(), constants: { X_OK: 1, F_OK: 0 } }))

const mockAccess = vi.mocked(accessSync)
const mockSpawn = vi.mocked(spawnSync)

describe('createEgoBackend', () => {
  it('reports missing off darwin/win32 with the lite install hint', async () => {
    const backend = createEgoBackend({ platform: 'linux' })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toContain('only supports macOS and Windows')
    expect(probe.installHint).toBe('https://lite.ego.app/')
  })

  it('reports missing when the CLI is absent', async () => {
    const backend = createEgoBackend({ platform: 'darwin', isCommandExecutable: () => false })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toContain('CLI not found')
  })

  it('reports ok on macOS when the CLI is present without doctorCheck', async () => {
    const backend = createEgoBackend({ platform: 'darwin', isCommandExecutable: () => true })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toBe('macOS · CLI available')
  })

  it('reports ok on Windows when the CLI is present', async () => {
    const backend = createEgoBackend({ platform: 'win32', isCommandExecutable: () => true })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toBe('Windows · CLI available')
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

describe('default command lookup', () => {
  it('finds the CLI when the local bin candidate is usable', async () => {
    mockAccess.mockReturnValue(undefined)
    const backend = createEgoBackend({ platform: 'darwin' })
    expect((await backend.probe()).status).toBe('ok')
  })

  it('reports missing when no candidate resolves', async () => {
    mockAccess.mockImplementation(() => { throw new Error('ENOENT') })
    const backend = createEgoBackend({ platform: 'darwin' })
    expect((await backend.probe()).status).toBe('missing')
  })

  it('checks the executable bit on darwin', async () => {
    mockAccess.mockReturnValue(undefined)
    const backend = createEgoBackend({ platform: 'darwin' })
    await backend.probe()
    expect(mockAccess).toHaveBeenCalledWith(expect.any(String), 1) // constants.X_OK
  })
})

describe('default connection probe', () => {
  it('runs the real connection probe to ok', async () => {
    mockSpawn.mockReturnValueOnce({ status: 0, stdout: 'EGO_DOCTOR_OK', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('ok')
  })

  it('reports warn when the real connection probe fails', async () => {
    mockSpawn.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'refused' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe throws', async () => {
    mockSpawn.mockImplementationOnce(() => { throw new Error('spawn boom') })
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the connection probe fails with empty stderr', async () => {
    mockSpawn.mockReturnValueOnce({ status: 1, stdout: '', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('reports warn when the probe exits ok without the marker', async () => {
    mockSpawn.mockReturnValueOnce({ status: 0, stdout: 'other', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'darwin', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('warn')
  })

  it('runs the connection probe through the shell on Windows', async () => {
    mockSpawn.mockReturnValue({ status: 0, stdout: 'EGO_DOCTOR_OK', stderr: '' } as never)
    const backend = createEgoBackend({ platform: 'win32', doctorCheck: true, isCommandExecutable: () => true })
    expect((await backend.probe()).status).toBe('ok')
    expect(mockSpawn).toHaveBeenCalledWith(
      'ego-browser',
      ['nodejs', '-e', expect.any(String)],
      expect.objectContaining({ shell: true }),
    )
  })
})
