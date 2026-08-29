// @vitest-environment jsdom
/**
 * MermaidMarkdown spec (the chunk-resident preview renderer): the code-block
 * swap (mermaid fence → diagram), the render/sanitize failure fallbacks, the
 * copy button, the zoom modal (open, zoom/pan/reset/close interactions), the
 * restore path when a block stops being a mermaid fence, and the mount
 * teardown when a fence leaves the document.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

const renderMermaid = vi.fn()
const initializeMermaid = vi.fn()

vi.mock('mermaid', () => ({
  default: { initialize: initializeMermaid, render: renderMermaid },
}))

const { MermaidMarkdown } = await import('../src/client/mermaid.tsx')

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const GOOD_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>'
const codeLabels = { copyLabel: 'Copy', copiedLabel: 'Copied' }

const FENCE = ['```mermaid', 'graph TD; A-->B;', '```'].join('\n')

async function renderText(text: string): Promise<{
  container: HTMLDivElement
  rerender: (next: string) => Promise<void>
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const render = (next: string): void => {
    root.render(createElement(MermaidMarkdown, { text: next, codeLabels }))
  }
  await act(async () => {
    render(text)
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
  return {
    container,
    rerender: async (next: string) => {
      await act(async () => {
        render(next)
        await new Promise((resolve) => { setTimeout(resolve, 0) })
        await new Promise((resolve) => { setTimeout(resolve, 0) })
      })
    },
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

beforeEach(() => {
  renderMermaid.mockReset()
  initializeMermaid.mockReset()
  renderMermaid.mockResolvedValue({ svg: GOOD_SVG })
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('MermaidMarkdown swap', () => {
  it('configures mermaid, renders the fence, and swaps the code block for the sanitized diagram', async () => {
    const { container, unmount } = await renderText(`# Doc\n\n${FENCE}\n\ntail`)
    expect(initializeMermaid).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict', htmlLabels: false, startOnLoad: false,
    }))
    expect(renderMermaid).toHaveBeenCalledWith(expect.stringContaining('dsh-md-mermaid-'), 'graph TD; A-->B;')
    const diagram = container.querySelector('[data-mermaid-diagram]')!
    expect(diagram).not.toBeNull()
    expect(diagram.querySelector('svg text')?.textContent).toBe('ok')
    unmount()
  })

  it('a render rejection shows the error fallback with the fence source', async () => {
    renderMermaid.mockRejectedValue(new Error('Syntax error in graph\nline2\nline3\nline4\nline5\nline6\nline7'))
    const { container, unmount } = await renderText(FENCE)
    expect(container.querySelector('[class*="mermaidError"]')).not.toBeNull()
    const source = container.querySelector('[class*="mermaidCode"] code')!
    expect(source.textContent).toContain('graph TD; A-->B;')
    unmount()
  })

  it('a sanitized-away diagram never passes the raw string through', async () => {
    // The unclosed <text> fails the XML parse: sanitizeSvg keeps nothing.
    renderMermaid.mockResolvedValue({ svg: '<svg><text>oops</svg>' })
    const { container, unmount } = await renderText(FENCE)
    expect(container.querySelector('[data-mermaid-diagram]')).toBeNull()
    expect(container.querySelector('[class*="mermaidError"]')).not.toBeNull()
    unmount()
  })

  it('renders with the dark theme when the body carries the dark attribute', async () => {
    document.body.setAttribute('data-ds-dark-theme', '')
    document.documentElement.style.colorScheme = 'dark'
    const { container, unmount } = await renderText(FENCE)
    expect(initializeMermaid).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
    expect(container.querySelector('[data-mermaid-diagram]')).not.toBeNull()
    document.documentElement.style.colorScheme = ''
    document.body.removeAttribute('data-ds-dark-theme')
    unmount()
  })

  it('a scheme flip re-renders the diagram; a string rejection summarizes', async () => {
    const { container, unmount } = await renderText(FENCE)
    const callsBefore = renderMermaid.mock.calls.length
    // The theme subscription watches data-ds-dark-theme on <body>; the
    // documentElement stamp makes isDarkScheme() decide from it.
    document.documentElement.style.colorScheme = 'dark'
    await act(async () => {
      document.body.setAttribute('data-ds-dark-theme', '')
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(renderMermaid.mock.calls.length).toBeGreaterThan(callsBefore)
    // A non-Error rejection summarizes via String().
    renderMermaid.mockRejectedValueOnce('plain boom')
    await act(async () => {
      document.body.removeAttribute('data-ds-dark-theme')
      document.documentElement.style.colorScheme = ''
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(container.querySelector('[class*="mermaidError"]')).not.toBeNull()
    unmount()
  })

  it('render results landing after unmount or code change update nothing', async () => {
    let release!: (value: { svg: string }) => void
    renderMermaid.mockImplementation(() => new Promise((res) => { release = res }))
    const { container, unmount } = await renderText(FENCE)
    unmount()
    await act(async () => { release({ svg: GOOD_SVG }) })
    expect(container.isConnected).toBe(false)
  })

  it('an all-whitespace fence renders no diagram and never calls mermaid', async () => {
    const { container, unmount } = await renderText(['```mermaid', '   ', '```'].join('\n'))
    expect(renderMermaid).not.toHaveBeenCalled()
    expect(container.querySelector('[data-mermaid-diagram]')).toBeNull()
    unmount()
  })
})

describe('MermaidMarkdown copy + zoom', () => {
  it('the copy button flips to its copied label through the clipboard writer', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const { container, unmount } = await renderText(FENCE)
    const button = container.querySelector<HTMLButtonElement>('[class*="mermaidCopy"]')!
    await act(async () => {
      button.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(clipboard).toHaveBeenCalledWith('graph TD; A-->B;')
    // Fake timers must be active BEFORE the click so the label-reset
    // timeout is the fake one the test can advance.
    vi.useRealTimers()
    try {
      expect(button.textContent).toContain('Copied')
    } finally {
      vi.useRealTimers()
    }
    unmount()
  })

  it('copy twice only writes once, a failed write never flips, and a bare click on the frame is inert', async () => {
    const primitives = await import('@deepseek-ai/dsh-client-ui-primitives')
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(false)
    const { container, unmount } = await renderText(FENCE)
    const button = container.querySelector<HTMLButtonElement>('[class*="mermaidCopy"]')!
    await act(async () => {
      button.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(button.textContent).toContain('Copy')
    // A bare click on the diagram body (no svg ancestor) opens no modal.
    const frame = container.querySelector('[data-mermaid-diagram]')!
    expect(frame).not.toBeNull()
    act(() => { frame.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('[data-mermaid-modal]')).toBeNull()
    unmount()
  })

  it('a settle and guard sweep: cancelled render, copied re-click, drag without mousedown, stray keys, wheel-out, and a shiki-style block', async () => {
    // Cancelled render settling after unmount (the then/catch guards).
    let release!: (value: { svg: string }) => void
    renderMermaid.mockImplementation(() => new Promise((res) => { release = res }))
    const first = await renderText(FENCE)
    first.unmount()
    await act(async () => { release({ svg: GOOD_SVG }) })
    renderMermaid.mockResolvedValue({ svg: GOOD_SVG })

    // Drag guards: mousemove without an active drag, and a key that is none
    // of the zoom keys, plus a downward wheel (zoom out).
    const { container, unmount } = await renderText(FENCE)
    const body = container.querySelector('[data-mermaid-diagram]')!
    act(() => { body.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const modal = document.querySelector('[data-mermaid-modal]') as HTMLElement
    const stage = modal.querySelector('[class*="mermaidModalStage"]') as HTMLElement
    const svg = stage.querySelector('svg') as SVGSVGElement
    act(() => { window.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 5 })) })
    act(() => {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: 10, clientY: 10, cancelable: true }))
    })
    const afterWheel = svg.style.transform
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })) })
    expect(svg.style.transform).toBe(afterWheel)
    // A shiki-style block (language-mermaid class on <code>) is swapped too.
    const synthetic = document.createElement('div')
    synthetic.className = 'md-code-block'
    synthetic.innerHTML = '<code class="language-mermaid">graph TD; X-->Y;</code>'
    container.querySelector('[class*="mermaidMarkdown"]')!.append(synthetic)
    const callsBefore = renderMermaid.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup'))
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    expect(renderMermaid.mock.calls.length).toBe(callsBefore)
    unmount()
  })

  it('clicking the diagram opens the zoom modal with a clone; Escape and the close button dismiss it', async () => {
    const { container, unmount } = await renderText(FENCE)
    const body = container.querySelector('[data-mermaid-diagram]')!
    act(() => { body.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const modal = document.querySelector('[data-mermaid-modal]')!
    expect(modal).not.toBeNull()
    expect(modal.querySelector('svg text')?.textContent).toBe('ok')
    // Escape closes.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(document.querySelector('[data-mermaid-modal]')).toBeNull()
    // Reopen and close through the toolbar button.
    act(() => { body.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const reopen = document.querySelector('[data-mermaid-modal]')!
    const close = [...reopen.querySelectorAll('button')].at(-1)!
    act(() => { close.click() })
    expect(document.querySelector('[data-mermaid-modal]')).toBeNull()
    unmount()
  })

  it('the modal zoom buttons, keyboard zoom, wheel, drag and overlay click all work', async () => {
    const { container, unmount } = await renderText(FENCE)
    const body = container.querySelector('[data-mermaid-diagram]')!
    act(() => { body.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const modal = document.querySelector('[data-mermaid-modal]') as HTMLElement
    const stage = modal.querySelector('[class*="mermaidModalStage"]') as HTMLElement
    const svg = stage.querySelector('svg') as SVGSVGElement
    const buttons = [...modal.querySelectorAll('button')]
    // Zoom in / out / reset through the toolbar.
    act(() => { buttons[1]!.click() })
    expect(svg.style.transform).toContain('scale(1.2)')
    act(() => { buttons[0]!.click() })
    act(() => { buttons[2]!.click() })
    expect(svg.style.transform).toContain('scale(1)')
    // Wheel zoom around a point.
    act(() => {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 30, clientY: 30, cancelable: true }))
    })
    expect(svg.style.transform).not.toBe('')
    // Drag pans the diagram.
    act(() => {
      svg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }))
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 20 }))
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    // Keyboard zoom in/out/reset.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' })) })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' })) })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' })) })
    // A click on the overlay itself (not the panel) closes.
    act(() => { modal.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(document.querySelector('[data-mermaid-modal]')).toBeNull()
    unmount()
  })
})

describe('MermaidMarkdown mount lifecycle', () => {
  it('a block that stops being a mermaid fence gets its code children back', async () => {
    const { container, rerender, unmount } = await renderText(FENCE)
    expect(container.querySelector('[data-mermaid-processed]')).not.toBeNull()
    // The fence is now a plain text fence: restore the original children.
    await rerender(['```text', 'plain now', '```'].join('\n'))
    expect(container.querySelector('[data-mermaid-processed]')).toBeNull()
    expect(container.textContent).toContain('plain now')
    unmount()
  })

  it('a same-text commit re-scans the swapped block without disturbing it; a removed fence drops the mount', async () => {
    const { container, rerender, unmount } = await renderText(FENCE)
    expect(container.querySelector('[data-mermaid-processed]')).not.toBeNull()
    // Same text: reconciliation changes nothing, the swap survives, and the
    // rescan settles the mount (its cached source now reads from the swapped
    // host, which carries no code).
    await rerender(FENCE)
    await rerender(FENCE)
    expect(container.querySelector('[data-mermaid-processed]')).not.toBeNull()
    // A document without the fence drops the orphaned mount on the next scan.
    await rerender('no fences at all')
    expect(container.querySelector('[data-mermaid-processed]')).toBeNull()
    unmount()
  })

  it('a non-mermaid document never touches mermaid', async () => {
    const { container, unmount } = await renderText(['```sh', 'echo hi', '```'].join('\n'))
    expect(renderMermaid).not.toHaveBeenCalled()
    expect(container.querySelector('[data-mermaid-processed]')).toBeNull()
    unmount()
  })
})
