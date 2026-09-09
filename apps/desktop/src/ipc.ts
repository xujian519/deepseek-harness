/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopPluginRecord } from './project-manager.ts'
import type { DesktopLocale } from './locale.ts'
import type { PrintToPdfResult } from './print.ts'
import { PRINT_TO_PDF_CHANNEL } from './channels-app.ts'
import { SHELL_CHANNELS } from './channels-shell.ts'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  ...SHELL_CHANNELS,
  printToPdf: PRINT_TO_PDF_CHANNEL,
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
}

/** Narrow bridge exposed through context isolation. */
export interface DshDesktopApi {
  readonly protocolVersion: 1
  locale(): Promise<DesktopLocale>
  readonly plugins: {
    list(): Promise<readonly DesktopPluginRecord[]>
    add(spec: string): Promise<void>
    remove(name: string): Promise<void>
    update(name: string, version: string): Promise<void>
  }
  readonly updates: {
    check(): Promise<DesktopUpdateState>
    install(): Promise<void>
    subscribe(listener: (state: DesktopUpdateState) => void): () => void
  }
}

/** Print bridge exposed to the Web UI renderer under `window.desktop`, matching the client's `DesktopPrintBridge` contract. */
export interface DesktopPrintApi {
  printHtmlToPdf(payload: { html: string; suggestedName?: string }): Promise<PrintToPdfResult>
}
