/**
 * RenderBoundary's non-Error crash path: a subtree that throws a non-Error
 * value (a string, the classic `throw 'boom'`) shows the dismissible strip
 * with the String() of the value, and retry re-renders the children.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { RenderBoundary } from '../src/client/RenderBoundary.tsx'
import { t } from '../src/client/locales.ts'

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('RenderBoundary non-Error crashes', () => {
  it('shows String(value) for a thrown non-Error and recovers on retry', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow: string | null = 'raw string failure'
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    act(() => {
      root.render(createElement(RenderBoundary, { className: 'strip' },
        createElement(() => {
          if (shouldThrow !== null) throw shouldThrow
          return createElement('div', null, 'recovered')
        }),
      ))
    })
    // The strip shows the String() of the thrown value, not a crash.
    expect(container.textContent).toContain('dsh-better-sidebar: raw string failure')
    expect(container.textContent).toContain(t('terminalRetry'))
    expect(errorSpy).toHaveBeenCalled()
    // Retry with the fault gone remounts the children and clears the strip.
    shouldThrow = null
    const retry = [...container.querySelectorAll('button')]
      .find(button => button.textContent === t('terminalRetry'))
    expect(retry).toBeDefined()
    act(() => { retry!.click() })
    expect(container.textContent).toContain('recovered')
    root.unmount()
    container.remove()
  })
})
