/**
 * Main-renderer bridge: the desktop protocol marker plus the print-to-PDF
 * bridge under `window.desktop`, the name the client UI's
 * `DesktopPrintBridge` contract already detects.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })
contextBridge.exposeInMainWorld('desktop', {
  printHtmlToPdf: (payload: { html: string; suggestedName?: string }) =>
    ipcRenderer.invoke(DESKTOP_IPC.printToPdf, payload),
})
