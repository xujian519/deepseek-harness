/**
 * Side card settings section, interactive round: every write path against the
 * real component, store and service. The persisted document is read once on
 * mount (guarded against a newer optimistic edit), each row commits through
 * the fenced settings route with a revert + inline error on failure, the
 * inventory cards toggle `tabsEnabled` / `viewersEnabled`, the gear popups
 * carry both host-pref and plugin-owned rows (including the custom panel and
 * the custom-scheme strip popup), and the dashed cards open the add-plugin
 * modal. `api` is the only mocked seam — the route is the component's wire.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { FeatureSettingsRows, SideCardSection, SettingsBody, type SideCardSectionProps } from '../src/client/SideCardSection.tsx'
import { createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import { api } from '../src/client/api.ts'
import { t } from '../src/client/locales.ts'
import { SIDEBAR_PREFS_DEFAULTS, WIDTH_PERCENT_MAX, WIDTH_PERCENT_MIN } from '../src/prefs-shared.ts'
import { getShellPresets } from '../src/client/shell-presets.ts'

const PRESET = getShellPresets()[0]!

interface Harness {
  container: HTMLDivElement
  store: SidebarStore
  service: BetterSidebarService
  unmount: () => void
}

/** The two feature cards, the plugin-owned settings rows and the custom panel. */
function registerFeatures(service: BetterSidebarService): void {
  service.registerTab({
    id: 'demo',
    title: () => 'Demo tab',
    icon: size => createElement('i', { 'data-icon': 'demo', 'data-size': size }),
    order: 10,
    settings: {
      toggles: [
        { key: 'autoOpenSubagent', title: () => 'Auto subagent', desc: () => 'Opens on spawn' },
        { key: 'terminalFontFamily', type: 'text', title: 'Font family', placeholder: 'monospace' },
        { key: 'terminalFontSize', type: 'number', title: 'Font size', min: 9, max: 32, unit: 'px' },
        // No declared bounds: the clamp is a pass-through.
        { key: 'titleBarStripPx', type: 'number', title: 'Strip distance' },
        {
          key: 'editorExplorer',
          type: 'select',
          title: 'Explorer',
          options: [{ value: true, title: 'Merged' }, { value: false, title: 'Split' }],
        },
      ],
      pluginToggles: [
        { key: 'pluginFlag', title: 'Plugin flag' },
        { key: 'pluginText', type: 'text', title: 'Plugin text' },
        { key: 'pluginSize', type: 'number', title: 'Plugin size', min: 1, max: 10 },
        { key: 'pluginBare', type: 'number', title: 'Plugin bare number' },
        { key: 'pluginPick', type: 'select', title: 'Plugin pick', options: [{ value: 'a', title: 'A' }] },
        // No declared options / a multi pick with nothing stored yet.
        { key: 'pluginEmptyPick', type: 'select', title: 'Plugin empty pick' },
        {
          key: 'pluginMulti',
          type: 'select',
          multi: true,
          title: 'Plugin multi',
          options: [{ value: 'x', title: 'X' }, { value: 'y', title: 'Y' }],
        },
      ],
    },
    component: () => null,
  })
  // A feature with a custom panel only (no declarative rows).
  service.registerTab({
    id: 'panel',
    title: () => 'Panel tab',
    order: 20,
    settings: {
      render: panel => createElement(
        'button',
        {
          type: 'button',
          'data-panel': 'yes',
          onClick: () => {
            panel.updatePluginSetting('fromPanel', panel.pluginSettings.existing ?? 'x')
            panel.close()
          },
        },
        'panel body',
      ),
    },
    component: () => null,
  })
  // No icon, no settings, no explicit order, hidden — the inventory ordering
  // and the icon/settings fallbacks.
  service.registerTab({ id: 'bare', title: () => 'Bare tab', component: () => null })
  service.registerTab({ id: 'hiddenTab', title: () => 'Hidden tab', hidden: true, component: () => null })
  service.registerFileViewer({
    id: 'image',
    title: () => 'Image',
    icon: createElement('i', { 'data-icon': 'image' }),
    exts: ['png', 'jpg'],
    priority: 5,
    fetchStrategy: 'mediaUrl',
    component: () => null,
  })
  // A second unprioritized viewer: every `priority ?? 0` position runs.
  service.registerFileViewer({
    id: 'zeta',
    title: () => 'Zeta viewer',
    exts: ['zzz'],
    fetchStrategy: 'none',
    component: () => null,
  })
  // Untitled catch-all viewer (the card falls back to its id) with a settings gear.
  service.registerFileViewer({
    id: 'plain',
    title: '',
    exts: [],
    fetchStrategy: 'none',
    settings: { toggles: [{ key: 'autoOpenJobs', title: 'Jobs' }] },
    component: () => null,
  })
}

