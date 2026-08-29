/**
 * Workbench (split-pane) presentation tests against fake actions: divider
 * drags with the per-frame batching (summed incremental deltas, flushed on
 * release, capture-guarded), the VSCode drop-zone overlay (five zones, the
 * leave rules), empty-pane welcome cards, and the recursive split rendering.
 * jsdom lacks pointer capture, so the spec installs capture stubs.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Workbench, type WorkbenchActions } from '../src/client/split-pane.tsx'
import { serializeDrag, TAB_DRAG_TYPE } from '../src/client/TabBar.tsx'
import type { SidebarState, SidebarTab, SplitNode } from '../src/client/state.ts'

const state: SidebarState = {
  panelOpen: true, width: 400, activePane: 'pane:1', nextTerminal: 1, nextBrowser: 1,
  expanded: [], revealed: [], bottomOpen: false, bottomHeight: 220, bottomOpenedOnce: false,
  bottomSplits: { kind: 'leaf', id: 'pane:b', tabs: [], active: null },
  splits: { kind: 'leaf', id: 'pane:1', tabs: [], active: null },
  floats: [],
}

function makeActions(): WorkbenchActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    closeTab: (paneId, tabId) => { calls.push(`close:${paneId}:${tabId}`) },
    activateTab: (paneId, tabId) => { calls.push(`activate:${paneId}:${tabId}`) },
    focusPane: (paneId) => { calls.push(`focus:${paneId}`) },
    moveTabToEdge: (payload, toPane, zone) => { calls.push(`edge:${payload.tabId}:${toPane}:${zone}`) },
    moveTabBefore: (payload, toPane, before) => { calls.push(`before:${payload.tabId}:${toPane}:${before}`) },
    resizeSplit: (splitId, index, delta) => { calls.push(`resize:${splitId}:${index}:${delta.toFixed(3)}`) },
    floatTab: (tabId) => { calls.push(`float:${tabId}`) },
  }
}

function withRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}),
    ...rect,
  })
}

/** DragEvent-like helper (jsdom has no DragEvent). */
function drag(type: string, x = 0, y = 0, raw = ''): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'dataTransfer', { value: { getData: (t: string) => t === TAB_DRAG_TYPE ? raw : '' } })
  return event
}

function pointer(type: string, x: number, y: number, button = 0): Event {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button })
  Object.defineProperty(event, 'clientX', { value: x })
  Object.defineProperty(event, 'clientY', { value: y })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  return event
}

/** The flushFrame idiom from the free-window spec. */
const flushFrame = async (): Promise<void> => {
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() =>{  resolve() })) })
}

