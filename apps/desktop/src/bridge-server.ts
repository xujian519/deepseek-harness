/**
 * JSON-RPC bridge server running in the Electron main process. The dsh backend
 * connects over a local socket and calls OS-level methods here; OS events are
 * pushed back to the backend through the same channel.
 * @module @deepseek-ai/dsh-desktop-electron/bridge-server
 */

import { connect, createServer, type Server, type Socket } from 'node:net'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BrowserWindow,
  dialog, globalShortcut, Menu, nativeImage, Notification, Tray,
} from 'electron'
import { isTemplateTrayIcon, trayIconPath } from './tray.ts'

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
interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** One registered menu item as it travels over the wire. */
export interface WireMenuItem {
  id: string
  label: string
  accelerator?: string
}

/** Base tray entries supplied by the shell owner (main.ts). */
export interface TrayBaseActions {
  /** Restore and focus the main window. */
  onShow: () => void
  /** Begin an explicit quit. */
  onQuit: () => void
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

/** The default tray menu group, overridable through {@link DesktopTrayConfig.menuGroup}. */
const DEFAULT_TRAY_GROUP = 'tray'

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
 * JSON-RPC methods to Electron APIs. Menu, tray, shortcut, and notification
 * state all live here so backend registrations and OS events share one model.
 */
export class BridgeServer {
  private server: Server | undefined = undefined
  private socket: Socket | undefined = undefined
  private buffer = ''
  private readonly menuGroups = new Map<string, Map<string, WireMenuItem>>()
  private tray: Tray | undefined = undefined
  private trayBaseActions: TrayBaseActions | undefined = undefined
  private trayMenuGroup = DEFAULT_TRAY_GROUP
  private readonly notifications = new Map<string, Notification>()
  private notificationSeq = 0

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
      let staleRetried = false
      this.server.on('error', (error) => {
        // A POSIX socket file survives its listener: a crashed or killed app
        // leaves `path` behind, and a fresh bind then fails with EADDRINUSE
        // even though nothing listens. Probe the path — a live listener keeps
        // the error; a dead file is unlinked and the bind retried once.
        if (error instanceof Error && 'code' in error && error.code === 'EADDRINUSE' && path.startsWith('/') && !staleRetried) {
          staleRetried = true
          const probe = connect(path)
          probe.once('connect', () => {
            probe.destroy()
            reject(error)
          })
          probe.once('error', () => {
            probe.destroy()
            rmSync(path, { force: true })
            this.server?.listen(path)
          })
          return
        }
        reject(error)
      })
      this.server.listen(path, () => { resolve() })
    })
  }

  /**
   * Create the base tray: icon, Show/Quit entries, and click notifications.
   * Registered items in the configured tray menu group join the context menu.
   * @param appPath - `app.getAppPath()`: the app root in dev, `app.asar` when packaged.
   * @param actions - the base menu entries owned by the shell.
   * @returns the created tray, or undefined when the platform cannot host one.
   */
  initTray(appPath: string, actions: TrayBaseActions): Tray | undefined {
    try {
      const icon = nativeImage.createFromPath(trayIconPath(appPath, process.platform))
      if (isTemplateTrayIcon(process.platform)) icon.setTemplateImage(true)
      const tray = new Tray(icon)
      tray.setToolTip('DeepSeek Harness')
      tray.on('click', () => {
        this.notify('desktop/tray-clicked', { button: 'left' })
      })
      tray.on('right-click', () => {
        this.notify('desktop/tray-clicked', { button: 'right' })
      })
      this.tray = tray
      this.trayBaseActions = actions
      this.rebuildTrayMenu()
      return tray
    } catch (error) {
      console.warn(`System tray is unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** Close the socket server, any active connection, and every OS registration. */
  dispose(): void {
    this.socket?.end()
    this.socket = undefined
    this.server?.close()
    this.server = undefined
    globalShortcut.unregisterAll()
    this.tray?.destroy()
    this.tray = undefined
    this.trayBaseActions = undefined
    this.notifications.clear()
  }

  /** Send a one-way notification to the connected backend. */
  notify(method: string, params?: unknown): void {
    if (this.socket === undefined) return
    const notification: JsonRpcNotification = { jsonrpc: '2.0', method, params }
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
        return this.sendNotification(params)
      case 'desktop/registerMenuItem':
        this.registerMenuItem(params)
        return { ok: true }
      case 'desktop/unregisterMenuItem':
        this.unregisterMenuItem(params)
        return { ok: true }
      case 'desktop/registerGlobalShortcut':
        return this.registerGlobalShortcut(params)
      case 'desktop/unregisterGlobalShortcut':
        this.unregisterGlobalShortcut(params)
        return { ok: true }
      case 'desktop/setTray':
        this.setTray(params)
        return { ok: true }
      case 'desktop/clearTray':
        this.clearTray()
        return { ok: true }
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

  private sendNotification(params: unknown): { delivered: boolean; notificationId?: string } {
    const { title, body, id } = (params ?? {}) as { title: string; body?: string; id?: string }
    if (!Notification.isSupported()) return { delivered: false }
    const notificationId = id ?? `notification-${++this.notificationSeq}`
    const notification = new Notification({
      title,
      ...body !== undefined ? { body } : {},
    })
    notification.on('click', () => {
      this.notifications.delete(notificationId)
      this.notify('desktop/notification-clicked', { notificationId })
    })
    notification.on('close', () => {
      this.notifications.delete(notificationId)
    })
    // Electron drops an unreferenced Notification; keep it until it closes.
    this.notifications.set(notificationId, notification)
    notification.show()
    return { delivered: true, notificationId }
  }

  private registerMenuItem(params: unknown): void {
    const { group, item } = (params ?? {}) as { group: string; item: WireMenuItem }
    let items = this.menuGroups.get(group)
    if (items === undefined) {
      items = new Map()
      this.menuGroups.set(group, items)
    }
    items.set(item.id, item)
    this.rebuildAppMenu()
    this.rebuildTrayMenu()
  }

  private unregisterMenuItem(params: unknown): void {
    const { group, id } = (params ?? {}) as { group: string; id: string }
    this.menuGroups.get(group)?.delete(id)
    this.rebuildAppMenu()
    this.rebuildTrayMenu()
  }

  private registerGlobalShortcut(params: unknown): { ok: true } {
    const { accelerator } = (params ?? {}) as { accelerator: string }
    const registered = globalShortcut.register(accelerator, () => {
      this.notify('desktop/shortcut-triggered', { accelerator })
    })
    if (!registered) throw new Error(`accelerator ${accelerator} is already registered or unavailable`)
    return { ok: true }
  }

  private unregisterGlobalShortcut(params: unknown): void {
    const { accelerator } = (params ?? {}) as { accelerator: string }
    globalShortcut.unregister(accelerator)
  }

  private setTray(params: unknown): void {
    const { tooltip, menuGroup } = (params ?? {}) as { tooltip?: string; menuGroup?: string }
    if (this.tray === undefined) throw new Error('tray is unavailable')
    if (tooltip !== undefined) this.tray.setToolTip(tooltip)
    this.trayMenuGroup = menuGroup ?? DEFAULT_TRAY_GROUP
    this.rebuildTrayMenu()
  }

  private clearTray(): void {
    if (this.tray === undefined) return
    this.tray.setToolTip('DeepSeek Harness')
    this.trayMenuGroup = DEFAULT_TRAY_GROUP
    this.rebuildTrayMenu()
  }

  /** One registered item as an Electron menu template entry. */
  private menuItemTemplate(item: WireMenuItem): Electron.MenuItemConstructorOptions {
    return {
      label: item.label,
      ...item.accelerator !== undefined ? { accelerator: item.accelerator } : {},
      click: () => { this.notify('desktop/menu-activated', { menuId: item.id }) },
    }
  }

  /** Rebuild the application menu: standard roles plus one top-level menu per registered group. */
  private rebuildAppMenu(): void {
    const groups = [...this.menuGroups.entries()].filter(([group]) => group !== this.trayMenuGroup)
    if (groups.length === 0) return // no registered groups: the default menu stands
    const template: Electron.MenuItemConstructorOptions[] = [
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      ...groups.map(([group, items]) => ({
        label: group,
        submenu: [...items.values()].map(item => this.menuItemTemplate(item)),
      })),
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  /** Rebuild the tray context menu: base entries plus the configured tray group. */
  private rebuildTrayMenu(): void {
    const tray = this.tray
    const actions = this.trayBaseActions
    if (tray === undefined || actions === undefined) return
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Show DeepSeek Harness', click: actions.onShow },
      { type: 'separator' },
      { label: 'Quit DeepSeek Harness', click: actions.onQuit },
    ]
    const groupItems = this.menuGroups.get(this.trayMenuGroup)
    if (groupItems !== undefined && groupItems.size > 0) {
      template.push({ type: 'separator' })
      for (const item of groupItems.values()) template.push(this.menuItemTemplate(item))
    }
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }
}
