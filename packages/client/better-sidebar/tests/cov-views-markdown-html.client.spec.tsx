// @vitest-environment jsdom
/**
 * MarkdownDocument coverage round: the mermaid chunk path for a run with a
 * diagram fence, media elements without a src, inline tag text that
 * sanitizes to nothing (the walker leaves it alone), wrapper attribute
 * mapping (class/for → React names, style/on* dropped), whitespace-only HTML
 * leaves, stray closes at the top level, wrappers left open at the end of
 * the document (denied and allowed), and the MutationObserver re-arming that
 * swaps tag text that appears late.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { registerChunkForTests, resetChunks } from '../src/client/chunk-loader.ts'
import { MarkdownDocument, type MarkdownHtmlMedia } from '../src/client/MarkdownHtml.tsx'
import { analyzeMarkdownHtml } from '../src/client/markdown-html.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const media: MarkdownHtmlMedia = {
  scope: { sessionId: 's1', cwd: '/ws' },
  path: '/ws/docs/README.md',
  origin: 'http://gui.origin',
}
const codeLabels = { copyLabel: 'Copy', copiedLabel: 'Copied' }

async function renderDocument(text: string): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(MarkdownDocument, { info: analyzeMarkdownHtml(text), media, codeLabels }))
    // Let observer deliveries settle inside the act scope.
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
  return { container, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

beforeEach(() => {
  resetChunks()
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const el of document.querySelectorAll('body > div')) el.remove()
})

describe('mermaid chunk path', () => {
  it('routes a run containing a mermaid fence through the chunk renderer', async () => {
    let received: { text: string; codeLabels: { copyLabel: string } } | undefined
    registerChunkForTests('mermaid', async () => ({
      MermaidMarkdown: ((props: { text: string; codeLabels: { copyLabel: string } }) => {
        received = props
        return createElement('div', { 'data-testid': 'mermaid-rendered' }, props.text)
      }) as unknown as ReactNode,
    }))
    const { container, root } = await renderDocument([
      '# Diagram',
      '',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
    ].join('\n'))
    expect(container.querySelector('[data-testid="mermaid-rendered"]')).not.toBeNull()
    expect(received?.text).toContain('graph TD; A-->B;')
    expect(received?.codeLabels.copyLabel).toBe('Copy')
    await unmount(root)
  })
})

describe('sanitizer edges', () => {
  it('a media element without a src passes through untouched', async () => {
    const { container, root } = await renderDocument('<picture><img alt="placeholder"/><source srcSet="x"/></picture>')
    const img = container.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('placeholder')
    expect(img.getAttribute('src')).toBeNull()
    await unmount(root)
  })

  it('inline tag text that sanitizes to nothing stays literal text', async () => {
    const { container, root } = await renderDocument([
      'a row | danger',
      '|---|---|',
      '| x | an <iframe src="https://evil.test"> tag |',
    ].join('\n'))
    // The forbidden tag is neither swapped into an inline span nor rendered.
    expect(container.querySelector('[data-html-inline]')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.textContent).toContain('an <iframe src="https://evil.test"> tag')
    await unmount(root)
  })

  it('maps class/for to React names and drops style and on* attributes on wrappers', async () => {
    const { container, root } = await renderDocument([
      '<details open class="mine" for="x" style="color:red" onclick="evil()" data-k="v">',
      '',
      'inside the fold',
      '',
    ].join('\n'))
    const details = container.querySelector('details')!
    expect(details.className).toBe('mine')
    expect(details.getAttribute('data-k')).toBe('v')
    expect(details.getAttribute('style')).toBeNull()
    expect(details.getAttribute('onclick')).toBeNull()
    expect(details.textContent).toContain('inside the fold')
    await unmount(root)
  })

  it('skips an HTML leaf whose content is whitespace only', async () => {
    // After the unmatched close, the trailing whitespace becomes its own html
    // part; sanitizing it leaves nothing, so no leaf is emitted for it.
    const { container, root } = await renderDocument('</div>   ')
    expect(container.querySelectorAll('[data-dsh-html-segment]')).toHaveLength(0)
    await unmount(root)
  })

  it('a stray close at the top level renders nothing and keeps the flow', async () => {
    const { container, root } = await renderDocument('</div>\n\nplain tail')
    expect(container.querySelector('div[data-dsh-html-segment]')).toBeNull()
    expect(container.textContent).toContain('plain tail')
    await unmount(root)
  })

  it('a denied wrapper left open at the end lowers following runs in transparently', async () => {
    const { container, root } = await renderDocument('<form>\n\ntrailing markdown\n')
    expect(container.querySelector('form')).toBeNull()
    expect(container.textContent).toContain('trailing markdown')
    await unmount(root)
  })

  it('an allowed wrapper left open at the end still renders its element', async () => {
    const { container, root } = await renderDocument([
      '<div class="tail">',
      '',
      'trailing markdown',
    ].join('\n'))
    const div = container.querySelector('div.tail')!
    expect(div.textContent).toContain('trailing markdown')
    await unmount(root)
  })
})

describe('inline pass observer re-arm', () => {
  it('swaps tag text that appears in the DOM after mount', async () => {
    const { container, root } = await renderDocument('nothing taglike here')
    expect(container.querySelector('[data-html-inline]')).toBeNull()
    // A late text node (shiki settling, manual insert) carrying a tag: the
    // observer must re-run the pass and swap it.
    await act(async () => {
      const host = container.querySelector('div')!
      const text = document.createTextNode('late <b>bold</b> text')
      host.append(text)
      await new Promise((resolve) => { setTimeout(resolve, 0) })
      await new Promise((resolve) => { setTimeout(resolve, 0) })
    })
    const inline = container.querySelector('[data-html-inline]')
    expect(inline).not.toBeNull()
    expect(inline?.querySelector('b')?.textContent).toBe('bold')
    await unmount(root)
  })
})
