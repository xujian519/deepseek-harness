/**
 * The sidebar's extra icons render their glyphs: each component mounts a
 * sized <svg> with the app's outline style. Rendered WITHOUT props so the
 * default 16px size is exercised (every call site passes an explicit size).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import {
  IconDiffOutline16,
  IconGlobeOutline16,
  IconHistoryOutline16,
  IconHtmlOutline16,
  IconImageOutline16,
  IconMarkdownOutline16,
  IconPdfOutline16,
  IconSaveOutline16,
  IconStopOutline16,
  IconTerminalOutline16,
} from '../src/client/icons.tsx'

const GLYPHS: Array<[string, (props: { size?: number; className?: string }) => React.ReactElement]> = [
  ['terminal', IconTerminalOutline16],
  ['diff', IconDiffOutline16],
  ['image', IconImageOutline16],
  ['pdf', IconPdfOutline16],
  ['markdown', IconMarkdownOutline16],
  ['html', IconHtmlOutline16],
  ['globe', IconGlobeOutline16],
  ['history', IconHistoryOutline16],
  ['save', IconSaveOutline16],
  ['stop', IconStopOutline16],
]

describe('sidebar icon glyphs', () => {
  const host = document.createElement('div')
  let root: Root

  afterEach(() => {
    if (root !== undefined) {
      act(() => { root.unmount() })
      host.remove()
    }
    document.body.innerHTML = ''
  })

  for (const [name, Glyph] of GLYPHS) {
    it(`renders the ${name} glyph at its default size`, () => {
      host.remove()
      document.body.innerHTML = ''
      document.body.append(host)
      root = createRoot(host)
      act(() => { root.render(createElement(Glyph, { className: `icon-${name}` })) })
      const svg = host.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg!.getAttribute('width')).toBe('16')
      expect(svg!.getAttribute('height')).toBe('16')
      expect(svg!.getAttribute('class')).toBe(`icon-${name}`)
      expect(svg!.getAttribute('viewBox')).not.toBeNull()
    })
  }
})
