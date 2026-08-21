import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { BROWSEROS_NEO_DEFAULT_URL, createBrowserOsNeoBackend } from '../src/browseros-neo-backend.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))

const okFetch = async () => ({ status: 200 } as Response)
const notFoundFetch = async () => ({ status: 404 } as Response)
const throwingFetch = async () => { throw new Error('ECONNREFUSED') }

describe('createBrowserOsNeoBackend', () => {
  it('reports ok when the MCP endpoint responds with the port owner', async () => {
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, portOwner: () => 'BrowserOS(1234)' })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toContain('responded HTTP 200')
    expect(probe.detail).toContain('listening BrowserOS(1234)')
  })

  it('reports ok without owner when the ownership probe is empty', async () => {
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, portOwner: () => undefined })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).not.toContain('listening')
  })

  it('reports warn on HTTP 404 (foreign service on the port)', async () => {
    const backend = createBrowserOsNeoBackend({ fetchImpl: notFoundFetch, portOwner: () => undefined })
    const probe = await backend.probe()
    expect(probe.status).toBe('warn')
    expect(probe.detail).toContain('likely not BrowserOS neo')
  })

  it('reports missing when the endpoint is unreachable', async () => {
    const backend = createBrowserOsNeoBackend({ fetchImpl: throwingFetch, portOwner: () => undefined })
    const probe = await backend.probe()
    expect(probe.status).toBe('missing')
    expect(probe.detail).toContain('not reachable')
    expect(probe.installHint).toBe('https://browseros.com/agents')
  })

  it('uses the explicit url option over the default', async () => {
    const fetchImpl = vi.fn(okFetch)
    const backend = createBrowserOsNeoBackend({ url: 'http://127.0.0.1:9999/mcp', fetchImpl, portOwner: () => undefined })
    await backend.probe()
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:9999/mcp', expect.anything())
  })

  it('defaults the port to 80 for a URL without an explicit port', async () => {
    const portOwner = vi.fn(() => undefined)
    const backend = createBrowserOsNeoBackend({ url: 'http://localhost/mcp', fetchImpl: okFetch, portOwner })
    await backend.probe()
    expect(portOwner).toHaveBeenCalledWith('80')
  })

  it('falls back to DSH_BROWSEROS_MCP_URL then the default endpoint', async () => {
    const fetchImpl = vi.fn(okFetch)
    const backend = createBrowserOsNeoBackend({ fetchImpl, portOwner: () => undefined })
    const env = process.env.DSH_BROWSEROS_MCP_URL
    process.env.DSH_BROWSEROS_MCP_URL = 'http://127.0.0.1:7777/mcp'
    try {
      await backend.probe()
      expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7777/mcp', expect.anything())
    } finally {
      if (env === undefined) delete process.env.DSH_BROWSEROS_MCP_URL
      else process.env.DSH_BROWSEROS_MCP_URL = env
    }
    expect(BROWSEROS_NEO_DEFAULT_URL).toBe('http://127.0.0.1:9010/mcp')
  })

  it('falls back to the global fetch when no fetchImpl is injected', async () => {
    const globalFetch = globalThis.fetch
    try {
      globalThis.fetch = okFetch
      const backend = createBrowserOsNeoBackend({ portOwner: () => undefined })
      const probe = await backend.probe()
      expect(probe.status).toBe('ok')
    } finally {
      globalThis.fetch = globalFetch
    }
  })

  it('reports ok when the endpoint status is absent', async () => {
    const backend = createBrowserOsNeoBackend({
      fetchImpl: async () => ({}) as Response,
      portOwner: () => undefined,
    })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
    expect(probe.detail).toContain('responded HTTP ?')
  })

  it('carries the superset capability set', () => {
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch })
    expect(backend.capabilities).toEqual({
      downloadInterception: true,
      screencast: true,
      handoff: false,
      siteTools: false,
      loginState: true,
      antiBot: true,
    })
  })
})

describe('default port-owner probe', () => {
  it('parses lsof output on macOS/linux', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'COMMAND  PID  USER  FD  TYPE  DEVICE  SIZE/OFF  NODE  NAME\nBrowserOS  1234  me  3u  IPv4  0x0  0t0  TCP  127.0.0.1:9010 (LISTEN)',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).toContain('listening BrowserOS(1234)')
  })

  it('returns the bare pid when lsof has an empty COMMAND column', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'COMMAND  PID  USER\n  1234  me',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).toContain('listening 1234')
  })

  it('returns undefined when lsof output is empty', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).not.toContain('listening')
  })

  it('returns undefined when lsof output lacks the PID column', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'COMMAND  NAME\nBrowserOS  x',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).not.toContain('listening')
  })

  it('parses netstat output on win32', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '  TCP    127.0.0.1:9010    0.0.0.0:0    LISTENING    4321',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'win32' })
    const probe = await backend.probe()
    expect(probe.detail).toContain('listening 4321')
  })

  it('returns undefined when netstat has no matching LISTENING line', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '  TCP    127.0.0.1:9999    0.0.0.0:0    LISTENING    4321',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'win32' })
    const probe = await backend.probe()
    expect(probe.detail).not.toContain('listening')
  })

  it('returns undefined when the netstat line ends with pid 0', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: '  TCP    127.0.0.1:9010    0.0.0.0:0    LISTENING    0',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'win32' })
    const probe = await backend.probe()
    expect(probe.detail).not.toContain('listening')
  })

  it('falls back to the header token when lsof lacks the COMMAND column', async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0,
      stdout: 'PID  USER\n1234  me',
      stderr: '',
    } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).toContain('listening PID')
  })

  it('returns undefined when lsof has no stdout', async () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: undefined, stderr: undefined } as never)
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.detail).not.toContain('listening')
  })

  it('tolerates a throwing spawnSync', async () => {
    vi.mocked(spawnSync).mockImplementation(() => { throw new Error('boom') })
    const backend = createBrowserOsNeoBackend({ fetchImpl: okFetch, platform: 'darwin' })
    const probe = await backend.probe()
    expect(probe.status).toBe('ok')
  })
})
