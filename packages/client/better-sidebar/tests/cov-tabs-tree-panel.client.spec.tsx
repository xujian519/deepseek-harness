/**
 * TreePanel coverage round: the debounced global search (results, truncation,
 * error, stale-response suppression, clear-to-tree), the header refresh and
 * upload pickers, the upload session (progress overlay, success fade,
 * failure persistence, cancel), and the full-window presentation prop.
 */
// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { TreePanel } from '../src/client/TreePanel.tsx'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../src/client/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client/api.ts')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      fsTree: vi.fn(async () => ({
        entries: [{ name: 'a.ts', path: '/w/a.ts', isDir: false, hidden: false, isSymlink: false, broken: false }],
      })),
      fsSearch: vi.fn(async () => ({ matches: ['readme.md', 'src/read.ts'], truncated: false })),
    },
  }
})

/** The /sidebar/upload fetch stubs, driven per test. */
let uploadHandler: ((rel: string, init?: RequestInit) => Promise<Response>) | undefined

function jsonResponse(value: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ ok: true, value }) } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('/sidebar/upload')) {
      const rel = new URL(url, 'http://localhost').searchParams.get('relativePath') ?? ''
      if (uploadHandler === undefined) return jsonResponse({ path: `/w/${rel}`, size: 1 })
      return uploadHandler(rel, init)
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

interface Harness {
  container: HTMLDivElement
  opened: string[]
  rerender: (overrides?: { cwd?: string; full?: boolean }) => void
  unmount: () => void
}

async function mountPanel(props: { cwd?: string; full?: boolean } = {}): Promise<Harness> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const opened: string[] = []
  const state = { cwd: 'cwd' in props ? props.cwd : '/w', full: props.full ?? false }
  const render = (): void => {
    root.render(createElement(TreePanel, {
      sessionId: 's1',
      cwd: state.cwd,
      expanded: [],
      revealed: [],
      onToggle: () => {},
      onOpenFile: (path: string) => { opened.push(path) },
      onReferenceFile: () => {},
      full: state.full,
    }))
  }
  await act(async () => { render() })
  return {
    container,
    opened,
    rerender: (patch = {}) => {
      Object.assign(state, patch)
      act(render)
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Type into the search box (native setter so React sees the change). */
function search(container: HTMLDivElement, value: string): void {
  const input = container.querySelector<HTMLInputElement>('input[placeholder^="Search files"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Set files on a hidden picker input and fire its change. */
function pick(container: HTMLDivElement, index: 0 | 1, files: File[]): void {
  const input = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[index]!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
}

const overlay = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[role="dialog"][aria-modal]')

describe('TreePanel search', () => {
  it('debounces the query and renders result buttons that open through the caller', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    expect(panel.container.querySelector('[role="button"]')).not.toBeNull()
    search(panel.container, 'read')
    // The query is non-empty: the tree is replaced by the pending list
    // before the debounce even elapses.
    expect(panel.container.querySelector('[role="button"]')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    // The result list replaced the tree.
    const results = [...panel.container.querySelectorAll('button[class*="editorSearchResult"]')]
    expect(results.map(button => button.textContent)).toEqual(['readme.md', 'src/read.ts'])
    await act(async () => { (results[0] as HTMLElement).click() })
    expect(panel.opened).toEqual(['/w/readme.md'])
    panel.unmount()
  })

  it('announces a truncated result set', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    vi.mocked(api.fsSearch).mockResolvedValueOnce({ matches: ['a.ts'], truncated: true })
    const panel = await mountPanel()
    search(panel.container, 'a')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(panel.container.textContent).toContain('Too many results')
    panel.unmount()
  })

  it('shows the wire error of a failed search', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    vi.mocked(api.fsSearch).mockRejectedValueOnce(new Error('search boom'))
    const panel = await mountPanel()
    search(panel.container, 'a')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(panel.container.textContent).toContain('search boom')
    panel.unmount()
  })

  it('a stale search resolved after a newer keystroke never paints old results', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    let releaseStale: ((value: { matches: string[]; truncated: boolean }) => void) | undefined
    vi.mocked(api.fsSearch).mockImplementationOnce(async () => new Promise((resolve) => { releaseStale = resolve }))
    const panel = await mountPanel()
    search(panel.container, 'stale')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    // The newer keystroke aborted the stale request and issued its own.
    search(panel.container, 'fresh')
    await act(async () => {
      releaseStale?.({ matches: ['stale-result.ts'], truncated: false })
      await vi.advanceTimersByTimeAsync(300)
    })
    const results = [...panel.container.querySelectorAll('button[class*="editorSearchResult"]')]
      .map(button => button.textContent)
    expect(results).toEqual(['readme.md', 'src/read.ts'])
    panel.unmount()
  })

  it('a stale search that REJECTS after a newer keystroke shows no error', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    let rejectStale: ((cause: unknown) => void) | undefined
    vi.mocked(api.fsSearch).mockImplementationOnce(() =>
      new Promise((_resolve, reject) => { rejectStale = reject }) as never)
    const panel = await mountPanel()
    search(panel.container, 'stale')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    search(panel.container, 'fresh')
    // The stale request's controller is aborted by now: its late rejection
    // must be swallowed (no error line, fresh results render).
    await act(async () => {
      rejectStale?.(new DOMException('aborted', 'AbortError'))
      await vi.advanceTimersByTimeAsync(300)
    })
    // The pending stale call was aborted (its reject rode the abort) and the
    // fresh query answered: two calls, no error line, default results.
    const queries = vi.mocked(api.fsSearch).mock.calls.map(([, q]) => q)
    expect(queries).toContain('stale')
    expect(queries).toContain('fresh')
    expect(panel.container.querySelector('[class*="editorError"]')).toBeNull()
    const results = [...panel.container.querySelectorAll('button[class*="editorSearchResult"]')]
    expect(results).toHaveLength(2)
    panel.unmount()
  })

  it('a non-Error search rejection shows its string form', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    vi.mocked(api.fsSearch).mockRejectedValueOnce('raw-nope')
    const panel = await mountPanel()
    search(panel.container, 'a')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(panel.container.textContent).toContain('raw-nope')
    panel.unmount()
  })

  it('a result set with zero matches announces it', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    vi.mocked(api.fsSearch).mockResolvedValueOnce({ matches: [], truncated: false })
    const panel = await mountPanel()
    search(panel.container, 'nothing-here')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(panel.container.textContent).toContain('No matching files')
    panel.unmount()
  })

  it('clearing the query returns to the tree', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    search(panel.container, 'read')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    search(panel.container, '')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(panel.container.querySelector('[role="button"]')).not.toBeNull()
    panel.unmount()
  })
})

