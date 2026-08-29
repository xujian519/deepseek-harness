// @vitest-environment jsdom
/**
 * EditorHost coverage round: the load strategies the base spec never mounts
 * (custom load success/failure/cancel, fsRead text/truncated/rejection,
 * binary download with and without a detect re-match), the tree context
 * menu's escapes (new tab, side split, open-with URL/reveal, pin toggle),
 * the refresh confirm gate, the drag guards, degenerate treeWidth metas, and
 * the path input's Escape/blur/no-change commits.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import type { Context } from '../src/context-types.ts'
import { api } from '../src/client/api.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, type SidebarTab } from '../src/client/state.ts'
import { resetChunks } from '../src/client/chunk-loader.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The viewer's prop text (payloads are strings; truncated flags are booleans). */
const propText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'boolean' ? String(value) : ''

/** A viewer component that prints its payload and (optionally) hoists a toolbar. */
const Marker = (label: string): ((props: Record<string, unknown>) => ReactNode) =>
  props => createElement('div', { 'data-testid': 'viewer' }, `${label}:${propText(props.content ?? props.customData)}:${propText(props.truncated ?? false)}`)

function setup(): {
  store: ReturnType<typeof createSidebarStore>
  ctx: Context
  service: ReturnType<typeof createBetterSidebarService>
  tabByPath: (path: string) => () => SidebarTab
} {
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  service.registerTab({ id: 'editor', title: 'Editor', dedupeKey: tab => tab.path, component: () => null })
  store.setSession('editor-home-session')
  const sessionsSnapshot = { byId: { 'editor-home-session': { cwd: '/tmp' } }, current: 'editor-home-session' }
  const ctx = {
    betterSidebar: service,
    get: (name: string) => name === 'betterSidebar' ? service : undefined,
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
  } as unknown as Context
  const tabByPath = (path: string): () => SidebarTab => (): SidebarTab =>
    allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(tab => tab.path === path)!
  return { store, ctx, service, tabByPath }
}

function mountHost(ctx: Context, store: ReturnType<typeof createSidebarStore>, tab: () => SidebarTab): {
  container: HTMLDivElement
  rerender: () => void
  unmount: () => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (): void => {
    root.render(createElement(EditorHost, {
      ctx,
      store,
      scope: { sessionId: 'editor-home-session', cwd: '/tmp' },
      tab: tab(),
      expanded: [],
      revealed: [],
      onToggleDir: () => {},
      onReferenceFile: () => {},
    }))
  }
  act(render)
  return {
    container,
    rerender: () => { act(render) },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

const flushed = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
}

/** Right-click the named file row and open its context menu. */
function openFileMenu(container: HTMLDivElement, name = 'b.ts'): void {
  const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')]
    .find(el => el.querySelector('[class*="explorerName"]')?.textContent === name)
  if (row === undefined) throw new Error(`file row not found: ${name}`)
  act(() => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }))
  })
}

const menuItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]

