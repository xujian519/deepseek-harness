/**
 * Tests for the desktop-shell service provider.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import DesktopShell from '../src/index.ts'

const socketPath = join(tmpdir(), `dsh-desktop-shell-test-${process.pid}.sock`)

describe('DesktopShell', () => {
  let server: Server
  let serverSocket: Socket | undefined
  let shells: { shell: DesktopShell; ctx: Context }[] = []
  let lastMethod: string | undefined
  let lastParams: unknown

  beforeEach(async () => {
    lastMethod = undefined
    lastParams = undefined
    serverSocket = undefined
    server = createServer((socket) => {
      serverSocket = socket
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
          const frame = JSON.parse(line) as { id?: number; method: string; params?: unknown }
          lastMethod = frame.method
          lastParams = frame.params
          if ('id' in frame && typeof frame.id === 'number') {
            const params = frame.params as { title?: string } | undefined
            const response = frame.method === 'desktop/showOpenDialog'
              ? params?.title === 'explode'
                ? { jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'boom' } }
                : { jsonrpc: '2.0', id: frame.id, result: { filePaths: ['/selected'] } }
              : frame.method === 'desktop/showSaveDialog'
                ? { jsonrpc: '2.0', id: frame.id, result: { filePath: '/saved.txt' } }
                : { jsonrpc: '2.0', id: frame.id, result: undefined }
            socket.write(JSON.stringify(response) + '\n')
          }
        }
      })
    })
    await new Promise<void>((resolve) => { server.listen(socketPath, resolve) })
    process.env.DSH_DESKTOP_BRIDGE_PATH = socketPath
  })

  afterEach(async () => {
    for (const { ctx } of shells) {
      await ctx.fiber.dispose()
    }
    shells = []
    serverSocket?.end()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err != null) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
    delete process.env.DSH_DESKTOP_BRIDGE_PATH
    try { unlinkSync(socketPath) } catch {}
  })

  it('showOpenDialog returns the selected paths', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    const result = await shell.showOpenDialog({ properties: ['openDirectory'] })
    expect(result).toEqual(['/selected'])
    expect(lastMethod).toBe('desktop/showOpenDialog')
  })

  it('showSaveDialog returns the selected path', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    const result = await shell.showSaveDialog({ defaultPath: '/tmp' })
    expect(result).toBe('/saved.txt')
    expect(lastMethod).toBe('desktop/showSaveDialog')
  })

  it('sendNotification forwards a notification', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 50))
    shell.sendNotification({ title: 'hello', body: 'world' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/sendNotification')
    expect(lastParams).toEqual({ title: 'hello', body: 'world' })
  })

  it('registerMenuItem and its disposer notify the bridge', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 50))
    const disposer = shell.registerMenuItem('file', { id: 'open', label: 'Open' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/registerMenuItem')
    disposer()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/unregisterMenuItem')
  })

  it('registerGlobalShortcut and its disposer notify the bridge', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 50))
    const disposer = shell.registerGlobalShortcut('Cmd+K', () => {})
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/registerGlobalShortcut')
    disposer()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/unregisterGlobalShortcut')
  })

  it('setTray and its disposer notify the bridge', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 50))
    const disposer = shell.setTray({ tooltip: 'DSH' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/setTray')
    disposer()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lastMethod).toBe('desktop/clearTray')
  })

  it('rejects methods when the bridge path is missing', async () => {
    delete process.env.DSH_DESKTOP_BRIDGE_PATH
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await expect(shell.showOpenDialog({})).rejects.toThrow('DSH_DESKTOP_BRIDGE_PATH is not set')
  })

  it('maps a server JSON-RPC error to DesktopError(dialog-failed)', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    await expect(shell.showOpenDialog({ title: 'explode' })).rejects.toMatchObject({
      name: 'DesktopError',
      code: 'dialog-failed',
    })
  })

  it('propagates an aborted signal as AbortError, not a DesktopError', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    const controller = new AbortController()
    controller.abort()
    await expect(shell.showOpenDialog({}, controller.signal)).rejects.toThrow('aborted')
  })

  it('forwards desktop/menu-activated from the bridge to ctx listeners', async () => {
    const ctx = new Context()
    const received: string[] = []
    ctx.on('desktop/menu-activated', ({ menuId }) => { received.push(menuId) })
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    serverSocket?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'desktop/menu-activated', params: { menuId: 'open' } }) + '\n',
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(received).toEqual(['open'])
  })

  it('invokes the registered shortcut handler when triggered', async () => {
    const ctx = new Context()
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    let fired = 0
    shell.registerGlobalShortcut('Cmd+K', () => { fired += 1 })
    serverSocket?.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'desktop/shortcut-triggered', params: { accelerator: 'Cmd+K' } }) + '\n',
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fired).toBe(1)
  })

  it('emits desktop/bridge-lost when the socket closes unexpectedly', async () => {
    const ctx = new Context()
    let lost = 0
    ctx.on('desktop/bridge-lost', () => { lost += 1 })
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    serverSocket?.end()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lost).toBe(1)
  })

  it('does not emit desktop/bridge-lost when the shell is disposed normally', async () => {
    const ctx = new Context()
    let lost = 0
    ctx.on('desktop/bridge-lost', () => { lost += 1 })
    const shell = new DesktopShell(ctx)
    shells.push({ shell, ctx })
    await new Promise(resolve => setTimeout(resolve, 20))
    await ctx.fiber.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(lost).toBe(0)
  })
})
