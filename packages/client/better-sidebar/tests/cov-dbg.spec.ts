/** Temporary debug repro of the full WS replay flow. */
import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { WebSocket } from 'ws'
import { apply } from '../src/index.ts'
import { SIDEBAR_PREFS_NS } from '../src/config.ts'
import type { SidebarWebUpgradeRoute } from '../src/context-types.ts'

describe('dbg full ws flow', () => {
  it('replays after reconnect', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dbg-ws-'))
    const upgrades: SidebarWebUpgradeRoute[] = []
    const settings = {
      register: () => ({
        get: () => ({ agentTerminalTools: false, agentOpenTools: false }),
        watch: () => () => {},
        update: async () => {},
        replace: async () => {},
      }),
      describe: () => [{ ns: SIDEBAR_PREFS_NS, value: { tabsEnabled: {}, viewersEnabled: {} }, applies: 'live' as const, revision: 0 }],
      update: async () => {},
    }
    const ctx = {
      webRuntime: { trustedHosts: [] },
      webServer: {
        register: () => () => {},
        registerUpgrade: (route: SidebarWebUpgradeRoute) => { upgrades.push(route); return () => {} },
      },
      sessions: { get: () => ({ header: { cwd: workspace } }) },
      tools: { register: () => () => {} },
      effect: (fn: () => unknown) => { fn() },
      inject: (deps: readonly string[], cb: (sctx: { settings: unknown }) => void) => {
        if (deps.includes('settings')) cb({ settings })
        return () => {}
      },
      get: () => undefined,
      on: () => () => {},
    }
    apply(ctx as never, { reconnectGraceMs: 30_000 })
    const server: Server = createServer()
    server.on('upgrade', (req, socket, head) => {
      const route = upgrades.find(candidate => (req.url ?? '/').startsWith(candidate.path))
      if (route === undefined) { socket.destroy(); return }
      void route.handler(req as never, socket, head)
    })
    server.listen(0)
    const base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
    const url = `${base}/sidebar/ws/terminal?sessionId=pump&tab=t1`

    const drain = (ws: WebSocket): { seen: string[] } => {
      const seen: string[] = []
      ws.on('message', (d: Buffer) => seen.push(d.toString('utf8')))
      return { seen }
    }
    const first = await new Promise<WebSocket>((res, rej) => {
      const ws = new WebSocket(url)
      ws.once('open', () =>{  res(ws) })
      ws.once('error', rej)
    })
    const d1 = drain(first)
    first.send('echo marker-abc\r')
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !d1.seen.some(t => t.includes('marker-abc'))) {
      await new Promise(r => setTimeout(r, 50))
    }
    console.log('first saw marker:', d1.seen.some(t => t.includes('marker-abc')), 'frames:', d1.seen.length)
    first.close()
    await new Promise((resolve) => { first.once('close', resolve) })
    await new Promise(r => setTimeout(r, 100))

    const second = await new Promise<WebSocket>((res, rej) => {
      const ws = new WebSocket(url)
      ws.once('open', () =>{  res(ws) })
      ws.once('error', rej)
    })
    const d2 = drain(second)
    await new Promise(r => setTimeout(r, 500))
    const idx = d2.seen.findIndex(t => t.includes('marker-abc'))
    console.log('replay frames:', JSON.stringify(d2.seen.map(t => t.length)))
    console.log('marker frame index:', idx)
    if (idx >= 0) console.log('marker frame content:', JSON.stringify(d2.seen[idx]!.slice(0, 300)))
    second.close()
    server.close()
    server.closeAllConnections()
    expect(d2.seen.some(t => t.includes('marker-abc'))).toBe(true)
  })
})
import { join } from 'node:path'
