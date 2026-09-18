/**
 * Lazy wrapper tests (src/client/lazy-chunk.tsx): the wrapper that mounts
 * chunk-resident components from the built-in descriptors. Pins the two
 * contracts that matter for the descriptor API:
 * - the wrapper is a plain render-prop function — `component(props)` can be
 *   called directly (Sidebar's style) without a chunk registered and
 *   without throwing; hooks live in the inner component only,
 * - loading → placeholder, failure → error + retry that recovers, success →
 *   the chunk component rendered.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { builtinTabs } from '../src/client/builtins/tabs.tsx'
import { builtinViewers } from '../src/client/builtins/viewers.tsx'
import { registerChunkForTests, resetChunks } from '../src/client/chunk-loader.ts'
import { lazyChunkComponent } from '../src/client/lazy-chunk.tsx'
import type { Context } from '../src/context-types.ts'
import type { FileViewerProps, TabComponentProps } from '../src/client/service.ts'
import css from '../src/client/sidebar.module.css'

/** Render `node` into a detached body container under React's act(). */
function mount(node: ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  // act() flushes the (concurrent) initial commit — the placeholder must be
  // in the DOM before the async load flushes below.
  act(() => { root.render(node) })
  const unmount = (): void => {
    act(() => { root.unmount() })
    container.remove()
  }
  return { container, unmount }
}

const Marker = (): ReactNode => createElement('div', { 'data-testid': 'chunk-rendered' }, 'loaded')

beforeEach(() => {
  resetChunks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Defensive: drop any containers left by failed assertions.
  for (const el of document.querySelectorAll('body > div')) el.remove()
})

describe('lazyChunkComponent', () => {
  it('renders the loading placeholder first, then the chunk component', async () => {
    let calls = 0
    registerChunkForTests('editor', async () => {
      calls += 1
      return { TextEditor: Marker }
    })
    const Wrapper = lazyChunkComponent<{ label: string }>('editor', mod => mod.TextEditor as ComponentType<{ label: string }> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, { label: 'x' }))
    // Initial paint: the loading placeholder (no chunk loaded yet).
    expect(container.querySelector(`.${css.editorPlaceholder}`)).not.toBeNull()
    await act(async () => {})
    expect(container.querySelector('[data-testid="chunk-rendered"]')).not.toBeNull()
    expect(container.textContent).toContain('loaded')
    expect(calls).toBe(1)
    unmount()
  })

  it('shows the failure reason with a retry that recovers', async () => {
    let fail = true
    registerChunkForTests('editor', async () => {
      if (fail) throw new Error('boom')
      return { TextEditor: Marker }
    })
    const Wrapper = lazyChunkComponent<Record<string, never>>('editor', mod => mod.TextEditor as ComponentType<Record<string, never>> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, {}))
    await act(async () => {})
    expect(container.textContent).toContain('boom')
    // The failed load cleared the loader cache; retry now succeeds.
    fail = false
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    await act(async () => { button!.click() })
    await act(async () => {})
    expect(container.querySelector('[data-testid="chunk-rendered"]')).not.toBeNull()
    unmount()
  })

  it('props flow through to the chunk component', async () => {
    const Recorder = (props: { label: string }): ReactNode => createElement('div', { 'data-testid': 'rec', 'data-label': props.label })
    registerChunkForTests('terminal', async () => ({ TerminalView: Recorder }))
    const Wrapper = lazyChunkComponent<{ label: string }>('terminal', mod => mod.TerminalView as ComponentType<{ label: string }> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, { label: 'hello' }))
    await act(async () => {})
    expect(container.querySelector('[data-testid="rec"]')?.getAttribute('data-label')).toBe('hello')
    unmount()
  })
})

