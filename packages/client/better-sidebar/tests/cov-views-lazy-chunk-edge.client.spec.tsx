// @vitest-environment jsdom
/**
 * Coverage round for the lazy chunk wrapper's edge paths: the cancelled
 * settlements (unmount before the load settles), a chunk missing its
 * component, and a rejection carrying a non-Error value.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { registerChunkForTests, resetChunks } from '../src/client/chunk-loader.ts'
import { lazyChunkComponent } from '../src/client/lazy-chunk.tsx'
import css from '../src/client/sidebar.module.css'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function mount(node: ReactNode): { container: HTMLDivElement; unmount: () => void } {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(node) })
  return {
    container,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

const Marker = (): ReactNode => createElement('div', { 'data-testid': 'chunk-rendered' }, 'loaded')

beforeEach(() => {
  resetChunks()
})

afterEach(() => {
  for (const el of document.querySelectorAll('body > div')) el.remove()
})

describe('lazyChunkView edge paths', () => {
  it('a settlement after unmount updates nothing and crashes nothing', async () => {
    let release: ((mod: Record<string, unknown>) => void) | undefined
    let reject: ((error: unknown) => void) | undefined
    registerChunkForTests('editor', () => new Promise((resolve, rej) => { release = resolve; reject = rej }))
    const Wrapper = lazyChunkComponent<Record<string, never>>('editor', mod => mod.TextEditor as ComponentType<Record<string, never>> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, {}))
    unmount()
    // The load settles into a dead component: the cancelled guards must skip
    // both the success and the failure setState.
    act(() => { release?.({ TextEditor: Marker }) })
    // Same for a rejection settling after unmount (the catch's guard).
    expect(() => { act(() => { reject?.(new Error('late failure')) }) }).not.toThrow()
    expect(container.isConnected).toBe(false)
  })

  it('a chunk without the picked component degrades to the missing-component error', async () => {
    registerChunkForTests('editor', async () => ({ SomethingElse: Marker }))
    const Wrapper = lazyChunkComponent<Record<string, never>>('editor', mod => mod.TextEditor as ComponentType<Record<string, never>> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, {}))
    await act(async () => {})
    expect(container.querySelector(`.${css.editorError}`)).not.toBeNull()
    expect(container.textContent).toContain('chunk "editor" is missing its component')
    unmount()
  })

  it('a non-Error rejection surfaces its string form', async () => {
    registerChunkForTests('terminal', () => Promise.reject('plain failure'))
    const Wrapper = lazyChunkComponent<Record<string, never>>('terminal', mod => mod.TerminalView as ComponentType<Record<string, never>> | undefined)
    const { container, unmount } = mount(createElement(Wrapper, {}))
    await act(async () => {})
    expect(container.textContent).toContain('plain failure')
    unmount()
  })
})
