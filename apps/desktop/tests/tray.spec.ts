/**
 * Tray platform decisions: icon selection and close behavior must stay
 * deterministic across platforms without requiring an Electron host.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTemplateTrayIcon, shouldHideOnClose, trayIconFile, trayIconPath } from '../src/tray.ts'

describe('tray platform decisions', () => {
  it('selects the template icon on macOS and the colored icon elsewhere', () => {
    expect(trayIconFile('darwin')).toBe('trayTemplate.png')
    expect(trayIconFile('win32')).toBe('tray.png')
    expect(trayIconFile('linux')).toBe('tray.png')
  })

  it('marks only macOS icons as template images', () => {
    expect(isTemplateTrayIcon('darwin')).toBe(true)
    expect(isTemplateTrayIcon('win32')).toBe(false)
  })

  it('resolves the icon path inside the app assets directory', () => {
    expect(trayIconPath('/app', 'darwin')).toBe(join('/app', 'assets', 'trayTemplate.png'))
    expect(trayIconPath('/app', 'win32')).toBe(join('/app', 'assets', 'tray.png'))
  })

  it('hides on close only while a tray exists and no quit started', () => {
    expect(shouldHideOnClose(false, true)).toBe(true)
    expect(shouldHideOnClose(true, true)).toBe(false)
    expect(shouldHideOnClose(false, false)).toBe(false)
  })
})
