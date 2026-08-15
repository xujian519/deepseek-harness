/**
 * Tests for the desktop-shell JSON-RPC bridge client.
 */

import { createServer, type Server, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BridgeClient, type JsonRpcNotification } from '../src/bridge-client.ts'

const socketPath = join(tmpdir(), `dsh-desktop-bridge-test-${process.pid}.sock`)

describe('BridgeClient', () => {
  let server: Server
  let serverSocket: Socket | undefined
  let client: BridgeClient
  let notifications: JsonRpcNotification[] = []

  beforeEach(async () => {
    notifications = []
    serverSocket = undefined
    server = createServer((socket) => {
      serverSocket = socket
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
          const frame = JSON.parse(line) as { id: number; method: string; params?: unknown }
          if ('id' in frame) {
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
      onClose: () => {},
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

  it('rejects when the server returns an error', async () => {
    await expect(client.call('unknown', {})).rejects.toThrow('unknown: unknown')
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
})
