/**
 * Tests for the Electron Main JSON-RPC bridge server: socket lifecycle,
 * method allow-listing, and startup failure all run without an Electron host.
 */

import { connect, createServer, type Socket } from 'node:net'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow, Tray } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeServer, resolveBridgePath } from '../src/bridge-server.ts'

/** Hoisted fake state shared by the mocked electron module and the tests. */
const mocks = vi.hoisted(() => ({
  notifications: [] as {
    options: Record<string, string | undefined>
    handlers: Record<string, () => void>
    show: ReturnType<typeof vi.fn>
  }[],
  lastMenuTemplate: [] as unknown[],
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn(),
  registerShortcut: vi.fn(),
  unregisterAll: vi.fn(),
  isNotificationSupported: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: '' }),
  },
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate.mockImplementation((template: unknown[]) => {
      mocks.lastMenuTemplate = template
      return { template }
    }),
    setApplicationMenu: mocks.setApplicationMenu,
  },
  Notification: Object.assign(
    vi.fn().mockImplementation(function (this: unknown, options: Record<string, string | undefined>) {
      const instance = {
        options,
        handlers: {} as Record<string, () => void>,
        show: vi.fn(),
        on: vi.fn((event: string, cb: () => void) => {
          instance.handlers[event] = cb
          return instance
        }),
      }
      mocks.notifications.push(instance)
      return instance
    }),
    { isSupported: mocks.isNotificationSupported.mockReturnValue(true) },
  ),
  globalShortcut: {
    register: mocks.registerShortcut.mockReturnValue(true),
    unregister: vi.fn(),
    unregisterAll: mocks.unregisterAll,
  },
}))

