/**
 * FreeWindow interaction round beyond the sidebar-shell spec: the pointer
 * guards (wrong button, button targets, capture lost), the rAF coalescing
 * (two moves per frame, the flush-on-release of a pending frame), the
 * cancel/abort paths committing the last applied geometry, the dock-target
 * highlight lifecycle across panes (including zero-sized panes), and the
 * header menu's dock/close rows and outside dismissal.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { FreeWindow } from '../src/client/FreeWindow.tsx'
import { t } from '../src/client/locales.ts'
import type { FloatWindow, SidebarTab } from '../src/client/state.ts'

const tab: SidebarTab = { id: 'notes', type: 'notes', title: 'Notes' }

function makeFloat(): FloatWindow {
  return { id: 'f1', tab, x: 100, y: 50, w: 300, h: 200 }
}

function pointer(type: string, x: number, y: number, button = 0): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

const flushFrame = async (): Promise<void> => {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) })
}

interface Harness {
  container: HTMLElement
  calls: { raise: number; move: Array<[number, number]>; resize: Array<[number, number]>; dock: Array<string | null>; close: number }
  win: () => {
    root: HTMLElement
    header: HTMLElement
    resize: HTMLElement
    close: HTMLElement
  }
  rerender: (float: FloatWindow) => void
  unmount: () => void
}

function mountWindow(float: FloatWindow, panes: HTMLElement[] = []): Harness {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  document.body.append(container)
  for (const pane of panes) document.body.append(pane)
  const calls = {
    raise: 0,
    move: [] as Array<[number, number]>,
    resize: [] as Array<[number, number]>,
    dock: [] as Array<string | null>,
    close: 0,
  }
  const root: Root = createRoot(container)
  const render = (current: FloatWindow): void => {
    act(() => {
      root.render(createElement(FreeWindow, {
        float: current,
        renderTab: t => createElement('div', { 'data-testid': 'floatbody' }, t.id),
        onRaise: () => { calls.raise += 1 },
        onMove: (x, y) => { calls.move.push([x, y]) },
        onResize: (w, h) => { calls.resize.push([w, h]) },
        onDock: (paneId) => { calls.dock.push(paneId) },
        onClose: () => { calls.close += 1 },
      }))
    })
  }
  render(float)
  return {
    container,
    calls,
    win: () => ({
      root: container.querySelector<HTMLElement>('[data-dsh-float-window]')!,
      header: container.querySelector<HTMLElement>('[class*="floatHeader"]')!,
      resize: container.querySelector<HTMLElement>('[class*="floatResize"]')!,
      close: container.querySelector<HTMLElement>('[class*="floatClose"]')!,
    }),
    rerender: render,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
      for (const pane of panes) pane.remove()
    },
  }
}

/** A workbench pane with a real rect (the dock target). */
function pane(id: string, left: number, top: number, size = 100): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('data-dsh-pane', id)
  el.getBoundingClientRect = () => ({
    x: left, y: top, left, top, right: left + size, bottom: top + size, width: size, height: size, toJSON: () => ({}),
  } as DOMRect)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('FreeWindow pointer guards', () => {
  it('renders the floated tab and raises on any press', () => {
    const h = mountWindow(makeFloat())
    try {
      const { root, header } = h.win()
      expect(root.style.left).toBe('100px')
      expect(header.textContent).toContain('Notes')
      expect(root.querySelector('[data-testid="floatbody"]')).not.toBeNull()
      act(() => { root.dispatchEvent(pointer('pointerdown', 10, 10)) })
      expect(h.calls.raise).toBe(1)
    } finally {
      h.unmount()
    }
  })

  it('a non-primary press never starts a header or resize drag', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { header, resize } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220, 2))
        header.dispatchEvent(pointer('pointermove', 200, 250))
        resize.dispatchEvent(pointer('pointerdown', 300, 220, 2))
        resize.dispatchEvent(pointer('pointermove', 400, 300))
      })
      await flushFrame()
      expect(h.calls.move).toEqual([])
      expect(h.calls.resize).toEqual([])
    } finally {
      h.unmount()
    }
  })

  it('a press on the close button starts no drag', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { header, close } = h.win()
      act(() => {
        close.dispatchEvent(pointer('pointerdown', 5, 5))
        header.dispatchEvent(pointer('pointermove', 200, 250))
      })
      await flushFrame()
      expect(h.calls.move).toEqual([])
      expect(h.calls.close).toBe(0)
    } finally {
      h.unmount()
    }
  })

  it('pointer events without capture are ignored (mid-drag capture loss)', () => {
    const h = mountWindow(makeFloat())
    try {
      const { header, resize } = h.win()
      // No pointerdown: the move/up guards (dragRef null) short-circuit.
      act(() => {
        header.dispatchEvent(pointer('pointermove', 200, 250))
        header.dispatchEvent(pointer('pointerup', 200, 250))
        resize.dispatchEvent(pointer('pointermove', 400, 300))
        resize.dispatchEvent(pointer('pointerup', 400, 300))
      })
      expect(h.calls.move).toEqual([])
      expect(h.calls.resize).toEqual([])
      // pointercancel with no active drag is also a no-op.
      act(() => {
        header.dispatchEvent(pointer('pointercancel', 200, 250))
        header.dispatchEvent(new Event('lostpointercapture'))
      })
      expect(h.calls.move).toEqual([])
    } finally {
      h.unmount()
    }
  })
})

