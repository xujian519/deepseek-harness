// @vitest-environment jsdom
/**
 * Coverage round for the settings-nav icon marker: the disposed guard. A
 * MutationObserver stub stands in for the platform class so the test can
 * deliver a queued observation AFTER disposal — the real observer cannot
 * (disconnect() drops pending records), which is exactly the race the guard
 * closes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSettingsNavIcon, SETTINGS_NAV_MARKER } from '../src/client/settings-nav-icon.ts'

/** A MutationObserver stand-in whose callback the test drives by hand. */
class ManualMutationObserver {
  static instances: ManualMutationObserver[] = []
  callback: () => void
  disconnect = vi.fn()
  constructor(callback: MutationCallback) {
    this.callback = () => callback([], this as unknown as MutationObserver)
    ManualMutationObserver.instances.push(this)
  }
  observe(): void {}
}

function navButton(label: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.innerHTML = `<span>${label}</span>`
  return button
}

function dialogWith(...buttons: HTMLButtonElement[]): HTMLElement {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const nav = document.createElement('nav')
  nav.append(...buttons)
  dialog.append(nav)
  return dialog
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  ManualMutationObserver.instances = []
})

describe('registerSettingsNavIcon disposed guard', () => {
  it('a late observation after disposal leaves the document untouched', () => {
    vi.stubGlobal('MutationObserver', ManualMutationObserver)
    const sideCard = navButton('Side card')
    document.body.append(dialogWith(sideCard))

    const dispose = registerSettingsNavIcon(() => 'Side card')
    expect(sideCard.hasAttribute(SETTINGS_NAV_MARKER)).toBe(true)

    dispose()
    expect(sideCard.hasAttribute(SETTINGS_NAV_MARKER)).toBe(false)

    // The queued mutation fires after disposal: the guard returns before the
    // label walk, so no marker can come back.
    for (const instance of ManualMutationObserver.instances) instance.callback()
    expect(sideCard.hasAttribute(SETTINGS_NAV_MARKER)).toBe(false)
  })
})
