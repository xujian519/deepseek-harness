/**
 * System tray decisions for the desktop shell. Pure platform logic stays here
 * so it is testable without an Electron host; the Electron Tray construction
 * lives in main.ts.
 * @module @deepseek-ai/dsh-desktop-electron/tray
 */

import { join } from 'node:path'

/** Tray icon file for one platform: a macOS template icon or the colored icon. */
export function trayIconFile(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
}

/** Whether the tray icon must be marked as a macOS template image. */
export function isTemplateTrayIcon(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/** Resolve the tray icon path from the app path for one platform. */
export function trayIconPath(appPath: string, platform: NodeJS.Platform): string {
  return join(appPath, 'assets', trayIconFile(platform))
}

/** Whether closing the last window keeps the app alive in the tray. */
export function shouldHideOnClose(isQuitting: boolean, trayAvailable: boolean): boolean {
  return !isQuitting && trayAvailable
}
