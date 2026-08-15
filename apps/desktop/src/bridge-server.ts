/**
 * JSON-RPC bridge server running in the Electron main process. The dsh backend
 * connects over a local socket and calls OS-level methods here; OS events are
 * pushed back to the backend through the same channel.
 * @module @deepseek-ai/dsh-desktop-electron/bridge-server
 */

import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { type BrowserWindow, dialog } from 'electron'

/** Incoming JSON-RPC request from the backend. */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number
  method: string
  params?: unknown
}

/** Outgoing JSON-RPC response to the backend. */
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

/** Outgoing JSON-RPC notification to the backend. */
export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** Allow-listed bridge methods implemented by the main process. */
const ALLOWED_METHODS = new Set([
  'desktop/showOpenDialog',
  'desktop/showSaveDialog',
  'desktop/sendNotification',
  'desktop/registerMenuItem',
  'desktop/unregisterMenuItem',
  'desktop/registerGlobalShortcut',
  'desktop/unregisterGlobalShortcut',
  'desktop/setTray',
  'desktop/clearTray',
])

/**
 * Resolve a bridge socket path in the app user-data directory.
 * Windows uses a named pipe; POSIX uses a Unix domain socket file.
 * @param userData - Electron app.getPath('userData').
 * @param platform - target platform, defaulting to the current one.
 * @returns the bridge path to pass to the backend as DSH_DESKTOP_BRIDGE_PATH.
 */
export function resolveBridgePath(userData: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? `\\\\?\\pipe\\dsh-desktop-bridge-${process.pid}`
    : join(userData, 'dsh-desktop-bridge.sock')
}

/**
 * Bridge server owned by Electron Main. It creates the socket before the dsh
 * backend is spawned, accepts one backend connection, and dispatches allow-listed
 * JSON-RPC methods to Electron APIs.
 */
export class BridgeServer {
  private server: Server | undefined = undefined
  private socket: Socket | undefined = undefined
  private buffer = ''

  constructor(private readonly window: BrowserWindow) {}

  /**
   * Create the socket server and wait for it to listen.
   * @param path - socket path or pipe name.
   * @returns a promise that resolves once listening.
   */
  async start(path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((socket) => {
        if (this.socket !== undefined) {
          // Reject the extra backend connection. Its errors are expected
          // (e.g. a reset during the FIN exchange) and must not crash Main.
          socket.on('error', () => {})
          socket.end()
          return
        }
        this.socket = socket
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => { this.onData(chunk) })
        socket.on('close', () => { this.socket = undefined })
        socket.on('error', (error) => { console.error('desktop bridge socket error', error) })
      })
      this.server.listen(path, () => { resolve() })
      this.server.on('error', reject)
    })
  }

  /** Close the socket server and any active connection. */
  dispose(): void {
    this.socket?.end()
    this.socket = undefined
    this.server?.close()
    this.server = undefined
  }

  /** Send a one-way notification to the connected backend. */
  notify(notification: JsonRpcNotification): void {
    if (this.socket === undefined) return
    this.socket.write(JSON.stringify(notification) + '\n')
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      this.onFrame(line).catch((error: unknown) => { console.error('desktop bridge frame error', error) })
    }
  }

  private async onFrame(line: string): Promise<void> {
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      // Ignore a malformed frame: the peer is our own backend process, and
      // one bad line must not kill the bridge.
      return
    }
    const id = request.id
    if (typeof id !== 'number') return
    const response = await this.handle(id, request)
    this.socket?.write(JSON.stringify(response) + '\n')
  }

  private async handle(id: number, request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const unknownMethod: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `unknown method: ${request.method}` },
    }
    if (!ALLOWED_METHODS.has(request.method)) return unknownMethod
    try {
      const result = await this.dispatch(request.method, request.params)
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { jsonrpc: '2.0', id, error: { code: -32000, message } }
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'desktop/showOpenDialog':
        return this.showOpenDialog(params)
      case 'desktop/showSaveDialog':
        return this.showSaveDialog(params)
      case 'desktop/sendNotification':
        this.sendNotification(params)
        return undefined
      case 'desktop/registerMenuItem':
      case 'desktop/unregisterMenuItem':
      case 'desktop/registerGlobalShortcut':
      case 'desktop/unregisterGlobalShortcut':
      case 'desktop/setTray':
      case 'desktop/clearTray':
        this.stub(method, params)
        return undefined
    }
    return undefined
  }

  private async showOpenDialog(params: unknown): Promise<{ filePaths: string[] } | undefined> {
    const { title, defaultPath, properties } = (params ?? {}) as { title?: string; defaultPath?: string; properties?: ('openFile' | 'openDirectory' | 'multiSelections')[] }
    const options: Electron.OpenDialogOptions = {}
    if (title !== undefined) options.title = title
    if (defaultPath !== undefined) options.defaultPath = defaultPath
    if (properties !== undefined) options.properties = properties
    const result = await dialog.showOpenDialog(this.window, options)
    if (result.canceled) return undefined
    return { filePaths: result.filePaths }
  }

  private async showSaveDialog(params: unknown): Promise<{ filePath: string } | undefined> {
    const { title, defaultPath } = (params ?? {}) as { title?: string; defaultPath?: string }
    const options: Electron.SaveDialogOptions = {}
    if (title !== undefined) options.title = title
    if (defaultPath !== undefined) options.defaultPath = defaultPath
    const result = await dialog.showSaveDialog(this.window, options)
    if (result.canceled) return undefined
    if (result.filePath === '') return undefined
    return { filePath: result.filePath }
  }

  private sendNotification(params: unknown): void {
    const { title, body } = (params ?? {}) as { title?: string; body?: string }
    console.log(`[notification stub] ${title ?? ''}: ${body ?? ''}`)
  }

  private stub(method: string, params: unknown): undefined {
    console.log(`[desktop bridge stub] ${method}`, params)
    return undefined
  }
}
