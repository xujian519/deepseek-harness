/**
 * Main-renderer bridge: the desktop protocol marker plus the print-to-PDF
 * bridge under `window.desktop`, the name the client UI's
 * `DesktopPrintBridge` contract already detects.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { PRINT_TO_PDF_CHANNEL } from './channels-app.ts'

contextBridge.exposeInMainWorld('dshDesktop', { protocolVersion: 1 })
contextBridge.exposeInMainWorld('desktop', {
  printHtmlToPdf: (payload: { html: string; suggestedName?: string }) =>
    ipcRenderer.invoke(PRINT_TO_PDF_CHANNEL, payload),
})
