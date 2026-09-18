// @vitest-environment jsdom
/**
 * Final coverage round for the sidebar client's component tails: the service
 * tails (openFile's title fallback, a URL seed without a title, and a
 * descriptor patch that replaces the workbench tree), the workbench's
 * tree-less render / payload-less drop / capture-less release, the browser
 * tab's inert navigation controls before a URL exists, PdfView's drag shield
 * while the frame is still loading, TreePanel's cancel edges (Escape after a
 * cancel, a progress report arriving after the session settled), MdToc
 * mounted without a parent element, the lazy chunk's post-unmount rejection,
 * and DiffTab's post-unmount settle plus the worktree→commit prop swap.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { api } from '../src/client/api.ts'
import { BrowserView } from '../src/client/BrowserView.tsx'
import { registerChunkForTests, resetChunks } from '../src/client/chunk-loader.ts'
import { DiffTab } from '../src/client/DiffTab.tsx'
import { lazyChunkComponent } from '../src/client/lazy-chunk.tsx'
import { MdToc } from '../src/client/md-toc.tsx'
import { PdfView } from '../src/client/PdfView.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { Workbench, type WorkbenchActions } from '../src/client/split-pane.tsx'
import { allLeaves, createSidebarStore, type SidebarDiffRef, type SidebarState, type SidebarTab, type SplitNode } from '../src/client/state.ts'
import { TreePanel } from '../src/client/TreePanel.tsx'
import type { UploadResult } from '../src/client/upload.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The upload queue the TreePanel mounts — driven per test, never real network. */
const upload = vi.hoisted(() => ({ toDir: vi.fn() }))

vi.mock('../src/client/upload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/upload.ts')>()
  return { ...actual, uploadToDir: upload.toDir }
})

/** The diff child, recorded per render so a transient prop swap is observable. */
const diffRenders = vi.hoisted(() => ({
  props: [] as { diff: string; untrackedPath?: string; untrackedContent?: string }[],
}))

vi.mock('../src/client/DiffView.tsx', () => ({
  DiffView: (props: { diff: string; untrackedPath?: string; untrackedContent?: string }) => {
    diffRenders.props.push(props)
    return createElement('div', { 'data-testid': 'diff-view' })
  },
}))

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return { ...actual, api: { ...actual.api, fsTree: vi.fn(async () => ({ entries: [] })) } }
})

/** Mount one element in a fresh container; jsdom-lane cleanup is the caller's. */
function mount(node: ReturnType<typeof createElement>): { container: HTMLDivElement; root: Root; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return {
    container,
    root,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

const flushed = async (): Promise<void> => {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0) }) })
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
  resetChunks()
  diffRenders.props.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('BetterSidebar service tails', () => {
  /** A store on a live session, with an editor + probe descriptor registered. */
  function serviceWith(tabs: Parameters<ReturnType<typeof createBetterSidebarService>['registerTab']>[0][]): {
    store: ReturnType<typeof createSidebarStore>
    service: ReturnType<typeof createBetterSidebarService>
  } {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    for (const tab of tabs) service.registerTab(tab)
    return { store, service }
  }

  const landedTabs = (store: ReturnType<typeof createSidebarStore>): SidebarTab[] => {
    const state = store.getSnapshot().state as SidebarState
    return allLeaves(state.splits).concat(allLeaves(state.bottomSplits)).flatMap(leaf => leaf.tabs)
  }

  it('openFile titles the tab with the file name when the path has no separator', () => {
    const { store, service } = serviceWith([
      { id: 'editor', title: () => 'Editor', dedupeKey: tab => tab.path, component: () => null },
    ])
    service.openFile({ sessionId: 's1', cwd: '/ws' }, 'notes.md')
    expect(landedTabs(store)).toContainEqual({ id: 'editor:notes.md', title: 'notes.md', path: 'notes.md', type: 'editor' })
  })

  it('a URL seed without a title keeps the descriptor title and still pre-fills the path', () => {
    const { store, service } = serviceWith([
      { id: 'browser', title: 'Browser', component: () => null },
    ])
    service.openTab({ type: 'browser', url: 'https://example.com/x' })
    expect(landedTabs(store)).toContainEqual({
      id: 'browser', type: 'browser', title: 'Browser', path: 'https://example.com/x',
    })
  })

  it('a createTab patch that replaces the workbench tree still reports the minted tab and opens the panel', () => {
    const onOpen = vi.fn()
    const { store, service } = serviceWith([{
      id: 'probe',
      title: 'Probe',
      onOpen,
      createTab: () => ({
        tab: { id: 'probe:1', type: 'probe', title: 'Probe' },
        patch: { splits: { kind: 'leaf', id: 'pane:replaced', tabs: [], active: null }, activePane: null },
      }),
      component: () => null,
    }])
    // A content open (a path seed) — the panel must come into sight afterwards.
    service.openTab({ type: 'probe', path: 'a.ts' })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 'probe:1', type: 'probe' })
    expect(store.getSnapshot().state?.panelOpen).toBe(true)
  })
})