const window = {} as BrowserWindow
const APP_NAME = 'DeepSeek Harness'
// Windows cannot listen on a POSIX socket file; a named pipe is the native form.
// The path is unique PER TEST: Windows pipe names linger briefly after the
// owning server closes, so a fixed name collides with the previous test's
// (EADDRINUSE) while the OS frees it.
let socketPath: string
let socketPathCounter = 0
function nextSocketPath(): string {
  socketPathCounter += 1
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\dsh-desktop-bridge-server-test-${process.pid}-${socketPathCounter}`
    : join(tmpdir(), `dsh-desktop-bridge-server-test-${process.pid}-${socketPathCounter}.sock`)
}

/** A shell-owned tray double handed to the bridge through initTray. */
function makeTrayDouble(): {
  tray: Tray
  handlers: Record<string, () => void>
  setToolTip: ReturnType<typeof vi.fn>
  setContextMenu: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
} {
  const setToolTip = vi.fn()
  const setContextMenu = vi.fn()
  const destroy = vi.fn()
  const handlers: Record<string, () => void> = {}
  const tray = {
    setToolTip,
    setContextMenu,
    destroy,
    on: vi.fn((event: string, cb: () => void) => { handlers[event] = cb }),
  } as unknown as Tray
  return { tray, handlers, setToolTip, setContextMenu, destroy }
}

const APP_MENU_BASE: Electron.MenuItemConstructorOptions[] = [
  { label: APP_NAME, submenu: [{ role: 'quit' }] },
]

describe('resolveBridgePath', () => {
  it('resolves a pid-suffixed POSIX socket in the OS temp directory', () => {
    expect(resolveBridgePath('darwin')).toBe(join(tmpdir(), `dsh-desktop-bridge-${process.pid}.sock`))
    expect(resolveBridgePath('linux')).toBe(join(tmpdir(), `dsh-desktop-bridge-${process.pid}.sock`))
  })

  it('resolves a Windows named pipe carrying the pid', () => {
    expect(resolveBridgePath('win32')).toBe(`\\\\?\\pipe\\dsh-desktop-bridge-${process.pid}`)
  })
})

describe('BridgeServer', () => {
  let bridge: BridgeServer
  let client: Socket | undefined
  let frames: string[] = []

  beforeEach(async () => {
    frames = []
    mocks.notifications.length = 0
    mocks.lastMenuTemplate = []
    mocks.buildFromTemplate.mockClear()
    mocks.setApplicationMenu.mockClear()
    mocks.registerShortcut.mockClear().mockReturnValue(true)
    mocks.unregisterAll.mockClear()
    mocks.isNotificationSupported.mockClear().mockReturnValue(true)
    socketPath = nextSocketPath()
    bridge = new BridgeServer(() => window, APP_NAME)
    await bridge.start(socketPath)
    client = connect(socketPath)
    client.setEncoding('utf8')
    client.on('data', (chunk: string) => {
      for (const line of chunk.split('\n').filter(Boolean)) frames.push(line)
    })
    await new Promise(resolve => setTimeout(resolve, 20))
  })

  afterEach(async () => {
    client?.end()
    bridge.dispose()
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    try { unlinkSync(socketPath) } catch {}
  })

  it('rejects an unknown method with a JSON-RPC error', async () => {
    client?.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'desktop/unknown' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const frame = JSON.parse(frames[0] ?? '{}') as { error?: { code: number } }
    expect(frame.error?.code).toBe(-32601)
  })

  it('rejects a frame without an id', async () => {
    client?.write(JSON.stringify({ jsonrpc: '2.0', method: 'desktop/showOpenDialog' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(frames).toEqual([])
  })

  it('rejects a second connection while one backend is attached', async () => {
    const second = connect(socketPath)
    const closed = new Promise<void>((resolve) => { second.on('close', () => { resolve() }) })
    await closed
    expect(second.destroyed).toBe(true)
  })

  it('rejects start when the socket path is already taken', async () => {
    bridge.dispose()
    // A FRESH path: the beforeEach bridge's name may still be held on Windows
    // while its pipe tears down, which would make the blocker's own listen
    // fail instead of the second BridgeServer's.
    const occupied = nextSocketPath()
    const blocker = createServer()
    await new Promise<void>((resolve, reject) => {
      blocker.on('error', reject)
      blocker.listen(occupied, resolve)
    })
    const other = new BridgeServer(() => window, APP_NAME)
    await expect(other.start(occupied)).rejects.toThrow()
    other.dispose()
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => {
        if (error != null) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  })

  it('recovers from a stale socket file with no live listener', async () => {
    bridge.dispose()
    if (process.platform === 'win32') return // named pipes leave no file behind
    await new Promise<void>((resolve, reject) => {
      const stale = createServer()
      stale.on('error', reject)
      stale.listen(socketPath, () => {
        stale.close(() => {
          // POSIX keeps the socket file after close: a stale file with no
          // listener is exactly the crashed-app residue a restart must clear.
          resolve()
        })
      })
    })
    const other = new BridgeServer(() => window, APP_NAME)
    await other.start(socketPath)
    other.dispose()
  })

  it('disposes without failing when never started', () => {
    const fresh = new BridgeServer(() => window, APP_NAME)
    fresh.dispose()
  })

  it('delivers a notification and pushes its click back with the id', async () => {
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/sendNotification', params: { title: 'hello', body: 'world' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const response = JSON.parse(frames[0] ?? '{}') as { result?: { delivered: boolean; notificationId: string } }
    expect(response.result).toEqual({ delivered: true, notificationId: 'notification-1' })
    expect(mocks.notifications).toHaveLength(1)
    expect(mocks.notifications[0]?.options).toEqual({ title: 'hello', body: 'world' })
    frames.length = 0
    mocks.notifications[0]?.handlers.click?.()
    await new Promise(resolve => setTimeout(resolve, 20))
    const pushed = JSON.parse(frames[0] ?? '{}') as { method: string; params: { notificationId: string } }
    expect(pushed.method).toBe('desktop/notification-clicked')
    expect(pushed.params).toEqual({ notificationId: 'notification-1' })
  })

  it('reports undelivered when notifications are unsupported', async () => {
    mocks.isNotificationSupported.mockReturnValue(false)
    client?.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'desktop/sendNotification', params: { title: 'x' } }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const response = JSON.parse(frames[0] ?? '{}') as { result?: { delivered: boolean } }
    expect(response.result).toEqual({ delivered: false })
  })

  it('registers a menu item behind the shell base entries and pushes its activation', async () => {
    bridge.setAppMenuBase(APP_MENU_BASE)
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/registerMenuItem',
      params: { group: 'file', item: { id: 'open', label: 'Open', accelerator: 'CmdOrCtrl+O' } },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    // One rebuild from setAppMenuBase, one from the registration.
    expect(mocks.setApplicationMenu).toHaveBeenCalledTimes(2)
    // The shell's own entries survive the rebuild; the group follows them.
    expect(mocks.lastMenuTemplate[0]).toMatchObject({ label: APP_NAME })
    const group = mocks.lastMenuTemplate.find(entry =>
      typeof entry === 'object' && entry !== null && (entry as { label?: string }).label === 'file') as { submenu: { click: () => void }[] } | undefined
    expect(group?.submenu).toHaveLength(1)
    frames.length = 0
    group?.submenu[0]?.click?.()
    await new Promise(resolve => setTimeout(resolve, 20))
    const pushed = JSON.parse(frames[0] ?? '{}') as { method: string; params: { menuId: string } }
    expect(pushed.method).toBe('desktop/menu-activated')
    expect(pushed.params).toEqual({ menuId: 'open' })
  })

  it('restores the base application menu when the last group is removed', async () => {
    bridge.setAppMenuBase(APP_MENU_BASE)
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/registerMenuItem',
      params: { group: 'file', item: { id: 'open', label: 'Open' } },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    // Base rebuild + registration rebuild.
    expect(mocks.setApplicationMenu).toHaveBeenCalledTimes(2)
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'desktop/unregisterMenuItem',
      params: { group: 'file', id: 'open' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    // Removing the last group must reinstall the shell's base menu, not leave
    // the custom menu with a stale group standing.
    expect(mocks.setApplicationMenu).toHaveBeenCalledTimes(3)
    expect(mocks.lastMenuTemplate.some((entry) => {
      const candidate = entry as { label?: string }
      return candidate.label === 'file'
    })).toBe(false)
  })

  it('registers a global shortcut and pushes its trigger', async () => {
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/registerGlobalShortcut', params: { accelerator: 'Cmd+K' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(JSON.parse(frames[0] ?? '{}')).toMatchObject({ result: { ok: true } })
    const callback = mocks.registerShortcut.mock.calls[0]?.[1] as (() => void) | undefined
    frames.length = 0
    callback?.()
    await new Promise(resolve => setTimeout(resolve, 20))
    const pushed = JSON.parse(frames[0] ?? '{}') as { method: string; params: { accelerator: string } }
    expect(pushed.method).toBe('desktop/shortcut-triggered')
    expect(pushed.params).toEqual({ accelerator: 'Cmd+K' })
  })

  it('rejects a shortcut registration the OS cannot claim', async () => {
    mocks.registerShortcut.mockReturnValue(false)
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/registerGlobalShortcut', params: { accelerator: 'Cmd+K' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    const response = JSON.parse(frames[0] ?? '{}') as { error?: { code: number; message: string } }
    expect(response.error?.code).toBe(-32000)
    expect(response.error?.message).toContain('already registered')
  })

  it('sets the tray tooltip and menu group through setTray', async () => {
    const double = makeTrayDouble()
    bridge.initTray(double.tray, { onShow: () => {}, onQuit: () => {} })
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/setTray', params: { tooltip: 'DSH', menuGroup: 'tray' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(double.setToolTip).toHaveBeenCalledWith('DSH')
    // A tray-group menu item lands in the tray menu, not the application menu.
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'desktop/registerMenuItem',
      params: { group: 'tray', item: { id: 'pause', label: 'Pause' } },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    // A tray-group item never joins the application menu; the rebuild still
    // runs (base baseline) but must not carry the tray item. Read the
    // application menu from the setApplicationMenu call, not the shared mock
    // capture: the tray rebuild's own buildFromTemplate overwrites that.
    const appMenu = mocks.setApplicationMenu.mock.calls.at(-1)?.[0] as { template?: unknown[] } | undefined
    expect(appMenu?.template?.some((entry) => {
      const candidate = entry as { label?: string }
      return candidate.label === 'Pause'
    })).toBe(false)
    const trayMenu = double.setContextMenu.mock.calls.at(-1)?.[0] as { template?: unknown[] } | undefined
    expect(trayMenu?.template?.some(entry =>
      typeof entry === 'object' && entry !== null && (entry as { label?: string }).label === 'Pause')).toBe(true)
  })

  it('clears the tray configuration back to the default tooltip', async () => {
    const double = makeTrayDouble()
    bridge.initTray(double.tray, { onShow: () => {}, onQuit: () => {} })
    client?.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'desktop/setTray', params: { tooltip: 'DSH' } }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    client?.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'desktop/clearTray' }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(double.setToolTip).toHaveBeenLastCalledWith(APP_NAME)
  })

  it('labels the tray base entries with the app name', async () => {
    const double = makeTrayDouble()
    bridge.initTray(double.tray, { onShow: () => {}, onQuit: () => {} })
    const trayMenu = double.setContextMenu.mock.calls.at(-1)?.[0] as { template?: { label?: string }[] } | undefined
    const labels = (trayMenu?.template ?? []).map(entry => entry.label)
    expect(labels).toContain(`Show ${APP_NAME}`)
    expect(labels).toContain(`Quit ${APP_NAME}`)
  })

  it('pushes tray clicks to the backend', async () => {
    const double = makeTrayDouble()
    bridge.initTray(double.tray, { onShow: () => {}, onQuit: () => {} })
    frames.length = 0
    double.handlers.click?.()
    await new Promise(resolve => setTimeout(resolve, 20))
    const pushed = JSON.parse(frames[0] ?? '{}') as { method: string; params: { button: string } }
    expect(pushed.method).toBe('desktop/tray-clicked')
    expect(pushed.params).toEqual({ button: 'left' })
  })

  it('dispose tears down shortcuts and the socket but leaves the tray to the shell', async () => {
    const double = makeTrayDouble()
    bridge.initTray(double.tray, { onShow: () => {}, onQuit: () => {} })
    client?.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'desktop/sendNotification', params: { title: 'x' },
    }) + '\n')
    await new Promise(resolve => setTimeout(resolve, 20))
    bridge.dispose()
    expect(mocks.unregisterAll).toHaveBeenCalled()
    expect(double.destroy).not.toHaveBeenCalled()
  })
})
