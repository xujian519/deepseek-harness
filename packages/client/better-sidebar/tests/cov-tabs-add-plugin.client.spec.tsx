/**
 * PluginListBody remaining surfaces: the live search filter (function and
 * string descriptions), category grouping (string / function / none), the
 * "no match" and empty-catalog states, the topic button's window.open, and
 * the transient "Copied" feedback resetting on a timer. The tab catalog is
 * mocked with grouped entries because the shipped catalogs are flat and
 * uncategorized; the component behavior under test stays real.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { PluginListBody } from '../src/client/add-plugin-modal.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { createSidebarStore } from '../src/client/state.ts'
import type { PluginEntry } from '../src/client/plugins-shared.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// A controlled catalog: string description + string category, function
// description + function category, and one uncategorized entry (grouping
// order = first appearance, uncategorized last under no heading).
const catalog = vi.hoisted(() => [
  { id: 'p-cat', name: 'Catted', url: 'github:a/catted', install: 'dsh plugin add p-cat', description: 'First category', category: 'Tools' },
  { id: 'p-fn', name: 'Fncat', url: 'github:a/fncat', install: 'dsh plugin add p-fn', description: () => 'Lazy blurb', category: () => 'Dynamic' },
  { id: 'p-bare', name: 'Bare', url: 'github:a/bare', install: 'dsh plugin add p-bare', description: 'No group here' },
  { id: 'p-cat2', name: 'Catted Two', url: 'github:a/catted2', install: 'dsh plugin add p-cat2', description: 'Same group', category: 'Tools' },
])
vi.mock('../src/client/plugins-tabs.ts', () => ({ builtinTabPlugins: catalog }))

const service = createBetterSidebarService(createSidebarStore())

function mountBody(kind: 'tab' | 'viewer' = 'tab'): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => {
    root.render(createElement(PluginListBody, { service, kind }))
  })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Type into the search box (native setter so React sees the change). */
function search(container: HTMLDivElement, value: string): void {
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('PluginListBody search + grouping', () => {
  it('groups entries by category; an existing group accumulates later entries', () => {
    const { container, unmount } = mountBody()
    const headings = [...container.querySelectorAll('[class*="pluginGroupHeading"]')].map(el => el.textContent)
    expect(headings).toEqual(['Tools', 'Dynamic'])
    const groups = [...container.querySelectorAll('[class*=_pluginGroup_]')]
    expect(groups).toHaveLength(3)
    // The later Tools entry joined the FIRST group (push, not a new heading).
    expect(groups[0]!.textContent).toContain('Catted Two')
    expect(groups[0]!.querySelectorAll('[class*=_pluginEntry_]')).toHaveLength(2)
    expect(groups[2]!.textContent).toContain('Bare')
    expect(groups[2]!.querySelector('[class*="pluginGroupHeading"]')).toBeNull()
    unmount()
  })

  it('the search narrows by name, id, and lazily-resolved description', () => {
    const { container, unmount } = mountBody()
    search(container, 'p-fn')
    let names = [...container.querySelectorAll('[class*="pluginName"]')].map(el => el.textContent)
    expect(names).toEqual(['Fncat'])
    search(container, 'no group')
    names = [...container.querySelectorAll('[class*="pluginName"]')].map(el => el.textContent)
    expect(names).toEqual(['Bare'])
    search(container, 'zzz-nothing')
    // No match: the dedicated empty line, count 0.
    expect(container.textContent).toContain('No plugins match')
    expect(container.querySelector('[class*="count"]')?.textContent).toBe('0')
    unmount()
  })

  it('the topic button opens the GitHub topic in a new browser tab', () => {
    const opened: Array<[string, string, string]> = []
    const original = window.open
    window.open = ((url: string, target: string, features: string) => {
      opened.push([url, target, features])
      return null
    }) as typeof window.open
    const { container, unmount } = mountBody()
    try {
      const topic = container.querySelector('button[class*="pluginTopicBtn"]') as HTMLButtonElement
      act(() => { topic.click() })
      expect(opened).toHaveLength(1)
      expect(opened[0]![1]).toBe('_blank')
      expect(opened[0]![2]).toBe('noopener')
    } finally {
      window.open = original
      unmount()
    }
  })

  it('the Copied feedback resets after its timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const { container, unmount } = mountBody()
    const copies = [...container.querySelectorAll('button[aria-label^="Copy install command:"]')] as HTMLButtonElement[]
    await act(async () => { copies[0]!.click() })
    expect(copies[0]!.textContent).toBe('Copied')
    // Copying another entry moves the feedback; when the FIRST entry's timer
    // fires it must not clear the second entry's label (a stale reset).
    await act(async () => { copies[1]!.click() })
    expect(copies[1]!.textContent).toBe('Copied')
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(copies[0]!.textContent).toBe('Copy')
    expect(copies[1]!.textContent).toBe('Copy')
    unmount()
  })
})

describe('PluginListBody with an empty catalog', () => {
  it('renders the catalog-empty line instead of the list', async () => {
    vi.resetModules()
    vi.doMock('../src/client/plugins-tabs.ts', () => ({ builtinTabPlugins: [] as PluginEntry[] }))
    try {
      const { PluginListBody: EmptyCatalog } = await import('../src/client/add-plugin-modal.tsx')
      const container = document.createElement('div')
      document.body.append(container)
      const root: Root = createRoot(container)
      const freshService = createBetterSidebarService(createSidebarStore())
      act(() => {
        root.render(createElement(EmptyCatalog, { service: freshService, kind: 'tab' }))
      })
      expect(container.textContent).toContain('No plugins curated yet')
      expect(container.textContent).toContain('0')
      act(() => { root.unmount() })
      container.remove()
      document.body.innerHTML = ''
    } finally {
      vi.doUnmock('../src/client/plugins-tabs.ts')
      vi.resetModules()
    }
  })

  it('mounts without the optional modal className when the CSS module carries no key', async () => {
    // The modal className is a conditional spread guarded on the CSS module
    // key: with an empty style dictionary the modal still renders (unstyled).
    vi.resetModules()
    vi.doMock('../src/client/SideCardSection.module.css', () => ({ default: {} }))
    try {
      const { AddPluginModal: Bare } = await import('../src/client/add-plugin-modal.tsx')
      const container = document.createElement('div')
      document.body.append(container)
      const root: Root = createRoot(container)
      const freshService = createBetterSidebarService(createSidebarStore())
      const onClose = vi.fn()
      act(() => {
        root.render(createElement(Bare, { service: freshService, onClose, kind: 'tab' }))
      })
      expect(document.body.textContent).toContain('Browse more plugins on GitHub')
      act(() => { root.unmount() })
      container.remove()
      document.body.innerHTML = ''
    } finally {
      vi.doUnmock('../src/client/SideCardSection.module.css')
      vi.resetModules()
    }
  })
})