describe('Workbench tails', () => {
  function renderWorkbench(overrides: { tree?: SplitNode; state?: Partial<SidebarState> }): {
    container: HTMLDivElement
    calls: string[]
    unmount: () => void
  } {
    const calls: string[] = []
    const actions: WorkbenchActions = {
      closeTab: () => {},
      activateTab: () => {},
      focusPane: () => {},
      moveTabToEdge: (payload, toPane, zone) => { calls.push(`edge:${payload.tabId}:${toPane}:${zone}`) },
      moveTabBefore: () => {},
      resizeSplit: () => {},
      floatTab: () => {},
    }
    const state: SidebarState = {
      panelOpen: true, width: 400, activePane: 'pane:1', nextTerminal: 1, nextBrowser: 1,
      expanded: [], revealed: [], bottomOpen: false, bottomHeight: 220, bottomOpenedOnce: false,
      bottomSplits: { kind: 'leaf', id: 'pane:b', tabs: [], active: null },
      splits: { kind: 'leaf', id: 'pane:1', tabs: [{ id: 't1', type: 'editor', title: 'A' }], active: 't1' },
      floats: [],
      ...overrides.state,
    }
    const props = {
      state,
      ...(overrides.tree !== undefined ? { tree: overrides.tree } : {}),
      newTabOptions: [],
      actions,
      onNewTab: () => {},
      renderTab: (tab: SidebarTab) => createElement('div', null, tab.id),
    }
    const { container, unmount } = mount(createElement(Workbench, props))
    return { container, calls, unmount }
  }

  const pointer = (type: string, x: number, y: number): Event => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clientX', { value: x })
    Object.defineProperty(event, 'clientY', { value: y })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    return event
  }

  const drag = (type: string, x: number, y: number, raw = ''): Event => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clientX', { value: x })
    Object.defineProperty(event, 'clientY', { value: y })
    Object.defineProperty(event, 'dataTransfer', {
      value: { getData: (name: string) => name === 'application/x-dsh-tab' ? raw : '' },
    })
    return event
  }

  it('without an explicit tree the workbench renders the state splits', () => {
    const { container, unmount } = renderWorkbench({})
    expect(container.querySelector('[data-dsh-pane="pane:1"]')).not.toBeNull()
    expect(container.querySelector('[class*="workbench"]')).not.toBeNull()
    unmount()
  })

  it('a drop with no armed dragover resolves the zone from the cursor', () => {
    const { container, calls, unmount } = renderWorkbench({})
    const pane = container.querySelector<HTMLElement>('[data-dsh-pane="pane:1"]')!
    // jsdom's default rect is zero-sized → the center zone.
    act(() => { pane.dispatchEvent(drag('drop', 5, 5, JSON.stringify({ tabId: 't9', paneId: 'pane:0' }))) })
    expect(calls).toEqual(['edge:t9:pane:1:center'])
    unmount()
  })

  it('a release without pointer capture neither flushes nor drops the drag state', () => {
    const tree: SplitNode = {
      kind: 'split', id: 'sp1', dir: 'row', sizes: [0.5, 0.5],
      children: [
        { kind: 'leaf', id: 'p-left', tabs: [], active: null },
        { kind: 'leaf', id: 'p-right', tabs: [], active: null },
      ],
    }
    const { container, calls, unmount } = renderWorkbench({ tree })
    const divider = container.querySelector<HTMLElement>('[class*="divider"]')!
    divider.setPointerCapture = () => {}
    divider.releasePointerCapture = () => {}
    divider.hasPointerCapture = () => false
    act(() => { divider.dispatchEvent(pointer('pointerdown', 100, 50)) })
    act(() => { divider.dispatchEvent(pointer('pointerup', 140, 50)) })
    // The release was ignored: the divider stays active and nothing resized.
    expect(divider.className).toContain('dividerActive')
    expect(calls).toEqual([])
    unmount()
  })
})

