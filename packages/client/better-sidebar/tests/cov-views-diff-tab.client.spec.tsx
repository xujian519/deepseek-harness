// @vitest-environment jsdom
/**
 * DiffTab coverage round: the worktree and commit load paths, the
 * both-sides-empty retry (the staged-flag fix), the untracked full-file
 * fallback (text and binary reads), the empty-diff notice, error rendering,
 * and the refresh button that re-runs the load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { api } from '../src/client/api.ts'
import { DiffTab } from '../src/client/DiffTab.tsx'
import type { SidebarDiffRef } from '../src/client/state.ts'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const flushed = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    await new Promise((resolve) => { setTimeout(resolve, 0) })
  })
}

function mount(sessionId: string, cwd: string | undefined, diff: SidebarDiffRef): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(DiffTab, { sessionId, cwd, diff })) })
  return { container, root }
}

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-x',
  '+y',
].join('\n')

beforeEach(() => {
  vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: DIFF })
  vi.spyOn(api, 'gitCommitDiff').mockResolvedValue({ diff: DIFF })
  vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'brand new\n', truncated: false })
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('DiffTab load paths', () => {
  it('loads a worktree diff and titles the tab with the path', async () => {
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'src/a.ts', staged: false }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(api.gitDiff).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/ws' }, 'src/a.ts', false, undefined)
    expect(container.textContent).toContain('src/a.ts')
    expect(container.querySelectorAll('div[class*="gitDiffLine"]').length).toBe(2)
    act(() => { root.unmount() })
    container.remove()
  })

  it('loads a commit patch and titles the tab with hash + subject', async () => {
    const ref: SidebarDiffRef = { kind: 'commit', hash: 'abc1234', hashFull: 'abcdef1234567890', subject: 'fix thing' }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(api.gitCommitDiff).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/ws' }, 'abcdef1234567890', undefined)
    expect(container.textContent).toContain('abc1234 fix thing')
    act(() => { root.unmount() })
    container.remove()
  })

  it('carries the repoRoot and worktree into the scope payloads', async () => {
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: true, worktree: '/wt', repoRoot: '/repo' }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(api.gitDiff).toHaveBeenCalledWith(
      { sessionId: 's1', cwd: '/ws', repoRoot: '/repo' }, 'a.ts', true, '/wt',
    )
    act(() => { root.unmount() })
    container.remove()
  })

  it('retries the other side once when the requested side is empty', async () => {
    const gitDiff = vi.spyOn(api, 'gitDiff')
      .mockResolvedValueOnce({ diff: '' })
      .mockResolvedValueOnce({ diff: DIFF })
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: true }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(gitDiff).toHaveBeenCalledTimes(2)
    expect(gitDiff).toHaveBeenLastCalledWith(
      { sessionId: 's1', cwd: '/ws' }, 'a.ts', false, undefined,
    )
    expect(container.querySelectorAll('div[class*="gitDiffLine"]').length).toBe(2)
    act(() => { root.unmount() })
    container.remove()
  })

  it('falls back to a full-file addition for an untracked worktree file', async () => {
    vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: '' })
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'notes/idea.ts', staged: false, untracked: true, repoRoot: '/repo' }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(api.fsRead).toHaveBeenCalledWith({ sessionId: 's1', cwd: '/ws', repoRoot: '/repo' }, '/repo/notes/idea.ts')
    expect(container.querySelectorAll('div[class*="gitDiffLine"]').length).toBe(1)
    act(() => { root.unmount() })
    container.remove()
  })

  it('a binary untracked read degrades to the empty-diff notice', async () => {
    vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: '' })
    vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'binary', bytes: [] as unknown as number[] } as unknown as Awaited<ReturnType<typeof api.fsRead>>)
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'blob.bin', staged: false, untracked: true }
    const { container, root } = mount('s1', undefined, ref)
    await flushed()
    expect(api.fsRead).toHaveBeenCalledWith({ sessionId: 's1', cwd: undefined }, 'blob.bin')
    expect(container.textContent).toContain('No text changes')
    act(() => { root.unmount() })
    container.remove()
  })

  it('a genuinely empty diff shows the empty notice', async () => {
    vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: '' })
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: true }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(container.textContent).toContain('No text changes')
    act(() => { root.unmount() })
    container.remove()
  })

  it('a failed load renders the error text (Error and raw string forms)', async () => {
    vi.spyOn(api, 'gitDiff').mockRejectedValue(new Error('route down'))
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: false }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(container.textContent).toContain('Failed to load diff')
    expect(container.textContent).toContain('route down')
    act(() => { root.unmount() })
    container.remove()

    vi.spyOn(api, 'gitDiff').mockRejectedValue('raw refusal')
    const second = mount('s1', '/ws', { kind: 'worktree', path: 'b.ts', staged: false })
    await flushed()
    expect(second.container.textContent).toContain('raw refusal')
    act(() => { second.root.unmount() })
    second.container.remove()
  })

  it('the refresh button re-runs the load', async () => {
    const gitDiff = vi.spyOn(api, 'gitDiff').mockResolvedValue({ diff: DIFF })
    const ref: SidebarDiffRef = { kind: 'worktree', path: 'a.ts', staged: false }
    const { container, root } = mount('s1', '/ws', ref)
    await flushed()
    expect(gitDiff).toHaveBeenCalledTimes(1)
    const refresh = container.querySelector<HTMLButtonElement>('button[title="Refresh"]')!
    act(() => { refresh.click() })
    await flushed()
    expect(gitDiff).toHaveBeenCalledTimes(2)
    act(() => { root.unmount() })
    container.remove()
  })
})
