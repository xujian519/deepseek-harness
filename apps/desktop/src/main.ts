/**
 * DeepSeek Harness desktop shell — Electron Main process. It owns the
 * application lifecycle, spawns the dsh backend child, and loads the Web UI
 * from the backend's bound URL once the readiness line appears.
 * @module @deepseek-ai/dsh-desktop-electron/main
 */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, shell, type Tray } from 'electron'
import { startDshBackend, type DesktopBackend } from './server-manager.ts'
import { BridgeServer, resolveBridgePath } from './bridge-server.ts'
import { isWithinBackendOrigin } from './navigation.ts'
import { printHtmlToPdf } from './print.ts'
import { shouldHideOnClose } from './tray.ts'

/** Repository root from either layout (src/main.ts or dist/main.js: three hops up). */
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** Renderer-supplied HTML ceiling for print-to-PDF, matching the host read cap. */
const MAX_PRINT_HTML_BYTES = 4 * 1024 * 1024

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
    if (!isWithinBackendOrigin(url, backendOrigin)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isWithinBackendOrigin(url, backendOrigin)) event.preventDefault()
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
 * Create the system tray through the bridge, whose menu model rebuilds it
 * when backend plugins register tray items.
 * @param appPath - `app.getAppPath()`: the app root in dev, `app.asar` when packaged.
 * @returns the created tray, or undefined when the platform cannot host one.
 */
function createTray(appPath: string): Tray | undefined {
  return bridge?.initTray(appPath, {
    onShow: showMainWindow,
    onQuit: () => {
      isQuitting = true
      app.quit()
    },
  })
}

void app.whenReady().then(async () => {
  ipcMain.handle('desktop:ping', () => 'pong')
  ipcMain.handle('desktop:print-to-pdf', async (_event, payload: unknown) => {
    // Renderer input is untrusted: validate the closed channel's arguments
    // before the hidden print window touches anything.
    if (typeof payload !== 'object' || payload === null) return { error: 'invalid payload' }
    const html = (payload as { html?: unknown }).html
    const suggestedName = (payload as { suggestedName?: unknown }).suggestedName
    if (typeof html !== 'string' || html.length === 0) return { error: 'invalid html' }
    // Match the host read ceiling so a hostile or buggy renderer cannot push
    // an unbounded document into the hidden print window.
    if (html.length > MAX_PRINT_HTML_BYTES) return { error: 'html too large' }
    if (suggestedName !== undefined && typeof suggestedName !== 'string') {
      return { error: 'invalid suggestedName' }
    }
    return printHtmlToPdf(mainWindow, html, suggestedName ?? 'document')
  })
  const window = createWindow()

  bridge = new BridgeServer(window)
  const bridgePath = resolveBridgePath(app.getPath('userData'))
  try {
    await bridge.start(bridgePath)
  } catch (error) {
    console.error('failed to start the desktop bridge', error)
    dialog.showErrorBox(
      'DeepSeek Harness failed to start',
      `Failed to start the desktop bridge: ${error instanceof Error ? error.message : String(error)}`,
    )
    app.quit()
    return
  }
  // initTray reports unavailability itself; a tray-less run still works.
  tray = createTray(app.getAppPath())

  const { entry, loaderArgs, cwd } = resolveBackend()
  backend = startDshBackend({
    nodeBin: resolveNodeBin(),
    entry,
    loaderArgs,
    profile: 'desktop',
    // The Electron window is the UI surface; suppress the web runtime's
    // default-browser handoff so it does not open the same URL a second time.
    args: ['--port', '0', '--no-open'],
    cwd,
    env: {
      ...process.env,
      DSH_DESKTOP_BRIDGE_PATH: bridgePath,
      // The desktop launch has no terminal; let profile boot converge the
      // scheduler-handshake copies by running pnpm itself when they diverge.
      DSH_AUTO_PNPM_INSTALL: '1',
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