describe('BrowserView navigation controls', () => {
  it('back/forward/external-open are inert until a URL exists', () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    vi.spyOn(api, 'browserProbe').mockResolvedValue({ reachable: true })
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    const { container, unmount } = mount(createElement(BrowserView, {
      ctx: { betterSidebar: service, get: () => service } as never,
      store,
      scope: { sessionId: 's1', cwd: '/ws' },
      tab: { id: 'browser:1', type: 'browser', title: 'Browser' },
      visible: true,
    } as never))
    const button = (label: string): HTMLButtonElement =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
    expect([button('Back').disabled, button('Forward').disabled, button('Open in browser').disabled])
      .toEqual([true, true, true])
    // Disabled form controls swallow their activation entirely.
    act(() => { button('Back').click() })
    act(() => { button('Forward').click() })
    act(() => { button('Open in browser').click() })
    expect(opened).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Enter a URL to start browsing')
    unmount()
  })
})

describe('PdfView drag shield before the frame exists', () => {
  it('a drag while still loading leaves the absent frame and shield alone', () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(() => {}))
    const { container, unmount } = mount(createElement(PdfView, {
      scope: { sessionId: 's1', cwd: '/ws' },
      path: '/ws/doc.pdf',
      title: 'doc.pdf',
    }))
    expect(container.querySelector('iframe')).toBeNull()
    act(() => { document.dispatchEvent(new Event('dragstart')) })
    expect(container.querySelector('[class*="editorPdfDragShieldActive"]')).not.toBeNull()
    // The release restores the (absent) frame and shield refs without throwing.
    act(() => { document.dispatchEvent(new Event('dragend')) })
    expect(container.querySelector('[class*="editorPdfDragShieldActive"]')).toBeNull()
    unmount()
  })
})

describe('TreePanel upload edges', () => {
  const panelProps = {
    sessionId: 's1',
    cwd: '/w',
    expanded: [],
    revealed: [],
    onToggle: () => {},
    onOpenFile: () => {},
    onReferenceFile: () => {},
  }

  /** Pick one file through the hidden file input (index 0 = files). */
  const pick = (container: HTMLDivElement, files: File[]): void => {
    const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]!
    Object.defineProperty(input, 'files', { value: files, configurable: true })
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  }

  const overlay = (container: HTMLDivElement): HTMLElement | null =>
    container.querySelector<HTMLElement>('[class*="uploadOverlay"]')

  it('Escape during an in-flight cancel does not abort the request a second time', () => {
    const aborts: AbortSignal[] = []
    let settle: (() => void) | undefined
    upload.toDir.mockImplementation((_scope, _dir, _items, _progress, signal: AbortSignal) => {
      aborts.push(signal)
      return new Promise<UploadResult[]>((resolve) => { settle = () => { resolve([]) } })
    })
    const abort = vi.spyOn(AbortController.prototype, 'abort')
    const { container, unmount } = mount(createElement(TreePanel, panelProps))
    pick(container, [new File(['x'], 'a.txt')])
    expect(overlay(container)).not.toBeNull()
    const cancel = [...container.querySelectorAll('button')].find(button => button.textContent === 'Cancel')!
    act(() => { cancel.click() })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(aborts[0]!.aborted).toBe(true)
    // The cancel is in flight (the button is disabled); Escape must be a no-op.
    expect(cancel.disabled).toBe(true)
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(abort).toHaveBeenCalledTimes(1)
    expect(overlay(container)).not.toBeNull()
    act(() => { settle?.() })
    unmount()
  })

  it('a progress report arriving after the session settled does not resurrect the overlay', async () => {
    let report: ((done: number, total: number, current: string) => void) | undefined
    let settle: (() => void) | undefined
    upload.toDir.mockImplementation((_scope, _dir, _items, onProgress: (done: number, total: number, current: string) => void) => {
      report = onProgress
      return new Promise<UploadResult[]>((resolve) => { settle = () => { resolve([{ relativePath: 'a.txt', ok: true }]) } })
    })
    const { container, unmount } = mount(createElement(TreePanel, panelProps))
    pick(container, [new File(['x'], 'a.txt')])
    expect(overlay(container)).not.toBeNull()
    await act(async () => { settle?.() })
    expect(overlay(container)).toBeNull()
    const hint = container.querySelector('[class*="editorSearchHint"]')!.textContent
    // The late report lands on a closed session: the overlay stays down.
    act(() => { report?.(1, 1, '') })
    expect(overlay(container)).toBeNull()
    expect(container.querySelector('[class*="editorSearchHint"]')!.textContent).toBe(hint)
    unmount()
  })
})

