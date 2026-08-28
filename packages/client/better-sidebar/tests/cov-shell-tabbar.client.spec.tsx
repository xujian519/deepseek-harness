/**
 * TabBar interaction round beyond the wheel/middle-click/context-menu
 * specs: tab-level drag-and-drop (start/over/drop/end, with and without the
 * pin marker), strip-level drops, the + menu lifecycle, the close button,
 * page-mode wheel deltas, and every tab-context-menu entry (float, pin
 * submenu, unpin, close family) including the pinned VIRTUAL tab's stripped
 * menu.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { parseDrag, serializeDrag, TabBar, TAB_DRAG_TYPE, type NewTabOption, type TabDragPayload } from '../src/client/TabBar.tsx'
import { t } from '../src/client/locales.ts'
import type { SidebarTab } from '../src/client/state.ts'

function dragEvent(type: string, dataTransfer: Partial<DragEvent['dataTransfer']> & { getData?: (type: string) => string } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      setData: vi.fn(),
      effectAllowed: '',
      getData: () => '',
      ...dataTransfer,
    },
  })
  return event
}

interface Harness {
  container: HTMLDivElement
  calls: { onActivate: string[]; onClose: string[]; onNewTab: string[]; onDropTab: Array<[TabDragPayload, string | null]>; onFloat: string[]; onPin: Array<[string, 'workspace' | 'global' | null]> }
  rerender: (tabs: SidebarTab[]) => void
  unmount: () => void
}

function mountBar(tabs: SidebarTab[], newTabOptions: NewTabOption[] = []): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const calls = {
    onActivate: [] as string[],
    onClose: [] as string[],
    onNewTab: [] as string[],
    onDropTab: [] as Array<[TabDragPayload, string | null]>,
    onFloat: [] as string[],
    onPin: [] as Array<[string, 'workspace' | 'global' | null]>,
  }
  const root: Root = createRoot(container)
  const render = (current: SidebarTab[]): void => {
    act(() => {
      root.render(createElement(TabBar, {
        paneId: 'pane:1',
        tabs: current,
        active: current[0]?.id ?? null,
        onActivate: (id) => { calls.onActivate.push(id) },
        onClose: (id) => { calls.onClose.push(id) },
        onNewTab: (id) => { calls.onNewTab.push(id) },
        newTabOptions,
        onFloatTab: (id) => { calls.onFloat.push(id) },
        onDropTab: (payload, before) => { calls.onDropTab.push([payload, before]) },
        onPinTab: (id, scope) => { calls.onPin.push([id, scope]) },
      }))
    })
  }
  render(tabs)
  return {
    container,
    calls,
    rerender: render,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

const menuRows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
const rowWith = (text: string): HTMLElement =>
  menuRows().find(row => (row.textContent ?? '').includes(text))!

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('parseDrag', () => {
  it('rejects malformed payloads and broken JSON', () => {
    expect(parseDrag('not json')).toBeNull()
    expect(parseDrag(JSON.stringify({ tabId: 't1' }))).toBeNull()
    expect(parseDrag(JSON.stringify({ tabId: 1, paneId: 'p' }))).toBeNull()
    expect(parseDrag(serializeDrag({ tabId: 't1', paneId: 'p1' }))).toEqual({ tabId: 't1', paneId: 'p1' })
  })
})

describe('tab drag-and-drop', () => {
  const baseTabs: SidebarTab[] = [
    { id: 't1', type: 'editor', title: 'A' },
    { id: 't2', type: 'git', title: 'B' },
  ]

  it('dragStart marks the body, serializes the payload; drop on a tab inserts before it', () => {
    const bar = mountBar(baseTabs)
    try {
      const tabEls = [...bar.container.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
      const setData = vi.fn()
      tabEls[0]!.dispatchEvent(dragEvent('dragstart', { setData }))
      expect(document.body.hasAttribute('data-dsh-tab-dragging')).toBe(true)
      expect(setData).toHaveBeenCalledWith(TAB_DRAG_TYPE, JSON.stringify({ tabId: 't1', paneId: 'pane:1' }))
      // dragEnd releases the body flag.
      tabEls[0]!.dispatchEvent(dragEvent('dragend'))
      expect(document.body.hasAttribute('data-dsh-tab-dragging')).toBe(false)
      // Dropping t1 onto t2 asks for an insert-before-t2 move.
      const raw = serializeDrag({ tabId: 't1', paneId: 'pane:1' })
      tabEls[1]!.dispatchEvent(dragEvent('drop', { getData: (type: string) => type === TAB_DRAG_TYPE ? raw : '' }))
      expect(bar.calls.onDropTab).toEqual([[{ tabId: 't1', paneId: 'pane:1' }, 't2']])
    } finally {
      bar.unmount()
      document.body.removeAttribute('data-dsh-tab-dragging')
    }
  })

  it('a pinned tab neither starts drags nor accepts drops', () => {
    const bar = mountBar([
      { id: 't1', type: 'terminal', title: 'Pinned', pin: { scope: 'global' } },
      { id: 't2', type: 'git', title: 'B' },
    ])
    try {
      const tabEls = [...bar.container.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
      const setData = vi.fn()
      tabEls[0]!.dispatchEvent(dragEvent('dragstart', { setData }))
      expect(setData).not.toHaveBeenCalled()
      expect(document.body.hasAttribute('data-dsh-tab-dragging')).toBe(false)
      const raw = serializeDrag({ tabId: 't2', paneId: 'pane:1' })
      tabEls[0]!.dispatchEvent(dragEvent('drop', { getData: () => raw }))
      expect(bar.calls.onDropTab).toEqual([])
      // The pin glyph renders on the pinned tab.
      expect(tabEls[0]!.querySelector('svg')).not.toBeNull()
    } finally {
      bar.unmount()
    }
  })

  it('strip-level drops merge into the pane and dragover highlights the strip', () => {
    const bar = mountBar(baseTabs)
    try {
      const barEl = bar.container.querySelector<HTMLElement>('[class*="tabBar"]')!
      const raw = serializeDrag({ tabId: 't2', paneId: 'pane:2' })
      act(() => { barEl.dispatchEvent(dragEvent('dragover')) })
      expect(barEl.className).toContain('Drop')
      act(() => { barEl.dispatchEvent(dragEvent('dragleave')) })
      act(() => { barEl.dispatchEvent(dragEvent('drop', { getData: (type: string) => type === TAB_DRAG_TYPE ? raw : '' })) })
      expect(bar.calls.onDropTab).toEqual([[{ tabId: 't2', paneId: 'pane:2' }, null]])
    } finally {
      bar.unmount()
    }
  })

  it('a page-mode wheel delta scrolls by the whole scrollport', () => {
    const bar = mountBar(baseTabs)
    try {
      const list = bar.container.querySelector<HTMLElement>('[class*="tabList"]')!
      Object.defineProperty(list, 'scrollWidth', { value: 600, configurable: true })
      Object.defineProperty(list, 'clientWidth', { value: 200, configurable: true })
      list.scrollLeft = 0
      list.dispatchEvent(new WheelEvent('wheel', { cancelable: true, deltaY: 1, deltaMode: 2 }))
      expect(list.scrollLeft).toBe(200)
    } finally {
      bar.unmount()
    }
  })
})

describe('close button and + menu', () => {
  it('the close button closes without activating the tab', () => {
    const bar = mountBar([{ id: 't1', type: 'editor', title: 'A' }])
    try {
      const close = bar.container.querySelector<HTMLElement>('[class*="tabClose"]')!
      act(() => { close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onClose).toEqual(['t1'])
      expect(bar.calls.onActivate).toEqual([])
    } finally {
      bar.unmount()
    }
  })

  it('the + menu opens, selects an option, and renders disabled/icon states', () => {
    const bar = mountBar([{ id: 't1', type: 'editor', title: 'A' }], [
      { id: 'opt-plain', label: 'Plain' },
      { id: 'opt-off', label: 'Off', disabled: true },
      { id: 'opt-icon', label: 'Iconed', icon: createElement('span', null, 'ICO') },
    ])
    try {
      const plus = bar.container.querySelector<HTMLElement>('[class*="tabBarPlus"]')!
      act(() => { plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      const rows = menuRows()
      expect(rows).toHaveLength(3)
      const disabled = rowWith('Off') as HTMLButtonElement
      expect(disabled.disabled).toBe(true)
      expect(rowWith('Iconed').textContent).toContain('ICO')
      act(() => { rowWith('Plain').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onNewTab).toEqual(['opt-plain'])
      // The selection closed the menu.
      expect(menuRows()).toHaveLength(0)
    } finally {
      bar.unmount()
    }
  })
})

describe('tab context menu entries', () => {
  const tabs: SidebarTab[] = [
    { id: 't1', type: 'editor', title: 'A' },
    { id: 't2', type: 'terminal', title: 'Term' },
    { id: 't3', type: 'git', title: 'C' },
  ]

  function openContextMenu(bar: Harness, title: string): void {
    const tabEl = [...bar.container.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
      .find(el => el.title === title)!
    act(() => { tabEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 })) })
  }

  it('float, pin submenu, unpin, and the close family all dispatch', async () => {
    const bar = mountBar([
      { id: 't1', type: 'editor', title: 'A' },
      { id: 't2', type: 'terminal', title: 'Term' },
    ])
    try {
      openContextMenu(bar, 'A')
      act(() => { rowWith(t('moveToFreeWindow')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onFloat).toEqual(['t1'])

      openContextMenu(bar, 'Term')
      // Unpinned terminal: a "Pin" parent row with a workspace/global submenu.
      const pinRow = rowWith(t('pinTerminal'))
      expect(pinRow.getAttribute('aria-haspopup')).toBe('menu')
      act(() => { pinRow.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
      act(() => { rowWith(t('pinToWorkspace')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onPin.at(-1)).toEqual(['t2', 'workspace'])

      // A PINNED terminal shows a single unpin row.
      bar.rerender([
        { id: 't1', type: 'editor', title: 'A' },
        { id: 't2', type: 'terminal', title: 'Term', pin: { scope: 'global' } },
      ])
      openContextMenu(bar, 'Term')
      act(() => { rowWith(t('unpinTerminal')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onPin.at(-1)).toEqual(['t2', null])

      // closeOthers / closeLeft / closeRight dispatch per-tab closes.
      openContextMenu(bar, 'Term')
      act(() => { rowWith(t('closeOtherTabs')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onClose).toEqual(['t1'])
      openContextMenu(bar, 'Term')
      act(() => { rowWith(t('closeLeftTabs')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onClose.at(-1)).toBe('t1')
      bar.rerender(tabs.slice(0, 2))
      openContextMenu(bar, 'A')
      act(() => { rowWith(t('closeRightTabs')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onClose.at(-1)).toBe('t2')
    } finally {
      bar.unmount()
    }
  })

  it('a pinned VIRTUAL tab offers only unpin and close', () => {
    const bar = mountBar([{
      id: 'pinned:home:t9',
      type: 'terminal',
      title: 'Remote',
      pin: { scope: 'global' },
      meta: { __pinnedHome: { sessionId: 'home', cwd: '/w', tabId: 't9' } },
    }])
    try {
      const tabEl = bar.container.querySelector<HTMLElement>('[class*="tabList"] > [class*="tab"]')!
      act(() => { tabEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 6 })) })
      const labels = menuRows().map(row => row.textContent)
      expect(labels).toHaveLength(2)
      expect(labels[0]).toContain(t('unpinTerminal'))
      act(() => { rowWith(t('close')).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(bar.calls.onClose).toEqual(['pinned:home:t9'])
      expect(bar.calls.onFloat).toEqual([])
    } finally {
      bar.unmount()
    }
  })

  it('the + button dismisses an open tab context menu (one menu at a time)', () => {
    const bar = mountBar(tabs)
    try {
      openContextMenu(bar, 'A')
      expect(menuRows().length).toBeGreaterThan(0)
      const plus = bar.container.querySelector<HTMLElement>('[class*="tabBarPlus"]')!
      act(() => { plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
      expect(menuRows()).toHaveLength(0)
    } finally {
      bar.unmount()
    }
  })
})
