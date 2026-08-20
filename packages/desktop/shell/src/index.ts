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
import { BridgeClient, BridgeRpcError, type JsonRpcNotification } from './bridge-client.ts'

/**
 * Cordis plugin that registers `ctx.desktop` backed by the Electron main bridge.
 * If `DSH_DESKTOP_BRIDGE_PATH` is absent, the plugin loads but every method
 * rejects with `bridge-disconnected`; this lets tests and headless boots compose
 * the same bundle without Electron.
 */
export default class DesktopShell extends Desktop {
  private bridge?: BridgeClient
  /** Live menu registrations keyed by `${group}:${id}`, replayed after a bridge reconnect. */
  private readonly menuRegistrations = new Map<string, { group: string; item: DesktopMenuItem }>()
  /** Live shortcut registrations keyed by accelerator, replayed after a bridge reconnect. */
  private readonly shortcutRegistrations = new Map<string, { accelerator: string; handler: () => void }>()
  /** The live tray configuration, replayed after a bridge reconnect. */
  private trayRegistration: { config: DesktopTrayConfig; disposer: () => void } | undefined

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
      onReconnect: () => { void this.replayRegistrations(ctx) },
    })
    ctx.effect(() => {
      return () => { this.bridge?.dispose() }
    })
  }

  async showOpenDialog(options: OpenDialogOptions, signal?: AbortSignal): Promise<string[] | undefined> {
    const result = await this.callBridge('desktop/showOpenDialog', options, signal) as { filePaths: string[] } | undefined
    return result?.filePaths
  }

  async showSaveDialog(options: SaveDialogOptions, signal?: AbortSignal): Promise<string | undefined> {
    const result = await this.callBridge('desktop/showSaveDialog', options, signal) as { filePath: string } | undefined
    return result?.filePath
  }

  sendNotification(notification: DesktopNotification): void {
    const bridge = this.bridgeOrThrow()
    bridge.notify('desktop/sendNotification', notification)
  }

  async registerMenuItem(group: string, item: DesktopMenuItem): Promise<() => void> {
    const bridge = this.bridgeOrThrow()
    const key = `${group}:${item.id}`
    await bridge.call('desktop/registerMenuItem', { group, item })
    this.menuRegistrations.set(key, { group, item })
    return (): void => {
      this.menuRegistrations.delete(key)
      const current = this.bridge
      if (current !== undefined) current.notify('desktop/unregisterMenuItem', { group, id: item.id })
    }
  }

  async registerGlobalShortcut(accelerator: string, handler: () => void): Promise<() => void> {
    const bridge = this.bridgeOrThrow()
    await bridge.call('desktop/registerGlobalShortcut', { accelerator })
    this.shortcutRegistrations.set(accelerator, { accelerator, handler })
    return (): void => {
      this.shortcutRegistrations.delete(accelerator)
      const current = this.bridge
      if (current !== undefined) current.notify('desktop/unregisterGlobalShortcut', { accelerator })
    }
  }

  async setTray(config: DesktopTrayConfig): Promise<() => void> {
    const bridge = this.bridgeOrThrow()
    await bridge.call('desktop/setTray', config)
    const disposer = (): void => {
      if (this.trayRegistration?.disposer === disposer) this.trayRegistration = undefined
      const current = this.bridge
      if (current !== undefined) current.notify('desktop/clearTray', {})
    }
    this.trayRegistration = { config, disposer }
    return disposer
  }

  /** Re-establish every live registration after the bridge socket reconnects. */
  private async replayRegistrations(ctx: Context): Promise<void> {
    try {
      for (const { group, item } of this.menuRegistrations.values()) {
        await this.bridge?.call('desktop/registerMenuItem', { group, item })
      }
      for (const { accelerator } of this.shortcutRegistrations.values()) {
        await this.bridge?.call('desktop/registerGlobalShortcut', { accelerator })
      }
      const tray = this.trayRegistration
      if (tray !== undefined) await this.bridge?.call('desktop/setTray', tray.config)
    } catch (error) {
      ctx.logger.warn(`desktop bridge reconnect replay failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async callBridge<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const bridge = this.bridgeOrThrow()
    try {
      return await bridge.call(method, params, signal) as T
    } catch (error) {
      if (error instanceof DesktopError) throw error
      if (error instanceof BridgeRpcError) throw new DesktopError('dialog-failed', error.message)
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new DesktopError('bridge-disconnected', error instanceof Error ? error.message : String(error))
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
        this.shortcutRegistrations.get(accelerator)?.handler()
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
