/**
 * Upload overlay coverage: the full-window progress card over the files tree.
 * Percent math (0 for an empty total, capped at 100), the progressbar ARIA
 * values, the cancel button (disabled while cancellation is in flight), and
 * the Esc shortcut — a window-level keydown listener removed on unmount.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { UploadOverlay } from '../src/client/UploadOverlay.tsx'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(props: Partial<Parameters<typeof UploadOverlay>[0]> = {}): {
  container: HTMLDivElement
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(createElement(UploadOverlay, {
      dir: '/w/docs',
      done: 2,
      total: 4,
      current: 'report.pdf',
      onCancel: () => {},
      ...props,
    }))
  })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('UploadOverlay', () => {
  it('renders the target directory, per-file progress text and the ARIA values', () => {
    const onCancel = vi.fn()
    const { container, unmount } = mount({ onCancel })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-label')).toContain('/w/docs')
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar?.getAttribute('aria-valuemin')).toBe('0')
    expect(bar?.getAttribute('aria-valuemax')).toBe('4')
    expect(bar?.getAttribute('aria-valuenow')).toBe('2')
    expect(bar?.getAttribute('aria-valuetext')).toContain('report.pdf')
    // Halfway through: the fill is 50% wide.
    const fill = bar?.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('50%')
    expect(container.querySelector('button[disabled]')).toBeNull()
    unmount()
  })

  it('a zero total renders 0% instead of dividing by zero; 100% caps', () => {
    const zero = mount({ total: 0, done: 0, current: '' })
    const zeroFill = zero.container.querySelector('[role="progressbar"]')?.firstElementChild as HTMLElement
    expect(zeroFill.style.width).toBe('0%')
    zero.unmount()
    const full = mount({ total: 2, done: 5 })
    const fullFill = full.container.querySelector('[role="progressbar"]')?.firstElementChild as HTMLElement
    expect(fullFill.style.width).toBe('100%')
    full.unmount()
  })

  it('Esc cancels through the window listener and the button cancels too', () => {
    const onCancel = vi.fn()
    const { container, unmount } = mount({ onCancel })
    // Only Escape cancels; other keys are ignored.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    })
    expect(onCancel).not.toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
    const button = container.querySelector<HTMLButtonElement>('button')
    expect(button?.textContent).toBe('Cancel')
    act(() => { button!.click() })
    expect(onCancel).toHaveBeenCalledTimes(2)
    unmount()
  })

  it('the cancel button is disabled while cancellation is in flight', () => {
    const { container, unmount } = mount({ cancelling: true })
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    unmount()
  })

  it('the Esc listener is removed on unmount', () => {
    const onCancel = vi.fn()
    const { unmount } = mount({ onCancel })
    unmount()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
