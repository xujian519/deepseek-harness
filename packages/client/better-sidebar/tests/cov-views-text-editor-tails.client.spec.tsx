/**
 * TextEditor surface tails beyond the draft buffer: the own toolbar row (mode
 * toggle / dirty dot / save status), the save failure path, the Mod-s keymap,
 * the two selection popups (CodeMirror selection for code files, mouse-up
 * selection inside the markdown preview), the html preview's sandbox status
 * row, the three markdown render arms, and the in-place re-theme on a scheme
 * flip. The split markdown document / mermaid chunk renderers are replaced by
 * probes: the subject is which arm TextEditor picks and what it hands over.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import type { Context } from '../src/context-types.ts'
import { createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { t } from '../src/client/locales.ts'
import { api } from '../src/client/api.ts'
import type { EditorToolbarControls, EditorToolbarState, FileViewerProps } from '../src/client/service.ts'
import type { SidebarPrefs } from '../src/prefs-shared.ts'

const probes = vi.hoisted(() => ({
  document: [] as Array<Record<string, unknown>>,
  mermaid: [] as Array<Record<string, unknown>>,
}))

vi.mock('../src/client/MarkdownHtml.tsx', () => ({
  MarkdownDocument: (props: Record<string, unknown>) => {
    probes.document.push(props)
    return createElement('div', { 'data-probe': 'markdown-document' })
  },
  LazyMermaidMarkdown: (props: Record<string, unknown>) => {
    probes.mermaid.push(props)
    return createElement('div', { 'data-probe': 'mermaid-markdown' })
  },
}))

const { TextEditor } = await import('../src/client/TextEditor.tsx')

interface Harness {
  readonly container: HTMLDivElement
  readonly store: SidebarStore
  readonly drafts: string[]
  readonly hostStates: EditorToolbarState[]
  readonly controls: () => EditorToolbarControls | null
  readonly view: () => EditorView | null
  readonly setPrefs: (patch: Partial<SidebarPrefs>) => void
  readonly rerender: () => void
  readonly unmount: () => void
}

interface MountOptions extends Partial<Omit<FileViewerProps, 'toolbar'>> {
  /** Own-toolbar mode (`undefined`) is the default; 'host' hands the row over. */
  toolbar?: 'self' | 'host' | undefined
  prefs?: Partial<SidebarPrefs>
}

const SCOPE = { sessionId: 's1', cwd: '/p' }

