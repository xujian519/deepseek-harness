/**
 * Desktop preload: the allow-listed bridge between the renderer and the
 * Electron Main process. This file is bundled to a sandboxed CommonJS
 * script (`dist/preload.cjs`) by the package build; sandboxed preloads cannot
 * use ESM.
 * @module @deepseek-ai/dsh-desktop-electron/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

/** The API exposed to the renderer as `window.desktop`. */
export interface DesktopBridge {
  /** Round-trip probe proving the preload and IPC channels are live. */
  ping(): Promise<string>
}

const bridge: DesktopBridge = {
  ping: () => ipcRenderer.invoke('desktop:ping'),
}

contextBridge.exposeInMainWorld('desktop', bridge)