function mount(): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  registerFeatures(service)
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(SideCardSection, { store, service } as unknown as SideCardSectionProps)) })
  return {
    container,
    store,
    service,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Mount and flush the one-shot settings read (revision + values). */
async function mountSettled(): Promise<Harness> {
  const harness = mount()
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return harness
}

/** Dismiss the open dialog through its own close control. */
function closeDialog(): void {
  act(() => { dialog()!.querySelector<HTMLButtonElement>(`button[aria-label="${t('close')}"]`)!.click() })
}

const checkbox = (label: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${label}"]`)!

const inputByLabel = (scope: ParentNode, label: string): HTMLInputElement =>
  scope.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!

const cardByTitle = (h: Harness, title: string): HTMLButtonElement =>
  [...h.container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')]
    .find(button => button.textContent?.includes(title))!

/** The settings gear button of one feature card (null when none is rendered). */
const gearByLabel = (label: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label} ${t('settingsPopup')}"]`)

const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]')

/** Type into an input and commit it with blur (React's value tracker needs the
 *  native setter). */
function typeAndBlur(input: HTMLInputElement, value: string): void {
  // oxlint-disable-next-line unbound-method -- the native value setter, invoked with the input via call() below
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
}

/** Open one dropdown and return its portaled items. */
function openMenu(anchor: HTMLElement): HTMLElement[] {
  act(() => { anchor.click() })
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

beforeEach(() => {
  Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true })
  vi.spyOn(api, 'settingsGet').mockResolvedValue({ value: {}, revision: 1 })
  // The route is revision-guarded and returns the MERGED document, so the
  // stub accumulates patches like the host does.
  let document: Record<string, unknown> = { ...SIDEBAR_PREFS_DEFAULTS }
  vi.spyOn(api, 'settingsUpdate').mockImplementation(async (patch: Record<string, unknown>) => {
    document = { ...document, ...patch }
    return { value: document, revision: 2 }
  })
})

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  vi.restoreAllMocks()
})

