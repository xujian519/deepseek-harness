// @vitest-environment jsdom
/**
 * MdToc coverage round: headings without text are skipped by the outline
 * scan, a non-Escape keydown leaves the popover open, and the jump flash is
 * conditional on the CSS module actually carrying the class (a mocked module
 * without it must degrade to no flash, not a crash).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { MdToc } from '../src/client/md-toc.tsx'

// The CSS module stand-in: same class names the component reads, minus
// tocFlash — the "built CSS without this class" degrade path.
vi.mock('../src/client/sidebar.module.css', () => ({
  default: {
    tocBar: 'tocBar', tocPanel: 'tocPanel', tocItem: 'tocItem',
    tocItemLevel: 'tocItemLevel', tocItemText: 'tocItemText', tocButton: 'tocButton',
  },
}))

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

Element.prototype.scrollIntoView = vi.fn()

interface HeadingSpec {
  tag: string
  text: string
}

function Harness({ specs }: { specs: readonly HeadingSpec[] }): React.ReactElement {
  return createElement(
    'div',
    null,
    createElement(MdToc),
    ...specs.map(spec => createElement(spec.tag, null, spec.text)),
  )
}

async function mountToc(specs: readonly HeadingSpec[]): Promise<{ container: HTMLDivElement; root: Root }> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(Harness, { specs }))
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
  return { container: host.firstElementChild as HTMLDivElement, root }
}

async function unmount(root: Root): Promise<void> {
  await act(async () => { root.unmount() })
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
})

describe('MdToc scan and popover edges', () => {
  it('skips headings without text (four headings, one empty → three entries)', async () => {
    const { container, root } = await mountToc([
      { tag: 'h1', text: 'Title' },
      { tag: 'h2', text: '' },
      { tag: 'h2', text: 'A' },
      { tag: 'h3', text: 'B' },
    ])
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-md-toc]')
    expect(button, 'three real headings clear the threshold').not.toBeNull()
    await act(async () => { button!.click() })
    const items = [...container.querySelectorAll('[data-dsh-md-toc-panel] button')]
    expect(items.map(item => item.textContent)).toEqual(['1Title', '2A', '3B'])
    await unmount(root)
  })

  it('a keydown that is not Escape leaves the popover open', async () => {
    const { container, root } = await mountToc([
      { tag: 'h1', text: 'Title' },
      { tag: 'h2', text: 'A' },
      { tag: 'h2', text: 'B' },
    ])
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-md-toc]')!
    await act(async () => { button.click() })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    expect(container.querySelector('[data-dsh-md-toc-panel]')).not.toBeNull()
    await unmount(root)
  })

  it('jumps without a flash class when the CSS module lacks one', async () => {
    // Mount with real timers (the settle await needs them), then fake only
    // the flash-removal timeout window.
    const { container, root } = await mountToc([
      { tag: 'h1', text: 'Title' },
      { tag: 'h2', text: 'A' },
      { tag: 'h2', text: 'B' },
    ])
    const button = container.querySelector<HTMLButtonElement>('[data-dsh-md-toc]')!
    await act(async () => { button.click() })
    const target = container.querySelector('h2')!
    const item = [...container.querySelectorAll<HTMLButtonElement>('[data-dsh-md-toc-panel] button')]
      .find(candidate => candidate.textContent?.includes('A'))!
    await act(async () => { item.click() })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(target.className, 'no flash class exists to add').toBe('')
    await unmount(root)
  })
})
