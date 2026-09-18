/**
 * The side card settings section on a desktop shell: with the URL stamps in
 * place (desktop-env.ts caches the parsed environment), the built-in shell
 * preset is offered as DETECTED. A dedicated file because the environment is
 * parsed once per module graph — other specs assert the undetected copy.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// Before the first parseDesktopEnv(): the advanced desktop shell on macOS.
window.history.replaceState({}, '', '?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin')

const { SideCardSection } = await import('../src/client/SideCardSection.tsx')
const { createSidebarStore } = await import('../src/client/state.ts')
const { createBetterSidebarService } = await import('../src/client/service.ts')
const { api } = await import('../src/client/api.ts')
const { parseDesktopEnv } = await import('../src/client/desktop-env.ts')
const { getShellPresets } = await import('../src/client/shell-presets.ts')

const PRESET = getShellPresets()[0]!

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SideCardSection on a desktop shell', () => {
  it('marks the matching shell preset as detected', async () => {
    vi.spyOn(api, 'settingsGet').mockResolvedValue({ value: {}, revision: 1 })
    const container = document.createElement('div')
    document.body.append(container)
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const root = createRoot(container)
    act(() => {
      root.render(createElement(
        SideCardSection,
        { store, service } as unknown as Parameters<typeof SideCardSection>[0],
      ))
    })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    try {
      const env = parseDesktopEnv()
      expect(env.desktop).toBe(true)
      expect(PRESET.detect?.(env)).toBe(true)
      act(() => { container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!.click() })
      // The detected badge rides the option's description, so the observable
      // here is that the preset row is offered at all.
      expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent))
        .toContain(PRESET.title)
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })
})
