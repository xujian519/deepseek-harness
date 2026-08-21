import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createPlaywrightBackend } from '../src/playwright-backend.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

describe('createPlaywrightBackend', () => {
  it('reports ok when any playwright CLI is present', async () => {
    const backend = createPlaywrightBackend({ isCommandExecutable: cmd => cmd === 'playwright' })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toContain('CLI available')
  })

  it('reports warn with the install hint when no CLI is present', async () => {
    const backend = createPlaywrightBackend({ isCommandExecutable: () => false })
    const probe = await backend.probe()
    expect(probe.status).toBe('warn')
    expect(probe.detail).toContain('CLI not found')
    expect(probe.installHint).toBe('https://playwright.dev/mcp/introduction')
  })

  it('carries the limited capability set', () => {
    const backend = createPlaywrightBackend({ isCommandExecutable: () => false })
    expect(backend.capabilities).toEqual({
      downloadInterception: false,
      screencast: true,
      handoff: false,
      siteTools: false,
      loginState: false,
      antiBot: false,
    })
    expect(backend.id).toBe('playwright')
  })
})

describe('default command check', () => {
  it('reports ok when the real which finds a command', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never)
    expect((await createPlaywrightBackend().probe()).status).toBe('ok')
  })

  it('reports warn when the real which finds nothing', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as never)
    expect((await createPlaywrightBackend().probe()).status).toBe('warn')
  })

  it('tolerates a throwing which', async () => {
    vi.mocked(spawnSync).mockImplementation(() => { throw new Error('boom') })
    expect((await createPlaywrightBackend().probe()).status).toBe('warn')
  })
})
