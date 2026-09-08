/**
 * Desktop preload: the allow-listed bridge between the renderer and the
 * Electron Main process. This file is bundled to a sandboxed CommonJS
 * script (`dist/preload.cjs`) by the package build; sandboxed preloads cannot
 * use ESM.
 * @module @deepseek-ai/dsh-desktop-electron/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

/** Outcome of one desktop print-to-PDF request. */
export interface DesktopPrintResult {
  /** Saved file path on success. */
  path?: string
  /** The user dismissed the save dialog. */
  cancelled?: true
  /** Print, raster, or save failure message. */
  error?: string
}

/** The API exposed to the renderer as `window.desktop`. */
export interface DesktopBridge {
  /** Round-trip probe proving the preload and IPC channels are live. */
  ping(): Promise<string>
  /**
   * Print one full HTML document to PDF through the OS save dialog.
   * @param payload - the HTML document and the suggested file name.
   * @returns the saved path, a cancellation marker, or an error message.
   */
  printHtmlToPdf(payload: { html: string; suggestedName?: string }): Promise<DesktopPrintResult>
}

const bridge: DesktopBridge = {
  ping: () => ipcRenderer.invoke('desktop:ping'),
  printHtmlToPdf: payload => ipcRenderer.invoke('desktop:print-to-pdf', payload),
}

contextBridge.exposeInMainWorld('desktop', bridge)
