/**
 * Theme access against the live DOM: the pre-presenter fallbacks (no
 * color-scheme decision, no matchMedia), a non-finite computed alpha, and
 * the MutationObserver-driven scheme subscription.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { colorAlpha, isDarkScheme, subscribeColorScheme } from '../src/client/theme.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.removeAttribute('data-ds-dark-theme')
  document.documentElement.style.removeProperty('color-scheme')
})

describe('isDarkScheme fallbacks', () => {
  it('falls back to the OS media query before the presenter has decided', () => {
    document.documentElement.style.colorScheme = ''
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('dark') }))
    expect(isDarkScheme()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(isDarkScheme()).toBe(false)
  })

  it('an absent matchMedia keeps the light fallback', () => {
    document.documentElement.style.colorScheme = ''
    const original = window.matchMedia
    try {
      vi.stubGlobal('matchMedia', undefined)
      expect(isDarkScheme()).toBe(false)
    } finally {
      vi.stubGlobal('matchMedia', original)
    }
  })

  it('a set color-scheme makes the body attribute authoritative (light over dark OS)', () => {
    document.documentElement.style.colorScheme = 'light'
    document.body.removeAttribute('data-ds-dark-theme')
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(isDarkScheme()).toBe(false)
    document.body.setAttribute('data-ds-dark-theme', '')
    expect(isDarkScheme()).toBe(true)
  })
})

describe('colorAlpha malformed function forms', () => {
  it('treats a non-parsable alpha slot as opaque', () => {
    expect(colorAlpha('rgb(1 2 3 / weird)')).toBe(1)
    expect(colorAlpha('rgba(1, 2, 3)')).toBe(1)
    expect(colorAlpha('hsl(200 50% 50% / nope)')).toBe(1)
  })
})

describe('subscribeColorScheme', () => {
  it('fires on body palette flips and stops after the disposer', async () => {
    const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })
    // The presenter has decided the scheme: the body attribute is then the
    // authoritative signal the subscription tracks.
    document.documentElement.style.colorScheme = 'dark'
    const flips: boolean[] = []
    const dispose = subscribeColorScheme(() => { flips.push(isDarkScheme()) })
    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(flips).toEqual([true])
    document.body.removeAttribute('data-ds-dark-theme')
    await tick()
    expect(flips).toEqual([true, false])
    dispose()
    document.body.setAttribute('data-ds-dark-theme', '')
    await tick()
    expect(flips).toEqual([true, false])
  })
})