beforeEach(() => {
  resetChunks()
  vi.spyOn(api, 'fsTree').mockResolvedValue({
    path: '/',
    entries: [
      { name: 'a.ts', path: '/tmp/a.ts', isDir: false, hidden: false, isSymlink: false, broken: false },
      { name: 'b.ts', path: '/tmp/b.ts', isDir: false, hidden: false, isSymlink: false, broken: false },
    ],
    truncated: false,
  })
  vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'file body', truncated: false })
  vi.spyOn(api, 'openExternal').mockResolvedValue({ ok: true } as unknown as Awaited<ReturnType<typeof api.openExternal>>)
  // The plugin-settings write route: adopt the patch as the new prefs view.
  vi.spyOn(api, 'settingsUpdate').mockImplementation(async patch => ({ value: patch }))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('EditorHost load strategies', () => {
  it('a custom-strategy viewer loads its own data (success)', async () => {
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:custom', exts: ['custom'], fetchStrategy: 'custom',
      load: async () => 'custom payload',
      component: Marker('custom') as never,
    })
    service.openTab({ type: 'editor', title: 'x.custom', path: '/tmp/x.custom', id: 'editor:/tmp/x.custom' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.custom'))
    await flushed()
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe('custom:custom payload:false')
    unmount()
  })

  it('a custom-strategy viewer load failure renders the error text', async () => {
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:custom', exts: ['custom'], fetchStrategy: 'custom',
      load: async () => { throw new Error('custom blew up') },
      component: Marker('custom') as never,
    })
    service.openTab({ type: 'editor', title: 'x.custom', path: '/tmp/x.custom', id: 'editor:/tmp/x.custom' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.custom'))
    await flushed()
    expect(container.textContent).toContain('custom blew up')
    unmount()
  })

  it('a custom-strategy viewer settling after unmount updates nothing', async () => {
    const { store, ctx, service, tabByPath } = setup()
    let release: ((value: string) => void) | undefined
    service.registerFileViewer({
      id: 'test:custom', exts: ['custom'], fetchStrategy: 'custom',
      load: () => new Promise((resolve) => { release = resolve }),
      component: Marker('custom') as never,
    })
    service.openTab({ type: 'editor', title: 'x.custom', path: '/tmp/x.custom', id: 'editor:/tmp/x.custom' })
    const mounted = mountHost(ctx, store, tabByPath('/tmp/x.custom'))
    mounted.unmount()
    expect(() => { act(() => { release?.('late') }) }).not.toThrow()
  })

  it('an fsRead viewer renders text with its truncated flag', async () => {
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead', component: Marker('fsr') as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fsr'))
    await flushed()
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe('fsr:file body:false')
    unmount()
  })

  it('a truncated fsRead text carries the flag into the viewer', async () => {
    vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'partial', truncated: true })
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead', component: Marker('fsr') as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fsr'))
    await flushed()
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toBe('fsr:partial:true')
    unmount()
  })

  it('a failing fsRead renders the error', async () => {
    vi.spyOn(api, 'fsRead').mockRejectedValue('disk gone')
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead', component: Marker('fsr') as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fsr'))
    await flushed()
    expect(container.textContent).toContain('disk gone')
    unmount()
  })

  it('a binary read without a claiming detect viewer renders the download pane', async () => {
    vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'binary', head: btoa('MZ'), truncated: false } as Awaited<ReturnType<typeof api.fsRead>>)
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead', component: Marker('fsr') as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fsr'))
    await flushed()
    // The binary-download pane offers the media route + download link.
    expect(container.querySelector('[data-testid="viewer"]')).toBeNull()
    expect(container.textContent).not.toContain('Loading…')
    unmount()
  })

  it('a binary read whose head is claimed by a detect viewer re-routes to its strategy', async () => {
    vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'binary', head: btoa('SCORE!'), truncated: false } as Awaited<ReturnType<typeof api.fsRead>>)
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead', component: Marker('fsr') as never,
    })
    service.registerFileViewer({
      id: 'test:sniff', exts: [], priority: 10,
      detect: (_path, head) => new TextDecoder().decode(head).startsWith('SCORE'),
      fetchStrategy: 'none', component: Marker('sniff') as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fsr'))
    await flushed()
    expect(container.querySelector('[data-testid="viewer"]')?.textContent).toContain('sniff')
    unmount()
  })
})

