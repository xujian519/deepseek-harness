/** Context-isolated renderer bridge for desktop package and update operations. */

import { contextBridge, ipcRenderer } from 'electron'
import type { DshDesktopApi, DesktopUpdateState } from './ipc.ts'
import { SHELL_CHANNELS } from './channels-shell.ts'

const api: DshDesktopApi = {
  protocolVersion: 1,
  locale: () => ipcRenderer.invoke(SHELL_CHANNELS.localeGet) as Promise<ReturnType<DshDesktopApi['locale']> extends Promise<infer T> ? T : never>,
  plugins: {
    list: () => ipcRenderer.invoke(SHELL_CHANNELS.pluginsList) as Promise<ReturnType<DshDesktopApi['plugins']['list']> extends Promise<infer T> ? T : never>,
    add: spec => ipcRenderer.invoke(SHELL_CHANNELS.pluginsAdd, spec) as Promise<void>,
    remove: name => ipcRenderer.invoke(SHELL_CHANNELS.pluginsRemove, name) as Promise<void>,
    update: (name, version) => ipcRenderer.invoke(SHELL_CHANNELS.pluginsUpdate, name, version) as Promise<void>,
  },
  updates: {
    check: () => ipcRenderer.invoke(SHELL_CHANNELS.updatesCheck) as Promise<DesktopUpdateState>,
    install: () => ipcRenderer.invoke(SHELL_CHANNELS.updatesInstall) as Promise<void>,
    subscribe(listener) {
      const handle = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
      ipcRenderer.on(SHELL_CHANNELS.updatesState, handle)
      return () => { ipcRenderer.off(SHELL_CHANNELS.updatesState, handle) }
    },
  },
}

contextBridge.exposeInMainWorld('dshDesktop', api)