function mountEditor(over: MountOptions = {}): Harness {
  const { prefs, ...propsOver } = over
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  if (prefs !== undefined) store.setPrefs({ ...store.getPrefs(), ...prefs })
  const drafts: string[] = []
  let draft = ''
  const conversation = {
    input: {
      for: () => ({
        state: { getSnapshot: () => ({ draft }) },
        setDraft: (text: string) => { draft = text; drafts.push(text) },
      }),
    },
  }
  const ctx = {
    sessions: { scope: () => ({ ...SCOPE }) },
    get: (name: string) => (name === 'conversation' ? conversation : undefined),
  } as unknown as Context
  const hostStates: EditorToolbarState[] = []
  let controls: EditorToolbarControls | null = null
  const props = {
    ctx,
    store,
    scope: SCOPE,
    path: '/p/notes.md',
    title: 'notes.md',
    viewerId: 'markdown',
    content: '# head\n',
    onToolbarState: (state: EditorToolbarState) => { hostStates.push(state) },
    onToolbarControls: (next: EditorToolbarControls | null) => { controls = next },
    ...propsOver,
  } as FileViewerProps
  const root: Root = createRoot(container)
  const render = (): void => {
    act(() => { root.render(createElement(TextEditor, props)) })
  }
  render()
  return {
    container,
    store,
    drafts,
    hostStates,
    controls: () => controls,
    view: () => {
      const dom = container.querySelector('.cm-editor')
      return dom === null ? null : EditorView.findFromDOM(dom as HTMLElement)
    },
    setPrefs: (patch) => { act(() => { store.setPrefs({ ...store.getPrefs(), ...patch }) }) },
    rerender: render,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** The editor must look focused to the selection listener; jsdom cannot
 *  model a focused contenteditable, so the view reports focus directly. */
function fakeFocus(view: EditorView): void {
  Object.defineProperty(view, 'hasFocus', { configurable: true, get: () => true })
}

/** Anchor the selection at a measurable point (jsdom lays nothing out). */
function fakeCoords(view: EditorView, rect: { left: number; right: number; top: number } | null): void {
  Object.defineProperty(view, 'coordsAtPos', { configurable: true, value: () => rect })
}

const popupEl = (): HTMLElement | null => document.querySelector<HTMLElement>('[class*="selectionPopup"]')

const savedWrite = (): void => {
  vi.spyOn(api, 'fsWrite').mockResolvedValue({ ok: true })
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.style.cssText = ''
  document.body.removeAttribute('data-ds-dark-theme')
  probes.document.length = 0
  probes.mermaid.length = 0
  vi.restoreAllMocks()
})

describe('TextEditor while the content is still loading', () => {
  it('renders no editor and no-ops a save request from the host toolbar', () => {
    const write = vi.spyOn(api, 'fsWrite').mockResolvedValue({ ok: true })
    const h = mountEditor({ content: undefined, toolbar: 'host' })
    try {
      expect(h.view()).toBeNull()
      expect(h.controls()).not.toBeNull()
      // The host is told the viewer is not editable yet.
      expect(h.hostStates.at(-1)).toMatchObject({ editable: false, dirty: false, saveState: 'idle' })
      act(() => { h.controls()!.save() })
      expect(write).not.toHaveBeenCalled()
    } finally {
      h.unmount()
    }
  })

  it('renders no toolbar row for a host-less shell with no content', () => {
    const h = mountEditor({ content: undefined, viewerId: 'code' })
    try {
      expect(h.container.querySelector('button[aria-label]')).toBeNull()
      expect(h.container.textContent).toBe('')
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor own toolbar', () => {
  it('switches a markdown file between the preview and the editor from the toolbar', () => {
    const h = mountEditor({ toolbar: undefined })
    try {
      const buttons = [...h.container.querySelectorAll('button')]
      const preview = buttons.find(button => button.textContent === t('preview'))!
      const edit = buttons.find(button => button.textContent === t('edit'))!
      const cm = h.container.querySelector<HTMLElement>('[class*="editorCm"]')!
      expect(cm.className).toContain('editorCmHidden')
      expect(h.container.querySelector('[class*="editorMd"]')).not.toBeNull()

      act(() => { edit.click() })
      expect(h.container.querySelector<HTMLElement>('[class*="editorCm"]')!.className).not.toContain('editorCmHidden')
      expect(h.container.querySelector('[class*="editorMd"]')).toBeNull()

      act(() => { preview.click() })
      expect(h.container.querySelector<HTMLElement>('[class*="editorCm"]')!.className).toContain('editorCmHidden')
      expect(h.container.querySelector('[class*="editorMd"]')).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('shows the truncation banner only while the truncated file is being edited', () => {
    const h = mountEditor({ truncated: true, toolbar: undefined })
    try {
      expect(h.container.textContent).not.toContain(t('truncation'))
      act(() => {
        [...h.container.querySelectorAll('button')].find(button => button.textContent === t('edit'))!.click()
      })
      expect(h.container.textContent).toContain(t('truncation'))
    } finally {
      h.unmount()
    }
  })

  it('shows the saving label in flight, the saved label on success and clears the dirty dot', async () => {
    let release: (() => void) | undefined
    const write = vi.spyOn(api, 'fsWrite').mockImplementation(() => new Promise((resolve) => {
      release = () => { resolve({ ok: true }) }
    }))
    const h = mountEditor({ viewerId: 'code', path: '/p/a.ts', toolbar: undefined })
    try {
      const view = h.view()!
      act(() => { view.dispatch({ changes: { from: 0, insert: 'x' } }) })
      expect(h.container.querySelector(`[title="${t('unsaved')}"]`)).not.toBeNull()
      // Later keystrokes only refresh the draft ref; the dot stays on.
      act(() => { view.dispatch({ changes: { from: view.state.doc.length, insert: 'y' } }) })
      expect(h.container.querySelector(`[title="${t('unsaved')}"]`)).not.toBeNull()

      act(() => { h.container.querySelector<HTMLButtonElement>(`button[aria-label="${t('save')}"]`)!.click() })
      expect(write).toHaveBeenCalledWith(SCOPE, '/p/a.ts', view.state.doc.toString())
      expect(h.container.textContent).toContain(t('loading'))

      await act(async () => { release?.() })
      expect(h.container.textContent).toContain(t('saved'))
      expect(h.container.querySelector(`[title="${t('unsaved')}"]`)).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('keeps the dirty mark and reports the failure when the write is rejected', async () => {
    vi.spyOn(api, 'fsWrite').mockRejectedValue(new Error('disk full'))
    const h = mountEditor({ viewerId: 'code', path: '/p/a.ts', toolbar: undefined })
    try {
      act(() => { h.view()!.dispatch({ changes: { from: 0, insert: 'x' } }) })
      act(() => { h.container.querySelector<HTMLButtonElement>(`button[aria-label="${t('save')}"]`)!.click() })
      await act(async () => { await Promise.resolve() })
      expect(h.container.textContent).toContain(t('saveFailed'))
      expect(h.container.querySelector(`[title="${t('unsaved')}"]`)).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('saves through the Mod-s keymap', async () => {
    savedWrite()
    const h = mountEditor({ viewerId: 'code', path: '/p/a.ts', toolbar: undefined })
    try {
      const view = h.view()!
      act(() => { view.dispatch({ changes: { from: 0, insert: 'x' } }) })
      act(() => {
        view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
      })
      await act(async () => { await Promise.resolve() })
      expect(api.fsWrite).toHaveBeenCalledWith(SCOPE, '/p/a.ts', view.state.doc.toString())
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor host-toolbar reporting', () => {
  it('reports the state once per change and skips an unchanged re-render', () => {
    const h = mountEditor({ toolbar: 'host', viewerId: 'code', path: '/p/a.ts' })
    try {
      expect(h.hostStates).toHaveLength(1)
      expect(h.hostStates[0]).toEqual({ modes: false, mode: 'preview', dirty: false, editable: true, saveState: 'idle' })
      h.rerender()
      expect(h.hostStates).toHaveLength(1)
      act(() => { h.controls()!.setMode('edit') })
      expect(h.hostStates).toHaveLength(2)
      expect(h.hostStates[1]).toMatchObject({ mode: 'edit', modes: false })
      // The host registered the controls on mount and drops them on unmount.
      expect(h.controls()).not.toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor selection popup (editor surface)', () => {
  /** Select `head` characters from the start and let the listener measure. */
  function select(h: Harness, head: number, rect: { left: number; right: number; top: number } | null): void {
    const view = h.view()!
    fakeFocus(view)
    fakeCoords(view, rect)
    act(() => { view.dispatch({ selection: { anchor: 0, head } }) })
  }

  it('anchors the popup over a code selection and appends the payload on click', () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/notes.txt', content: 'alpha beta\n', toolbar: undefined })
    try {
      select(h, 5, { left: 200, right: 240, top: 90 })
      const popup = popupEl()!
      expect(popup.textContent).toBe(t('addToConversation'))
      // Anchor: the selection's horizontal center, clamped into the viewport.
      expect(popup.style.left).toBe('220px')
      expect(popup.style.top).toBe('90px')
      // The button's own mousedown keeps the selection alive.
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      popup.dispatchEvent(down)
      expect(down.defaultPrevented).toBe(true)
      act(() => { popup.click() })
      expect(h.drafts).toEqual(['```notes.txt:1\nalpha\n```'])
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('clamps the popup anchor into the viewport', () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/notes.txt', content: 'alpha beta\n', toolbar: undefined })
    try {
      select(h, 5, { left: 0, right: 10, top: 12 })
      expect(popupEl()!.style.left).toBe('80px')
      expect(popupEl()!.style.top).toBe('12px')
    } finally {
      h.unmount()
    }
  })

  it('never anchors for an empty selection, a whitespace-only selection or an unmeasurable one', () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/notes.txt', content: 'alpha beta\n', toolbar: undefined })
    try {
      // No selection at all: nothing to insert.
      select(h, 0, { left: 10, right: 20, top: 10 })
      expect(popupEl()).toBeNull()
      // Whitespace-only selection.
      select(h, 6, { left: 10, right: 20, top: 10 })
      const view = h.view()!
      act(() => { view.dispatch({ selection: { anchor: 5, head: 6 } }) })
      expect(popupEl()).toBeNull()
      // A non-empty selection the view cannot measure (scrolled out of view).
      select(h, 5, null)
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('ignores an update that carries no selection, document or focus change', () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/notes.txt', content: 'alpha beta\n', toolbar: undefined })
    try {
      const view = h.view()!
      fakeFocus(view)
      fakeCoords(view, { left: 100, right: 140, top: 40 })
      act(() => { view.dispatch({ selection: { anchor: 0, head: 5 } }) })
      expect(popupEl()).not.toBeNull()
      // A transaction touching neither selection, document nor focus keeps it.
      act(() => { view.dispatch({}) })
      expect(popupEl()).not.toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('hides a live popup when a later update has nothing to anchor', () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/notes.txt', content: 'alpha beta\n', toolbar: undefined })
    try {
      select(h, 5, { left: 100, right: 140, top: 40 })
      expect(popupEl()).not.toBeNull()
      act(() => { h.view()!.dispatch({ selection: { anchor: 2, head: 2 } }) })
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('does not arm the listener for a surface other than code / markdown', () => {
    const h = mountEditor({ viewerId: 'html', content: '<p>hi</p>', toolbar: undefined })
    try {
      select(h, 3, { left: 10, right: 20, top: 10 })
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor markdown preview selection', () => {
  const SOURCE = 'intro line\nsecond line\n'

  /** Point window.getSelection at a range inside the preview (or outside it). */
  function stubSelection(text: string, options: { collapsed?: boolean; node?: Node; nullSelection?: boolean } = {}): void {
    if (options.nullSelection === true) {
      vi.spyOn(window, 'getSelection').mockReturnValue(null)
      return
    }
    const node = options.node ?? document.body
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: options.collapsed ?? false,
      anchorNode: node,
      focusNode: node,
      toString: () => text,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 200, top: 60, width: 30, height: 8 }) }),
    } as unknown as Selection)
  }

  function mouseUp(h: Harness): void {
    act(() => { h.container.querySelector<HTMLElement>('[class*="editorMd"]')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
  }

  it('adds a preview selection with its source line span and hides the popup on scroll', () => {
    const h = mountEditor({ content: SOURCE, toolbar: undefined })
    try {
      const preview = h.container.querySelector<HTMLElement>('[class*="editorMd"]')!
      stubSelection('second line', { node: preview })
      mouseUp(h)
      const popup = popupEl()!
      // The anchor centers the 30px-wide range on x and sits at its top.
      expect(popup.style.left).toBe('215px')
      expect(popup.style.top).toBe('60px')
      act(() => { popup.click() })
      expect(h.drafts).toEqual(['```notes.md:2\nsecond line\n```'])

      // A second selection, then a scroll of the preview container dismisses it.
      stubSelection('second line', { node: preview })
      mouseUp(h)
      expect(popupEl()).not.toBeNull()
      act(() => { preview.dispatchEvent(new Event('scroll', { bubbles: false })) })
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('omits the line span when the selected text cannot be found in the source', () => {
    const h = mountEditor({ content: SOURCE, toolbar: undefined })
    try {
      stubSelection('not in the file', { node: h.container.querySelector<HTMLElement>('[class*="editorMd"]')! })
      mouseUp(h)
      act(() => { popupEl()!.click() })
      expect(h.drafts).toEqual(['```notes.md\nnot in the file\n```'])
    } finally {
      h.unmount()
    }
  })

  it('ignores a missing, collapsed, out-of-preview or whitespace-only selection', () => {
    const h = mountEditor({ content: SOURCE, toolbar: undefined })
    try {
      const preview = h.container.querySelector<HTMLElement>('[class*="editorMd"]')!
      stubSelection('', { nullSelection: true })
      mouseUp(h)
      expect(popupEl()).toBeNull()

      stubSelection('second line', { node: preview, collapsed: true })
      mouseUp(h)
      expect(popupEl()).toBeNull()

      stubSelection('second line', { node: document.body })
      mouseUp(h)
      expect(popupEl()).toBeNull()

      stubSelection('   ', { node: preview })
      mouseUp(h)
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('drops a click that lands in the same batch as the dismissal', () => {
    const h = mountEditor({ content: SOURCE, toolbar: undefined })
    try {
      const preview = h.container.querySelector<HTMLElement>('[class*="editorMd"]')!
      stubSelection('second line', { node: preview })
      mouseUp(h)
      const popup = popupEl()!
      act(() => {
        // The scroll dismisses the popup; the click was already on its way and
        // must not insert anything (React has not re-rendered the button away).
        preview.dispatchEvent(new Event('scroll'))
        popup.click()
      })
      expect(h.drafts).toEqual([])
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })

  it('hides a live popup when the editor is switched back to edit mode', () => {
    const h = mountEditor({ content: SOURCE, toolbar: undefined })
    try {
      stubSelection('second line', { node: h.container.querySelector<HTMLElement>('[class*="editorMd"]')! })
      mouseUp(h)
      expect(popupEl()).not.toBeNull()
      act(() => {
        [...h.container.querySelectorAll('button')].find(button => button.textContent === t('edit'))!.click()
      })
      expect(popupEl()).toBeNull()
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor markdown render arms', () => {
  it('hands the analyzed draft and the media context to the split document renderer', () => {
    const h = mountEditor({ content: '# heading\n', toolbar: undefined })
    try {
      expect(h.container.querySelector('[data-probe="markdown-document"]')).not.toBeNull()
      const handed = probes.document[0] as { info: { hasBlockHtml: boolean }; media: unknown }
      expect(handed.info.hasBlockHtml).toBe(false)
      expect(handed.media).toMatchObject({ scope: SCOPE, path: '/p/notes.md' })
      expect(probes.document).toHaveLength(1)
    } finally {
      h.unmount()
    }
  })

  it('flags a document containing raw HTML blocks in the handed-over analysis', () => {
    const h = mountEditor({ content: '# heading\n\n<div data-raw="1">raw</div>\n', toolbar: undefined })
    try {
      expect((probes.document[0] as { info: { hasBlockHtml: boolean } }).info.hasBlockHtml).toBe(true)
      expect(probes.document).toHaveLength(1)
    } finally {
      h.unmount()
    }
  })

  it('never renders the preview while editing', () => {
    const h = mountEditor({ content: '# heading\n', toolbar: undefined })
    try {
      act(() => {
        [...h.container.querySelectorAll('button')].find(button => button.textContent === t('edit'))!.click()
      })
      expect(h.container.querySelector('[class*="editorMd"]')).toBeNull()
      expect(h.container.querySelector('[data-probe="markdown-document"]')).toBeNull()
      // Back to the preview: the renderer mounts again with the live draft.
      act(() => {
        [...h.container.querySelectorAll('button')].find(button => button.textContent === t('preview'))!.click()
      })
      expect(h.container.querySelector('[data-probe="markdown-document"]')).not.toBeNull()
      expect(probes.document).toHaveLength(2)
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor html preview', () => {
  it('renders the sandboxed status row and toggles the temporary unlock', () => {
    const h = mountEditor({ viewerId: 'html', path: '/p/page.html', content: '<p>hi</p>', toolbar: undefined })
    try {
      const iframe = (): HTMLIFrameElement => h.container.querySelector('iframe')!
      expect(iframe().getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-downloads allow-modals')
      expect(h.container.textContent).toContain(t('sandboxStatusOn'))

      act(() => {
        [...h.container.querySelectorAll('button')].find(button => button.textContent === t('sandboxUnlock'))!.click()
      })
      expect(iframe().hasAttribute('sandbox')).toBe(false)
      expect(h.container.textContent).toContain(t('htmlNoSandboxWarning'))

      const restore = [...h.container.querySelectorAll('button')].find(button => button.textContent === t('sandboxRestore'))!
      act(() => { restore.click() })
      expect(iframe().hasAttribute('sandbox')).toBe(true)
      expect(h.container.textContent).toContain(t('sandboxStatusOn'))
    } finally {
      h.unmount()
    }
  })

  it('drops the sandbox from the stored default-unsafe preference', () => {
    const h = mountEditor({
      viewerId: 'html',
      path: '/p/page.html',
      content: '<p>hi</p>',
      toolbar: undefined,
      prefs: { htmlViewerDefaultUnsafe: true },
    })
    try {
      // The stored preference opens the preview straight into the red state,
      // with the restore action offered for the local override.
      expect(h.container.querySelector('iframe')!.hasAttribute('sandbox')).toBe(false)
      expect(h.container.textContent).toContain(t('htmlNoSandboxWarning'))
      expect([...h.container.querySelectorAll('button')].map(button => button.textContent)).toContain(t('sandboxRestore'))
    } finally {
      h.unmount()
    }
  })

  it('reports the global setting as the reason and offers no restore action', () => {
    const h = mountEditor({
      viewerId: 'html',
      path: '/p/page.html',
      content: '<p>hi</p>',
      toolbar: undefined,
      prefs: { htmlViewerNoSandbox: true },
    })
    try {
      expect(h.container.querySelector('iframe')!.hasAttribute('sandbox')).toBe(false)
      expect(h.container.textContent).toContain(t('htmlNoSandboxWarning'))
      expect([...h.container.querySelectorAll('button')].map(button => button.textContent)).not.toContain(t('sandboxRestore'))
    } finally {
      h.unmount()
    }
  })
})

describe('TextEditor theme flips', () => {
  it('re-themes the live view in place, keeping the draft and the view instance', async () => {
    const h = mountEditor({ viewerId: 'code', path: '/p/a.ts', content: 'const a = 1\n', toolbar: undefined })
    try {
      const view = h.view()!
      const dispatch = vi.spyOn(view, 'dispatch')
      const classes = view.dom.className
      act(() => { h.view()!.dispatch({ changes: { from: 0, insert: 'x' } }) })
      const typed = view.state.doc.toString()
      dispatch.mockClear()

      document.documentElement.style.colorScheme = 'dark'
      document.body.setAttribute('data-ds-dark-theme', '')
      await act(async () => { await Promise.resolve() })

      expect(dispatch).toHaveBeenCalled()
      expect(h.view()).toBe(view)
      expect(view.state.doc.toString()).toBe(typed)
      expect(view.dom.className).not.toBe(classes)
    } finally {
      h.unmount()
    }
  })
})