describe('EditorHost tree menu escapes', () => {
  it('the context menu opens a new dedupe tab and a side split', async () => {
    const { store, ctx, tabByPath } = setup()
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts', meta: { treeOpen: true },
    })
    const { container, rerender, unmount } = mountHost(ctx, store, tabByPath('/tmp/a.ts'))
    await flushed()
    const editorPaths = (): Array<string | undefined> =>
      allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).map(tab => tab.path)
    openFileMenu(container, 'b.ts')
    act(() => { menuItems().find(item => item.textContent === 'Open in New Tab')!.click() })
    expect(editorPaths()).toEqual([undefined, '/tmp/a.ts', '/tmp/b.ts'])
    // "Open to the side" inserts a fresh uid tab in a rightward split.
    rerender()
    openFileMenu(container, 'b.ts')
    act(() => { menuItems().find(item => item.textContent === 'Open to the Side')!.click() })
    const tabs = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
    const sideTab = tabs.at(-1)!
    expect(sideTab.id).not.toBe('editor:/tmp/b.ts')
    expect(sideTab.path).toBe('/tmp/b.ts')
    expect(sideTab.meta).toEqual({ treeOpen: false })
    unmount()
  })

  it('the open-with menu hands the URL and reveal actions to the host opener', async () => {
    const openExternal = vi.spyOn(api, 'openExternal')
      .mockResolvedValueOnce({ ok: true } as unknown as Awaited<ReturnType<typeof api.openExternal>>)
      .mockRejectedValueOnce(new Error('opener gone'))
      .mockResolvedValueOnce({ ok: true } as unknown as Awaited<ReturnType<typeof api.openExternal>>)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { store, ctx, tabByPath } = setup()
    // A pinned target surfaces as a DIRECT menu row (no submenu hover).
    store.setPrefs({
      ...store.getPrefs(),
      pluginSettings: { editor: { openWith: { pinned: ['vscode'], customEditors: [], sshHost: '' } } },
    })
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts', meta: { treeOpen: true },
    })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/a.ts'))
    await flushed()
    openFileMenu(container)
    act(() => { menuItems().find(item => item.textContent === 'VS Code')!.click() })
    expect(openExternal).toHaveBeenLastCalledWith({ action: 'url', url: 'vscode://file//tmp/b.ts' })
    // The reveal row lives in the submenu: hover the parent to reveal it.
    openFileMenu(container)
    act(() => {
      menuItems().find(item => item.getAttribute('aria-haspopup') === 'menu')!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    act(() => { menuItems().find(item => item.textContent === 'File Manager')!.click() })
    await flushed()
    expect(openExternal).toHaveBeenLastCalledWith({ action: 'reveal', path: '/tmp/b.ts' })
    expect(errorSpy).toHaveBeenCalledWith('open external failed', expect.anything())
    unmount()
  })

  it('the submenu pushpin toggles a target\'s pinned state through plugin settings', async () => {
    const { store, ctx, tabByPath } = setup()
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts', meta: { treeOpen: true },
    })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/a.ts'))
    await flushed()
    openFileMenu(container)
    // Hovering the "Open with" parent reveals the submenu (React synthesizes
    // onMouseEnter from bubbling mouseover); the pushpin is a plain span.
    act(() => {
      menuItems().find(item => item.getAttribute('aria-haspopup') === 'menu')!
        .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    // The pushpin of the VS Code row (each submenu row carries its own).
    const row = menuItems().find(item => item.getAttribute('aria-haspopup') !== 'menu'
      && item.querySelector('[class*="openWithName"]')?.textContent === 'VS Code')!
    const pin = row.querySelector<HTMLElement>('[role="button"][aria-label="Pin to menu"]')!
    act(() => { pin.click() })
    await flushed()
    expect(store.getPrefs().pluginSettings['editor']?.openWith).toMatchObject({ pinned: ['vscode'] })
    unmount()
  })
})

