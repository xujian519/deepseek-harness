/**
 * TextEditor draft-buffer spec: an edit-mode keystroke must neither re-render
 * the React tree nor re-scan the markdown source. The draft lives in the
 * editor's own ref, so only the clean→dirty transition commits, and the
 * preview derives its source from that ref when it next renders. The preview
 * and a save both read the latest text.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Profiler, act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@codemirror/view'
import { TextEditor } from '../src/client/TextEditor.tsx'
import { createSidebarStore } from '../src/client/state.ts'
import { attachLocale } from '../src/client/locales.ts'
import { api } from '../src/client/api.ts'
import type { EditorToolbarControls, EditorToolbarState, FileViewerProps } from '../src/client/service.ts'

const { rewrites } = vi.hoisted(() => ({ rewrites: vi.fn() }))

vi.mock('../src/client/markdown-images.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/markdown-images.ts')>()
  return {
    ...actual,
    rewriteLocalImageUrls: (...args: Parameters<typeof actual.rewriteLocalImageUrls>) => {
      rewrites()
      return actual.rewriteLocalImageUrls(...args)
    },
  }
})

/** Minimal structural fake of the locale face the sidebar dictionaries use. */
class FakeLocale {
  getSnapshot(): { active: string } { return { active: 'en' } }
  subscribe(_listener: () => void): () => void { return () => {} }
  register(_ns: string, _locale: string, _dict: Record<string, string>): () => void { return () => {} }
}

const CONTENT = 'head\n'
const TYPED = 'zzz-latest-marker'

interface Harness {
  readonly container: HTMLDivElement
  readonly view: EditorView
  readonly controls: () => EditorToolbarControls | null
  readonly commits: number
  readonly hostStates: EditorToolbarState[]
  readonly unmount: () => void
}

/** Mount TextEditor on a markdown file in host-toolbar mode and hand back its CodeMirror view. */
function mountEditor(): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  let controls: EditorToolbarControls | null = null
  const hostStates: EditorToolbarState[] = []
  const harness = {
    container,
    view: undefined as unknown as EditorView,
    controls: () => controls,
    get commits() { return commitCount },
    hostStates,
    unmount: () => { root.unmount() },
  }
  let commitCount = 0
  const props: FileViewerProps = {
    ctx: {} as FileViewerProps['ctx'],
    store: createSidebarStore(),
    scope: { sessionId: 's1', cwd: '/p' },
    path: '/p/notes.md',
    title: 'notes.md',
    viewerId: 'markdown',
    content: CONTENT,
    toolbar: 'host',
    onToolbarState: (state) => { hostStates.push(state) },
    onToolbarControls: (next) => { controls = next },
  }
  const element: ReactNode = createElement(
    Profiler,
    { id: 'editor', onRender: () => { commitCount += 1 } },
    createElement(TextEditor, props),
  )
  act(() => { root.render(element) })
  const editor = container.querySelector('.cm-editor')
  if (editor === null) throw new Error('CodeMirror did not mount')
  const view = EditorView.findFromDOM(editor as HTMLElement)
  if (view === null) throw new Error('CodeMirror view missing')
  return Object.assign(harness, { view })
}

/** Append text to the document, one React commit boundary per character. */
function typeAtEnd(harness: Harness, text: string): void {
  for (const character of text) {
    act(() => {
      harness.view.dispatch({ changes: { from: harness.view.state.doc.length, insert: character } })
    })
  }
}

afterEach(() => {
  attachLocale(undefined)
  vi.clearAllMocks()
})

describe('TextEditor draft buffer', () => {
  it('commits once for a whole edit-mode typing run and never scans the source', () => {
    attachLocale(new FakeLocale())
    const harness = mountEditor()
    expect(rewrites).toHaveBeenCalledOnce()

    act(() => { harness.controls()?.setMode('edit') })
    const beforeTyping = harness.commits
    typeAtEnd(harness, TYPED)

    // Only the clean→dirty transition commits; the text lives in the editor ref.
    expect(harness.commits).toBe(beforeTyping + 1)
    // Edit-mode keystrokes never rewrite image destinations for the hidden preview.
    expect(rewrites).toHaveBeenCalledOnce()
    expect(harness.hostStates.at(-1)?.dirty).toBe(true)
    harness.unmount()
  })

  it('renders the latest edit-mode text when the preview comes back', () => {
    attachLocale(new FakeLocale())
    const harness = mountEditor()
    act(() => { harness.controls()?.setMode('edit') })
    typeAtEnd(harness, TYPED)

    act(() => { harness.controls()?.setMode('preview') })

    expect(harness.container.textContent).toContain(TYPED)
    expect(rewrites).toHaveBeenCalledTimes(2)
    harness.unmount()
  })

  it('saves the editor document and clears the draft on success', async () => {
    attachLocale(new FakeLocale())
    const harness = mountEditor()
    const write = vi.spyOn(api, 'fsWrite').mockResolvedValue({ ok: true })
    act(() => { harness.controls()?.setMode('edit') })
    typeAtEnd(harness, TYPED)

    await act(async () => { harness.controls()?.save() })

    expect(write).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/p' }, '/p/notes.md', harness.view.state.doc.toString())
    expect(harness.view.state.doc.toString()).toBe(`${CONTENT}${TYPED}`)
    expect(harness.hostStates.at(-1)?.dirty).toBe(false)
    expect(harness.hostStates.at(-1)?.saveState).toBe('saved')
    harness.unmount()
  })
})
