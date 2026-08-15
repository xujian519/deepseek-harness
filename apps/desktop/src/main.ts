/**
 * DeepSeek Harness desktop shell — Electron Main process. It owns the
 * application lifecycle, spawns the dsh backend child, and loads the Web UI
 * from the backend's bound URL once the readiness line appears.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { startDshBackend, type DesktopBackend } from './server-manager.ts'
import { BridgeServer, resolveBridgePath } from './bridge-server.ts'

/** Repository root from either layout (src/main.ts or dist/main.js: three hops up). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

let backend: DesktopBackend | undefined
let bridge: BridgeServer | undefined
/** Origin the renderer may navigate to: the backend's bound URL. */
let backendOrigin = 'http://127.0.0.1'

/** The Node binary to run the dsh backend: packaged runtime, or dev PATH node. */
function resolveNodeBin(): string {
  if (app.isPackaged) {
    return process.platform === 'win32'
      ? join(process.resourcesPath, 'node', 'node.exe')
      : join(process.resourcesPath, 'node', 'bin', 'node')
  }
  return process.env.DSH_DESKTOP_NODE ?? 'node'
}

/** Backend entry, tsx loader args, and working directory for this launch mode. */
function resolveBackend(): { entry: string; loaderArgs: string[]; cwd: string } {
  if (app.isPackaged) {
    return {
      entry: join(process.resourcesPath, 'backend', 'lib', 'bin.js'),
      loaderArgs: [],
      cwd: app.getPath('home'),
    }
  }
  return {
    entry: join(REPO_ROOT, 'apps', 'cli', 'src', 'bin.ts'),
    loaderArgs: ['--import', 'tsx/esm'],
    cwd: REPO_ROOT,
  }
}

/**
 * Create the main window with the hardened renderer: no Node integration,
 * context isolation on, and the sandboxed preload bridge. The window may only
 * navigate within the backend origin; popups open in the system browser.
 * @returns the created window.
 */
function createWindow(): BrowserWindow {
  const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url))
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DeepSeek Harness',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(backendOrigin)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(backendOrigin)) event.preventDefault()
  })
  return window
}

void app.whenReady().then(async () => {
  ipcMain.handle('desktop:ping', () => 'pong')
  const window = createWindow()

  bridge = new BridgeServer(window)
  const bridgePath = resolveBridgePath(app.getPath('userData'))
  await bridge.start(bridgePath)

  const { entry, loaderArgs, cwd } = resolveBackend()
  backend = startDshBackend({
    nodeBin: resolveNodeBin(),
    entry,
    loaderArgs,
    profile: 'desktop',
    args: ['--port', '0'],
    cwd,
    env: {
      ...process.env,
      DSH_DESKTOP_BRIDGE_PATH: bridgePath,
    },
  })
  backend.onExit((exit) => {
    console.error(`dsh backend exited (code ${String(exit.code)}, signal ${String(exit.signal)})`)
    if (!window.isDestroyed()) {
      void dialog.showMessageBox(window, {
        type: 'error',
        message: 'dsh backend exited unexpectedly',
        detail: `The backend process ended with code ${String(exit.code)} and signal ${String(exit.signal)}.`,
      })
    }
  })
  try {
    const url = await backend.ready
    backendOrigin = new URL(url).origin
    await window.loadURL(url)
  } catch (error) {
    console.error('failed to start the dsh backend', error)
    dialog.showErrorBox(
      'DeepSeek Harness failed to start',
      error instanceof Error ? error.message : String(error),
    )
    app.quit()
  }
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', (event) => {
  if (backend === undefined) return
  event.preventDefault()
  const closing = backend
  const closingBridge = bridge
  backend = undefined
  bridge = undefined
  closingBridge?.dispose()
  void closing.dispose().finally(() => { app.exit(0) })
})