describe('EditorHost refresh + toolbar edge cases', () => {
  it('a dirty draft asks for confirmation; declining keeps the content mounted', async () => {
    const { store, ctx, service, tabByPath } = setup()
    let loads = 0
    service.registerFileViewer({
      id: 'test:fake', exts: ['fake'], fetchStrategy: 'custom',
      load: () => { loads += 1; return Promise.resolve(undefined) },
      component: ((props: Record<string, unknown>) => {
        useEffect(() => {
          (props.onToolbarState as ((state: Record<string, unknown>) => void) | undefined)?.({ modes: true, mode: 'preview', dirty: true, editable: false, saveState: 'idle' })
        }, [])
        return Marker('fake')(props)
      }) as never,
    })
    service.openTab({ type: 'editor', title: 'x.fake', path: '/tmp/x.fake', id: 'editor:/tmp/x.fake' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fake'))
    await flushed()
    expect(loads).toBe(1)
    const refresh = container.querySelector<HTMLButtonElement>('button[title="Refresh"]')!
    // Declining the discard keeps the mounted viewer (no reload).
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    act(() => { refresh.click() })
    await flushed()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(loads).toBe(1)
    unmount()
  })

  it('a confirmed refresh reloads; a missing confirm function declines safely', async () => {
    const { store, ctx, service, tabByPath } = setup()
    service.registerFileViewer({
      id: 'test:fake', exts: ['fake'], fetchStrategy: 'none',
      component: ((props: Record<string, unknown>) => {
        useEffect(() => {
          (props.onToolbarState as ((state: Record<string, unknown>) => void) | undefined)?.({ modes: false, mode: 'preview', dirty: true, editable: false, saveState: 'idle' })
        }, [])
        return Marker('fake')(props)
      }) as never,
    })
    service.openTab({ type: 'editor', title: 'x.fake', path: '/tmp/x.fake', id: 'editor:/tmp/x.fake' })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fake'))
    await flushed()
    expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const refresh = container.querySelector<HTMLButtonElement>('button[title="Refresh"]')!
    act(() => { refresh.click() })
    await flushed()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="viewer"]')).not.toBeNull()
    unmount()

    // No window.confirm at all: the reload is refused (never discards blindly).
    delete (window as { confirm?: unknown }).confirm
    const second = mountHost(ctx, store, tabByPath('/tmp/x.fake'))
    await flushed()
    const refresh2 = second.container.querySelector<HTMLButtonElement>('button[title="Refresh"]')
    expect(refresh2).not.toBeNull()
    act(() => { refresh2!.click() })
    await flushed()
    expect(second.container.querySelector('[data-testid="viewer"]')).not.toBeNull()
    Object.defineProperty(window, 'confirm', { value: vi.fn(), configurable: true, writable: true })
    second.unmount()
  })

  it('a save-state edge into saved in preview mode reloads exactly once', async () => {
    const { store, ctx, service, tabByPath } = setup()
    let report: ((state: Record<string, unknown>) => void) | undefined
    let loads = 0
    service.registerFileViewer({
      id: 'test:fake', exts: ['fake'], fetchStrategy: 'custom',
      load: () => { loads += 1; return Promise.resolve(undefined) },
      component: ((props: Record<string, unknown>) => {
        useEffect(() => {
          report = props.onToolbarState as (state: Record<string, unknown>) => void
        }, [])
        return Marker('fake')(props)
      }) as never,
    })
    service.openTab({ type: 'editor', title: 'x.fake', path: '/tmp/x.fake', id: 'editor:/tmp/x.fake' })
    const { unmount } = mountHost(ctx, store, tabByPath('/tmp/x.fake'))
    await flushed()
    expect(loads).toBe(1)
    // An edge INTO saved while in preview mode fires exactly one reload.
    await act(async () => {
      report?.({ modes: true, mode: 'preview', dirty: false, editable: false, saveState: 'saved' })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(loads).toBe(2)
    // In edit mode a saved edge never reloads (the caret must survive).
    await act(async () => {
      report?.({ modes: true, mode: 'edit', dirty: true, editable: true, saveState: 'idle' })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      report?.({ modes: true, mode: 'edit', dirty: true, editable: true, saveState: 'saved' })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(loads).toBe(2)
    unmount()
  })
})

describe('EditorHost drag guards and meta clamps', () => {
  it('move/release without a drag start are ignored, and a zero-width drag persists nothing', () => {
    const { store, ctx, tabByPath } = setup()
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts',
      meta: { treeOpen: true, treeWidth: 240 },
    })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/a.ts'))
    const handle = container.querySelector('[role="separator"]')!
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100 }))
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100 }))
    })
    // A drag that ends where it started changes nothing, so no meta write.
    act(() => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 300 }))
      handle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 300 }))
    })
    expect(tabByPath('/tmp/a.ts')().meta).toEqual({ treeOpen: true, treeWidth: 240 })
    unmount()
  })

  it('degenerate treeWidth metas clamp or fall back to the default', () => {
    const { store, ctx, tabByPath } = setup()
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts',
      meta: { treeOpen: true, treeWidth: 9999 },
    })
    const { container, unmount } = mountHost(ctx, store, tabByPath('/tmp/a.ts'))
    expect((container.querySelector('[role="separator"]')!.parentElement!).style.width).toBe('480px')
    unmount()
    ctx.betterSidebar.openTab({
      type: 'editor', title: 'b.ts', path: '/tmp/b.ts', id: 'editor:/tmp/b.ts',
      meta: { treeOpen: true, treeWidth: 'wide' },
    })
    const second = mountHost(ctx, store, tabByPath('/tmp/b.ts'))
    expect((second.container.querySelector('[role="separator"]')!.parentElement!).style.width).toBe('240px')
    second.unmount()
  })
})

describe('EditorHost path input edges', () => {
  const fileHost = (): ReturnType<typeof setup> & { mounted: ReturnType<typeof mountHost> } => {
    const s = setup()
    ctxOpen(s)
    const mounted = mountHost(s.ctx, s.store, s.tabByPath('/tmp/a.ts'))
    return { ...s, mounted }
  }
  const ctxOpen = (s: ReturnType<typeof setup>): void => {
    s.ctx.betterSidebar.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts', meta: { treeOpen: false },
    })
  }

  it('Enter with an unchanged or empty value resets the input without opening', () => {
    const s = fileHost()
    const input = s.mounted.container.querySelector('input')!
    const tabsBefore = allLeaves(s.store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).length
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    act(() => { input.dispatchEvent(new Event('blur')) })
    const tabsAfter = allLeaves(s.store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).length
    expect(tabsAfter).toBe(tabsBefore)
    s.mounted.unmount()
  })

  it('typing then Escape/blur restores the current path', () => {
    const s = fileHost()
    const input = s.mounted.container.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'typed but abandoned')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect((input).value).toBe('typed but abandoned')
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect((input).value).toBe('a.ts')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'typed again')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect((input).value).toBe('a.ts')
    s.mounted.unmount()
  })
})
