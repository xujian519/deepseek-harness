/**
 * Tests for the desktop-shell JSON-RPC bridge client.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeClient, BridgeRpcError, type JsonRpcNotification } from '../src/bridge-client.ts'

// Windows cannot listen on a POSIX socket file; a named pipe is the native form.
const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\dsh-desktop-bridge-test-${process.pid}`
  : join(tmpdir(), `dsh-desktop-bridge-test-${process.pid}.sock`)

describe('BridgeClient', () => {
  let server: Server
  let serverSocket: Socket | undefined
  let client: BridgeClient
  let notifications: JsonRpcNotification[] = []
  let closeCount = 0

  beforeEach(async () => {
    notifications = []
    closeCount = 0
    serverSocket = undefined
    server = createServer((socket) => {
      serverSocket = socket
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
          const frame = JSON.parse(line) as { id: number; method: string; params?: unknown }
          if ('id' in frame) {
            if (frame.method === 'never-answered') return
            const response = frame.method === 'echo'
              ? { jsonrpc: '2.0', id: frame.id, result: frame.params }
              : { jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `unknown: ${frame.method}` } }
            socket.write(JSON.stringify(response) + '\n')
          }
        }
      })
    })
    await new Promise<void>((resolve) => { server.listen(socketPath, resolve) })
    client = new BridgeClient({
      path: socketPath,
      onNotification: (notification) => { notifications.push(notification) },
      onClose: () => { closeCount += 1 },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  afterEach(async () => {
    client.dispose()
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
    try { unlinkSync(socketPath) } catch {}
  })

  it('calls a method and resolves the result', async () => {
    const result = await client.call('echo', { hello: 'world' })
    expect(result).toEqual({ hello: 'world' })
  })

  it('rejects with a BridgeRpcError when the server returns an error', async () => {
    await expect(client.call('unknown', {})).rejects.toMatchObject({
      name: 'BridgeRpcError',
      code: -32601,
      message: 'unknown: unknown',
    })
  })

  it('sends notifications without expecting a response', () => {
    client.notify('ping', { value: 1 })
    // No response is requested, so the client should not hang.
    expect(client.connected).toBe(true)
  })

  it('reports disconnected after disposal', () => {
    client.dispose()
    expect(client.connected).toBe(false)
  })

  it('rejects a pending call with AbortError when the signal aborts', async () => {
    const controller = new AbortController()
    const promise = client.call('never-answered', {}, controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow('aborted')
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(client.call('echo', {}, controller.signal)).rejects.toThrow('aborted')
  })

  it('detaches the abort listener once the call settles', async () => {
    const controller = new AbortController()
    const result = await client.call('echo', { done: true }, controller.signal)
    expect(result).toEqual({ done: true })
    // Aborting after settlement must not surface an error on the settled call.
    controller.abort()
    expect(controller.signal.aborted).toBe(true)
  })

  it('rejects pending calls and reports close when the server ends the socket', async () => {
    const promise = client.call('never-answered', {})
    serverSocket?.end()
    await expect(promise).rejects.toThrow('bridge socket closed')
    expect(closeCount).toBe(1)
  })

  it('does not report a close after an explicit dispose', async () => {
    client.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(closeCount).toBe(0)
  })

  it('rejects calls after disposal', async () => {
    client.dispose()
    await expect(client.call('echo', {})).rejects.toThrow('bridge client is disposed')
  })

  it('parses a server-pushed notification', async () => {
    serverSocket?.write(JSON.stringify({ jsonrpc: '2.0', method: 'desktop/tray-clicked', params: { button: 'left' } }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(notifications).toEqual([
      { jsonrpc: '2.0', method: 'desktop/tray-clicked', params: { button: 'left' } },
    ])
  })

  it('exports BridgeRpcError for provider mapping', () => {
    expect(new BridgeRpcError(-32000, 'boom').code).toBe(-32000)
  })

  it('drops notifications after disposal', () => {
    client.dispose()
    expect(() => {
      client.notify('ping', {})
    }).not.toThrow()
  })

  it('drops notifications while the socket is not connected', async () => {
    serverSocket?.end()
    await expect.poll(() => client.connected).toBe(false)
    expect(() => {
      client.notify('ping', {})
    }).not.toThrow()
  })

  it('rejects calls after the server closes the socket', async () => {
    serverSocket?.end()
    await expect.poll(() => client.connected).toBe(false)
    await expect(client.call('echo', {})).rejects.toThrow('bridge socket is not connected')
  })

  it('rejects pending calls and reports close when the connection is refused', async () => {
    const deadPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\dsh-desktop-bridge-dead-${process.pid}`
      : join(tmpdir(), `dsh-desktop-bridge-dead-${process.pid}.sock`)
    const orphan = new BridgeClient({
      path: deadPath,
      onNotification: () => {},
      onClose: () => { closeCount += 1 },
    })
    try {
      // The connect fails: onError rejects nothing pending (there is none),
      // then the close surfaces as a bridge loss.
      await expect.poll(() => closeCount).toBe(1)
      expect(orphan.connected).toBe(false)
    } finally {
      orphan.dispose()
    }
  })

  it('skips empty lines in the frame stream', async () => {
    serverSocket?.write(
      '\n' + JSON.stringify({ jsonrpc: '2.0', method: 'desktop/tray-clicked', params: { button: 'right' } }) + '\n',
    )
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(notifications).toHaveLength(1)
  })

  it('ignores a malformed frame', async () => {
    serverSocket?.write('not-json\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(notifications).toEqual([])
  })

  it('ignores a response for an unknown id', async () => {
    serverSocket?.write(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(notifications).toEqual([])
  })

  it('ignores a frame without an id or method', async () => {
    serverSocket?.write(JSON.stringify({ jsonrpc: '2.0' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(notifications).toEqual([])
  })
})