describe('Workbench presentation', () => {
  const host = document.createElement('div')
  let root: Root
  let actions: ReturnType<typeof makeActions>

  function mount(tree: SplitNode, tabs: SidebarTab[] = []): void {
    document.body.innerHTML = ''
    document.body.append(host)
    actions = makeActions()
    root = createRoot(host)
    const liveState: SidebarState = { ...state, splits: { kind: 'leaf', id: 'pane:1', tabs, active: tabs[0]?.id ?? null } }
    act(() => {
      root.render(createElement(Workbench, {
        state: liveState,
        tree,
        newTabOptions: [{ id: 'git', label: 'Git' }, { id: 'locked', label: 'Locked', disabled: true }],
        actions,
        onNewTab: (id) => { actions.calls.push(`new:${id}`) },
        renderTab: tab => createElement('div', { 'data-testid': 'tabbody' }, tab.id),
        getTabIcon: () => createElement('i', { 'data-testid': 'tabicon' }),
        getTabBadge: tab => tab.id === 't1' ? createElement('b', { className: 'probe-badge' }, '3') : null,
      }))
    })
  }

  afterEach(() => {
    if (root !== undefined) act(() => { root.unmount() })
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders tabs with icon and badge resolvers, and focuses a pane on pointerdown', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [{ id: 't1', type: 'editor', title: 'A' }], active: 't1' })
    expect(host.querySelector('[data-testid="tabicon"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="tabbody"]')!.textContent).toBe('t1')
    expect(host.querySelector('.probe-badge')!.textContent).toBe('3')
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    act(() => { pane.dispatchEvent(pointer('pointerdown', 10, 10)) })
    expect(actions.calls).toContain('focus:pane:1')
  })

  it('an empty pane renders welcome cards; a disabled card cannot open', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const cards = [...host.querySelectorAll<HTMLElement>('[class*="paneCard"]')]
    expect(cards.map(card => card.textContent)).toEqual(['Git', 'Locked'])
    expect((cards[1] as HTMLButtonElement).disabled).toBe(true)
    act(() => { cards[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(actions.calls).toEqual([])
    act(() => { cards[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(actions.calls).toEqual(['new:git'])
  })

  it('the drop overlay tracks the five VSCode zones and drop dispatches the edge move', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    withRect(pane, { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    const raw = serializeDrag({ tabId: 't9', paneId: 'pane:0' })
    // x is decided before y (the left/right bands win the corners).
    const zones: Array<[number, number, string]> = [
      [10, 50, 'Left'], [90, 50, 'Right'], [50, 10, 'Up'], [50, 90, 'Down'], [50, 50, 'Center'],
    ]
    for (const [x, y, css] of zones) {
      act(() => { pane.dispatchEvent(drag('dragover', x, y)) })
      const overlay = host.querySelector<HTMLElement>('[class*="dropOverlay"]')!
      expect(overlay.className).toContain(css)
      act(() => { pane.dispatchEvent(drag('dragover', 50, 50)) })
    }
    // A drop uses the last armed zone (center) and carries the payload.
    act(() => { pane.dispatchEvent(drag('dragover', 50, 50)) })
    act(() => { pane.dispatchEvent(drag('drop', 50, 50, raw)) })
    expect(actions.calls).toEqual(['edge:t9:pane:1:center'])
    expect(host.querySelector('[class*="dropOverlay"]')).toBeNull()
  })

  it('a zero-sized pane maps every position to the center zone', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    // jsdom's default rect is zero-sized: zoneAt short-circuits to center.
    act(() => { pane.dispatchEvent(drag('dragover', 5, 5)) })
    const overlay = host.querySelector<HTMLElement>('[class*="dropOverlay"]')!
    expect(overlay.className).toContain('Center')
    // A drop without a payload lands nothing.
    act(() => { pane.dispatchEvent(drag('drop', 5, 5)) })
    expect(actions.calls).toEqual([])
  })

  it('dragLeave clears the overlay only when the pointer left the pane entirely', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    withRect(pane, { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    act(() => { pane.dispatchEvent(drag('dragover', 10, 50)) })
    expect(host.querySelector('[class*="dropOverlay"]')).not.toBeNull()
    // Moving onto a CHILD keeps the overlay (relatedTarget inside).
    const leaveToChild = drag('dragleave', 40, 50)
    Object.defineProperty(leaveToChild, 'relatedTarget', { value: pane.firstChild })
    act(() => { pane.dispatchEvent(leaveToChild) })
    expect(host.querySelector('[class*="dropOverlay"]')).not.toBeNull()
    // Leaving for real clears it.
    const leave = drag('dragleave', 40, 50)
    Object.defineProperty(leave, 'relatedTarget', { value: null })
    act(() => { pane.dispatchEvent(leave) })
    expect(host.querySelector('[class*="dropOverlay"]')).toBeNull()
  })

  it('a window-level dragend clears a lingering overlay', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    withRect(pane, { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    act(() => { pane.dispatchEvent(drag('dragover', 10, 50)) })
    expect(host.querySelector('[class*="dropOverlay"]')).not.toBeNull()
    act(() => { window.dispatchEvent(new Event('dragend')) })
    expect(host.querySelector('[class*="dropOverlay"]')).toBeNull()
  })

  it('reordering drops between tabs dispatch moveTabBefore', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [{ id: 't1', type: 'editor', title: 'A' }, { id: 't2', type: 'git', title: 'B' }], active: null }, [{ id: 't1', type: 'editor', title: 'A' }, { id: 't2', type: 'git', title: 'B' }])
    const tabEls = [...host.querySelectorAll<HTMLElement>('[class*="tabList"] > [class*="tab"]')]
    const raw = serializeDrag({ tabId: 't1', paneId: 'pane:1' })
    act(() => { tabEls[1]!.dispatchEvent(drag('drop', 0, 0, raw)) })
    expect(actions.calls).toEqual(['before:t1:pane:1:t2'])
  })

  it('split trees render dividers whose drags batch incremental deltas per frame', async () => {
    const tree: SplitNode = {
      kind: 'split', id: 'sp1', dir: 'row', sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'p-left', tabs: [], active: null },
        { kind: 'leaf', id: 'p-right', tabs: [], active: null },
      ],
    }
    mount(tree)
    // A row split renders a horizontal divider between the two children.
    const divider = host.querySelector<HTMLElement>('[class*="divider"]')!
    expect(divider.className).toContain('dividerRow')
    const parent = divider.parentElement!
    withRect(parent, { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 })
    // jsdom has no pointer capture; the component calls it directly.
    divider.setPointerCapture = () => {}
    divider.releasePointerCapture = () => {}
    divider.hasPointerCapture = () => true
    act(() => { divider.dispatchEvent(pointer('pointerdown', 100, 50)) })
    expect(divider.className).toContain('dividerActive')
    // Two moves inside one frame batch into ONE resize with the SUMMED delta.
    act(() => {
      divider.dispatchEvent(pointer('pointermove', 110, 50))
      divider.dispatchEvent(pointer('pointermove', 130, 50))
    })
    await flushFrame()
    // 30px over a 200px-wide container = 0.15.
    expect(actions.calls).toEqual(['resize:sp1:0:0.150'])
    // A move batch with a zero NET delta (out then back) applies nothing.
    act(() => {
      divider.dispatchEvent(pointer('pointermove', 120, 50))
      divider.dispatchEvent(pointer('pointermove', 130, 50))
    })
    await flushFrame()
    expect(actions.calls).toHaveLength(1)
    // The release flushes and drops the active class.
    act(() => { divider.dispatchEvent(pointer('pointerup', 140, 50)) })
    expect(divider.className).not.toContain('dividerActive')
  })

  it('a column split renders the column divider and ignores moves without capture', async () => {
    const tree: SplitNode = {
      kind: 'split', id: 'sp2', dir: 'col', sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'p-top', tabs: [], active: null },
        { kind: 'leaf', id: 'p-bottom', tabs: [], active: null },
      ],
    }
    mount(tree)
    const divider = host.querySelector<HTMLElement>('[class*="divider"]')!
    expect(divider.className).toContain('dividerCol')
    const parent = divider.parentElement!
    withRect(parent, { left: 0, top: 0, width: 100, height: 200, right: 100, bottom: 200 })
    divider.setPointerCapture = () => {}
    divider.releasePointerCapture = () => {}
    divider.hasPointerCapture = () => true
    act(() => { divider.dispatchEvent(pointer('pointerdown', 50, 100)) })
    act(() => { divider.dispatchEvent(pointer('pointermove', 50, 150)) })
    await flushFrame()
    expect(actions.calls).toEqual(['resize:sp2:0:0.250'])
    // Capture lost mid-drag: moves are ignored until re-down.
    divider.hasPointerCapture = () => false
    act(() => { divider.dispatchEvent(pointer('pointermove', 50, 300)) })
    await flushFrame()
    expect(actions.calls).toHaveLength(1)
  })

  it('a col split maps the up/down zones to col inserts (zone coverage via real drops)', () => {
    const tree: SplitNode = {
      kind: 'split', id: 'sp3', dir: 'col', sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'p-top', tabs: [], active: null },
        { kind: 'leaf', id: 'p-bottom', tabs: [], active: null },
      ],
    }
    mount(tree)
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="p-top"]')!
    withRect(pane, { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    const raw = serializeDrag({ tabId: 't7', paneId: 'p-bottom' })
    act(() => { pane.dispatchEvent(drag('dragover', 50, 90)) })
    const overlay = host.querySelector<HTMLElement>('[class*="dropOverlay"]')!
    expect(overlay.className).toContain('Down')
    act(() => { pane.dispatchEvent(drag('drop', 50, 90, raw)) })
    expect(actions.calls).toEqual(['edge:t7:p-top:down'])
  })

  it('a drop with an armed zone keeps it even at another position (drop uses state first)', () => {
    mount({ kind: 'leaf', id: 'pane:1', tabs: [], active: null })
    const pane = host.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    withRect(pane, { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    const raw = serializeDrag({ tabId: 't8', paneId: 'p' })
    // Arm LEFT, then drop at the far edge: the armed zone wins over a
    // recomputed right zone.
    act(() => { pane.dispatchEvent(drag('dragover', 10, 50)) })
    act(() => { pane.dispatchEvent(drag('drop', 90, 50, raw)) })
    expect(actions.calls).toEqual(['edge:t8:pane:1:left'])
  })
})
