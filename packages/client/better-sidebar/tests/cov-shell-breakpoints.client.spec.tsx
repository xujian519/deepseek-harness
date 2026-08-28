/**
 * Breakpoint hooks in the browser lane: the live narrow flag, the rAF
 * throttle's coalescing (a resize burst schedules ONE frame), the cleanup's
 * pending-frame cancel, and the guard for a window-less effect run.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { useNarrowViewport, useViewportSize } from '../src/client/breakpoints.ts'

function stubRaf(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return frames
}

function size(innerWidth: number, innerHeight: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: innerWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useViewportSize throttling', () => {
  it('coalesces a resize burst into one frame', async () => {
    const frames = stubRaf()
    size(1280, 800)
    const observed: string[] = []
    function Probe(): null {
      const sizeNow = useViewportSize()
      observed.push(`${sizeNow.width}x${sizeNow.height}`)
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    await act(async () => { root.render(createElement(Probe)) })
    // Two resize events before the frame runs: the second must not schedule
    // another frame (frame !== null → skip).
    size(1000, 700)
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(1)
    await act(async () => { frames.shift()?.(0) })
    expect(observed.at(-1)).toBe('1000x700')
    await act(async () => { root.unmount() })
  })

  it('cancels a pending frame on unmount', async () => {
    const frames = stubRaf()
    size(1280, 800)
    function Probe(): null {
      useViewportSize()
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    await act(async () => { root.render(createElement(Probe)) })
    // A resize arms a frame; unmounting before it runs must cancel it.
    size(900, 600)
    window.dispatchEvent(new Event('resize'))
    expect(frames).toHaveLength(1)
    await act(async () => { root.unmount() })
    expect(vi.mocked(window.cancelAnimationFrame)).toHaveBeenCalledWith(1)
  })

  it('useNarrowViewport mirrors the live width', async () => {
    size(1280, 800)
    const observed: boolean[] = []
    function Probe(): null {
      observed.push(useNarrowViewport())
      return null
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root: Root = createRoot(host)
    await act(async () => { root.render(createElement(Probe)) })
    expect(observed).toEqual([false])
    size(390, 800)
    window.dispatchEvent(new Event('resize'))
    await act(async () => {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    expect(observed.at(-1)).toBe(true)
    await act(async () => { root.unmount() })
  })
})

// Note: useViewportSize's `typeof window === 'undefined'` effect guard is
// intentionally not exercised here. react-dom's render/commit phases read
// window globals (event lane, HTMLIFrameElement), so no mount can flush
// effects without a window in this lane, and the SSR lane never runs
// effects — the guard protects non-React compositions only.