describe('TreePanel header actions', () => {
  it('the refresh button wipes the tree cache (a new fs.tree request)', async () => {
    const { api } = await import('../src/client/api.ts')
    const panel = await mountPanel()
    const before = vi.mocked(api.fsTree).mock.calls.length
    const refresh = panel.container.querySelector('button[aria-label="Refresh"]') as HTMLButtonElement
    await act(async () => { refresh.click() })
    expect(vi.mocked(api.fsTree).mock.calls.length).toBeGreaterThan(before)
    panel.unmount()
  })

  it('the upload pickers stay enabled while idle and start an upload session', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    const fileButton = panel.container.querySelector('button[aria-label="Upload Files"]') as HTMLButtonElement
    const folderButton = panel.container.querySelector('button[aria-label="Upload Folder"]') as HTMLButtonElement
    expect(fileButton.disabled).toBe(false)
    expect(folderButton.disabled).toBe(false)
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await act(async () => { folderButton.click() })
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()
    pick(panel.container, 1, [new File(['x'], 'picked.txt')])
    // The overlay is up with the progress session; hint line under the search.
    expect(overlay()).not.toBeNull()
    expect(overlay()!.getAttribute('aria-label')).toContain('/w')
    expect(panel.container.querySelector('[class*="editorSearchHint"]')?.textContent).toContain('picked.txt')
    // Both picker buttons are disabled while the session is in flight.
    expect((panel.container.querySelector('button[aria-label="Upload Files"]') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    panel.unmount()
  })

  it('the file picker button opens the file input', async () => {
    const panel = await mountPanel()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    await act(async () => {
      ;(panel.container.querySelector('button[aria-label="Upload Files"]') as HTMLButtonElement).click()
    })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
    panel.unmount()
  })

  it('a picker change with no FileList reports nothing', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    const input = panel.container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0]!
    Object.defineProperty(input, 'files', { value: null, configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    panel.unmount()
  })

  it('without a cwd the FOLDER picker change reports nothing', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel({ cwd: undefined as unknown as string })
    const input = panel.container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'f.txt')], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    panel.unmount()
  })

  it('a newer upload replaces a previous success hint and the stale fade is a no-op', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    // First upload settles successfully.
    pick(panel.container, 0, [new File(['x'], 'first.txt')])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(panel.container.querySelector('[class*="editorSearchHint"]')?.textContent).toContain('Uploaded 1 file(s)')
    // A second upload starts within the fade window and STAYS in flight:
    // its progress hint replaces the first upload's success line.
    uploadHandler = async (rel, init) => {
      if (rel === 'second.txt') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }
      return jsonResponse({ path: '/w/first.txt', size: 1 })
    }
    pick(panel.container, 0, [new File(['y'], 'second.txt')])
    expect(panel.container.querySelector('[class*="editorSearchHint"]')?.textContent).toContain('second.txt')
    const hintAfter = panel.container.querySelector('[class*="editorSearchHint"]')
    // The first upload's stale fade timer fires: the CURRENT hint is untouched.
    await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
    expect(panel.container.querySelector('[class*="editorSearchHint"]')).toBe(hintAfter)
    panel.unmount()
  })

  it('the FOLDER picker change with no FileList reports nothing', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    const input = panel.container.querySelectorAll<HTMLInputElement>('input[type="file"]')[1]!
    Object.defineProperty(input, 'files', { value: null, configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    panel.unmount()
  })

  it('a completed upload fades its success hint and refreshes the tree', async () => {
    vi.useFakeTimers()
    const { api } = await import('../src/client/api.ts')
    const panel = await mountPanel()
    pick(panel.container, 0, [new File(['x'], 'done.txt')])
    const treeCalls = vi.mocked(api.fsTree).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // The session settled: the overlay is gone and the tree cache was wiped.
    expect(overlay()).toBeNull()
    expect(vi.mocked(api.fsTree).mock.calls.length).toBeGreaterThan(treeCalls)
    const hint = panel.container.querySelector('[class*="editorSearchHint"]')
    expect(hint?.textContent).toContain('Uploaded 1 file(s)')
    // Success hints fade after 3.5s.
    await act(async () => { await vi.advanceTimersByTimeAsync(3500) })
    expect(panel.container.querySelector('[class*="editorSearchHint"]')).toBeNull()
    panel.unmount()
  })

  it('a failed upload keeps its error hint (no fade) and marks the line failed', async () => {
    vi.useFakeTimers()
    uploadHandler = async () => ({
      ok: false,
      status: 413,
      json: async () => ({ ok: false, error: { code: 'too-large', message: 'cap' } }),
    } as unknown as Response)
    const panel = await mountPanel()
    pick(panel.container, 0, [new File(['x'], 'big.txt')])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const hint = panel.container.querySelector('[class*="editorSearchHint"]')
    expect(hint?.className).toContain('editorError')
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    // The failure stays until the next action.
    expect(panel.container.querySelector('[class*="editorSearchHint"]')).not.toBeNull()
    panel.unmount()
  })

  it('the cancel button aborts the session and reports cancellation', async () => {
    vi.useFakeTimers()
    uploadHandler = async (rel, init) => {
      if (rel === 'b.txt') {
        // The in-flight request dies when the caller's abort signal fires.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        })
      }
      return jsonResponse({ path: '/w/a.txt', size: 1 })
    }
    const panel = await mountPanel()
    pick(panel.container, 0, [new File(['x'], 'a.txt'), new File(['y'], 'b.txt')])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // Two files: the first uploaded, the second in flight → 50%.
    expect(overlay()!.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1')
    const cancel = overlay()!.querySelector('button') as HTMLButtonElement
    expect(cancel.disabled).toBe(false)
    await act(async () => { cancel.click() })
    // The abort kills the in-flight request: the session settles immediately.
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    const hint = panel.container.querySelector('[class*="editorSearchHint"]')
    expect(hint?.textContent).toContain('cancelled')
    expect(hint?.className).toContain('editorError')
    panel.unmount()
  })

  it('without a cwd the pickers open but report nothing', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel({ cwd: undefined as unknown as string })
    pick(panel.container, 0, [new File(['x'], 'lonely.txt')])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    expect(panel.container.querySelector('[class*="editorSearchHint"]')).toBeNull()
    panel.unmount()
  })

  it('an empty picker selection reports nothing', async () => {
    vi.useFakeTimers()
    const panel = await mountPanel()
    pick(panel.container, 0, [])
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(overlay()).toBeNull()
    panel.unmount()
  })

  it('the full prop switches the panel to the full-window presentation', async () => {
    const panel = await mountPanel({ full: true })
    expect(panel.container.firstElementChild!.className).toContain('editorTreePanelFull')
    panel.unmount()
  })
})
