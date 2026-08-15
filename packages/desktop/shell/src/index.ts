/**
 * Service Provider for `ctx.desktop` inside the packaged Electron shell.
 * It connects to the Electron main process over a local socket and forwards
 * method calls and notifications through a JSON-RPC bridge.
 * @module @deepseek-ai/dsh-desktop-shell
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  Desktop,
  DesktopError,
  type DesktopMenuItem,
  type DesktopNotification,
  type DesktopTrayConfig,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from '@deepseek-ai/dsh-desktop'
import { BridgeClient, type JsonRpcNotification } from './bridge-client.ts'

/**
 * Cordis plugin that registers `ctx.desktop` backed by the Electron main bridge.
 * If `DSH_DESKTOP_BRIDGE_PATH` is absent, the plugin loads but every method
 * rejects with `bridge-disconnected`; this lets tests and headless boots compose
 * the same bundle without Electron.
 */
export default class DesktopShell extends Desktop {
  private readonly bridge?: BridgeClient
  private readonly menuDisposers = new Map<string, () => void>()
  private readonly shortcutDisposers = new Map<string, () => void>()

  constructor(ctx: Context) {
    super(ctx)
    const path = process.env.DSH_DESKTOP_BRIDGE_PATH
    if (path === undefined) {
      ctx.logger.warn('DSH_DESKTOP_BRIDGE_PATH is not set; ctx.desktop is unavailable')
      return
    }
    this.bridge = new BridgeClient({
      path,
      onNotification: (notification) => { this.onBridgeNotification(ctx, notification) },
      onClose: () => { ctx.emit('desktop/bridge-lost') },
    })
    ctx.effect(() => {
      return () => { this.bridge?.dispose() }
    })
  }

  async showOpenDialog(options: OpenDialogOptions): Promise<string[] | undefined> {
    const bridge = this.bridgeOrThrow()
    const result = await bridge.call('desktop/showOpenDialog', options) as { filePaths: string[] } | undefined
    return result?.filePaths
  }

  async showSaveDialog(options: SaveDialogOptions): Promise<string | undefined> {
    const bridge = this.bridgeOrThrow()
    const result = await bridge.call('desktop/showSaveDialog', options) as { filePath: string } | undefined
    return result?.filePath
  }

  sendNotification(notification: DesktopNotification): void {
    const bridge = this.bridgeOrThrow()
    bridge.notify('desktop/sendNotification', notification)
  }

  registerMenuItem(group: string, item: DesktopMenuItem): () => void {
    const bridge = this.bridgeOrThrow()
    const key = `${group}:${item.id}`
    bridge.notify('desktop/registerMenuItem', { group, item })
    const dispose = (): void => {
      this.menuDisposers.delete(key)
      bridge.notify('desktop/unregisterMenuItem', { group, id: item.id })
    }
    this.menuDisposers.set(key, dispose)
    return dispose
  }

  registerGlobalShortcut(accelerator: string, handler: () => void): () => void {
    const bridge = this.bridgeOrThrow()
    bridge.notify('desktop/registerGlobalShortcut', { accelerator })
    const dispose = (): void => {
      this.shortcutDisposers.delete(accelerator)
      bridge.notify('desktop/unregisterGlobalShortcut', { accelerator })
    }
    this.shortcutDisposers.set(accelerator, handler)
    return dispose
  }

  setTray(config: DesktopTrayConfig): () => void {
    const bridge = this.bridgeOrThrow()
    bridge.notify('desktop/setTray', config)
    return (): void => {
      bridge.notify('desktop/clearTray', {})
    }
  }

  private bridgeOrThrow(): BridgeClient {
    if (this.bridge === undefined) {
      throw new DesktopError('bridge-disconnected', 'DSH_DESKTOP_BRIDGE_PATH is not set')
    }
    if (!this.bridge.connected) {
      throw new DesktopError('bridge-disconnected', 'desktop bridge socket is not connected')
    }
    return this.bridge
  }

  private onBridgeNotification(ctx: Context, notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'desktop/menu-activated':
        ctx.emit('desktop/menu-activated', notification.params as { menuId: string })
        return
      case 'desktop/shortcut-triggered': {
        const { accelerator } = notification.params as { accelerator: string }
        ctx.emit('desktop/shortcut-triggered', { accelerator })
        this.shortcutDisposers.get(accelerator)?.()
        return
      }
      case 'desktop/tray-clicked':
        ctx.emit('desktop/tray-clicked', notification.params as { button: 'left' | 'right' })
        return
      case 'desktop/file-dropped':
        ctx.emit('desktop/file-dropped', notification.params as { paths: string[] })
        return
      case 'desktop/notification-clicked':
        ctx.emit('desktop/notification-clicked', notification.params as { notificationId: string })
        return
      default:
        ctx.logger.warn(`unknown desktop bridge notification: ${notification.method}`)
    }
  }
}

export { BridgeClient }
export type { JsonRpcNotification }