describe('built-in descriptor contract (render-prop functions)', () => {
  it('every heavy built-in viewer component is callable as a plain function without a chunk (returns an element)', () => {
    const viewers = builtinViewers()
    for (const id of ['markdown', 'html', 'code']) {
      const descriptor = viewers.find(viewer => viewer.id === id)
      expect(descriptor, id).toBeDefined()
      // No chunk registered: calling must not throw — it returns the lazy
      // element (the loading placeholder renders once mounted).
      expect(() => descriptor!.component({} as FileViewerProps), id).not.toThrow()
    }
  })

  it('the terminal tab component keeps the same contract', () => {
    const tabs = builtinTabs({} as Context)
    const terminal = tabs.find(tab => tab.id === 'terminal')
    expect(terminal).toBeDefined()
    // The descriptor reads tab.id (the tabId mapping); a real tab is part of
    // the contract — Sidebar always provides one.
    const props = { tab: { id: 'terminal:1', type: 'terminal', title: '终端 1' } } as unknown as TabComponentProps
    expect(() => terminal!.component(props)).not.toThrow()
  })

  it('a built-in viewer mounted without a chunk available degrades to the error + retry affordance (no crash)', async () => {
    // No test chunk registered and jsdom has no client module system: the
    // load fails and the wrapper must degrade gracefully, never throw.
    const viewers = builtinViewers()
    const code = viewers.find(viewer => viewer.id === 'code')!
    const { container, unmount } = mount(createElement(code.component, {} as FileViewerProps))
    await act(async () => {})
    expect(container.querySelector(`.${css.editorError}`)).not.toBeNull()
    expect(container.querySelector('button')).not.toBeNull()
    unmount()
  })

  it('a registered chunk makes the built-in viewer render through the real descriptor path', async () => {
    registerChunkForTests('editor', async () => ({ TextEditor: Marker }))
    const viewers = builtinViewers()
    const markdown = viewers.find(viewer => viewer.id === 'markdown')!
    // EditorHost renders viewer components via createElement(component, props).
    const { container, unmount } = mount(createElement(markdown.component, {
      ctx: {},
      store: undefined,
      scope: { sessionId: 's1', cwd: '/p' },
      path: '/p/a.md',
      title: 'a.md',
      viewerId: 'markdown',
    } as unknown as FileViewerProps))
    await act(async () => {})
    expect(container.querySelector('[data-testid="chunk-rendered"]')).not.toBeNull()
    unmount()
  })

  it('the terminal descriptor maps tab.id → tabId (TerminalView props are not TabComponentProps)', async () => {
    let received: unknown
    registerChunkForTests('terminal', async () => ({
      TerminalView: ((props: { tabId: string }) => {
        received = props.tabId
        return createElement('div', { 'data-testid': 'terminal-tabid' }, props.tabId)
      }) as unknown as ComponentType<Record<string, never>>,
    }))
    const tabs = builtinTabs({} as Context)
    const terminal = tabs.find(tab => tab.id === 'terminal')!
    const props = {
      ctx: {},
      store: undefined,
      scope: { sessionId: 's1', cwd: '/p' },
      tab: { id: 'terminal:2', type: 'terminal', title: '终端 2' },
      visible: true,
    } as unknown as TabComponentProps
    const { container, unmount } = mount(createElement(terminal.component, props))
    await act(async () => {})
    expect(container.querySelector('[data-testid="terminal-tabid"]')?.textContent).toBe('terminal:2')
    expect(received).toBe('terminal:2')
    unmount()
  })

  it('the loader cache survives across descriptor mounts (chunk fetched once)', async () => {
    let calls = 0
    registerChunkForTests('terminal', async () => {
      calls += 1
      return { TerminalView: Marker }
    })
    const tabs = builtinTabs({} as Context)
    const terminal = tabs.find(tab => tab.id === 'terminal')!
    const props = { tab: { id: 'terminal:1', type: 'terminal', title: '终端 1' } } as unknown as TabComponentProps
    const { container: first, unmount: unmountFirst } = mount(createElement(terminal.component, props))
    await act(async () => {})
    expect(first.querySelector('[data-testid="chunk-rendered"]')).not.toBeNull()
    unmountFirst()
    const { container: second, unmount: unmountSecond } = mount(createElement(terminal.component, props))
    await act(async () => {})
    expect(second.querySelector('[data-testid="chunk-rendered"]')).not.toBeNull()
    unmountSecond()
    expect(calls).toBe(1)
  })
})

describe('built-in viewer descriptor surface', () => {
  it('every viewer resolves a localized title and an icon at any size', () => {
    const viewers = builtinViewers()
    expect(viewers.map(viewer => viewer.id)).toEqual(
      ['image', 'pdf', 'markdown', 'html', 'code', 'binary-download'],
    )
    for (const viewer of viewers) {
      const title = typeof viewer.title === 'function' ? viewer.title() : viewer.title
      expect(title, viewer.id).toBeTruthy()
      const icon = typeof viewer.icon === 'function' ? viewer.icon(18) : viewer.icon
      expect(icon, viewer.id).toBeTruthy()
    }
  })

  it('the html viewer exposes its settings rows with localized copy', () => {
    const html = builtinViewers().find(viewer => viewer.id === 'html')!
    for (const toggle of html.settings?.toggles ?? []) {
      const title = typeof toggle.title === 'function' ? toggle.title() : toggle.title
      const desc = typeof toggle.desc === 'function' ? toggle.desc() : toggle.desc
      expect(title, toggle.key).toBeTruthy()
      expect(desc, toggle.key).toBeTruthy()
    }
  })

  it('the image viewer renders the resolved media url as the img src', () => {
    const image = builtinViewers().find(viewer => viewer.id === 'image')!
    const { container, unmount } = mount(createElement(image.component, {
      mediaUrl: 'http://gui.origin/sidebar/file?path=x',
      title: 'shot.png',
    } as unknown as FileViewerProps))
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('http://gui.origin/sidebar/file?path=x')
    expect(img?.getAttribute('alt')).toBe('shot.png')
    unmount()
  })

  it('the binary-download viewer renders the download link instead of a preview', () => {
    const binary = builtinViewers().find(viewer => viewer.id === 'binary-download')!
    const { container, unmount } = mount(createElement(binary.component, {
      scope: { sessionId: 's1', cwd: '/p' },
      path: '/p/archive.bin',
    } as unknown as FileViewerProps))
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toContain('/sidebar/file?')
    expect(link?.getAttribute('href')).toContain('download=1')
    expect(link?.hasAttribute('download')).toBe(true)
    unmount()
  })

  it('the pdf viewer fetches the media route and mounts the blob-backed frame', async () => {
    const createObjectURL = vi.fn(() => 'blob:dsh-pdf')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const pdf = builtinViewers().find(viewer => viewer.id === 'pdf')!
    const { container, unmount } = mount(createElement(pdf.component, {
      scope: { sessionId: 's1', cwd: '/p' },
      path: '/p/doc.pdf',
      title: 'doc.pdf',
    } as unknown as FileViewerProps))
    await act(async () => {})
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/sidebar/file?'), expect.anything())
    expect(createObjectURL).toHaveBeenCalled()
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('blob:dsh-pdf')
    expect(frame?.getAttribute('title')).toBe('doc.pdf')
    unmount()
  })
})
