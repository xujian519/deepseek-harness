/**
 * Electron-backed provider of the `ctx.directoryPicker` seam. It exposes the
 * `electron` capability and delegates directory selection to
 * `ctx.desktop.showOpenDialog`, which is implemented by the Electron main bridge.
 * @module @deepseek-ai/dsh-desktop-directory-picker
 */

import type { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type {
  DirectoryPickerCapability,
  DirectoryPickerCapabilities,
} from '@deepseek-ai/dsh-host-directory-picker'
import type { Desktop } from '@deepseek-ai/dsh-desktop'

/** The electron interaction: one native OS chooser on the host display. */
export interface DirectoryPickerElectronCapability {
  kind: 'electron'
  /**
   * Open the chooser and wait for the operator.
   * @param signal - caller/connection lifetime; abort rejects the call and
   * discards the dialog result. The native dialog itself stays open until the
   * operator acts because Electron exposes no programmatic close.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(signal: AbortSignal): Promise<string | null>
}

declare module '@deepseek-ai/dsh-host-directory-picker' {
  /** Merge the `electron` capability into the directory-picker seam. */
  interface DirectoryPickerCapabilities {
    electron: DirectoryPickerElectronCapability
  }
}

/**
 * Electron-backed directory picker. Loaded as a plugin, it registers
 * `ctx.directoryPicker` with the `electron` capability.
 */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  /** Requires the desktop seam; the Cordis loader keeps the plugin pending
   * until a provider registers `ctx.desktop`, failing loud instead of a
   * delayed TypeError on first pick. */
  static inject = ['desktop']

  declare protected ctx: Context & { desktop: Desktop }

  private readonly electronCapability: DirectoryPickerCapability

  constructor(ctx: Context) {
    super(ctx)
    this.electronCapability = {
      kind: 'electron',
      pick: signal => this.pickDirectory(signal),
    }
  }

  capability(): DirectoryPickerCapability {
    return this.electronCapability
  }

  private async pickDirectory(signal: AbortSignal): Promise<string | null> {
    const result = await this.ctx.desktop.showOpenDialog({ properties: ['openDirectory'] }, signal)
    if (result === undefined) return null
    return result[0] ?? null
  }
}

export type { DirectoryPickerCapabilities }
