/**
 * Tests for the Electron Main JSON-RPC bridge server: socket lifecycle,
 * method allow-listing, and startup failure all run without an Electron host.
 */

import { connect, createServer, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeServer, resolveBridgePath } from '../src/bridge-server.ts'

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: '' }),
  },
}))

const window = {} as BrowserWindow
// Windows cannot listen on a POSIX socket file; a named pipe is the native form.
const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\dsh-desktop-bridge-server-test-${process.pid}`
  : join(tmpdir(), `dsh-desktop-bridge-server-test-${process.pid}.sock`)

describe('resolveBridgePath', () => {
  it('resolves a POSIX socket file under userData', () => {
    expect(resolveBridgePath('/user', 'darwin')).toBe(join('/user', 'dsh-desktop-bridge.sock'))
    expect(resolveBridgePath('/user', 'linux')).toBe(join('/user', 'dsh-desktop-bridge.sock'))
  })

  it('resolves a Windows named pipe carrying the pid', () => {
    expect(resolveBridgePath('/user', 'win32')).toBe(`\\\\?\\pipe\\dsh-desktop-bridge-${process.pid}`)
  })
})

describe('BridgeServer', () => {
  let bridge: BridgeServer
  let client: Socket | undefined
  let frames: string[] = []

  beforeEach(async () => {
    frames = []
    bridge = new BridgeServer(window)
    await bridge.start(socketPath)
    client = connect(socketPath)
    client.setEncoding('utf8')
    client.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) frames.push(line)
    })
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  afterEach(async () => {
    client?.end()
    bridge.dispose()
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    try { unlinkSync(socketPath) } catch {}
  })

  it('rejects an unknown method with a JSON-RPC error', async () => {
    client?.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'desktop/unknown' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const frame = JSON.parse(frames[0] ?? '{}') as { error?: { code: number } }
    expect(frame.error?.code).toBe(-32601)
  })

  it('rejects a frame without an id', async () => {
    client?.write(JSON.stringify({ jsonrpc: '2.0', method: 'desktop/showOpenDialog' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(frames).toEqual([])
  })

  it('rejects a second connection while one backend is attached', async () => {
    const second = connect(socketPath)
    const closed = new Promise<void>((resolve) => { second.on('close', () => { resolve() }) })
    await closed
    expect(second.destroyed).toBe(true)
  })

  it('rejects start when the socket path is already taken', async () => {
    bridge.dispose()
    await new Promise(resolve => setTimeout(resolve, 50))
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.on('error', reject)
      blocker.listen(socketPath, resolve)
    })
    const other = new BridgeServer(window)
    await expect(other.start(socketPath)).rejects.toThrow()
    other.dispose()
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => {
        if (error != null) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  })

  it('disposes without failing when never started', () => {
    const fresh = new BridgeServer(window)
    fresh.dispose()
  })
})