describe('MdToc without a parent container', () => {
  it('stays inert when the bar has no parent element to outline', () => {
    // Mounting into a document fragment is the one way barRef.current has no
    // parentElement: the container read yields null and the effect returns.
    const fragment = document.createDocumentFragment()
    const root = createRoot(fragment)
    act(() => { root.render(createElement(MdToc)) })
    expect(fragment.querySelector('[data-dsh-md-toc]')).toBeNull()
    const bar = fragment.firstElementChild!
    expect(bar.parentElement).toBeNull()
    expect(bar.textContent).toBe('')
    act(() => { root.unmount() })
  })
})

describe('lazy chunk post-unmount rejection', () => {
  it('a load rejection after unmount never consults the picker and renders nothing', () => {
    let reject: ((error: unknown) => void) | undefined
    registerChunkForTests('editor', () => new Promise((_resolve, rej) => { reject = rej }))
    const pick = vi.fn(() => undefined)
    const Wrapper = lazyChunkComponent<Record<string, never>>('editor', pick)
    const { container, unmount } = mount(createElement(Wrapper, {}))
    unmount()
    expect(() => { act(() => { reject?.(new Error('late failure')) }) }).not.toThrow()
    expect(pick).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
  })
})

describe('DiffTab tails', () => {
  const DIFF = ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-x', '+y'].join('\n')

  it('a worktree load settling after unmount updates nothing', () => {
    let release: ((value: { diff: string }) => void) | undefined
    vi.spyOn(api, 'gitDiff').mockImplementation(() => new Promise((resolve) => { release = resolve }))
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: false }
    const { container, unmount } = mount(createElement(DiffTab, { sessionId: 's1', cwd: '/ws', diff: ref }))
    unmount()
    expect(api.gitDiff).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/ws' }, 'a.ts', false, undefined)
    const renders = diffRenders.props.length
    expect(() => { act(() => { release?.({ diff: DIFF }) }) }).not.toThrow()
    // The dead instance re-rendered nothing: the diff never reached the view.
    expect(diffRenders.props).toHaveLength(renders)
    expect(container.textContent).toBe('')
  })

  it('swapping an untracked worktree ref for a commit ref renders the fallback path as empty', async () => {
    vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: '' })
    vi.spyOn(api, 'gitCommitDiff').mockResolvedValue({ diff: DIFF })
    vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'brand new\n', truncated: false })
    const worktree: SidebarDiffRef = { kind: 'worktree', path: 'new.ts', staged: false, untracked: true }
    const { root, unmount } = mount(createElement(DiffTab, { sessionId: 's1', cwd: '/ws', diff: worktree }))
    await flushed()
    expect(diffRenders.props.at(-1)).toMatchObject({ untrackedPath: 'new.ts', untrackedContent: 'brand new\n' })
    // The commit ref arrives while the worktree data is still in state: the
    // pre-effect render must not claim a worktree path for a commit.
    const commit: SidebarDiffRef = { kind: 'commit', hash: 'abc1234', hashFull: 'abcdef123456', subject: 'fix' }
    act(() => { root.render(createElement(DiffTab, { sessionId: 's1', cwd: '/ws', diff: commit })) })
    expect(diffRenders.props.at(-1)).toMatchObject({ untrackedPath: '' })
    await flushed()
    expect(diffRenders.props.at(-1)).toEqual({ diff: DIFF })
    unmount()
  })
})