describe('SideCardSection initial sync', () => {
  it('seeds the rows from the persisted document', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { openByDefault: true, defaultWidthPercent: 42 },
      revision: 9,
    })
    const h = await mountSettled()
    try {
      expect(checkbox(t('settingsOpenTitle')).checked).toBe(true)
      expect(inputByLabel(h.container, t('settingsWidthTitle')).value).toBe('42')
    } finally {
      h.unmount()
    }
  })

  it('keeps the store defaults when the read fails', async () => {
    vi.mocked(api.settingsGet).mockRejectedValue(new Error('route down'))
    const h = await mountSettled()
    try {
      expect(checkbox(t('settingsOpenTitle')).checked).toBe(SIDEBAR_PREFS_DEFAULTS.openByDefault)
      expect(h.container.querySelector('[role="alert"]')).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('drops a read that lands after the user already wrote', async () => {
    let release: ((view: { value: unknown; revision: number }) => void) | undefined
    vi.mocked(api.settingsGet).mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const h = mount()
    try {
      // The user writes first: the mount read must not clobber that edit.
      act(() => { checkbox(t('settingsOpenTitle')).click() })
      await act(async () => { await Promise.resolve() })
      expect(h.store.getPrefs().openByDefault).toBe(true)
      await act(async () => {
        release?.({ value: { openByDefault: false, defaultWidthPercent: 20 }, revision: 3 })
        await Promise.resolve()
      })
      expect(checkbox(t('settingsOpenTitle')).checked).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('drops a read that lands after unmount', async () => {
    let release: ((view: { value: unknown; revision: number }) => void) | undefined
    vi.mocked(api.settingsGet).mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const h = mount()
    h.unmount()
    release?.({ value: { openByDefault: true }, revision: 3 })
    await act(async () => { await Promise.resolve() })
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
  })

  it('re-sorts the inventory when a plugin registers another feature', async () => {
    const h = await mountSettled()
    try {
      const before = h.container.querySelectorAll('button[aria-pressed]').length
      act(() => {
        h.service.registerTab({ id: 'late', title: () => 'Late tab', order: 1, component: () => null })
      })
      expect(h.container.querySelectorAll('button[aria-pressed]')).toHaveLength(before + 1)
      // Registry order: explicit order first, then the unordered tab at the
      // default 100, hidden types last.
      const titles = [...h.container.querySelectorAll('button[aria-pressed]')]
        .map(button => button.textContent ?? '')
      const at = (title: string): number => titles.findIndex(entry => entry.includes(title))
      expect(at('Late tab')).toBeLessThan(at('Demo tab'))
      expect(at('Demo tab')).toBeLessThan(at('Bare tab'))
      expect(at('Bare tab')).toBeLessThan(at('Hidden tab'))
    } finally {
      h.unmount()
    }
  })

  it('orders viewer cards by priority with the unprioritized catch-all last', async () => {
    const h = await mountSettled()
    try {
      const titles = [...h.container.querySelectorAll('button[aria-pressed]')].map(button => button.textContent ?? '')
      const at = (title: string): number => titles.findIndex(entry => entry.includes(title))
      expect(at('Image')).toBeLessThan(at('plain'))
      // The untitled viewer falls back to its id for both the card and the
      // popup title, and its empty extension list reads as the catch-all copy.
      expect(at('plain')).toBeGreaterThan(-1)
      expect(titles.some(entry => entry.includes(t('settingsViewerCatchAll')))).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('renders no icon chip for a feature that declares no icon', async () => {
    const h = await mountSettled()
    try {
      expect(cardByTitle(h, 'Bare tab').querySelector('[class*="cardIconChip"]')).toBeNull()
      expect(cardByTitle(h, 'Demo tab').querySelector('[class*="cardIconChip"]')).not.toBeNull()
      expect(cardByTitle(h, 'Image').querySelector('[data-icon="image"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('SideCardSection general rows', () => {
  it('flips the open-by-default switch through the settings route', async () => {
    const h = await mountSettled()
    try {
      await act(async () => { checkbox(t('settingsOpenTitle')).click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ openByDefault: true }, 1)
      expect(h.store.getPrefs().openByDefault).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('flips the open-path and agent-tools switches', async () => {
    const h = await mountSettled()
    try {
      await act(async () => { checkbox(t('settingsOpenPathTitle')).click() })
      await act(async () => { checkbox(t('settingsOpenToolsTitle')).click() })
      // The first commit carries the revision read at mount, the second the
      // revision the first response returned.
      expect(api.settingsUpdate).toHaveBeenCalledWith({ interceptOpenPath: false }, 1)
      expect(api.settingsUpdate).toHaveBeenCalledWith({ agentOpenTools: true }, 2)
      expect(h.store.getPrefs().interceptOpenPath).toBe(false)
      expect(h.store.getPrefs().agentOpenTools).toBe(true)
    } finally {
      h.unmount()
    }
  })

  it('reverts an optimistic write and shows the wire error inline', async () => {
    vi.mocked(api.settingsUpdate).mockRejectedValue(new Error('disk full'))
    const h = await mountSettled()
    try {
      await act(async () => { checkbox(t('settingsOpenTitle')).click() })
      expect(h.store.getPrefs().openByDefault).toBe(false)
      expect(checkbox(t('settingsOpenTitle')).checked).toBe(false)
      expect(h.container.querySelector('[role="alert"]')!.textContent).toContain('disk full')
    } finally {
      h.unmount()
    }
  })

  it('shows the friendly conflict copy for a settings-conflict failure', async () => {
    vi.mocked(api.settingsUpdate).mockRejectedValue(Object.assign(new Error('revision'), { code: 'settings-conflict' }))
    const h = await mountSettled()
    try {
      await act(async () => { checkbox(t('settingsOpenTitle')).click() })
      expect(h.container.querySelector('[role="alert"]')!.textContent).toContain(t('settingsConflict'))
    } finally {
      h.unmount()
    }
  })

  it('stringifies a non-Error rejection into the inline error', async () => {
    vi.mocked(api.settingsUpdate).mockRejectedValue('plain refusal')
    const h = await mountSettled()
    try {
      await act(async () => { checkbox(t('settingsOpenTitle')).click() })
      expect(h.container.querySelector('[role="alert"]')!.textContent).toContain('plain refusal')
    } finally {
      h.unmount()
    }
  })

  it('commits the width row, clamped to the contract range', async () => {
    const h = await mountSettled()
    try {
      const input = inputByLabel(h.container, t('settingsWidthTitle'))
      typeAndBlur(input, '150')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ defaultWidthPercent: WIDTH_PERCENT_MAX }, 1)
      expect(h.store.getPrefs().defaultWidthPercent).toBe(WIDTH_PERCENT_MAX)
      expect(inputByLabel(h.container, t('settingsWidthTitle')).value).toBe(String(WIDTH_PERCENT_MAX))

      typeAndBlur(inputByLabel(h.container, t('settingsWidthTitle')), '0')
      await act(async () => { await Promise.resolve() })
      expect(h.store.getPrefs().defaultWidthPercent).toBe(WIDTH_PERCENT_MIN)
    } finally {
      h.unmount()
    }
  })

  it('commits the width row on Enter', async () => {
    const h = await mountSettled()
    try {
      const input = inputByLabel(h.container, t('settingsWidthTitle'))
      // oxlint-disable-next-line unbound-method -- the native value setter, invoked with the input via call() below
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      act(() => {
        setter.call(input, '33')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      // Enter is the keyboard commit: the row blurs itself, which commits.
      const blur = vi.spyOn(input, 'blur')
      act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
      expect(blur).not.toHaveBeenCalled()
      act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      expect(blur).toHaveBeenCalled()
      act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ defaultWidthPercent: 33 }, 1)
    } finally {
      h.unmount()
    }
  })
})

describe('SideCardSection scheme dropdown', () => {
  it('picks a plain scheme and mirrors the legacy compat flag', async () => {
    const h = await mountSettled()
    try {
      const anchor = h.container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      const items = openMenu(anchor)
      const web = items.find(item => item.textContent?.includes(t('settingsSchemeWebTitle')))!
      await act(async () => { web.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ titleBarScheme: 'web', titleBarCompat: false }, 1)
      expect(h.store.getPrefs().titleBarScheme).toBe('web')
      // A plain scheme needs no further settings: no gear on the row.
      expect(gearByLabel(t('settingsTitleBarTitle'))).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('stores a picked preset with its id and keeps the custom gear', async () => {
    const h = await mountSettled()
    try {
      const items = openMenu(h.container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!)
      await act(async () => { items.find(item => item.textContent?.includes(PRESET.title))!.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        titleBarScheme: 'preset',
        titleBarPresetId: PRESET.id,
        titleBarCompat: true,
      }, 1)
      expect(h.store.getPrefs().titleBarScheme).toBe('preset')

      // Picking the custom scheme reveals the gear that opens its settings.
      const again = openMenu(h.container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!)
      await act(async () => { again.find(item => item.textContent?.includes(t('settingsSchemeCustomTitle')))!.click() })
      expect(h.store.getPrefs().titleBarScheme).toBe('custom')
      expect(h.store.getPrefs().titleBarCompat).toBe(true)
      expect(gearByLabel(t('settingsTitleBarTitle'))).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('shows the resolved preset in the closed anchor and falls back to auto for a stale id', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { titleBarScheme: 'preset', titleBarPresetId: PRESET.id },
      revision: 1,
    })
    const h = await mountSettled()
    try {
      expect(h.container.querySelector('button[aria-haspopup="listbox"]')!.textContent).toContain(PRESET.title)
    } finally {
      h.unmount()
    }
    // A stored preset id that is no longer registered reads as auto (its
    // strip resolves to 0 anyway).
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { titleBarScheme: 'preset', titleBarPresetId: 'gone-shell' },
      revision: 1,
    })
    const stale = await mountSettled()
    try {
      expect(stale.container.querySelector('button[aria-haspopup="listbox"]')!.textContent)
        .toContain(t('settingsSchemeAutoTitle'))
    } finally {
      stale.unmount()
    }
  })

  it('opens the custom-scheme popup and commits the strip distance and custom CSS', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { titleBarScheme: 'custom', titleBarCompat: true },
      revision: 1,
    })
    const h = await mountSettled()
    try {
      act(() => { gearByLabel(t('settingsTitleBarTitle'))!.click() })
      const modal = dialog()!
      const strip = inputByLabel(modal, t('settingsTitleBarStripTitle'))
      typeAndBlur(strip, '200')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ titleBarStripPx: 120 }, 1)

      const cssArea = modal.querySelector<HTMLTextAreaElement>('textarea')!
      // oxlint-disable-next-line unbound-method -- the native value setter, invoked with the textarea via call() below
      const textSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      act(() => {
        textSetter.call(cssArea, '.x { color: red }')
        cssArea.dispatchEvent(new Event('input', { bubbles: true }))
        cssArea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      })
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ customCss: '.x { color: red }' }, 2)
    } finally {
      h.unmount()
    }
  })

  it('blurs the custom CSS area on Cmd/Ctrl+Enter', async () => {
    vi.mocked(api.settingsGet).mockResolvedValue({
      value: { titleBarScheme: 'custom', titleBarCompat: true },
      revision: 1,
    })
    const h = await mountSettled()
    try {
      act(() => { gearByLabel(t('settingsTitleBarTitle'))!.click() })
      const cssArea = dialog()!.querySelector<HTMLTextAreaElement>('textarea')!
      const blur = vi.spyOn(cssArea, 'blur')
      act(() => { cssArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true })) })
      expect(blur).not.toHaveBeenCalled()
      act(() => { cssArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })) })
      expect(blur).toHaveBeenCalled()
      // The Ctrl variant commits the same way.
      blur.mockClear()
      act(() => { cssArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })) })
      expect(blur).toHaveBeenCalled()
      // The Done footer closes the popup.
      act(() => { [...dialog()!.querySelectorAll('button')].find(button => button.textContent === t('settingsDone'))!.click() })
      expect(dialog()).toBeNull()
      // Reopened, its own close control dismisses it too.
      act(() => { gearByLabel(t('settingsTitleBarTitle'))!.click() })
      closeDialog()
      expect(dialog()).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('SideCardSection feature cards', () => {
  it('toggles a tab card and a viewer card through the merged pref maps', async () => {
    const h = await mountSettled()
    try {
      await act(async () => { cardByTitle(h, 'Demo tab').click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ tabsEnabled: { demo: false } }, 1)
      expect(h.store.getPrefs().tabsEnabled.demo).toBe(false)

      await act(async () => { cardByTitle(h, 'Image').click() })
      expect(h.store.getPrefs().viewersEnabled.image).toBe(false)
    } finally {
      h.unmount()
    }
  })

  it('hides the gear of a disabled feature', async () => {
    const h = await mountSettled()
    try {
      expect(gearByLabel('Demo tab')).not.toBeNull()
      await act(async () => { cardByTitle(h, 'Demo tab').click() })
      expect(gearByLabel('Demo tab')).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('opens the add-plugin modal from each dashed card', async () => {
    const h = await mountSettled()
    try {
      const addTab = [...h.container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes(t('addPluginsTabCard')))!
      act(() => { addTab.click() })
      expect(dialog()!.getAttribute('aria-label')).toBe(t('addPluginsTabCard'))
      act(() => { [...dialog()!.querySelectorAll('button')].find(button => button.textContent === t('settingsDone'))!.click() })
      expect(dialog()).toBeNull()

      const addViewer = [...h.container.querySelectorAll<HTMLButtonElement>('button')]
        .find(button => button.textContent?.includes(t('addPluginsViewerCard')))!
      act(() => { addViewer.click() })
      expect(dialog()!.getAttribute('aria-label')).toBe(t('addPluginsViewerCard'))
    } finally {
      h.unmount()
    }
  })
})

describe('SideCardSection feature settings popup', () => {
  it('writes the host rows, the plugin rows and the plugin number clamp', async () => {
    const h = await mountSettled()
    try {
      act(() => { gearByLabel('Demo tab')!.click() })
      const modal = dialog()!
      expect(modal.getAttribute('aria-label')).toBe('Demo tab')

      // Host switch row (the pref defaults on, so the click turns it off).
      await act(async () => { checkbox('Auto subagent').click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ autoOpenSubagent: false }, 1)

      // Host text row keeps an empty value meaningful.
      const fontFamily = inputByLabel(modal, 'Font family')
      typeAndBlur(fontFamily, '')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ terminalFontFamily: '' }, 2)

      // Host number row clamps into the declared bounds.
      const fontSize = inputByLabel(modal, 'Font size')
      typeAndBlur(fontSize, '99')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ terminalFontSize: 32 }, 2)

      // A number row without declared bounds commits the rounded value as-is.
      typeAndBlur(inputByLabel(modal, 'Strip distance'), '17.6')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ titleBarStripPx: 18 }, 2)

      // Enter is the keyboard commit for typed rows too; other keys are inert.
      // (The committed row remounts on its new key, so re-query it.)
      typeAndBlur(inputByLabel(modal, 'Font family'), 'mono')
      await act(async () => { await Promise.resolve() })
      const font = inputByLabel(modal, 'Font family')
      expect(font.value).toBe('mono')
      const fontBlur = vi.spyOn(font, 'blur')
      act(() => { font.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
      expect(fontBlur).not.toHaveBeenCalled()
      act(() => { font.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      expect(fontBlur).toHaveBeenCalled()

      // Host select row commits the picked option value.
      const select = modal.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!
      const item = openMenu(select).find(entry => entry.textContent?.includes('Split'))!
      await act(async () => { item.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ editorExplorer: false }, 2)

      const anchorOf = (label: string): HTMLButtonElement =>
        [...modal.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')]
          .find(anchor => anchor.getAttribute('aria-label') === label)!

      // Plugin-owned rows read and write the descriptor's own blob; sequential
      // writes stay additive (every merge builds on the latest optimistic map).
      // The first one runs before anything was stored: the missing blob reads
      // as empty, and a row with no declared bounds commits the rounded value.
      typeAndBlur(inputByLabel(modal, 'Plugin bare number'), '7.4')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ pluginSettings: { demo: { pluginBare: 7 } } }, 2)

      await act(async () => { checkbox('Plugin flag').click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        pluginSettings: { demo: { pluginBare: 7, pluginFlag: true } },
      }, 2)

      const pluginSize = inputByLabel(modal, 'Plugin size')
      typeAndBlur(pluginSize, '50')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        pluginSettings: { demo: { pluginBare: 7, pluginFlag: true, pluginSize: 10 } },
      }, 2)

      const pluginText = inputByLabel(modal, 'Plugin text')
      typeAndBlur(pluginText, 'hello')
      await act(async () => { await Promise.resolve() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        pluginSettings: { demo: { pluginBare: 7, pluginFlag: true, pluginSize: 10, pluginText: 'hello' } },
      }, 2)

      const pluginItems = openMenu(anchorOf('Plugin pick'))
      await act(async () => { pluginItems[0]!.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        pluginSettings: {
          demo: { pluginBare: 7, pluginFlag: true, pluginSize: 10, pluginText: 'hello', pluginPick: 'a' },
        },
      }, 2)

      // A select row with no declared options opens an empty menu; Escape
      // dismisses an open one.
      expect(openMenu(anchorOf('Plugin empty pick'))).toHaveLength(0)
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    } finally {
      h.unmount()
    }
  })

  it('commits a multi select from an empty pick as an options-ordered array', async () => {
    const h = await mountSettled()
    try {
      act(() => { gearByLabel('Demo tab')!.click() })
      const anchor = [...dialog()!.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')]
        .find(entry => entry.getAttribute('aria-label') === 'Plugin multi')!
      expect(anchor.textContent).toContain('—')
      const items = openMenu(anchor)
      expect(items.map(item => item.textContent)).toEqual(['X', 'Y'])
      await act(async () => { items[0]!.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({
        pluginSettings: { demo: { pluginMulti: ['x'] } },
      }, 1)
      // Multi-pick stays open with the picked row selected.
      expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
    } finally {
      h.unmount()
    }
  })

  it('renders a plugin text row whose stored value is not a scalar as empty', async () => {
    const h = await mountSettled()
    try {
      h.store.setPrefs({ ...h.store.getPrefs(), pluginSettings: { demo: { pluginText: { nested: true } } } })
      act(() => { gearByLabel('Demo tab')!.click() })
      expect(inputByLabel(dialog()!, 'Plugin text').value).toBe('')
    } finally {
      h.unmount()
    }
  })

  it('names the popup after the feature and falls back to the viewer id', async () => {
    const h = await mountSettled()
    try {
      expect(cardByTitle(h, t('settingsViewerCatchAll')).textContent).toContain('plain')
      act(() => { gearByLabel('plain')!.click() })
      expect(dialog()!.getAttribute('aria-label')).toBe('plain')
      // The dialog's own close control dismisses the popup.
      closeDialog()
      expect(dialog()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('writes through a custom settings panel and renders a throwing panel inline', async () => {
    const h = await mountSettled()
    try {
      act(() => { gearByLabel('Panel tab')!.click() })
      const panel = dialog()!.querySelector<HTMLButtonElement>('[data-panel="yes"]')!
      await act(async () => { panel.click() })
      expect(api.settingsUpdate).toHaveBeenCalledWith({ pluginSettings: { panel: { fromPanel: 'x' } } }, 1)
      // The panel closed its own popup through the render props' close().
      expect(dialog()).toBeNull()

      // A panel that throws surfaces the message instead of breaking the page.
      act(() => {
        h.service.registerTab({
          id: 'boom',
          title: () => 'Boom tab',
          order: 30,
          settings: { render: () => { throw new Error('panel exploded') } },
          component: () => null,
        })
      })
      act(() => { gearByLabel('Boom tab')!.click() })
      expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('panel exploded')
      closeDialog()

      // A panel that throws a non-Error surfaces its stringified value.
      act(() => {
        h.service.registerTab({
          id: 'boom2',
          title: () => 'Boom two',
          order: 31,
          settings: { render: () => { throw 'raw refusal' } },
          component: () => null,
        })
      })
      act(() => { gearByLabel('Boom two')!.click() })
      expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('raw refusal')
      // The Done footer closes the popup.
      act(() => { [...dialog()!.querySelectorAll('button')].find(button => button.textContent === t('settingsDone'))!.click() })
      expect(dialog()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('keeps a typed row draft when the row declares no commit handler', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    act(() => {
      root.render(createElement(FeatureSettingsRows, {
        toggles: [{ key: 'terminalFontFamily', type: 'text', title: 'Font family' }],
        prefs: { ...SIDEBAR_PREFS_DEFAULTS },
        onToggle: () => {},
      }))
    })
    try {
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Font family"]')!
      typeAndBlur(input, 'draft only')
      // With no handler the row keeps what the user typed (no canonical
      // value to adopt, no revert).
      expect(input.value).toBe('draft only')
    } finally {
      act(() => { root.unmount() })
      container.remove()
    }
  })

  it('drops a feature that declares nothing at all from the popup body', () => {
    const store = createSidebarStore()
    const service = createBetterSidebarService(store)
    const body = SettingsBody({
      feature: { id: 'empty', title: 'Empty', component: () => null },
      prefs: { ...SIDEBAR_PREFS_DEFAULTS },
      store,
      service,
      onToggle: () => {},
      onCommit: () => '',
      onSelectValue: () => {},
      onPluginToggle: () => {},
      onPluginCommit: () => '',
      onPluginSelectValue: () => {},
      onPluginWrite: () => {},
      onClose: () => {},
    })
    expect(body).toBeNull()
  })
})
