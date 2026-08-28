// @vitest-environment jsdom
/**
 * DiffView coverage round: the untracked-file projection (trailing-newline
 * trim, empty content, full-addition numbering), the file header badges
 * (binary / added / deleted / renamed), unprefixed paths, hunk section
 * headers, context and `\ No newline` meta rows, the >500-row head+tail cap
 * with its expand/collapse toggle, and the null render for a diff with no
 * files.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { DiffView } from '../src/client/DiffView.tsx'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(props: { diff?: string; untrackedPath?: string; untrackedContent?: string }): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(DiffView, { ...props, diff: props.diff ?? '' })) })
  return { container, root }
}

function unmount(container: HTMLDivElement, root: Root): void {
  act(() => { root.unmount() })
  container.remove()
}

afterEach(() => { document.body.innerHTML = '' })

describe('untracked file projection', () => {
  it('renders the file content as one addition per line, trimming the trailing newline', () => {
    const { container, root } = mount({ untrackedPath: 'fresh/new.ts', untrackedContent: 'alpha\nbeta\n' })
    expect(container.textContent).toContain('fresh/new.ts')
    expect(container.textContent).toContain('← /dev/null')
    const lines = [...container.querySelectorAll('div[class*="gitDiffLine"]')]
    expect(lines).toHaveLength(2)
    expect(lines.map(line => line.textContent)).toEqual(['1alpha', '2beta'])
    unmount(container, root)
  })

  it('keeps content without a trailing newline verbatim', () => {
    const { container, root } = mount({ untrackedPath: 'x.txt', untrackedContent: 'solo' })
    // An unknown extension stays folded: expand before asserting the rows.
    act(() => { container.querySelector('button')!.click() })
    const lines = [...container.querySelectorAll('div[class*="gitDiffLine"]')]
    expect(lines.map(line => line.textContent)).toEqual(['1solo'])
    unmount(container, root)
  })

  it('an empty untracked file renders only the path row', () => {
    const { container, root } = mount({ untrackedPath: 'empty.txt', untrackedContent: '' })
    expect(container.querySelectorAll('div[class*="gitDiffLine"]')).toHaveLength(0)
    expect(container.querySelector('button')).not.toBeNull()
    unmount(container, root)
  })
})

describe('file header badges', () => {
  it('marks a binary file and keeps its row non-expandable', () => {
    const { container, root } = mount({ diff: [
      'diff --git a/logo.png b/logo.png',
      '--- a/logo.png',
      '+++ b/logo.png',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n') })
    const header = container.querySelector('button')!
    expect(header.getAttribute('aria-expanded')).toBeNull()
    expect(header.textContent).toContain('logo.png')
    // t() returns the key in tests: the binary badge.
    expect(header.textContent).toContain('Binary')
    unmount(container, root)
  })

  it('marks an added file (old side /dev/null)', () => {
    const { container, root } = mount({ diff: [
      'diff --git a/added.ts b/added.ts',
      '--- /dev/null',
      '+++ b/added.ts',
      '@@ -0,0 +1 @@',
      '+brand new',
    ].join('\n') })
    expect(container.querySelector('button')!.textContent).toContain('Added')
    unmount(container, root)
  })

  it('marks a deleted file, defaulting its fold state from the old path', () => {
    const { container, root } = mount({ diff: [
      'diff --git a/src/gone.ts b/src/gone.ts',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-so long',
    ].join('\n') })
    // A .ts source path is open by default even when its new side is gone.
    const header = container.querySelector('button')!
    expect(header.textContent).toContain('Deleted')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('so long')
    unmount(container, root)
  })

  it('marks a renamed file and shows both paths', () => {
    const { container, root } = mount({ diff: [
      'diff --git a/before.ts b/after.ts',
      '--- a/before.ts',
      '+++ b/after.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n') })
    const header = container.querySelector('button')!
    expect(header.textContent).toContain('Renamed')
    expect(header.textContent).toContain('← before.ts')
    unmount(container, root)
  })

  it('renders an unprefixed path verbatim', () => {
    const { container, root } = mount({ diff: [
      'diff --git README.md README.md',
      '--- README.md',
      '+++ README.md',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n') })
    expect(container.querySelector('button')!.textContent).toContain('README.md')
    unmount(container, root)
  })
})

describe('hunk and line rendering', () => {
  it('renders the hunk section header, context rows, and the no-newline meta row', () => {
    const { container, root } = mount({ diff: [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@ function a()',
      ' const x = 1',
      '-const y = 2',
      '\\ No newline at end of file',
      '+const y = 3',
      '\\ No newline at end of file',
    ].join('\n') })
    expect(container.textContent).toContain('function a()')
    const lines = [...container.querySelectorAll('div[class*="gitDiffLine"]')]
    expect(lines).toHaveLength(5)
    expect(lines[0]!.textContent).toBe('11const x = 1')
    // The meta rows render as text, without number gutters.
    expect(lines[2]!.textContent).toBe(' No newline at end of file')
    unmount(container, root)
  })
})

describe('row cap and expand toggle', () => {
  const bigDiff = [
    'diff --git a/src/big.ts b/src/big.ts',
    '--- a/src/big.ts',
    '+++ b/src/big.ts',
    '@@ -1,600 +1,600 @@',
    ...Array.from({ length: 600 }, (_, i) => `+line ${i}`),
  ].join('\n')

  it('caps the flattened rows at 500 with an expand affordance', () => {
    const { container, root } = mount({ diff: bigDiff })
    const rows = container.querySelectorAll('div[class*="gitDiffLine"]')
    expect(rows.length).toBeLessThan(500)
    const expand = [...container.querySelectorAll('button')].at(-1)!
    expect(expand.textContent).toMatch(/Expand \d+ more rows/)
    unmount(container, root)
  })

  it('expanding reveals the hidden rows; collapsing folds them back', () => {
    const { container, root } = mount({ diff: bigDiff })
    const expand = [...container.querySelectorAll('button')].at(-1)!
    act(() => { expand.click() })
    expect(container.querySelectorAll('div[class*="gitDiffLine"]').length).toBe(600)
    const collapse = [...container.querySelectorAll('button')].at(-1)!
    expect(collapse.textContent).toContain('Collapse')
    act(() => { collapse.click() })
    expect(container.querySelectorAll('div[class*="gitDiffLine"]').length).toBeLessThan(500)
    unmount(container, root)
  })
})

describe('degenerate input', () => {
  it('renders nothing for text with no file sections', () => {
    const { container, root } = mount({ diff: 'leading noise\nwithout a diff header' })
    expect(container.childElementCount).toBe(0)
    unmount(container, root)
  })
})
