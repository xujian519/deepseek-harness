/**
 * Channel sources of truth: the preload-owned channel files must stay in
 * lockstep with the aggregate map the main process registers handlers on,
 * because sandboxed preloads cannot require the shared ipc chunk.
 */

import { describe, expect, it } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { PRINT_TO_PDF_CHANNEL } from '../src/channels-app.ts'
import { SHELL_CHANNELS } from '../src/channels-shell.ts'

describe('desktop IPC channel sources', () => {
  it('aggregates the shell channels plus the print channel', () => {
    expect(DESKTOP_IPC).toEqual({ ...SHELL_CHANNELS, printToPdf: PRINT_TO_PDF_CHANNEL })
  })

  it('keeps every channel name in the dsh-desktop namespace', () => {
    for (const channel of Object.values(DESKTOP_IPC)) {
      expect(channel.startsWith('dsh-desktop:')).toBe(true)
    }
  })

  it('exposes distinct names for every operation', () => {
    expect(new Set(Object.values(DESKTOP_IPC)).size).toBe(Object.keys(DESKTOP_IPC).length)
  })
})
