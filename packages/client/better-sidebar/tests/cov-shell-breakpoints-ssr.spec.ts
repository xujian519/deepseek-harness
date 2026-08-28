/**
 * Breakpoint hooks under SSR (no window): the lazy size initializer and the
 * narrow flag must resolve to their zero-size fallbacks through a server
 * render, where effects never run.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { isNarrowWidth, useNarrowViewport, useViewportSize } from '../src/client/breakpoints.ts'

describe('breakpoint hooks without a window', () => {
  it('useViewportSize initializes to the zero size', () => {
    expect(typeof window).toBe('undefined')
    let seen = ''
    function Probe(): null {
      const size = useViewportSize()
      seen = `${size.width}x${size.height}`
      return null
    }
    renderToString(createElement(Probe))
    expect(seen).toBe('0x0')
  })

  it('useNarrowViewport treats the zero size as narrow', () => {
    let narrow: boolean | undefined
    function Probe(): null {
      narrow = useNarrowViewport()
      return null
    }
    renderToString(createElement(Probe))
    expect(narrow).toBe(true)
    expect(isNarrowWidth(0)).toBe(true)
  })
})
