/**
 * Service Definition for the `ctx.desktop` capability seam: OS-level desktop
 * integration exposed to the dsh backend through the Electron main process.
 * The renderer does not use this seam directly; it receives model-visible facts
 * through the normal backend event stream.
 * @module @deepseek-ai/dsh-desktop
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'

/** Options for a native open-file or open-directory dialog. */
export interface OpenDialogOptions {
  /** Dialog window title. */
  title?: string
  /** Pre-selected path or directory. */
  defaultPath?: string
  /** Which selection modes are allowed. */
  properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
}

/** Options for a native save-file dialog. */
export interface SaveDialogOptions {
  /** Dialog window title. */
  title?: string
  /** Pre-selected path or directory. */
  defaultPath?: string
}

/** A system notification posted by the host. */
export interface DesktopNotification {
  /** Notification title. */
  title: string
  /** Notification body text. */
  body?: string
  /** Stable identifier echoed back in `desktop/notification-clicked`; the provider mints one when absent. */
  id?: string
}

/** One dynamic application-menu entry registered by a backend plugin. */
export interface DesktopMenuItem {
  /** Stable identifier returned in `desktop/menu-activated`. */
  id: string
  /** Display label. */
  label: string
  /** Optional keyboard shortcut (Electron accelerator syntax). */
  accelerator?: string
}

/** Configuration for the host tray icon. */
export interface DesktopTrayConfig {
  /** Tooltip text. */
  tooltip?: string
  /**
   * Menu group whose registered items populate the tray context menu, on top
   * of the shell's own Show/Quit entries (default `'tray'`).
   */
  menuGroup?: string
}

/** Closed failure vocabulary for desktop operations. */
export type DesktopErrorCode = 'bridge-disconnected' | 'dialog-cancelled' | 'dialog-failed'

/** Typed failure thrown by desktop providers so callers can map business codes. */
export class DesktopError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DesktopErrorCode, message: string) {
    super(message)
    this.name = 'DesktopError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Desktop OS-integration service. */
    desktop: Desktop
  }

  interface Events {
    /**
     * A registered menu item was activated.
     * @mode emit
     * @param payload - event payload.
     */
    'desktop/menu-activated'(payload: { menuId: string }): void
    /**
     * A registered global shortcut was pressed.
     * @mode emit
     * @param payload - event payload.
     */
    'desktop/shortcut-triggered'(payload: { accelerator: string }): void
    /**
     * The tray icon was clicked.
     * @mode emit
     * @param payload - event payload.
     */
    'desktop/tray-clicked'(payload: { button: 'left' | 'right' }): void
    /**
     * Files were dropped on the renderer window.
     * @mode emit
     * @param payload - event payload.
     */
    'desktop/file-dropped'(payload: { paths: string[] }): void
    /**
     * A notification was clicked.
     * @mode emit
     * @param payload - event payload.
     */
    'desktop/notification-clicked'(payload: { notificationId: string }): void
    /**
     * The bridge to Electron Main was lost.
     * @mode emit
     */
    'desktop/bridge-lost'(): void
  }
}

/**
 * Abstract desktop-integration service. Subclass, implement the methods, and
 * load the subclass as a plugin — it registers as `ctx.desktop`.
 */
export abstract class Desktop extends Service {
  constructor(ctx: Context) {
    super(ctx, 'desktop')
  }

  /**
   * Show a native open-file / open-directory dialog.
   * @param options - dialog options.
   * @param signal - caller/connection lifetime; abort rejects the call and
   * discards the dialog result. The native dialog itself stays open until the
   * operator acts because Electron exposes no programmatic close.
   * @returns selected paths, or undefined when the operator cancels.
   */
  abstract showOpenDialog(options: OpenDialogOptions, signal?: AbortSignal): Promise<string[] | undefined>

  /**
   * Show a native save-file dialog.
   * @param options - dialog options.
   * @param signal - caller/connection lifetime; abort rejects the call and
   * discards the dialog result. The native dialog itself stays open until the
   * operator acts because Electron exposes no programmatic close.
   * @returns the chosen absolute path, or undefined when the operator cancels.
   */
  abstract showSaveDialog(options: SaveDialogOptions, signal?: AbortSignal): Promise<string | undefined>

  /**
   * Show a system notification.
   * @param notification - notification content.
   */
  abstract sendNotification(notification: DesktopNotification): void

  /**
   * Register a menu item under a named group. Items in the tray's configured
   * menu group (`'tray'` by default) join the tray context menu; other groups
   * become top-level application menus.
   * @param group - named menu group (e.g., `file`, `view`, `tray`).
   * @param item - menu item to register.
   * @returns a promise resolving to a disposer that removes the item; rejects
   * when the bridge cannot place the item.
   */
  abstract registerMenuItem(group: string, item: DesktopMenuItem): Promise<() => void>

  /**
   * Register a global keyboard shortcut.
   * @param accelerator - Electron accelerator string.
   * @param handler - callback invoked when the shortcut fires.
   * @returns a promise resolving to a disposer that unregisters the shortcut;
   * rejects when the accelerator is already claimed.
   */
  abstract registerGlobalShortcut(accelerator: string, handler: () => void): Promise<() => void>

  /**
   * Configure the host tray icon.
   * @param config - tray configuration.
   * @returns a promise resolving to a disposer that removes the tray
   * configuration; rejects when no tray is available.
   */
  abstract setTray(config: DesktopTrayConfig): Promise<() => void>
}

export default Desktop
