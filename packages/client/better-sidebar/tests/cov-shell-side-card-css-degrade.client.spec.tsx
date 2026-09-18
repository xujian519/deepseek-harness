/**
 * The Side card section against a built stylesheet that carries none of the
 * plugin's own classes: the width row, a typed settings row and both popups
 * must degrade to unclassed elements instead of crashing (the CSS module
 * stand-in below resolves every read to undefined, the same contract the
 * MdToc flash spec pins for a missing class).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../src/client/SideCardSection.module.css', () => ({ default: {} }))

const { SideCardSection } = await import('../src/client/SideCardSection.tsx')
const { createSidebarStore } = await import('../src/client/state.ts')
const { createBetterSidebarService } = await import('../src/client/service.ts')
const { api } = await import('../src/client/api.ts')
const { t } = await import('../src/client/locales.ts')

function mount(prefsExtra: Record<string, unknown> = {}): HTMLDivElement {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab({
    id: 'demo',
    title: () => 'Demo tab',
    settings: {
      toggles: [
        { key: 'terminalFontFamily', type: 'text', title: 'Font family' },
        { key: 'terminalFontSize', type: 'number', title: 'Font size', min: 9, max: 32, unit: 'px' },
      ],
    },
    component: () => null,
  })
  const root = createRoot(container)
  act(() => {
    root.render(createElement(SideCardSection, { store, service } as unknown as Parameters<typeof SideCardSection>[0]))
  })
  void prefsExtra
  return container
}

beforeEach(() => {
  vi.spyOn(api, 'settingsGet').mockResolvedValue({ value: {}, revision: 1 })
  vi.spyOn(api, 'settingsUpdate').mockResolvedValue({ value: {}, revision: 2 })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('SideCardSection without the plugin stylesheet', () => {
  it('still renders the width row and the typed settings rows', async () => {
    const container = mount()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    const width = container.querySelector<HTMLInputElement>(`input[aria-label="${t('settingsWidthTitle')}"]`)!
    expect(width.type).toBe('number')

    act(() => { container.querySelector<HTMLButtonElement>('button[aria-label$="settings"]')!.click() })
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    const font = dialog.querySelector<HTMLInputElement>('input[aria-label="Font family"]')!
    expect(font.type).toBe('text')
    const size = dialog.querySelector<HTMLInputElement>('input[aria-label="Font size"]')!
    expect(size.type).toBe('number')
    expect(size.min).toBe('9')
    expect(size.max).toBe('32')
  })

  it('still renders the custom-scheme popup', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { titleBarScheme: 'custom', titleBarCompat: true },
      revision: 1,
    })
    const container = mount()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    act(() => {
      container.querySelector<HTMLButtonElement>(`button[aria-label="${t('settingsTitleBarTitle')} ${t('settingsPopup')}"]`)!.click()
    })
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.querySelector('textarea')).not.toBeNull()
  })
})
