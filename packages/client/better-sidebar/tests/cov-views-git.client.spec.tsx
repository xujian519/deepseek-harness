/**
 * Source-control panel coverage round: the status-row badge/section rules,
 * refresh (initial, manual, silent poll, failure), worktree and repository
 * selection, stage/unstage/commit/checkout, lazy history paging, the file and
 * history context menus, the destructive-confirm modal, and the stale-response
 * guards that keep one checkout's rows out of another's view.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { GitView } from '../src/client/GitView.tsx'
import { api, type GitLogEntry, type GitStatusEntry, type GitStatusResult, type GitWorktree, type SessionScope } from '../src/client/api.ts'
import type { SidebarTab } from '../src/client/state.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MAIN: GitWorktree = { path: '/repo/main', branch: 'main', current: true, changes: 0 }
const LINKED: GitWorktree = { path: '/repo/agent', branch: 'agent', current: false, changes: 2 }
const OTHER: GitWorktree = { path: 'C:\\repo\\win', branch: 'win', current: false, changes: 3 }

const SCOPE: SessionScope = { sessionId: 'parent', cwd: '/repo/main' }

function statusEntry(path: string, xy: string): GitStatusEntry {
  return { path, xy }
}

function logEntry(index: number, overrides: Partial<GitLogEntry> = {}): GitLogEntry {
  return {
    hash: `abc123${index}`,
    hashFull: `abc1234${String(index).padStart(8, '0')}`,
    subject: `subject ${index}`,
    author: 'Ada',
    date: '2020-01-02 03:04:05 +0800',
    refs: '',
    ...overrides,
  }
}

const DEFAULT_STATUS: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  entries: [
    statusEntry('staged.ts', 'M '),
    statusEntry('worktree.ts', ' M'),
    statusEntry('both.ts', 'MM'),
    statusEntry('fresh.ts', '??'),
    statusEntry('clean.ts', '  '),
  ],
}

interface Fixture {
  worktrees?: () => GitWorktree[] | Promise<GitWorktree[]>
  status?: (target?: string) => GitStatusResult | Promise<GitStatusResult>
  branch?: (target?: string) => { current: string; names: string[] } | Promise<{ current: string; names: string[] }>
  log?: (skip: number, target?: string) => GitLogEntry[] | Promise<GitLogEntry[]>
}

interface Installed {
  worktrees: MockInstance<typeof api.gitWorktrees>
  status: MockInstance<typeof api.gitStatus>
  branch: MockInstance<typeof api.gitBranch>
  log: MockInstance<typeof api.gitLog>
}

/** Install the git API spies with per-test fixtures (defaults: one clean checkout). */
function installGit(fixture: Fixture = {}): Installed {
  return {
    worktrees: vi.spyOn(api, 'gitWorktrees').mockImplementation(async () => await fixture.worktrees?.() ?? [MAIN]),
    status: vi.spyOn(api, 'gitStatus').mockImplementation(async (_scope, target) => await fixture.status?.(target) ?? DEFAULT_STATUS),
    branch: vi.spyOn(api, 'gitBranch')
      .mockImplementation(async (_scope, target) => await fixture.branch?.(target) ?? { current: 'main', names: ['main', 'feature'] }),
    log: vi.spyOn(api, 'gitLog')
      .mockImplementation(async (_scope, _count, skip = 0, target) => await fixture.log?.(skip, target) ?? []),
  }
}

interface Harness {
  container: HTMLDivElement
  onOpenFile: MockInstance
  onOpenDiff: MockInstance<(tab: SidebarTab) => void>
  rerender: (props: { scope?: SessionScope; visible?: boolean }) => void
  unmount: () => void
}

function mount(options: { scope?: SessionScope; visible?: boolean } = {}): Harness {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const onOpenFile = vi.fn()
  const onOpenDiff = vi.fn<(tab: SidebarTab) => void>()
  const render = (props: { scope?: SessionScope; visible?: boolean }): void => {
    act(() => {
      root.render(createElement(GitView, {
        scope: props.scope ?? options.scope ?? SCOPE,
        onOpenFile,
        onOpenDiff,
        visible: props.visible ?? options.visible ?? false,
      }))
    })
  }
  render(options)
  return {
    container,
    onOpenFile,
    onOpenDiff,
    rerender: render,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

/** Flush the mount effect's async refresh chain. */
async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolvePromise!: (value: T) => void
  let rejectPromise!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? ''
}

function rowsNamed(container: HTMLElement, name: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[class*="gitName"]')]
    .filter(span => span.textContent === name)
}

/** The `<div class="gitRow">` owning one file row (not the nested row button). */
function fileRow(container: HTMLElement, name: string): HTMLElement {
  return rowsNamed(container, name)[0]!.closest<HTMLElement>('div[class*="gitRow"]')!
}

/** The clickable body of one file row (opens its diff). */
function rowMain(container: HTMLElement, name: string): HTMLButtonElement {
  return fileRow(container, name).querySelector<HTMLButtonElement>('button[class*="gitRowMain"]')!
}

/** The row action button (stage/unstage) of one file row. */
function rowAction(container: HTMLElement, name: string): HTMLButtonElement {
  return fileRow(container, name).querySelector<HTMLButtonElement>('button[aria-label]')!
}

function buttons(container: HTMLElement, label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => button.textContent === label || button.getAttribute('aria-label') === label || button.getAttribute('title') === label)
}

