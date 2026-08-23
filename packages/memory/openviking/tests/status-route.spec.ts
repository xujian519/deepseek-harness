/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

/* oxlint-disable typescript/prefer-promise-reject-errors -- The degraded-health case is the rejection scenario under test. */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

import { readStatus, registerStatusRoute } from '../src/status-route.ts'
import { OpenVikingClient } from '../src/client.ts'

function mockClient(overrides: { health?: unknown; queue?: unknown } = {}) {
  const client = {
    endpoint: 'http://127.0.0.1:1934',
    health: overrides.health instanceof Error
      ? vi.fn(() => Promise.reject(overrides.health))
      : vi.fn(async () => overrides.health ?? { status: 'ok', version: '0.4.15' }),
    queue: vi.fn(async () => overrides.queue ?? { name: 'queue', is_healthy: true, has_errors: false, status: 'idle' }),
  } as unknown as OpenVikingClient
  return client
}

describe('readStatus', () => {
  it('reports fresh health and queue state', async () => {
    const status = await readStatus(mockClient())
    expect(status).toEqual({
      endpoint: 'http://127.0.0.1:1934',
      healthy: true,
      version: '0.4.15',
      queueHealthy: true,
      queueErrors: false,
    })
  })

  it('degrades to unhealthy when the service errors', async () => {
    const client = mockClient({ health: new Error('down') })
    const status = await readStatus(client)
    expect(status.healthy).toBe(false)
    expect(status.queueErrors).toBe(true)
  })
})

describe('registerStatusRoute', () => {
  it('registers the loopback route when a web server exists', async () => {
    const ctx = new Context()
    const register = vi.fn((_route: unknown) => () => {}) as unknown as ((route: unknown) => () => void) & { mock: { calls: unknown[][] } }
    ctx.provide('webServer', { register } as never)
    registerStatusRoute(ctx, mockClient())
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(register).toHaveBeenCalledTimes(1)
    const route = (register.mock.calls[0]![0] as { path: string; handler(req: unknown, res: unknown): void | Promise<void> })
    expect(route.path).toBe('/openviking/status')
    const res = { writeHead: vi.fn(), end: vi.fn() }
    await route.handler({ method: 'GET' }, res)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'application/json' })
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('healthy'))
  })

  it('rejects non-GET requests with 405', async () => {
    const ctx = new Context()
    const register = vi.fn(() => () => {})
    ctx.provide('webServer', { register } as never)
    registerStatusRoute(ctx, mockClient())
    await new Promise(resolve => setTimeout(resolve, 10))
    const calls = (register as never as { mock: { calls: Array<[unknown]> } }).mock.calls
    const route = calls[0]![0] as { handler(req: unknown, res: unknown): void | Promise<void> }
    const res = { writeHead: vi.fn(), end: vi.fn() }
    await route.handler({ method: 'POST' }, res)
    expect(res.writeHead).toHaveBeenCalledWith(405)
  })

  it('does nothing without a web server', async () => {
    const ctx = new Context()
    registerStatusRoute(ctx, mockClient())
    await new Promise(resolve => setTimeout(resolve, 10))
  })
})
