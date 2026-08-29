/**
 * OpenWithSettings remaining event paths: editing a custom editor's name and
 * URL template inputs, and patching one row of a MULTI-editor list (a row's
 * edit must keep its siblings untouched).
 */
// @vitest-environment jsdom
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { OpenWithSettings } from '../src/client/open-with-settings.tsx'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

beforeAll(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

interface Harness {
  container: HTMLDivElement
  update: ReturnType<typeof vi.fn>
  unmount: () => void
}

function mountSettings(rawOpenWith: unknown): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const update = vi.fn()
  act(() => {
    root.render(createElement(OpenWithSettings, {
      pluginSettings: { openWith: rawOpenWith },
      updatePluginSetting: update,
    }))
  })
  return {
    container,
    update,
    unmount: () => { act(() => { root.unmount() }) },
  }
}

/** Type into a named input (native setter so React's tracker sees it). */
function type(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const twoEditors = {
  sshHost: '',
  customEditors: [
    { id: 'a', name: 'Windsurf', urlTemplate: 'windsurf://file/{path}', isVscodeFamily: false },
    { id: 'b', name: 'Stable', urlTemplate: 'stable://file/{path}', isVscodeFamily: true },
  ],
  pinned: [],
}

describe('OpenWithSettings row edits', () => {
  let harness: Harness
  afterEach(() => {
    harness.unmount()
    document.body.innerHTML = ''
  })

  it('editing the name input commits the patched row', () => {
    harness = mountSettings(twoEditors)
    const name = harness.container.querySelector<HTMLInputElement>('input[placeholder="Name"]')
    expect(name?.value).toBe('Windsurf')
    type(name!, 'Wave')
    expect(harness.update).toHaveBeenCalledWith('openWith', expect.objectContaining({
      customEditors: [
        expect.objectContaining({ id: 'a', name: 'Wave' }),
        expect.objectContaining({ id: 'b', name: 'Stable' }),
      ],
    }))
  })

  it('editing the template input commits the patched row (siblings untouched)', () => {
    harness = mountSettings(twoEditors)
    const template = harness.container.querySelector<HTMLInputElement>('input[placeholder*="://"]')
    expect(template?.value).toBe('windsurf://file/{path}')
    type(template!, 'wave://open/{path}')
    const blob = harness.update.mock.calls[0]?.[1] as { customEditors: Array<{ id: string; urlTemplate: string }> }
    expect(blob.customEditors[0]).toMatchObject({ id: 'a', urlTemplate: 'wave://open/{path}' })
    expect(blob.customEditors[1]).toMatchObject({ id: 'b', urlTemplate: 'stable://file/{path}' })
  })

  it('valid rows render no validity hint', () => {
    harness = mountSettings(twoEditors)
    expect(harness.container.textContent).not.toContain('are not shown in the menu')
  })
})