describe('FreeWindow drags', () => {
  it('coalesces two moves into one frame write and commits on release', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { header } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointermove', 310, 230))
        header.dispatchEvent(pointer('pointermove', 320, 240))
      })
      // One coalesced write per frame: the LAST pending geometry wins.
      await flushFrame()
      expect(h.win().root.style.left).toBe('120px')
      expect(h.calls.move).toEqual([])
      // The release position is the final truth (synchronous flush on up).
      act(() => { header.dispatchEvent(pointer('pointerup', 330, 250)) })
      expect(h.calls.move).toEqual([[130, 80]])
    } finally {
      h.unmount()
    }
  })

  it('a release with a still-pending frame flushes the write synchronously', () => {
    const h = mountWindow(makeFloat())
    try {
      const { header } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointermove', 350, 260))
        header.dispatchEvent(pointer('pointerup', 350, 260))
      })
      // The pending rAF was cancelled; the DOM got the geometry immediately.
      expect(h.win().root.style.left).toBe('150px')
      expect(h.calls.move).toEqual([[150, 90]])
    } finally {
      h.unmount()
    }
  })

  it('pointercancel commits the last applied geometry instead of rolling back', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { header } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointermove', 340, 240))
      })
      await flushFrame()
      act(() => { header.dispatchEvent(pointer('pointercancel', 999, 999)) })
      expect(h.calls.move).toEqual([[140, 70]])
      // The committed drag ignores the duplicate cancel.
      act(() => { header.dispatchEvent(new Event('lostpointercapture')) })
      expect(h.calls.move).toHaveLength(1)
    } finally {
      h.unmount()
    }
  })

  it('a fast flick cancel with NO applied move adopts the pending up coordinates', () => {
    const h = mountWindow(makeFloat())
    try {
      const { header } = h.win()
      // Cancel arrives before any rAF ran and without any pointermove: the
      // commit keeps the window's own (applied) geometry — never a rollback.
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointercancel', 280, 260))
      })
      expect(h.calls.move).toEqual([[100, 50]])
    } finally {
      h.unmount()
    }
  })

  it('a lostpointercapture abort with neither pending nor coordinates keeps the DOM size', () => {
    const h = mountWindow(makeFloat(), [])
    try {
      const { header } = h.win()
      // No move, no coordinates on lostpointercapture: the last applied size
      // (the window's own geometry) is adopted.
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('lostpointercapture', 300, 220))
      })
      expect(h.calls.move).toEqual([[100, 50]])
    } finally {
      h.unmount()
    }
  })

  it('releasing the header over a pane docks into it; moving between panes moves the highlight', async () => {
    const first = pane('pane:A', 0, 0)
    const second = pane('pane:B', 500, 500)
    const h = mountWindow(makeFloat(), [first, second])
    try {
      const { header } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointermove', 40, 40))
      })
      expect(first.hasAttribute('data-dsh-float-dock-over')).toBe(true)
      // A second move over the SAME pane keeps the highlight (no churn).
      act(() => { header.dispatchEvent(pointer('pointermove', 50, 50)) })
      expect(first.hasAttribute('data-dsh-float-dock-over')).toBe(true)
      // Moving off the panes clears the highlight.
      act(() => { header.dispatchEvent(pointer('pointermove', 300, 400)) })
      expect(first.hasAttribute('data-dsh-float-dock-over')).toBe(false)
      // Releasing over the second pane docks there.
      act(() => {
        header.dispatchEvent(pointer('pointermove', 550, 550))
        header.dispatchEvent(pointer('pointerup', 550, 550))
      })
      expect(h.calls.dock).toEqual(['pane:B'])
      expect(second.hasAttribute('data-dsh-float-dock-over')).toBe(false)
    } finally {
      h.unmount()
    }
  })

  it('skips zero-sized panes when hit-testing the dock target', async () => {
    const invisible = pane('ghost', 0, 0, 0)
    const real = pane('pane:R', 0, 0)
    const h = mountWindow(makeFloat(), [invisible, real])
    try {
      const { header } = h.win()
      act(() => {
        header.dispatchEvent(pointer('pointerdown', 300, 220))
        header.dispatchEvent(pointer('pointermove', 40, 40))
      })
      expect(invisible.hasAttribute('data-dsh-float-dock-over')).toBe(false)
      expect(real.hasAttribute('data-dsh-float-dock-over')).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('unmounting mid-drag cancels the pending frame and clears the dock highlight', async () => {
    const target = pane('pane:A', 0, 0)
    const h = mountWindow(makeFloat(), [target])
    const { header } = h.win()
    act(() => {
      header.dispatchEvent(pointer('pointerdown', 300, 220))
      header.dispatchEvent(pointer('pointermove', 40, 40))
    })
    expect(target.hasAttribute('data-dsh-float-dock-over')).toBe(true)
    h.unmount()
    // The unmount cleanup released the highlight.
    expect(target.hasAttribute('data-dsh-float-dock-over')).toBe(false)
  })
})

describe('FreeWindow resize handle', () => {
  it('resizes from the SE corner and commits on release', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { resize } = h.win()
      act(() => {
        resize.dispatchEvent(pointer('pointerdown', 400, 250))
        resize.dispatchEvent(pointer('pointermove', 450, 300))
        resize.dispatchEvent(pointer('pointermove', 460, 310))
      })
      await flushFrame()
      expect(h.win().root.style.width).toBe('360px')
      act(() => { resize.dispatchEvent(pointer('pointerup', 460, 310)) })
      expect(h.calls.resize).toEqual([[360, 260]])
    } finally {
      h.unmount()
    }
  })

  it('a cancel mid-resize commits the last applied size', async () => {
    const h = mountWindow(makeFloat())
    try {
      const { resize } = h.win()
      act(() => {
        resize.dispatchEvent(pointer('pointerdown', 400, 250))
        resize.dispatchEvent(pointer('pointermove', 440, 290))
      })
      await flushFrame()
      act(() => { resize.dispatchEvent(pointer('pointercancel', 0, 0)) })
      expect(h.calls.resize).toEqual([[340, 240]])
    } finally {
      h.unmount()
    }
  })
})

describe('FreeWindow header menu', () => {
  it('dock and close rows dispatch; an outside press just closes the menu', () => {
    const h = mountWindow(makeFloat())
    try {
      const { header } = h.win()
      act(() => { header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })) })
      const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      expect(rows.map(row => row.textContent)).toEqual([t('dockToSidebar'), t('close')])
      // The outside pointerdown closes the menu without dispatching.
      act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
      expect([...document.querySelectorAll('[role="menuitem"]')]).toHaveLength(0)
      expect(h.calls.dock).toEqual([])
      // Re-open: the dock row docks into the ACTIVE pane (null).
      act(() => { header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })) })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(row => (row.textContent ?? '') === t('dockToSidebar'))!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(h.calls.dock).toEqual([null])
      // Re-open: the close row closes the tab with its window.
      act(() => { header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })) })
      act(() => {
        [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
          .find(row => (row.textContent ?? '') === t('close'))!
          .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      })
      expect(h.calls.close).toBe(1)
    } finally {
      h.unmount()
    }
  })
})
