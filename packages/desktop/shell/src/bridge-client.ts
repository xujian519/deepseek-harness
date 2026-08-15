/**
 * JSON-RPC 2.0 client over a local Unix domain socket / Windows named pipe.
 * The desktop shell provider uses this to reach the Electron main process.
 * @module @deepseek-ai/dsh-desktop-shell/bridge-client
 */

import { createConnection, type Socket } from 'node:net'

/** Outgoing JSON-RPC request. */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

/** Incoming JSON-RPC response. */
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/** Incoming JSON-RPC notification (server push). */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** Lifecycle callbacks for the bridge client. */
export interface BridgeClientOptions {
  /** Local socket path (Unix) or pipe name (Windows). */
  path: string
  /** A server-pushed notification arrived. */
  onNotification: (notification: JsonRpcNotification) => void
  /** The socket closed. */
  onClose: () => void
}

/** One pending request keyed by JSON-RPC id. */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

/**
 * Line-delimited JSON-RPC client. Methods return promises; notifications are
 * forwarded through {@link BridgeClientOptions.onNotification}.
 */
export class BridgeClient {
  private readonly socket: Socket
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private buffer = ''
  private disposed = false

  constructor(private readonly options: BridgeClientOptions) {
    this.socket = createConnection(options.path)
    this.socket.setEncoding('utf8')
    this.socket.on('data', (chunk: string) => { this.onData(chunk) })
    this.socket.on('close', () => { this.onClose() })
    this.socket.on('error', (error) => { this.onError(error) })
  }

  /** True if the socket is currently connected. */
  get connected(): boolean {
    return this.socket.readyState === 'open'
  }

  /**
   * Call a method on the Electron main bridge and await its result.
   * @param method - JSON-RPC method name.
   * @param params - method parameters.
   * @returns the method result.
   * @throws {Error} when the socket is closed or the server returns an error.
   */
  call(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('bridge client is disposed'))
    if (!this.connected) return Promise.reject(new Error('bridge socket is not connected'))
    const id = this.nextId++
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.write(JSON.stringify(request) + '\n')
    })
  }

  /**
   * Send a one-way notification to the Electron main bridge.
   * @param method - JSON-RPC method name.
   * @param params - notification parameters.
   */
  notify(method: string, params?: unknown): void {
    if (this.disposed) return
    if (!this.connected) return
    const notification = { jsonrpc: '2.0', method, params }
    this.socket.write(JSON.stringify(notification) + '\n')
  }

  /** Close the bridge socket and reject any pending requests. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const pending of this.pending.values()) {
      pending.reject(new Error('bridge client disposed'))
    }
    this.pending.clear()
    this.socket.end()
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      this.onFrame(line)
    }
  }

  private onFrame(line: string): void {
    let frame: JsonRpcResponse | JsonRpcNotification
    try {
      frame = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification
    } catch {
      return
    }
    if ('id' in frame && typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id)
      if (pending === undefined) return
      this.pending.delete(frame.id)
      if (frame.error !== undefined) {
        pending.reject(new Error(frame.error.message))
      } else {
        pending.resolve(frame.result)
      }
    } else if ('method' in frame) {
      this.options.onNotification(frame)
    }
  }

  private onClose(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error('bridge socket closed'))
    }
    this.pending.clear()
    this.options.onClose()
  }

  private onError(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}
