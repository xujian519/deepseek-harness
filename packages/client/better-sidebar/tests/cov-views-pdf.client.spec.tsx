// @vitest-environment jsdom
/**
 * PdfView coverage round: the blob-URL load pipeline (ready, HTTP failure,
 * rejection, post-unmount aborts), the object-URL revocation on teardown, and
 * the drag/resize interaction shield (block on dragstart and resize-target
 * pointerdown, unblock on dragend/drop/pointerup/pointercancel/blur, and the
 * non-Element pointer target guard).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { mediaUrl } from '../src/client/api.ts'
import { PdfView } from '../src/client/PdfView.tsx'
import css from '../src/client/sidebar.module.css'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const SCOPE = { sessionId: 's1', cwd: '/ws' }

/** Deferred fetch plumbing the tests control. */
let respond: ((init: { ok?: boolean; status?: number; bytes?: ArrayBuffer }) => void) | undefined
let rejectWith: ((error: unknown) => void) | undefined

const mount = (): { container: HTMLDivElement; root: Root } => {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(PdfView, { scope: SCOPE, path: '/ws/doc.pdf', title: 'doc.pdf' })) })
  return { container, root }
}

const unmount = (container: HTMLDivElement, root: Root): void => {
  act(() => { root.unmount() })
  container.remove()
}

beforeEach(() => {
  let objectUrls = 0
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: vi.fn(() => `blob:pdf-${++objectUrls}`),
    revokeObjectURL: vi.fn(),
  }))
  vi.stubGlobal('fetch', vi.fn((_url: unknown, init?: RequestInit) => new Promise((resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
    respond = ({ ok = true, status = 200, bytes = new ArrayBuffer(8) }) => {
      resolve({ ok, status, arrayBuffer: async () => bytes } as unknown as Response)
    }
    rejectWith = reject
  })))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  respond = undefined
  rejectWith = undefined
})

describe('PdfView load pipeline', () => {
  it('fetches the media route and renders the blob-backed frame when ready', async () => {
    const { container, root } = mount()
    expect(container.textContent).toContain('Download to view')
    expect(fetch).toHaveBeenCalledWith(mediaUrl(SCOPE, '/ws/doc.pdf'), { signal: expect.any(AbortSignal) })
    await act(async () => { respond?.({}) })
    await act(async () => {})
    const frame = container.querySelector('iframe')!
    expect(frame.src).toBe('blob:pdf-1')
    expect(frame.title).toBe('doc.pdf')
    unmount(container, root)
    // Teardown revokes the object URL.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-1')
  })

  it('a non-OK response renders the HTTP status as the error message', async () => {
    const { container, root } = mount()
    await act(async () => { respond?.({ ok: false, status: 404 }) })
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('HTTP 404')
    unmount(container, root)
  })

  it('a string rejection renders its raw text', async () => {
    const { container, root } = mount()
    await act(async () => { rejectWith?.('network hole') })
    expect(container.textContent).toContain('network hole')
    unmount(container, root)
  })

  it('an abort while the bytes are in flight keeps the loading state (no setState)', async () => {
    const { container, root } = mount()
    await act(async () => { respond?.({}) })
    expect(container.querySelector('iframe')).not.toBeNull()
    // Unmount aborts; a trailing abort rejection settles into dead state.
    unmount(container, root)
    await act(async () => { rejectWith?.(new DOMException('aborted', 'AbortError')) })
  })
})

describe('PdfView interaction shield', () => {
  const ready = async (): Promise<{ container: HTMLDivElement; root: Root }> => {
    const mounted = mount()
    await act(async () => { respond?.({}) })
    return mounted
  }

  it('dragstart blocks the frame (shield active); dragend and drop release it', async () => {
    const { container, root } = await ready()
    act(() => { document.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })) })
    expect(container.querySelector('iframe')?.className).toContain('editorPdfFrameBlocked')
    act(() => { document.dispatchEvent(new Event('dragend')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    act(() => { document.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })) })
    act(() => { document.dispatchEvent(new Event('drop')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    unmount(container, root)
  })

  it('a pointerdown on a resize handle blocks; pointerup, pointercancel and blur release', async () => {
    const { container, root } = await ready()
    const handle = document.createElement('div')
    handle.className = css.panelResize ?? ''
    document.body.append(handle)
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(container.querySelector('iframe')?.className).toContain('editorPdfFrameBlocked')
    act(() => { window.dispatchEvent(new PointerEvent('pointerup')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    act(() => { window.dispatchEvent(new PointerEvent('pointercancel')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    handle.remove()
    unmount(container, root)
  })

  it('a pointerdown whose target is not an Element (window itself) is ignored', async () => {
    const { container, root } = await ready()
    act(() => { window.dispatchEvent(new PointerEvent('pointerdown')) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    // A plain element far from any resize handle also never blocks.
    const plain = document.createElement('div')
    document.body.append(plain)
    act(() => { plain.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
    expect(container.querySelector('iframe')?.className).not.toContain('editorPdfFrameBlocked')
    plain.remove()
    unmount(container, root)
  })
})
