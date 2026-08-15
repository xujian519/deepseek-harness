/**
 * DeepSeek Harness desktop shell — Electron Main process. It owns the
 * application lifecycle, spawns the dsh backend child, and loads the Web UI
 * from the backend's bound URL once the readiness line appears.
 * @module @deepseek-ai/dsh-desktop-electron/main
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import { startDshBackend, type DesktopBackend } from './server-manager.ts'
import { BridgeServer, resolveBridgePath } from './bridge-server.ts'
import { isTemplateTrayIcon, shouldHideOnClose, trayIconPath } from './tray.ts'

/** Repository root from either layout (src/main.ts or dist/main.js: three hops up). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

let backend: DesktopBackend | undefined
let bridge: BridgeServer | undefined
/** Origin the renderer may navigate to: the backend's bound URL. */
let backendOrigin = 'http://127.0.0.1'
/** The open main window, kept module-level so tray actions can restore it. */
let mainWindow: BrowserWindow | undefined
/** The system tray, when the platform created one successfully. */
let tray: Tray | undefined
/** True once an explicit quit started, so close no longer hides the window. */
let isQuitting = false

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

/** Restore and focus the main window from a tray or dock action. */
function showMainWindow(): void {
  if (mainWindow === undefined) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
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
  mainWindow = window
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(backendOrigin)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(backendOrigin)) event.preventDefault()
  })
  window.on('close', (event) => {
    if (shouldHideOnClose(isQuitting, tray !== undefined)) {
      event.preventDefault()
      window.hide()
    }
  })
  return window
}

/**
 * Create the system tray from the packaged or dev assets directory.
 * @param appPath - `app.getAppPath()`: the app root in dev, `app.asar` when packaged.
 * @returns the created tray.
 */
function createTray(appPath: string): Tray {
  const icon = nativeImage.createFromPath(trayIconPath(appPath, process.platform))
  if (isTemplateTrayIcon(process.platform)) icon.setTemplateImage(true)
  const created = new Tray(icon)
  created.setToolTip('DeepSeek Harness')
  created.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show DeepSeek Harness', click: showMainWindow },
    { type: 'separator' },
    { label: 'Quit DeepSeek Harness', click: () => {
      isQuitting = true
      app.quit()
    } },
  ]))
  created.on('click', showMainWindow)
  return created
}

void app.whenReady().then(async () => {
  ipcMain.handle('desktop:ping', () => 'pong')
  const window = createWindow()

  try {
    tray = createTray(app.getAppPath())
  } catch (error) {
    console.warn(`System tray is unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

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
  if (tray === undefined || isQuitting) app.quit()
})

app.on('activate', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  isQuitting = true
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
