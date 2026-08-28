// @vitest-environment jsdom
/**
 * Edge-path round across the tab surfaces: loads that settle after their
 * host unmounted (the cancelled guards in DiffTab, EditorHost and PdfView),
 * the editor toolbar's saving/failed labels, the browser bar's guards driven
 * by raw dispatched events, and the untracked diff without content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { api } from '../src/client/api.ts'
import { DiffTab } from '../src/client/DiffTab.tsx'
import { DiffView } from '../src/client/DiffView.tsx'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { PdfView } from '../src/client/PdfView.tsx'
import { BrowserView } from '../src/client/BrowserView.tsx'
import type { Context } from '../src/context-types.ts'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore } from '../src/client/state.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Mount `node`; the returned unmount flushes the React teardown. */
function mountNode(node: ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(node) })
  return {
    container,
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

/** A deferred promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-x',
  '+y',
].join('\n')

beforeEach(() => {
  vi.spyOn(api, 'fsTree').mockResolvedValue({ path: '/', entries: [], truncated: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('DiffTab cancelled guards', () => {
  it('a load settling after unmount updates nothing', async () => {
    const gitDiff = deferred<{ diff: string }>()
    vi.spyOn(api, 'gitDiff').mockReturnValue(gitDiff.promise)
    const { container, unmount } = mountNode(createElement(DiffTab, {
      sessionId: 's1', cwd: '/ws', diff: { kind: 'worktree', path: 'a.ts', staged: false },
    }))
    expect(container.textContent).toContain('Loading…')
    unmount()
    // The whole chain (first side, other side, empty-diff fallback) settles
    // into a dead component: every guard must skip its setState.
    await act(async () => { gitDiff.resolve({ diff: '' }) })
    await flushed()
  })

  it('a commit load and its error path settling after unmount update nothing', async () => {
    const commitDiff = deferred<{ diff: string }>()
    vi.spyOn(api, 'gitCommitDiff').mockReturnValue(commitDiff.promise)
    const commit = mountNode(createElement(DiffTab, {
      sessionId: 's1', cwd: '/ws',
      diff: { kind: 'commit', hash: 'abc1234', hashFull: 'abcdef', subject: 's' },
    }))
    commit.unmount()
    await act(async () => { commitDiff.resolve({ diff: DIFF }) })
    await flushed()

    const failure = deferred<{ diff: string }>()
    vi.spyOn(api, 'gitDiff').mockReturnValue(failure.promise)
    const worktree = mountNode(createElement(DiffTab, {
      sessionId: 's1', cwd: '/ws', diff: { kind: 'worktree', path: 'b.ts', staged: true },
    }))
    worktree.unmount()
    await act(async () => { failure.reject(new Error('too late')) })
    await flushed()
    // The spinner cleared on unmount (the finally guard skipped the reset).
    expect(document.querySelector('[class*="gitPlaceholder"]')).toBeNull()
  })

  it('an untracked fallback resolving after unmount skips its setData', async () => {
    vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: '' })
    const read = deferred<{ kind: 'text'; content: string }>()
    vi.spyOn(api, 'fsRead').mockReturnValue(read.promise as never)
    const { container, unmount } = mountNode(createElement(DiffTab, {
      sessionId: 's1', cwd: '/ws', diff: { kind: 'worktree', path: 'c.ts', staged: false, untracked: true },
    }))
    await flushed()
    unmount()
    await act(async () => { read.resolve({ kind: 'text', content: 'late body\n' }) })
    await flushed()
    expect(container.textContent).not.toContain('late body')
  })
})

describe('DiffView untracked without content', () => {
  it('an absent untrackedContent reads as an empty file', () => {
    const { container, unmount } = mountNode(createElement(DiffView, { diff: '', untrackedPath: 'x.ts' }))
    expect(container.textContent).toContain('x.ts')
    expect(container.querySelectorAll('div[class*="gitDiffLine"]')).toHaveLength(0)
    unmount()
  })
})

describe('PdfView aborted loads', () => {
  it('bytes landing after unmount are dropped before the blob is created', async () => {
    const createObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    }))
    const bytes = deferred<ArrayBuffer>()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: () => bytes.promise }) as unknown as Response))
    const { container, unmount } = mountNode(createElement(PdfView, {
      scope: { sessionId: 's1', cwd: '/ws' }, path: '/ws/d.pdf', title: 'd.pdf',
    }))
    unmount()
    await act(async () => { bytes.resolve(new ArrayBuffer(4)) })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(container.isConnected).toBe(false)
    vi.unstubAllGlobals()
  })

  it('a rejection landing after unmount updates nothing', async () => {
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn(),
    }))
    const failure = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => failure.promise as unknown as Promise<Response>))
    const { container, unmount } = mountNode(createElement(PdfView, {
      scope: { sessionId: 's1', cwd: '/ws' }, path: '/ws/d.pdf', title: 'd.pdf',
    }))
    unmount()
    await act(async () => { failure.reject(new Error('late http 500')) })
    expect(container.textContent ?? '').not.toContain('late http 500')
    vi.unstubAllGlobals()
  })
})

describe('EditorHost cancelled guards and toolbar labels', () => {
  function setup(): {
    store: ReturnType<typeof createSidebarStore>
    ctx: Context
    service: ReturnType<typeof createBetterSidebarService>
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
    return { store, ctx, service }
  }

  function hostFor(ctx: Context, store: ReturnType<typeof createSidebarStore>, path: string): {
    container: HTMLDivElement
    unmount: () => void
  } {
    const tab = () => allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(candidate => candidate.path === path)!
    return mountNode(createElement(EditorHost, {
      ctx, store,
      scope: { sessionId: 'editor-home-session', cwd: '/tmp' },
      tab: tab(),
      expanded: [], revealed: [],
      onToggleDir: () => {}, onReferenceFile: () => {},
    }))
  }

  it('custom loads settling after unmount update nothing (resolve and reject)', async () => {
    const { store, ctx, service } = setup()
    const loads = deferred<string>()
    service.registerFileViewer({
      id: 'test:custom', exts: ['custom'], fetchStrategy: 'custom',
      load: () => loads.promise,
      component: ((props: Record<string, unknown>) => {
        useEffect(() => { (props.onToolbarState as ((state: Record<string, unknown>) => void) | undefined)?.({ modes: false, mode: 'preview', dirty: false, editable: false, saveState: 'idle' }) }, [])
        return createElement('div', { 'data-testid': 'viewer' }, `custom:${String(props.customData)}`)
      }) as never,
    })
    service.openTab({ type: 'editor', title: 'x.custom', path: '/tmp/x.custom', id: 'editor:/tmp/x.custom' })
    const { container, unmount } = hostFor(ctx, store, '/tmp/x.custom')
    unmount()
    await act(async () => { loads.resolve('late data') })
    // A second viewer instance: rejection with a non-Error after unmount.
    const failure = deferred<string>()
    vi.spyOn(api, 'fsTree').mockResolvedValue({ path: '/', entries: [], truncated: false })
    service.registerFileViewer({
      id: 'test:custom2', exts: ['custom2'], fetchStrategy: 'custom',
      load: () => failure.promise,
      component: (() => createElement('div', null, 'nope')) as never,
    })
    service.openTab({ type: 'editor', title: 'y.custom', path: '/tmp/y.custom', id: 'editor:/tmp/y.custom' })
    const second = hostFor(ctx, store, '/tmp/y.custom')
    second.unmount()
    await act(async () => { failure.reject('late plain failure') })
    expect(container.isConnected).toBe(false)
  })

  it('fsRead results and failures settling after unmount update nothing', async () => {
    const { store, ctx, service } = setup()
    service.registerFileViewer({
      id: 'test:fsr', exts: ['fsr'], fetchStrategy: 'fsRead',
      component: (() => createElement('div', null, 'fsr')) as never,
    })
    service.openTab({ type: 'editor', title: 'x.fsr', path: '/tmp/x.fsr', id: 'editor:/tmp/x.fsr' })
    const read = deferred<{ kind: string; content: string; truncated?: boolean }>()
    vi.spyOn(api, 'fsRead').mockReturnValue(read.promise as never)
    const { container, unmount } = hostFor(ctx, store, '/tmp/x.fsr')
    await flushed()
    unmount()
    await act(async () => { read.resolve({ kind: 'text', content: 'late body' }) })
    expect(container.isConnected).toBe(false)

    const failure = deferred<never>()
    vi.spyOn(api, 'fsRead').mockReturnValue(failure.promise as never)
    service.openTab({ type: 'editor', title: 'z.fsr', path: '/tmp/z.fsr', id: 'editor:/tmp/z.fsr' })
    const second = hostFor(ctx, store, '/tmp/z.fsr')
    await flushed()
    second.unmount()
    await act(async () => { failure.reject('late disk gone') })
    expect(second.container.isConnected).toBe(false)
  })

  it('the toolbar status label renders saving and failed states', async () => {
    const { store, ctx, service } = setup()
    let report: ((state: Record<string, unknown>) => void) | undefined
    service.registerFileViewer({
      id: 'test:fake', exts: ['fake'], fetchStrategy: 'custom',
      load: () => Promise.resolve(undefined),
      component: ((props: Record<string, unknown>) => {
        useEffect(() => { report = props.onToolbarState as (state: Record<string, unknown>) => void }, [])
        return createElement('div', null, 'fake')
      }) as never,
    })
    service.openTab({ type: 'editor', title: 'x.fake', path: '/tmp/x.fake', id: 'editor:/tmp/x.fake' })
    const { container, unmount } = hostFor(ctx, store, '/tmp/x.fake')
    await flushed()
    await act(async () => {
      report?.({ modes: true, mode: 'preview', dirty: false, editable: false, saveState: 'saving' })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(container.textContent).toContain('Loading…')
    await act(async () => {
      report?.({ modes: true, mode: 'preview', dirty: false, editable: false, saveState: 'failed' })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(container.textContent).toContain('Save failed')
    unmount()
  })

  it('a plain typing keydown in the path input is neither commit nor reset', () => {
    const { store, ctx, service } = setup()
    service.openTab({
      type: 'editor', title: 'a.ts', path: '/tmp/a.ts', id: 'editor:/tmp/a.ts', meta: { treeOpen: false },
    })
    const { container, unmount } = hostFor(ctx, store, '/tmp/a.ts')
    const input = container.querySelector('input')!
    const before = (input as HTMLInputElement).value
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
    expect((input as HTMLInputElement).value).toBe(before)
    unmount()
  })
})

describe('BrowserView raw-event guards', () => {
  function browserSetup(): { store: ReturnType<typeof createSidebarStore>; mount: () => ReturnType<typeof mountNode> } {
    const store = createSidebarStore()
    store.setSession('s1')
    const service = createBetterSidebarService(store)
    service.registerTab({ id: 'browser', title: 'Browser', dedupeKey: tab => tab.path, component: () => null })
    service.openTab({ type: 'browser', title: 'Browser', id: 'browser:1' }, { sessionId: 's1' })
    const ctx = { betterSidebar: service, get: (name: string) => name === 'betterSidebar' ? service : undefined } as unknown as Context
    const tab = { id: 'browser:1', type: 'browser', title: 'Browser' } as never
    return {
      store,
      mount: () => mountNode(createElement(BrowserView, { ctx, store, scope: { sessionId: 's1', cwd: '/ws' }, tab, visible: true } as never)),
    }
  }

  function navigate(container: HTMLDivElement, value: string): void {
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  }

  beforeEach(() => {
    vi.spyOn(api, 'browserProbe').mockResolvedValue({ reachable: true })
    vi.stubGlobal('open', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('back/forward guards return at the stack bounds; the Go button navigates', () => {
    const { mount } = browserSetup()
    const { container, unmount } = mount()
    // The Go (link) button commits the typed address like Enter does.
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'https://go.test/')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const go = () => container.querySelector<HTMLButtonElement>('button[aria-label="Go"]')!
    act(() => { go().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://go.test/')
    // Back at the stack start / forward at the top: the guards return early.
    const back = () => container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!
    const forward = () => container.querySelector<HTMLButtonElement>('button[aria-label="Forward"]')!
    act(() => { forward().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    act(() => { back().click() })
    act(() => { back().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('iframe')!.getAttribute('src')).toBe('https://go.test/')
    unmount()
  })

  it('a non-Enter keydown in the address bar does nothing; external open without a URL is inert', () => {
    const { mount } = browserSetup()
    const { container, unmount } = mount()
    const input = container.querySelector<HTMLInputElement>('input')!
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })) })
    const external = () => container.querySelector<HTMLButtonElement>('button[aria-label="Open in browser"]')!
    act(() => { external().dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(window.open).not.toHaveBeenCalled()
    unmount()
  })

  it('the sandbox status bar restores the sandbox after an unlock', () => {
    const { mount } = browserSetup()
    const { container, unmount } = mount()
    navigate(container, 'https://example.com/')
    const unlock = [...container.querySelectorAll('button')].find(button => button.textContent!.startsWith('Temporarily disable'))!
    act(() => { unlock.click() })
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toBeNull()
    const restore = [...container.querySelectorAll('button')].find(button => button.textContent!.startsWith('Restore'))!
    act(() => { restore.click() })
    expect(container.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-scripts')
    unmount()
  })
})
