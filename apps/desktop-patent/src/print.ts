/**
 * Desktop print-to-PDF: render one HTML document in a hidden window, raster
 * it with the Electron printer, and save the bytes through the OS save
 * dialog. The HTML arrives from the renderer (the harness web UI, loopback
 * origin) — the same trust class as opening the file in the system browser;
 * scripts in the document execute inside the hidden window, so callers must
 * only feed their own session's produced files.
 * @module @deepseek-ai/dsh-desktop-electron/print
 */

import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog } from 'electron'

/** Result of one desktop print-to-PDF request. */
export interface PrintToPdfResult {
  /** Saved file path on success. */
  path?: string
  /** The user dismissed the save dialog. */
  cancelled?: true
  /** Print, raster, or save failure message. */
  error?: string
}

/**
 * Print one HTML document to PDF and save it with the OS save dialog.
 * @param parentWindow - window anchoring the save dialog; omitted hides the
 * dialog behind the print window.
 * @param html - the full standalone HTML document to rasterize.
 * @param suggestedName - default file name (a `.pdf` suffix is added when absent).
 * @returns the saved path, a cancellation marker, or an error message.
 */
export async function printHtmlToPdf(
  parentWindow: BrowserWindow | undefined,
  html: string,
  suggestedName: string,
): Promise<PrintToPdfResult> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await printWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
    })
    const defaultPath = suggestedName.endsWith('.pdf') ? suggestedName : `${suggestedName}.pdf`
    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow ?? printWindow, {
      defaultPath,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { cancelled: true }
    await writeFile(filePath, pdf)
    return { path: filePath }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy()
  }
}
