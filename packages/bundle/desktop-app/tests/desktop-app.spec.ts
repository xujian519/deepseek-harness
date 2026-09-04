/**
 * Desktop-surface bundle glue: the runtime plugin mounts without throwing. The
 * patch-composition cases pin the two desktop-ship defects: the web runtime
 * must never hand the URL to the system browser (the Electron window is the
 * UI), and the directory picker must pair the electron provider with a client
 * surface so the Add-workspace affordance renders.
 */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { apply } from '../src/index.ts'

describe('dsh-desktop-app glue', () => {
  it('apply mounts without throwing', () => {
    expect(() => { apply(new Context()) }).not.toThrow()
  })
})

// Compose the real patch layers the desktop profile boots (base + web-app +
// desktop-app) and program the shipped defects. The web runtime's default-
// browser handoff is on (`openBrowser` defaults true), so only an explicit
// `false` in the desktop layer keeps the Electron window the sole UI surface.
// And the desktop layer replaces the web runtime's auto mount-one pair with an
// explicit two-row pin, so both the electron provider and its client surface
// must survive the composition for the affordance to exist.
describe('dsh-desktop-app patch composition', () => {
  const ROOT = process.cwd()
  const layers = [
    join(ROOT, 'packages/bundle/base/cordis.patch.yml'),
    join(ROOT, 'packages/bundle/web-app/cordis.patch.yml'),
    join(ROOT, 'packages/bundle/desktop-app/cordis.patch.yml'),
  ]
  const entries = composeEntries(layers.map(file => loadOverlayPatches('desktop-app test', file)))
  const entryById = (id: string) => entries.find(entry => entry.id === id)

  it('keeps the web runtime from handing the URL to the system browser', () => {
    expect(entryById('web-runtime')?.config)
      .toMatchObject({ openBrowser: false })
  })

  it('replaces the auto chooser with the electron provider and its client surface', () => {
    expect(entryById('directory-picker')?.disabled).toBe(true)
    expect(entryById('directory-picker-desktop')?.name)
      .toBe('@deepseek-ai/dsh-desktop-directory-picker')
    expect(entryById('ui-directory-picker')?.name)
      .toBe('@deepseek-ai/dsh-client-ui-directory-picker-native')
  })
})
