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
            const response = frame.method === 'desktop/showOpenDialog'
              ? { jsonrpc: '2.0', id: frame.id, result: { filePaths: ['/selected'] } }
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
})