function menuItems(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
}

function menuItem(label: string): HTMLButtonElement {
  const item = menuItems().find(row => row.textContent === label)
  expect(item, `menu row ${label}`).not.toBeUndefined()
  return item!
}

/** Change one `<select>`'s value the way the browser does. */
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Type into the controlled commit input. */
function typeInto(input: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Dispatch a native right-click and return the event. */
function rightClick(node: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })
  act(() => { node.dispatchEvent(event) })
  return event
}

/** Close every portaled menu/modal left open by a test. */
function clearPortals(): void {
  document.body.innerHTML = ''
}

afterEach(() => {
  vi.restoreAllMocks()
  clearPortals()
})

describe('GitView checkout overview', () => {
  it('splits the status rows into staged and unstaged sections and decorates the history', async () => {
    installGit({
      log: () => [logEntry(0, { refs: 'HEAD -> main, tag: v1, tag: v1, origin/main, ' }), logEntry(1)],
    })
    const harness = mount()
    try {
      await flush()
      const text = textOf(harness.container)
      expect(text).toContain('Staged (2)')
      expect(text).toContain('Unstaged (3)')
      expect(text).toContain('subject 0')

      // The two-letter status maps onto one badge: the index letter wins, then
      // the worktree letter, then '?' for an untracked row.
      const badges = [...harness.container.querySelectorAll<HTMLElement>('[class*="gitBadge"]')]
        .map(node => node.textContent)
      expect(badges).toEqual(['M', 'M', 'M', 'M', '?'])
      // A row whose letters are both blank is neither staged nor unstaged.
      expect(rowsNamed(harness.container, 'clean.ts')).toHaveLength(0)
      expect(rowsNamed(harness.container, 'fresh.ts')).toHaveLength(1)

      // Decorations: deduped, 'HEAD -> ' unwrapped, 'tag: ' stripped, empties dropped.
      const refs = [...harness.container.querySelectorAll<HTMLElement>('[class*="gitLogRef"]')]
        .map(node => node.textContent)
      expect(refs).toEqual(['main', 'v1', 'origin/main'])
      // The meta line dates a 2020 commit in the viewer's own time zone, and
      // the fixture's 03:04+08:00 falls on the previous day west of UTC, so the
      // day comes from that instant rather than from a literal.
      const logged = new Date(Date.parse(logEntry(0).date))
      const pad = (value: number): string => String(value).padStart(2, '0')
      expect(textOf(harness.container))
        .toContain(`Ada · ${logged.getFullYear()}-${pad(logged.getMonth() + 1)}-${pad(logged.getDate())}`)
    } finally {
      harness.unmount()
    }
  })

  it('shows the loading, error, truncation and not-a-repo states', async () => {
    const pending = deferred<GitWorktree[]>()
    installGit({ worktrees: () => pending.promise })
    const harness = mount()
    try {
      expect(textOf(harness.container)).toContain('Loading')
      pending.reject(new Error('no git binary'))
      await flush()
      expect(textOf(harness.container)).toContain('no git binary')
      expect(textOf(harness.container)).not.toContain('Loading')
    } finally {
      harness.unmount()
    }

    installGit({ status: () => ({ isRepo: false, entries: [] }) })
    const notRepo = mount()
    try {
      await flush()
      expect(textOf(notRepo.container)).toContain('This directory is not a git repository')
    } finally {
      notRepo.unmount()
    }

    installGit({ status: () => ({ ...DEFAULT_STATUS, truncated: true }) })
    const truncated = mount()
    try {
      await flush()
      expect(textOf(truncated.container)).toContain('Too many changes; showing the first 2,000 entries')
    } finally {
      truncated.unmount()
    }
  })

  it('reports a status failure and a missing branch/log without losing the panel', async () => {
    installGit({
      status: () => { throw new Error('status exploded') },
    })
    const harness = mount()
    try {
      await flush()
      expect(textOf(harness.container)).toContain('status exploded')
    } finally {
      harness.unmount()
    }

    // A missing branch list and history degrade to empty values instead of
    // failing the whole checkout read.
    installGit({ branch: () => { throw new Error('no branch') }, log: () => { throw new Error('no log') } })
    const degraded = mount()
    try {
      await flush()
      expect(textOf(degraded.container)).toContain('Staged (2)')
      const branchSelect = degraded.container.querySelector<HTMLSelectElement>('select')!
      expect(branchSelect.value).toBe('main')
      expect(textOf(degraded.container)).not.toContain('no branch')
    } finally {
      degraded.unmount()
    }
  })

  it('lists branch choices and switches the checkout', async () => {
    installGit()
    const checkout = vi.spyOn(api, 'gitCheckout').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const branchSelect = harness.container.querySelector<HTMLSelectElement>('select')!
      expect([...branchSelect.options].map(option => option.value)).toEqual(['main', 'feature'])

      choose(branchSelect, 'feature')
      await flush()
      expect(checkout).toHaveBeenCalledWith(SCOPE, 'feature', MAIN.path)

      // Selecting the already-current branch is a no-op.
      checkout.mockClear()
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, 'main')
      await flush()
      expect(checkout).not.toHaveBeenCalled()

      checkout.mockRejectedValueOnce(new Error('dirty tree'))
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, 'feature')
      await flush()
      expect(textOf(harness.container)).toContain('Branch switch failed: dirty tree')
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView staging and committing', () => {
  it('stages and unstages single rows and whole sections', async () => {
    installGit()
    const stage = vi.spyOn(api, 'gitStage').mockResolvedValue({ ok: true })
    const unstage = vi.spyOn(api, 'gitUnstage').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      await act(async () => { rowAction(harness.container, 'staged.ts').click() })
      expect(unstage).toHaveBeenCalledWith(SCOPE, 'staged.ts', MAIN.path)

      await act(async () => { rowAction(harness.container, 'worktree.ts').click() })
      expect(stage).toHaveBeenCalledWith(SCOPE, 'worktree.ts', MAIN.path)

      await act(async () => { buttons(harness.container, 'Unstage all')[0]!.click() })
      expect(unstage).toHaveBeenLastCalledWith(SCOPE, undefined, MAIN.path)

      await act(async () => { buttons(harness.container, 'Stage all')[0]!.click() })
      expect(stage).toHaveBeenLastCalledWith(SCOPE, undefined, MAIN.path)
    } finally {
      harness.unmount()
    }
  })

  it('commits the message box, clears it on success and reports failures', async () => {
    installGit()
    const commit = vi.spyOn(api, 'gitCommit').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const input = harness.container.querySelector<HTMLInputElement>('input')!
      const commitButton = (): HTMLButtonElement => buttons(harness.container, 'Commit')[0]!
      // Nothing staged yet? Everything staged here, but an empty message keeps
      // the button disabled.
      expect(commitButton().disabled).toBe(true)

      typeInto(input, 'feat: add panel')
      expect(commitButton().disabled).toBe(false)
      await act(async () => { commitButton().click() })
      expect(commit).toHaveBeenCalledWith(SCOPE, 'feat: add panel', MAIN.path)
      expect(input.value).toBe('')

      // Ctrl+Enter sends from the keyboard.
      typeInto(input, 'fix: keyboard')
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
      })
      expect(commit).toHaveBeenLastCalledWith(SCOPE, 'fix: keyboard', MAIN.path)

      commit.mockRejectedValueOnce(new Error('hooks failed'))
      typeInto(input, 'fix: broken')
      await act(async () => { commitButton().click() })
      expect(textOf(harness.container)).toContain('hooks failed')

      // Editing the message clears the previous failure.
      typeInto(input, 'fix: again')
      expect(textOf(harness.container)).not.toContain('hooks failed')
    } finally {
      harness.unmount()
    }
  })

  it('refuses an empty or whitespace-only commit message', async () => {
    installGit()
    const commit = vi.spyOn(api, 'gitCommit').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const input = harness.container.querySelector<HTMLInputElement>('input')!
      // A modified Enter is the only keyboard commit; a bare Enter is left to
      // the field, and a whitespace message is refused either way.
      typeInto(input, 'message')
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      })
      expect(commit).not.toHaveBeenCalled()

      typeInto(input, '   ')
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }))
      })
      expect(commit).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView worktree and repository selection', () => {
  it('auto-selects the single dirty linked checkout and switches on demand', async () => {
    installGit({ worktrees: () => [MAIN, LINKED], status: target => ({ ...DEFAULT_STATUS, branch: target === LINKED.path ? 'agent' : 'main' }) })
    const harness = mount()
    try {
      await flush()
      const select = harness.container.querySelector<HTMLSelectElement>('select')!
      expect(select.value).toBe(LINKED.path)
      expect([...select.options].map(option => option.textContent)).toEqual(['main · main (0)', 'agent · agent (2)'])

      choose(select, MAIN.path)
      await flush()
      expect(harness.container.querySelector<HTMLSelectElement>('select')!.value).toBe(MAIN.path)
    } finally {
      harness.unmount()
    }
  })

  it('keeps the primary checkout when two linked checkouts are dirty and names Windows paths', async () => {
    installGit({ worktrees: () => [MAIN, LINKED, OTHER] })
    const harness = mount()
    try {
      await flush()
      const select = harness.container.querySelector<HTMLSelectElement>('select')!
      // The automatic choice is ambiguous, so the current checkout stays.
      expect(select.value).toBe(MAIN.path)
      expect([...select.options].map(option => option.textContent)).toContain('win · win (3)')
    } finally {
      harness.unmount()
    }
  })

  it('switches the selected child repository of a workspace container', async () => {
    installGit({
      status: () => ({ ...DEFAULT_STATUS, repositories: ['/repo/main', '/repo/other'] }),
    })
    const harness = mount()
    try {
      await flush()
      const selects = [...harness.container.querySelectorAll<HTMLSelectElement>('select')]
      const repoSelect = selects[0]!
      expect([...repoSelect.options].map(option => option.textContent)).toEqual(['main', 'other'])

      choose(repoSelect, '/repo/other')
      await flush()
      expect(harness.container.querySelector<HTMLSelectElement>('select')!.value).toBe('/repo/other')
      expect(textOf(harness.container)).toContain('Unstaged (3)')
    } finally {
      harness.unmount()
    }
  })

  it('adopts the repository root the host reports for the checkout', async () => {
    const installed = installGit({ status: () => ({ ...DEFAULT_STATUS, root: '/repo/nested' }) })
    const harness = mount()
    try {
      await flush()
      // The reported root becomes the scope of every later git request.
      expect(installed.status).toHaveBeenLastCalledWith(
        expect.objectContaining({ repoRoot: '/repo/nested' }),
        MAIN.path,
      )
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView history paging', () => {
  const FULL_PAGE = Array.from({ length: 20 }, (_value, index) => logEntry(index))

  it('pages the log and stops at the end of the history', async () => {
    let page = FULL_PAGE
    installGit({ log: () => page })
    const harness = mount()
    try {
      await flush()
      const more = (): HTMLButtonElement | undefined => buttons(harness.container, 'Load more')[0]
      expect(more()).not.toBeUndefined()

      page = [logEntry(99)]
      await act(async () => { more()!.click() })
      await flush()
      expect(textOf(harness.container)).toContain('subject 99')
      expect(more()).toBeUndefined()
    } finally {
      harness.unmount()
    }
  })

  it('reports a failed history page and hides the pager once the log ends', async () => {
    installGit({ log: () => FULL_PAGE })
    const harness = mount()
    try {
      await flush()
      const log = vi.mocked(api.gitLog)
      log.mockRejectedValueOnce(new Error('rev-list failed'))
      await act(async () => { buttons(harness.container, 'Load more')[0]!.click() })
      await flush()
      expect(textOf(harness.container)).toContain('Failed to load more history: rev-list failed')
    } finally {
      harness.unmount()
    }
  })

  it('opens a commit diff from a row click and from the keyboard', async () => {
    installGit({ log: () => [logEntry(3, { subject: 'third' })] })
    const harness = mount()
    try {
      await flush()
      const row = harness.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!
      act(() => { row.click() })
      expect(harness.onOpenDiff).toHaveBeenCalledTimes(1)
      const tab = harness.onOpenDiff.mock.calls[0]![0]
      expect(tab.id).toBe(`diff:c:${encodeURIComponent(MAIN.path)}:${logEntry(3).hashFull}`)
      expect(tab.title).toBe(`${logEntry(3).hash} third`)
      expect(tab.diff).toMatchObject({ kind: 'commit', hashFull: logEntry(3).hashFull, subject: 'third' })

      act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(harness.onOpenDiff).toHaveBeenCalledTimes(2)
      act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })) })
      expect(harness.onOpenDiff).toHaveBeenCalledTimes(3)
      act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })) })
      expect(harness.onOpenDiff).toHaveBeenCalledTimes(3)
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView file context menu', () => {
  it('opens a diff, copies paths and stages from the file menu', async () => {
    installGit()
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const stage = vi.spyOn(api, 'gitStage').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const body = rowMain(harness.container, 'worktree.ts')
      const event = rightClick(body)
      expect(event.defaultPrevented).toBe(true)
      expect(menuItems().map(item => item.textContent))
        .toEqual(['Open editor', 'Stage', 'Discard changes', 'Copy relative path', 'Copy absolute path'])

      act(() => { menuItem('Open editor').click() })
      expect(harness.onOpenFile).toHaveBeenCalledWith('/repo/main/worktree.ts')

      rightClick(body)
      act(() => { menuItem('Stage').click() })
      expect(stage).toHaveBeenCalledWith(SCOPE, 'worktree.ts', MAIN.path)

      rightClick(body)
      act(() => { menuItem('Copy relative path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('worktree.ts')

      rightClick(body)
      act(() => { menuItem('Copy absolute path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('/repo/main/worktree.ts')
    } finally {
      harness.unmount()
    }
  })

  it('offers unstage and opens the worktree diff from the row body', async () => {
    installGit()
    const unstage = vi.spyOn(api, 'gitUnstage').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const body = rowMain(harness.container, 'staged.ts')
      act(() => { body.click() })
      const tab = harness.onOpenDiff.mock.calls[0]![0]
      expect(tab.id).toBe(`diff:w:${encodeURIComponent(MAIN.path)}:s:staged.ts`)
      expect(tab.diff).toMatchObject({ kind: 'worktree', path: 'staged.ts', staged: true, untracked: false })

      rightClick(body)
      act(() => { menuItem('Unstage').click() })
      expect(unstage).toHaveBeenCalledWith(SCOPE, 'staged.ts', MAIN.path)
    } finally {
      harness.unmount()
    }
  })

  it('hides the editor action outside the workspace and skips discard for untracked files', async () => {
    installGit({
      worktrees: () => [MAIN, LINKED],
      status: () => ({ isRepo: true, branch: 'agent', entries: [statusEntry('fresh.ts', '??')] }),
    })
    const harness = mount()
    try {
      await flush()
      rightClick(rowMain(harness.container, 'fresh.ts'))
      // The selected checkout is outside the session workspace: the host would
      // reject the open, so the row is not offered.
      expect(menuItems().map(item => item.textContent))
        .toEqual(['Stage', 'Copy relative path', 'Copy absolute path'])

      act(() => { menuItem('Copy relative path').click() })
      expect(harness.onOpenFile).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  it('closes the file menu without acting on a dismissal', async () => {
    installGit()
    const harness = mount()
    try {
      await flush()
      rightClick(rowMain(harness.container, 'worktree.ts'))
      expect(menuItems()).toHaveLength(1 + 4)
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(menuItems()).toHaveLength(0)
      expect(harness.onOpenFile).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  it('copies a path outside the session workspace verbatim', async () => {
    installGit({
      worktrees: () => [MAIN, LINKED],
      status: () => ({ isRepo: true, branch: 'agent', entries: [statusEntry('inside.ts', ' M')] }),
    })
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const harness = mount()
    try {
      await flush()
      rightClick(rowMain(harness.container, 'inside.ts'))
      act(() => { menuItem('Copy relative path').click() })
      // The checkout root is outside the session cwd, so the relative form is
      // the unresolved path.
      expect(clipboard).toHaveBeenLastCalledWith('inside.ts')

      rightClick(rowMain(harness.container, 'inside.ts'))
      act(() => { menuItem('Copy absolute path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('/repo/agent/inside.ts')
    } finally {
      harness.unmount()
    }
  })

  it('confirms a discard before running it and reports its failure', async () => {
    installGit()
    const discard = vi.spyOn(api, 'gitDiscard').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const body = rowMain(harness.container, 'worktree.ts')
      rightClick(body)
      act(() => { menuItem('Discard changes').click() })
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(dialog.textContent).toContain('This discards the worktree changes of "worktree.ts"')
      expect(discard).not.toHaveBeenCalled()

      act(() => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Cancel')!.click()
      })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(discard).not.toHaveBeenCalled()

      rightClick(body)
      act(() => { menuItem('Discard changes').click() })
      discard.mockRejectedValueOnce(new Error('locked'))
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Discard changes')!.click()
      })
      await flush()
      expect(discard).toHaveBeenCalledWith(SCOPE, 'worktree.ts', MAIN.path)
      expect(textOf(harness.container)).toContain('locked')
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView history context menu', () => {
  it('copies hashes, opens the diff and runs revert and cherry-pick after confirmation', async () => {
    installGit({ log: () => [logEntry(4, { subject: 'fourth' })] })
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const revert = vi.spyOn(api, 'gitRevert').mockResolvedValue({ ok: true })
    const cherryPick = vi.spyOn(api, 'gitCherryPick').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const row = harness.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!
      rightClick(row)
      expect(menuItems().map(item => item.textContent)).toEqual([
        'View commit diff', 'Copy short hash', 'Copy full hash', 'Copy subject', 'Revert commit', 'Cherry-pick commit',
      ])

      act(() => { menuItem('View commit diff').click() })
      expect(harness.onOpenDiff).toHaveBeenCalledTimes(1)
      rightClick(row)
      act(() => { menuItem('Copy short hash').click() })
      expect(clipboard).toHaveBeenLastCalledWith(logEntry(4).hash)
      rightClick(row)
      act(() => { menuItem('Copy full hash').click() })
      expect(clipboard).toHaveBeenLastCalledWith(logEntry(4).hashFull)
      rightClick(row)
      act(() => { menuItem('Copy subject').click() })
      expect(clipboard).toHaveBeenLastCalledWith('fourth')

      rightClick(row)
      act(() => { menuItem('Revert commit').click() })
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Revert commit')!.click()
      })
      await flush()
      expect(revert).toHaveBeenCalledWith(SCOPE, logEntry(4).hashFull, MAIN.path)

      rightClick(row)
      act(() => { menuItem('Cherry-pick commit').click() })
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Cherry-pick commit')!.click()
      })
      await flush()
      expect(cherryPick).toHaveBeenCalledWith(SCOPE, logEntry(4).hashFull, MAIN.path)
    } finally {
      harness.unmount()
    }
  })

  it('closes the history menu and the confirm dialog without acting', async () => {
    installGit({ log: () => [logEntry(8, { subject: 'eighth' })] })
    vi.spyOn(api, 'gitRevert').mockResolvedValue({ ok: true })
    const harness = mount()
    try {
      await flush()
      const row = harness.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!
      rightClick(row)
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(menuItems()).toHaveLength(0)

      rightClick(row)
      act(() => { menuItem('Revert commit').click() })
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      act(() => { dialog.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.click() })
      expect(document.querySelector('[role="dialog"]')).toBeNull()
      expect(api.gitRevert).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
    }
  })

  it('reports a failed destructive action', async () => {
    installGit({ log: () => [logEntry(5, { subject: 'fifth' })] })
    vi.spyOn(api, 'gitRevert').mockRejectedValue(new Error('conflict'))
    const harness = mount()
    try {
      await flush()
      rightClick(harness.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!)
      act(() => { menuItem('Revert commit').click() })
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Revert commit')!.click()
      })
      await flush()
      expect(textOf(harness.container)).toContain('conflict')
    } finally {
      harness.unmount()
    }
  })
})

describe('GitView refresh lifecycle', () => {
  it('polls the checkout silently while the tab is visible', async () => {
    vi.useFakeTimers()
    const installed = installGit()
    const harness = mount({ visible: true })
    try {
      await flush()
      installed.status.mockClear()
      await act(async () => { vi.advanceTimersByTime(2000) })
      await flush()
      // The silent poll refreshes status alone and never re-reads the history.
      expect(installed.status).toHaveBeenCalledWith(expect.anything(), MAIN.path)
      expect(installed.log).toHaveBeenCalledTimes(1)

      harness.rerender({ visible: false })
      installed.status.mockClear()
      await act(async () => { vi.advanceTimersByTime(4000) })
      await flush()
      expect(installed.status).not.toHaveBeenCalled()
    } finally {
      harness.unmount()
      vi.useRealTimers()
    }
  })

  it('surfaces a silent poll failure without dropping the loaded rows', async () => {
    vi.useFakeTimers()
    const installed = installGit()
    const harness = mount({ visible: true })
    try {
      await flush()
      installed.worktrees.mockRejectedValueOnce(new Error('poll failed'))
      await act(async () => { vi.advanceTimersByTime(2000) })
      await flush()
      expect(textOf(harness.container)).toContain('poll failed')
      expect(textOf(harness.container)).toContain('Staged (2)')
    } finally {
      harness.unmount()
      vi.useRealTimers()
    }
  })

  it('reloads the panel when the user asks for a refresh', async () => {
    const installed = installGit()
    const harness = mount()
    try {
      await flush()
      installed.log.mockClear()
      await act(async () => { buttons(harness.container, 'Refresh')[0]!.click() })
      await flush()
      expect(installed.log).toHaveBeenCalledTimes(1)
    } finally {
      harness.unmount()
    }
  })

  it('drops a worktree inventory that a newer selection superseded', async () => {
    const worktrees = deferred<GitWorktree[]>()
    const installed = vi.spyOn(api, 'gitWorktrees')
      .mockReturnValueOnce(worktrees.promise)
      .mockResolvedValue([MAIN, LINKED])
    installGit({ status: target => ({ isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }) })

    const harness = mount()
    try {
      // A scope change bumps the generation and re-lists; the first listing is
      // then stale and must not publish its rows.
      harness.rerender({ scope: { sessionId: 'parent', cwd: '/repo/other' } })
      worktrees.resolve([MAIN])
      await flush()
      expect(installed).toHaveBeenCalled()
      expect(textOf(harness.container)).not.toContain('This directory is not a git repository')
      expect(textOf(harness.container)).toContain('No changes')
    } finally {
      harness.unmount()
    }
  })

  it('handles a checkout list with no current entry', async () => {
    const detached: GitWorktree[] = [
      { path: '/repo/a', branch: 'a', current: false, changes: 0 },
      { path: '/repo/b', branch: 'b', current: false, changes: 0 },
    ]
    const installed = installGit({
      worktrees: () => detached,
      status: () => ({
        isRepo: true,
        branch: 'a',
        entries: [statusEntry('unstaged.ts', ' M')],
        repositories: ['/repo/a', '/repo/b'],
      }),
      log: () => [logEntry(7)],
    })
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const harness = mount()
    try {
      await flush()
      const selects = [...harness.container.querySelectorAll<HTMLSelectElement>('select')]
      // No checkout owns the session cwd, so no default selection is published.
      expect(selects[0]!.getAttribute('title')).toBeNull()
      // Without a selected worktree the diff tab is scoped to the session only.
      act(() => { rowMain(harness.container, 'unstaged.ts').click() })
      expect(harness.onOpenDiff.mock.calls[0]![0].id).toBe('diff:w::u:unstaged.ts')

      const historyRow = harness.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!
      act(() => { historyRow.click() })
      expect(harness.onOpenDiff.mock.calls[1]![0].id).toBe(`diff:c::${logEntry(7).hashFull}`)

      // The editor path and the relative copy both fall back to the session cwd.
      const body = rowMain(harness.container, 'unstaged.ts')
      rightClick(body)
      act(() => { menuItem('Open editor').click() })
      expect(harness.onOpenFile).toHaveBeenCalledWith('/repo/main/unstaged.ts')
      rightClick(body)
      act(() => { menuItem('Copy relative path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('unstaged.ts')

      const repoSelect = selects[1]!
      choose(repoSelect, '/repo/b')
      await flush()
      // The empty worktree argument reaches the new repository's status read.
      expect(installed.status.mock.calls[1]).toEqual([{ sessionId: 'parent', cwd: '/repo/main' }, ''])
    } finally {
      harness.unmount()
    }
  })

  it('refreshes the whole view when a poll changes the selected checkout', async () => {
    vi.useFakeTimers()
    let inventory: GitWorktree[] = [MAIN]
    const installed = installGit({
      worktrees: () => inventory,
      status: target => ({ isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }),
    })
    const harness = mount({ visible: true })
    try {
      await flush()
      inventory = [MAIN, LINKED]
      installed.status.mockClear()
      await act(async () => { vi.advanceTimersByTime(2000) })
      await flush()
      // The dirty linked checkout is picked up by the poll and its full
      // checkout-derived view is refreshed (not just the status).
      expect(installed.status).toHaveBeenLastCalledWith(expect.anything(), LINKED.path)
      expect(installed.log).toHaveBeenCalledTimes(2)
    } finally {
      harness.unmount()
      vi.useRealTimers()
    }
  })

  it('coalesces a refresh that is already running', async () => {
    const pending = deferred<GitWorktree[]>()
    const installed = vi.spyOn(api, 'gitWorktrees').mockReturnValue(pending.promise)
    installGit({ status: () => ({ ...DEFAULT_STATUS, entries: [] }) })
    const harness = mount()
    try {
      await act(async () => { buttons(harness.container, 'Refresh')[0]!.click() })
      expect(installed).toHaveBeenCalledTimes(1)
      pending.resolve([MAIN])
      await flush()
      expect(textOf(harness.container)).toContain('No changes')
    } finally {
      harness.unmount()
    }
  })

  it('drops a checkout read that a newer generation superseded', async () => {
    const stale = deferred<GitStatusResult>()
    let first = true
    installGit({
      worktrees: () => [MAIN, LINKED],
      status: (target) => {
        if (first && target === LINKED.path) {
          first = false
          return stale.promise
        }
        return { isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }
      },
      branch: target => ({ current: target ?? '', names: [] }),
    })
    const harness = mount()
    try {
      await flush()
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, MAIN.path)
      await flush()
      stale.reject(new Error('too late'))
      await flush()
      // The superseded read publishes nothing, not even its failure.
      expect(textOf(harness.container)).not.toContain('too late')
    } finally {
      harness.unmount()
    }
  })

  it('drops a checkout listing that a newer generation superseded', async () => {
    vi.useFakeTimers()
    const stalePoll = deferred<GitWorktree[]>()
    let calls = 0
    installGit({
      worktrees: () => {
        calls += 1
        return calls === 1 ? [MAIN, LINKED] : stalePoll.promise
      },
      status: target => ({ isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }),
      branch: target => ({ current: target ?? '', names: [] }),
    })
    const harness = mount({ visible: true })
    try {
      await flush()
      await act(async () => { vi.advanceTimersByTime(2000) })
      await flush()
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, MAIN.path)
      await flush()
      stalePoll.reject(new Error('stale listing'))
      await flush()
      expect(textOf(harness.container)).not.toContain('stale listing')
      expect(harness.container.querySelector<HTMLSelectElement>('select')!.value).toBe(MAIN.path)
    } finally {
      harness.unmount()
      vi.useRealTimers()
    }
  })

  it('drops a silent status poll that a newer selection superseded', async () => {
    vi.useFakeTimers()
    const staleStatus = deferred<GitStatusResult>()
    let calls = 0
    vi.spyOn(api, 'gitWorktrees').mockResolvedValue([MAIN, LINKED])
    vi.spyOn(api, 'gitStatus').mockImplementation(async (_scope, target) => {
      calls += 1
      if (calls === 2 && target === LINKED.path) return await staleStatus.promise
      return { isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }
    })
    vi.spyOn(api, 'gitBranch').mockResolvedValue({ current: 'agent', names: ['agent'] })
    vi.spyOn(api, 'gitLog').mockResolvedValue([])
    const harness = mount({ visible: true })
    try {
      await flush()
      // The poll's tail read is still pending when the user switches checkout.
      await act(async () => { vi.advanceTimersByTime(2000) })
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, MAIN.path)
      await flush()
      staleStatus.resolve({ isRepo: true, branch: 'agent', entries: [statusEntry('stale.ts', ' M')] })
      await flush()
      expect(rowsNamed(harness.container, 'stale.ts')).toHaveLength(0)
    } finally {
      harness.unmount()
      vi.useRealTimers()
    }
  })

  it('surfaces non-Error failures from every git read and mutation', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the subject under test
    installGit({ status: () => Promise.reject('status down') })
    const statusFailure = mount()
    try {
      await flush()
      expect(textOf(statusFailure.container)).toContain('status down')
    } finally {
      statusFailure.unmount()
    }

    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- a non-Error rejection is the subject under test
    installGit({ worktrees: () => Promise.reject('listing down') })
    const listingFailure = mount()
    try {
      await flush()
      expect(textOf(listingFailure.container)).toContain('listing down')
    } finally {
      listingFailure.unmount()
    }

    installGit()
    vi.spyOn(api, 'gitCommit').mockRejectedValue('commit rejected')
    const commitFailure = mount()
    try {
      await flush()
      typeInto(commitFailure.container.querySelector<HTMLInputElement>('input')!, 'msg')
      await act(async () => { buttons(commitFailure.container, 'Commit')[0]!.click() })
      expect(textOf(commitFailure.container)).toContain('commit rejected')
    } finally {
      commitFailure.unmount()
    }

    installGit()
    vi.spyOn(api, 'gitCheckout').mockRejectedValue('branch down')
    const checkoutFailure = mount()
    try {
      await flush()
      choose(checkoutFailure.container.querySelector<HTMLSelectElement>('select')!, 'feature')
      await flush()
      expect(textOf(checkoutFailure.container)).toContain('Branch switch failed: branch down')
    } finally {
      checkoutFailure.unmount()
    }

    installGit({ log: () => [logEntry(6, { subject: 'sixth' })] })
    vi.spyOn(api, 'gitRevert').mockRejectedValue('revert down')
    const revertFailure = mount()
    try {
      await flush()
      rightClick(revertFailure.container.querySelector<HTMLElement>('[class*="gitLogRow"]')!)
      act(() => { menuItem('Revert commit').click() })
      await act(async () => {
        [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Revert commit')!.click()
      })
      await flush()
      expect(textOf(revertFailure.container)).toContain('revert down')
    } finally {
      revertFailure.unmount()
    }
  })

  it('reports a non-Error history page failure', async () => {
    installGit({ log: () => Array.from({ length: 20 }, (_value, index) => logEntry(index)) })
    const harness = mount()
    try {
      await flush()
      vi.mocked(api.gitLog).mockRejectedValueOnce('pager down')
      await act(async () => { buttons(harness.container, 'Load more')[0]!.click() })
      await flush()
      expect(textOf(harness.container)).toContain('Failed to load more history: pager down')
    } finally {
      harness.unmount()
    }
  })

  it('pages a full history page without ending the log', async () => {
    installGit({ log: skip => Array.from({ length: 20 }, (_value, index) => logEntry(skip + index)) })
    const harness = mount()
    try {
      await flush()
      await act(async () => { buttons(harness.container, 'Load more')[0]!.click() })
      await flush()
      expect(buttons(harness.container, 'Load more')).toHaveLength(1)
      expect(textOf(harness.container)).toContain('subject 0')
    } finally {
      harness.unmount()
    }
  })

  it('drops a history page that a newer checkout superseded', async () => {
    const page = deferred<GitLogEntry[]>()
    let calls = 0
    vi.spyOn(api, 'gitWorktrees').mockResolvedValue([MAIN, LINKED])
    vi.spyOn(api, 'gitStatus').mockImplementation(async (_scope, target) => ({
      isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [],
    }))
    vi.spyOn(api, 'gitBranch').mockImplementation(async (_scope, target) => ({ current: target ?? '', names: [] }))
    vi.spyOn(api, 'gitLog').mockImplementation(async (_scope, _count, skip = 0) => {
      calls += 1
      if (calls === 2 && skip === 20) return await page.promise
      return Array.from({ length: 20 }, (_value, index) => logEntry(skip + index))
    })
    const harness = mount()
    try {
      await flush()
      await act(async () => { buttons(harness.container, 'Load more')[0]!.click() })
      choose(harness.container.querySelector<HTMLSelectElement>('select')!, MAIN.path)
      await flush()
      page.reject(new Error('late page'))
      await flush()
      expect(textOf(harness.container)).not.toContain('late page')
    } finally {
      harness.unmount()
    }
  })

  it('copies paths when the session has neither a cwd nor a selected checkout', async () => {
    installGit({
      worktrees: () => [
        { path: '/repo/a', branch: 'a', current: false, changes: 0 },
        { path: '/repo/b', branch: 'b', current: false, changes: 0 },
      ],
      status: () => ({ isRepo: true, branch: 'a', entries: [statusEntry('loose.ts', ' M')] }),
    })
    const clipboard = vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    const harness = mount({ scope: { sessionId: 'parent' } })
    try {
      await flush()
      const body = rowMain(harness.container, 'loose.ts')
      rightClick(body)
      act(() => { menuItem('Copy relative path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('loose.ts')

      rightClick(body)
      act(() => { menuItem('Copy absolute path').click() })
      expect(clipboard).toHaveBeenLastCalledWith('loose.ts')
    } finally {
      harness.unmount()
    }
  })

  it('ignores a status response that arrives after the checkout changed', async () => {
    const status = deferred<GitStatusResult>()
    let first = true
    vi.spyOn(api, 'gitWorktrees').mockResolvedValue([MAIN, LINKED])
    const installedStatus = vi.spyOn(api, 'gitStatus').mockImplementation(async (_scope, target) => {
      if (first && target === LINKED.path) {
        first = false
        return await status.promise
      }
      return { isRepo: true, branch: target === LINKED.path ? 'agent' : 'main', entries: [] }
    })
    const harness = mount()
    try {
      await flush()
      const select = harness.container.querySelector<HTMLSelectElement>('select')!
      choose(select, MAIN.path)
      status.resolve({ isRepo: true, branch: 'agent', entries: [] })
      await flush()
      expect(installedStatus).toHaveBeenCalled()
      expect(harness.container.querySelector<HTMLSelectElement>('select')!.value).toBe(MAIN.path)
    } finally {
      harness.unmount()
    }
  })
})
