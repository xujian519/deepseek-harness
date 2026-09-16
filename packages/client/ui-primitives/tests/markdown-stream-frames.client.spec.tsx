// @vitest-environment jsdom
// Streaming frame coalescing: a reply whose open tail block outgrows the parse
// budget holds frames back instead of re-parsing its whole text on every chunk.
// A held-back frame shows the elements of the frame before it, a rewritten
// document is never held back, and the component's retry tick delivers the
// held-back text even when the reply pauses. Prefix equivalence with a fresh
// render is asserted on every frame this file renders.
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { MarkdownText } from './markdown-test-components.tsx'
import { markdownLabels } from './labels.client.ts'
import { StreamingRenderer } from '../src/markdown/streaming-renderer.ts'
import { StreamFrameGate, STREAM_FRAME_MIN_SOURCE_CHARS } from '../src/markdown/stream-frame-gate.ts'

afterEach(cleanup)

/** A paragraph long enough for admission to apply. */
const SOURCE = 'word '.repeat(STREAM_FRAME_MIN_SOURCE_CHARS / 3)

/** The DOM the given streaming children render to, mounted and torn down on its own. */
function markup(children: ReactNode[]): string {
  const view = render(<div>{children}</div>)
  const html = view.container.innerHTML
  view.unmount()
  return html
}

/** The DOM a fresh streaming renderer produces for `text`. */
function freshMarkup(text: string): string {
  return markup(new StreamingRenderer(markdownLabels).render(text))
}

/**
 * A clock that advances a fixed step per read, so a frame's measured cost is
 * the step between its two reads and its cool-down lands a fixed number of
 * reads later: admission is scripted here instead of machine-timed.
 */
function steppingGate(stepMs = 30): StreamFrameGate {
  let elapsed = 0
  return new StreamFrameGate(() => {
    elapsed += stepMs
    return elapsed
  })
}

describe('coalesced streaming frames', () => {
  it('hands a held-back frame the previous elements and renders the accumulated text on the retry', () => {
    const renderer = new StreamingRenderer(markdownLabels, steppingGate())
    const first = renderer.render(SOURCE)
    expect(markup(first)).toBe(freshMarkup(SOURCE))
    // The 30 ms frame outran the budget, so this chunk waits inside its cool-down.
    const held = renderer.render(`${SOURCE}\n\nsecond paragraph`)
    expect(held).toBe(first)
    expect(renderer.delayMs()).toBeGreaterThan(0)
    const retried = renderer.render(`${SOURCE}\n\nsecond paragraph\n\nthird paragraph`)
    expect(markup(retried)).toBe(freshMarkup(`${SOURCE}\n\nsecond paragraph\n\nthird paragraph`))
    expect(markup(retried)).not.toBe(markup(held))
  })

  it('renders a rewritten document instead of holding it back', () => {
    const renderer = new StreamingRenderer(markdownLabels, steppingGate())
    renderer.render(SOURCE)
    const rewritten = renderer.render('totally different document')
    // A non-append rewrite is not this frame's continuation, so it renders inside the cool-down.
    expect(markup(rewritten)).toBe(freshMarkup('totally different document'))
    expect(renderer.delayMs()).toBeNull()
  })
})

describe('a reply that streams as one growing top-level block', () => {
  /** One paragraph: no blank line can close it, so every frame re-parses all of it. */
  const BLOCK = Array.from({ length: 4_000 }, (_, index) => `Paragraph line ${index}. `).join('')
  const HEAD = BLOCK.slice(0, 400)

  it('delivers a held-back frame when the reply pauses, with no further chunk', async () => {
    const view = render(<MarkdownText text={HEAD} streaming />)
    view.rerender(<MarkdownText text={BLOCK} streaming />)
    const rendered = view.container.innerHTML
    view.rerender(<MarkdownText text={`${BLOCK}tail`} streaming />)
    // The block's re-parse outran the frame budget, so this chunk shows the frame before it.
    expect(view.container.innerHTML).toBe(rendered)
    const fresh = render(<MarkdownText text={`${BLOCK}tail`} streaming />)
    const expected = fresh.container.innerHTML
    fresh.unmount()
    expect(expected).not.toBe(rendered)
    await waitFor(() => { expect(view.container.innerHTML).toBe(expected) }, { timeout: 5_000 })
    view.unmount()
  }, 20_000)

  it('renders the settled text in full while a frame is held back', () => {
    const view = render(<MarkdownText text={HEAD} streaming />)
    view.rerender(<MarkdownText text={BLOCK} streaming />)
    const rendered = view.container.innerHTML
    view.rerender(<MarkdownText text={`${BLOCK}tail`} streaming />)
    expect(view.container.innerHTML).toBe(rendered)
    view.rerender(<MarkdownText text={`${BLOCK}tail`} />)
    const settled = render(<MarkdownText text={`${BLOCK}tail`} />)
    expect(view.container.innerHTML).toBe(settled.container.innerHTML)
    settled.unmount()
    view.unmount()
  }, 20_000)
})
