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

/** The JSON-RPC server returned an error response. */
export class BridgeRpcError extends Error {
  /**
   * @param code - JSON-RPC error code from the server.
   * @param message - server-supplied error description.
   */
  constructor(readonly code: number, message: string) {
    super(message)
    this.name = 'BridgeRpcError'
  }
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
  /** Caller signal the pending call waits on, when one was passed. */
  signal?: AbortSignal
  /** Abort listener bound to `signal`; removed when the request settles. */
  onAbort?: () => void
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
   * @param signal - caller lifetime; abort rejects the pending call and
   * discards any later server response.
   * @returns the method result.
   * @throws {BridgeRpcError} when the server returns a JSON-RPC error.
   * @throws {Error} when the socket is closed or disposed.
   * @throws {DOMException} `AbortError` when `signal` aborts.
   */
  call(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error('bridge client is disposed'))
    if (!this.connected) return Promise.reject(new Error('bridge socket is not connected'))
    const id = this.nextId++
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('aborted', 'AbortError'))
        return
      }
      const pending: PendingRequest = { resolve, reject }
      if (signal !== undefined) {
        const onAbort = (): void => {
          this.pending.delete(id)
          reject(new DOMException('aborted', 'AbortError'))
        }
        pending.signal = signal
        pending.onAbort = onAbort
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.set(id, pending)
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
    this.rejectAllPending(new Error('bridge client disposed'))
    this.socket.end()
  }

  private settle(id: number, pending: PendingRequest, error: Error | null, result?: unknown): void {
    this.pending.delete(id)
    if (pending.signal !== undefined && pending.onAbort !== undefined) {
      pending.signal.removeEventListener('abort', pending.onAbort)
    }
    if (error === null) {
      pending.resolve(result)
    } else {
      pending.reject(error)
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.settle(id, pending, error)
    }
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
      // Ignore a malformed frame: the peer is our own Main process, and one
      // bad line must not kill the bridge.
      return
    }
    if ('id' in frame && typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id)
      if (pending === undefined) return
      if (frame.error !== undefined) {
        this.settle(frame.id, pending, new BridgeRpcError(frame.error.code, frame.error.message))
      } else {
        this.settle(frame.id, pending, null, frame.result)
      }
    } else if ('method' in frame) {
      this.options.onNotification(frame)
    }
  }

  private onClose(): void {
    // Dispose closes the socket itself; that close must not surface as a
    // bridge loss to listeners.
    if (this.disposed) return
    this.rejectAllPending(new Error('bridge socket closed'))
    this.options.onClose()
  }

  private onError(error: Error): void {
    this.rejectAllPending(error)
  }
}
