/**
 * FileTree coverage round: level loading (error / pending / cache / refresh
 * tick), row affordances (reveal highlight, reference button, copied label),
 * the row context menu (open escapes, download, upload here, copy paths),
 * keyboard activation, and the drop-zone geometry variants (chat hint side
 * panel, unmeasurable body rect).
 */
// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { FileTree } from '../src/client/FileTree.tsx'
import type { FsEntry } from '../src/client/api.ts'
import type { OpenWithTarget } from '../src/client/open-with.ts'
import type { UploadItem } from '../src/client/upload.ts'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// Controllable fs.tree (per-test behavior) + a stable download URL.
const fsTree = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.ts', () => ({
  api: { fsTree: (...args: unknown[]) => fsTree(...args) },
  downloadUrl: () => '/sidebar/file?download=1',
}))

beforeAll(() => {
  Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
})

const ROOT = '/tmp'
const entries: FsEntry[] = [
  { name: 'src', path: '/tmp/src', isDir: true, hidden: false, isSymlink: false, broken: false },
  { name: '.env', path: '/tmp/.env', isDir: false, hidden: true, isSymlink: false, broken: false },
  { name: 'a.ts', path: '/tmp/a.ts', isDir: false, hidden: false, isSymlink: false, broken: false },
]
const subEntries: FsEntry[] = [
  { name: 'link', path: '/tmp/src/link', isDir: false, hidden: false, isSymlink: true, broken: true },
]

interface Harness {
  container: HTMLDivElement
  uploads: { dir: string; items: UploadItem[] }[]
  references: string[]
  opened: string[]
  toggles: string[]
  rerender: (overrides?: Partial<Record<string, unknown>>) => void
  unmount: () => void
}

async function mountTree(overrides: {
  /** `null` = explicitly no cwd (undefined falls back to the default root). */
  cwd?: string | null
  expanded?: string[]
  revealed?: string[]
  refreshTick?: number
  busy?: boolean
  openWithTargets?: OpenWithTarget[] | undefined
  openWithPinned?: string[]
  openWithSsh?: boolean
  /** Wire the targets WITHOUT the onOpenWith handler (section still hides). */
  openWithoutHandler?: boolean
  /** Wire the onOpenWith handler with an EMPTY target list (section hides). */
  openWithEmpty?: boolean
  /** Wire targets + handler but omit the pinned ids (menu falls back to []). */
  openWithNoPinned?: boolean
  noOpenEscapes?: boolean
} = {}): Promise<Harness> {
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  const uploads: { dir: string; items: UploadItem[] }[] = []
  const references: string[] = []
  const opened: string[] = []
  const toggles: string[] = []
  const state = {
    cwd: overrides.cwd === null ? undefined : (overrides.cwd ?? ROOT),
    expanded: overrides.expanded ?? [],
    revealed: overrides.revealed ?? [],
    refreshTick: overrides.refreshTick ?? 0,
    busy: overrides.busy ?? false,
  }
  const render = (): void => {
    root.render(createElement(FileTree, {
      sessionId: 's1',
      cwd: state.cwd,
      expanded: state.expanded,
      revealed: state.revealed,
      onToggle: (path: string) => { toggles.push(path) },
      onOpenFile: (path: string) => { opened.push(path) },
      ...(overrides.noOpenEscapes ? {} : { onOpenFileNewTab: () => {}, onOpenFileSide: () => {} }),
      ...(overrides.openWithoutHandler === true && overrides.openWithTargets !== undefined
        ? { openWithTargets: overrides.openWithTargets, openWithPinned: overrides.openWithPinned ?? [] }
        : {}),
      ...(overrides.openWithEmpty === true
        ? { openWithTargets: [], openWithPinned: [], onOpenWith: () => {}, onToggleOpenWithPin: () => {} }
        : {}),
      ...(overrides.openWithNoPinned === true
        ? { openWithTargets: overrides.openWithTargets, onOpenWith: () => {} }
        : {}),
      onReferenceFile: (path: string) => { references.push(path) },
      refreshTick: state.refreshTick,
      onUploadRequest: (dir: string, items: UploadItem[]) => { uploads.push({ dir, items }) },
      busy: state.busy,
    }))
  }
  await act(async () => { render() })
  return {
    container,
    uploads,
    references,
    opened,
    toggles,
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

/** A bubbling drag event carrying a stub dataTransfer (jsdom has no DragEvent). */
function dragEvent(type: string, dataTypes: string[] = ['Files'], withTransfer = true): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (withTransfer) {
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: dataTypes, items: [], files: [new File(['x'], 'dropped.txt')], dropEffect: '' },
    })
  }
  return event
}

function fire(target: Element, type: string, dataTypes?: string[], withTransfer = true): Event {
  const event = dragEvent(type, dataTypes, withTransfer)
  act(() => { target.dispatchEvent(event) })
  return event
}

/** The row whose name span matches (rows are role="button" divs). */
function rowByName(container: HTMLElement, name: string): HTMLElement {
  const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')]
    .find(el => el.querySelector('[class*="explorerName"]')?.textContent === name)
  if (row === undefined) throw new Error(`row not found: ${name}`)
  return row
}

/** The workspace root row (a plain div, no role attribute). */
function rootRow(container: HTMLElement): HTMLElement {
  const name = [...container.querySelectorAll<HTMLElement>('[class*="explorerName"]')]
    .find(el => el.textContent === 'tmp')
  if (name === undefined) throw new Error('root row not found')
  return name.parentElement ?? name
}

function openMenu(container: HTMLElement, name: string): void {
  const row = rowByName(container, name)
  act(() => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }))
  })
}

const menuItems = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]

const dropZone = (): HTMLElement | null => document.body.querySelector<HTMLElement>('[class*="uploadDropZone"]')

describe('FileTree levels', () => {
  let harness: Harness
  beforeEach(() => {
    fsTree.mockReset()
    fsTree.mockResolvedValue({ entries })
  })
  afterEach(() => {
    harness.unmount()
    document.body.innerHTML = ''
  })

  it('a freshly expanded level renders its transient loading row, then the level', async () => {
    fsTree.mockImplementation(async (_scope: unknown, path: string) =>
      path === ROOT ? { entries } : { entries: subEntries })
    harness = await mountTree()
    // The render pass that OPENS a directory runs before its level effect
    // stores the placeholder: the level body renders the transient loading
    // row, then the fetched entries replace it.
    harness.rerender({ expanded: ['/tmp/src'] })
    await act(async () => {})
    expect(rowByName(harness.container, 'link')).toBeDefined()
  })

  it('renders a failed level inline (Error message and raw string)', async () => {
    fsTree.mockRejectedValue(new Error('boom'))
    harness = await mountTree()
    await act(async () => {})
    expect(harness.container.textContent).toContain('boom')
    harness.unmount()
    document.body.innerHTML = ''
    fsTree.mockRejectedValue('raw-string')
    harness = await mountTree()
    await act(async () => {})
    expect(harness.container.textContent).toContain('raw-string')
  })

  it('hidden rows render dimmed; symlink and broken files carry their markers', async () => {
    fsTree.mockImplementation(async (_scope: unknown, path: string) =>
      path === ROOT ? { entries } : { entries: subEntries })
    harness = await mountTree({ expanded: ['/tmp/src'] })
    await act(async () => {})
    expect(rowByName(harness.container, '.env').className).toContain('explorerHidden')
    const link = rowByName(harness.container, 'link')
    expect(link.className).toContain('explorerBroken')
    expect(link.getAttribute('title')).toBe('/tmp/src/link — Broken symlink')
    expect(link.querySelector('[class*="explorerSymlink"]')).not.toBeNull()
  })

  it('an already-loaded level is not refetched; a refresh tick wipes the cache', async () => {
    harness = await mountTree()
    await act(async () => {})
    const callsAfterRoot = fsTree.mock.calls.length
    // Re-render with the SAME root: the cached level is not refetched.
    harness.rerender()
    expect(fsTree.mock.calls).toHaveLength(callsAfterRoot)
    // A refresh tick wipes the cache: the root reloads.
    harness.rerender({ refreshTick: 1 })
    expect(fsTree.mock.calls).toHaveLength(callsAfterRoot + 1)
  })

  it('an expanded directory loads its level once and renders nested rows', async () => {
    fsTree.mockImplementation(async (_scope: unknown, path: string) =>
      path === ROOT ? { entries } : { entries: subEntries })
    harness = await mountTree()
    await act(async () => {})
    harness.rerender({ expanded: ['/tmp/src'] })
    await act(async () => {})
    expect(rowByName(harness.container, 'link')).toBeDefined()
    const after = fsTree.mock.calls.length
    harness.rerender({ expanded: ['/tmp/src'] })
    await act(async () => {})
    expect(fsTree.mock.calls).toHaveLength(after)
  })

  it('without a cwd the tree shows the no-session placeholder', async () => {
    harness = await mountTree({ cwd: null })
    expect(harness.container.textContent).toContain('Select a conversation')
    expect(fsTree).not.toHaveBeenCalled()
  })

  it('a root without separators renders the whole path as the root label', async () => {
    harness = await mountTree({ cwd: 'workdir' })
    await act(async () => {})
    expect(harness.container.textContent).toContain('workdir')
  })
})

describe('FileTree rows: reveal + reference + copy', () => {
  let harness: Harness
  beforeEach(() => {
    fsTree.mockReset()
    fsTree.mockResolvedValue({ entries })
  })
  afterEach(() => {
    harness.unmount()
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('a revealed row scrolls into view and carries the reveal marker', async () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    harness = await mountTree({ revealed: ['/tmp/a.ts'] })
    try {
      const row = rowByName(harness.container, 'a.ts')
      expect(row.getAttribute('data-dsh-revealed')).toBe('true')
      expect(row.className).toContain('explorerRowRevealed')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })

  it('the @-reference button inserts the path and stops the row click', async () => {
    harness = await mountTree()
    const row = rowByName(harness.container, 'a.ts')
    const button = row.querySelector('button[class*="explorerRef"]') as HTMLButtonElement
    expect(button).not.toBeNull()
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => { button.dispatchEvent(click) })
    expect(harness.references).toEqual(['/tmp/a.ts'])
    expect(harness.opened).toEqual([])
  })

  it('copy relative / absolute path via the menu flips the copied label on success', async () => {
    vi.useFakeTimers()
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    harness = await mountTree()
    openMenu(harness.container, 'a.ts')
    const relative = menuItems().find(item => item.textContent === 'Copy relative path')
    expect(relative).toBeDefined()
    act(() => { relative!.click() })
    await act(async () => {})
    expect(primitives.writeClipboard).toHaveBeenCalledWith('a.ts')
    // The row's button is replaced by the transient copied label.
    expect(rowByName(harness.container, 'a.ts').textContent).toContain('Copied')
    await act(async () => { vi.advanceTimersByTime(1200) })
    expect(rowByName(harness.container, 'a.ts').textContent).not.toContain('Copied')

    openMenu(harness.container, 'a.ts')
    const absolute = menuItems().find(item => item.textContent === 'Copy absolute path')
    act(() => { absolute!.click() })
    await act(async () => {})
    expect(primitives.writeClipboard).toHaveBeenLastCalledWith('/tmp/a.ts')
  })

  it('a denied clipboard write never shows the copied label', async () => {
    vi.useFakeTimers()
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(false)
    harness = await mountTree()
    openMenu(harness.container, 'a.ts')
    const relative = menuItems().find(item => item.textContent === 'Copy relative path')
    act(() => { relative!.click() })
    await act(async () => {})
    expect(rowByName(harness.container, 'a.ts').textContent).not.toContain('Copied')
  })

  it('the workspace root row carries the reference button and its own copied label', async () => {
    vi.useFakeTimers()
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    harness = await mountTree()
    const root = rootRow(harness.container)
    expect(root.querySelector('button[class*="explorerRef"]')).not.toBeNull()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 })
    act(() => { root.dispatchEvent(event) })
    const relative = menuItems().find(item => item.textContent === 'Copy relative path')
    act(() => { relative!.click() })
    await act(async () => {})
    // The root's relative path is '.', and the label replaces the root button.
    expect(primitives.writeClipboard).toHaveBeenLastCalledWith('.')
    expect(rootRow(harness.container).textContent).toContain('Copied')
  })
})

describe('FileTree context-menu actions', () => {
  let harness: Harness
  beforeEach(() => {
    fsTree.mockReset()
    fsTree.mockResolvedValue({ entries })
  })
  afterEach(() => {
    harness.unmount()
    document.body.innerHTML = ''
  })

  it('a file row offers the open escapes and the download action', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    harness = await mountTree()
    openMenu(harness.container, 'a.ts')
    const labels = menuItems().map(item => item.textContent)
    expect(labels).toContain('Open in New Tab')
    expect(labels).toContain('Open to the Side')
    expect(labels).toContain('Download')
    // No upload entry for files (the host route refuses directories... for
    // files the caller's escapes replace it).
    expect(labels).not.toContain('Upload here')

    act(() => { menuItems().find(item => item.textContent === 'Open in New Tab')!.click() })
    expect(harness.opened).toEqual([]) // the escape callbacks are separate no-ops
    openMenu(harness.container, 'a.ts')
    act(() => { menuItems().find(item => item.textContent === 'Download')!.click() })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('the open escapes are absent when the caller wires none', async () => {
    harness = await mountTree({ noOpenEscapes: true })
    openMenu(harness.container, 'a.ts')
    const labels = menuItems().map(item => item.textContent)
    expect(labels).not.toContain('Open in New Tab')
    expect(labels).not.toContain('Open to the Side')
    expect(labels).toContain('Download')
  })

  it('a directory row offers Upload here; picking files reports them for that dir', async () => {
    harness = await mountTree()
    openMenu(harness.container, 'src')
    const upload = menuItems().find(item => item.textContent === 'Upload here')
    expect(upload).toBeDefined()
    expect(menuItems().map(item => item.textContent)).not.toContain('Download')
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    act(() => { upload!.click() })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
    // The hidden input's change delivers the picked files.
    const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'picked.txt')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(harness.uploads).toEqual([{ dir: '/tmp/src', items: [{ file, relativePath: 'picked.txt' }] }])
    // The picker resets so the same file can be picked again.
    expect(input.value).toBe('')
  })
})

describe('FileTree keyboard + busy drag surfaces', () => {
  let harness: Harness
  beforeEach(() => {
    fsTree.mockReset()
    fsTree.mockResolvedValue({ entries })
  })
  afterEach(() => {
    harness.unmount()
    document.body.innerHTML = ''
  })

  it('Enter and Space activate rows; other keys do nothing', async () => {
    harness = await mountTree()
    const file = rowByName(harness.container, 'a.ts')
    act(() => {
      file.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(harness.opened).toEqual(['/tmp/a.ts'])
    act(() => {
      file.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(harness.opened).toEqual(['/tmp/a.ts', '/tmp/a.ts'])
    act(() => {
      file.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true }))
    })
    expect(harness.opened).toHaveLength(2)

    const dir = rowByName(harness.container, 'src')
    act(() => {
      dir.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    // onToggle is a no-op here; activation simply did not crash the dir row.
    expect(harness.opened).toHaveLength(2)
  })

  it('busy: row dragover neither retargets nor shows a zone; a row drop reports nothing', async () => {
    harness = await mountTree({ busy: true })
    const dir = rowByName(harness.container, 'src')
    const over = fire(dir, 'dragover')
    expect(over.defaultPrevented).toBe(true)
    expect((over as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('none')
    expect(dropZone()).toBeNull()
    fire(harness.container.firstElementChild as HTMLElement, 'dragenter')
    expect(dropZone()).toBeNull()
    await act(async () => {})
    fire(dir, 'drop')
    await act(async () => {})
    expect(harness.uploads).toHaveLength(0)
  })

  it('a drag without a dataTransfer never enters the upload surface', async () => {
    harness = await mountTree()
    const body = harness.container.firstElementChild as HTMLElement
    const enter = fire(body, 'dragenter', ['Files'], false)
    expect(enter.defaultPrevented).toBe(false)
    expect(dropZone()).toBeNull()
  })

  it('an unmeasurable body rect anchors no drop zone', async () => {
    harness = await mountTree()
    const body = harness.container.firstElementChild as HTMLElement
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      return undefined as unknown as DOMRect
    }
    try {
      fire(body, 'dragenter')
      expect(dropZone()).toBeNull()
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })

  it('an empty drop payload reports no upload', async () => {
    harness = await mountTree()
    const body = harness.container.firstElementChild as HTMLElement
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], items: [], files: [], dropEffect: '' },
    })
    fire(body, 'dragenter')
    act(() => { body.dispatchEvent(event) })
    await act(async () => {})
    expect(harness.uploads).toHaveLength(0)
  })

  it('a body drop without a cwd is swallowed but reports nothing', async () => {
    harness = await mountTree({ cwd: null })
    const body = harness.container.firstElementChild as HTMLElement
    const drop = fire(body, 'drop')
    await act(async () => {})
    expect(drop.defaultPrevented).toBe(true)
    expect(harness.uploads).toHaveLength(0)
  })

  it('a non-file drop on a directory row passes through', async () => {
    harness = await mountTree()
    const dir = rowByName(harness.container, 'src')
    const drop = fire(dir, 'drop', ['application/x-tab'])
    await act(async () => {})
    expect(drop.defaultPrevented).toBe(false)
    expect(harness.uploads).toHaveLength(0)
  })

  it('a stale copied timer never clears a newer row label', async () => {
    vi.useFakeTimers()
    vi.spyOn(primitives, 'writeClipboard').mockResolvedValue(true)
    harness = await mountTree()
    openMenu(harness.container, 'a.ts')
    act(() => { menuItems().find(item => item.textContent === 'Copy absolute path')!.click() })
    await act(async () => {})
    expect(rowByName(harness.container, 'a.ts').textContent).toContain('Copied')
    // Copy the directory row too, then let BOTH timers elapse.
    openMenu(harness.container, 'src')
    act(() => { menuItems().find(item => item.textContent === 'Copy absolute path')!.click() })
    await act(async () => {})
    expect(rowByName(harness.container, 'src').textContent).toContain('Copied')
    await act(async () => { vi.advanceTimersByTime(1200) })
    // The first row's timer fired while the second label was shown (kept),
    // then the second timer cleared its own — nothing is stuck.
    expect(rowByName(harness.container, 'a.ts').textContent).not.toContain('Copied')
    expect(rowByName(harness.container, 'src').textContent).not.toContain('Copied')
  })

  it('clicking rows opens files and toggles directories; dir rows take Space too', async () => {
    harness = await mountTree()
    act(() => { rowByName(harness.container, 'a.ts').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(harness.opened).toEqual(['/tmp/a.ts'])
    act(() => { rowByName(harness.container, 'src').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(harness.toggles).toEqual(['/tmp/src'])
    act(() => {
      rowByName(harness.container, 'src').dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    })
    expect(harness.toggles).toEqual(['/tmp/src', '/tmp/src'])
  })

  it('a directory row renders the symlink marker and drop-target class only while hovered', async () => {
    fsTree.mockImplementation(async (_scope: unknown, path: string) =>
      path === ROOT
        ? { entries: [...entries, { name: 'slink', path: '/tmp/slink', isDir: true, hidden: false, isSymlink: true, broken: false }] }
        : { entries: subEntries })
    harness = await mountTree()
    expect(rowByName(harness.container, 'slink').querySelector('[class*="explorerSymlink"]')).not.toBeNull()
    // While a dir row is hovered, the FILE row loses the drop-target class.
    const body = harness.container.firstElementChild as HTMLElement
    fire(body, 'dragenter')
    const dir = rowByName(harness.container, 'src')
    fire(dir, 'dragover')
    expect(dir.className).toContain('explorerRowDropTarget')
    expect(rowByName(harness.container, 'a.ts').className).not.toContain('explorerRowDropTarget')
    // Hover the file row: its PARENT directory becomes the drop target.
    const file = rowByName(harness.container, 'a.ts')
    const over = fire(file, 'dragover')
    expect(over.defaultPrevented).toBe(true)
    expect(file.className).toContain('explorerRowDropTarget')
    expect(dir.className).not.toContain('explorerRowDropTarget')
    fire(file, 'drop')
    await act(async () => {})
    expect(harness.uploads).toEqual([{ dir: '/tmp', items: [{ file: (harness.uploads[0]?.items[0]?.file) as File, relativePath: 'dropped.txt' }] }])
  })

  it('the root row is a drop target and a context-menu surface', async () => {
    harness = await mountTree()
    const root = rootRow(harness.container)
    const body = harness.container.firstElementChild as HTMLElement
    fire(body, 'dragenter')
    const over = fire(root, 'dragover')
    expect(over.defaultPrevented).toBe(true)
    expect(root.className).toContain('explorerRowDropTarget')
    fire(root, 'drop')
    await act(async () => {})
    expect(harness.uploads).toHaveLength(1)
    expect(harness.uploads[0]!.dir).toBe('/tmp')
    // Right-click opens the directory menu (upload here + copy entries).
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })
    act(() => { root.dispatchEvent(event) })
    expect(menuItems().map(item => item.textContent)).toContain('Upload here')
  })

  it('the workspace root reference button inserts the root path', async () => {
    harness = await mountTree()
    const root = rootRow(harness.container)
    const button = root.querySelector('button[class*="explorerRef"]') as HTMLButtonElement
    act(() => { button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
    expect(harness.references).toEqual(['/tmp'])
  })

  it('targets wired without an onOpenWith handler still hide the section', async () => {
    harness = await mountTree({
      openWithoutHandler: true,
      openWithTargets: [
        { id: 'vscode', nameKey: 'openWithVscode', name: '', kind: 'url', urlTemplate: 'vscode://file/{path}', isVscodeFamily: true, localOnly: false },
      ],
      openWithPinned: [],
    })
    openMenu(harness.container, 'a.ts')
    expect(menuItems().some(item => item.textContent?.includes('Open with'))).toBe(false)
  })

  it('the picker change without upload-here targets the workspace root; busy swallows it', async () => {
    harness = await mountTree()
    const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'direct.txt')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(harness.uploads).toEqual([{ dir: '/tmp', items: [{ file, relativePath: 'direct.txt' }] }])
    // While busy the change is ignored entirely (and the value still resets).
    harness.rerender({ busy: true })
    const busyInput = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    const file2 = new File(['y'], 'busy.txt')
    Object.defineProperty(busyInput, 'files', { value: [file2], configurable: true })
    await act(async () => {
      busyInput.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(harness.uploads).toHaveLength(1)
    expect(busyInput.value).toBe('')
  })

  it('a hidden or revealed DIRECTORY row carries the dim / highlight classes', async () => {
    const scrollIntoView = vi.fn()
    const originalScroll = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    fsTree.mockResolvedValue({ entries: [
      { name: 'hid', path: '/tmp/hid', isDir: true, hidden: true, isSymlink: false, broken: false },
      { name: 'src', path: '/tmp/src', isDir: true, hidden: false, isSymlink: false, broken: false },
      { name: 'a.ts', path: '/tmp/a.ts', isDir: false, hidden: false, isSymlink: false, broken: false },
    ] })
    harness = await mountTree({ revealed: ['/tmp/src'] })
    const hidden = rowByName(harness.container, 'hid')
    expect(hidden.className).toContain('explorerHidden')
    expect(hidden.getAttribute('data-dsh-revealed')).toBeNull()
    const revealedDir = rowByName(harness.container, 'src')
    expect(revealedDir.className).toContain('explorerRowRevealed')
    expect(revealedDir.getAttribute('data-dsh-revealed')).toBe('true')
    HTMLElement.prototype.scrollIntoView = originalScroll
  })

  it('an unrelated key on a directory row does not toggle', async () => {
    harness = await mountTree()
    act(() => {
      rowByName(harness.container, 'src').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })
    expect(harness.toggles).toEqual([])
  })

  it('a picker change with no FileList reports nothing (defensive empty list)', async () => {
    harness = await mountTree()
    const input = harness.container.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: null, configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(harness.uploads).toEqual([{ dir: '/tmp', items: [] }])
  })

  it('selects the side-by-side escape from the file menu', async () => {
    const sides: string[] = []
    harness = await mountTree()
    // The harness side callback is a no-op; drive the id through onSelect by
    // re-mounting with a recording handler.
    harness.unmount()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    await act(async () => {
      root.render(createElement(FileTree, {
        sessionId: 's1',
        cwd: '/tmp',
        expanded: [],
        revealed: [],
        onToggle: () => {},
        onOpenFile: () => {},
        onOpenFileSide: (path: string) => { sides.push(path) },
        onReferenceFile: () => {},
        refreshTick: 0,
        onUploadRequest: () => {},
        busy: false,
      }))
    })
    const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')]
      .find(el => el.querySelector('[class*="explorerName"]')?.textContent === 'a.ts')
    act(() => {
      row!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1, clientY: 2 }))
    })
    const side = menuItems().find(item => item.textContent === 'Open to the Side')
    expect(side).toBeDefined()
    act(() => { side!.click() })
    expect(sides).toEqual(['/tmp/a.ts'])
    act(() => { root.unmount() })
    container.remove()
    document.body.innerHTML = ''
  })

  it('wired targets with an EMPTY list hide the section even with a handler', async () => {
    harness = await mountTree({ openWithEmpty: true })
    openMenu(harness.container, 'a.ts')
    expect(menuItems().some(item => item.textContent?.includes('Open with'))).toBe(false)
  })

  it('omitted pinned ids render the menu with no direct rows (fallback to [])', async () => {
    harness = await mountTree({
      openWithNoPinned: true,
      openWithTargets: [
        { id: 'vscode', nameKey: 'openWithVscode', name: '', kind: 'url', urlTemplate: 'vscode://file/{path}', isVscodeFamily: true, localOnly: false },
      ],
    })
    openMenu(harness.container, 'a.ts')
    // No pinned direct row, no separator: only the parent row remains.
    const labels = menuItems().map(item => item.textContent)
    expect(labels).toContain('Open with')
    expect(labels).not.toContain('VS Code')
    // Selecting the (only) submenu child still opens the target.
    act(() => { menuItems().find(item => item.getAttribute('aria-haspopup') === 'menu')!.click() })
    const child = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menu"] [role="menuitem"]')][0]!
    act(() => { child.click() })
  })

  it('dismisses the row menu on Escape', async () => {
    harness = await mountTree()
    openMenu(harness.container, 'a.ts')
    expect(menuItems()).toHaveLength(5)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menuItems()).toHaveLength(0)
  })

  it('a root-level file drops into its own path edge (parent of /a.ts)', async () => {
    fsTree.mockResolvedValue({ entries: [
      { name: 'a.ts', path: '/a.ts', isDir: false, hidden: false, isSymlink: false, broken: false },
    ] })
    harness = await mountTree({ cwd: '/' })
    const file = rowByName(harness.container, 'a.ts')
    fire(harness.container.firstElementChild as HTMLElement, 'dragenter')
    fire(file, 'drop')
    await act(async () => {})
    expect(harness.uploads).toHaveLength(1)
  })

  it('a wide body rect renders the chat-side invitation beside the tree', async () => {
    harness = await mountTree()
    const body = harness.container.firstElementChild as HTMLElement
    const original = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { top: 0, left: 260, width: 300, height: 200 } as DOMRect
    }
    try {
      fire(body, 'dragenter')
      expect(dropZone()).not.toBeNull()
      const hint = document.body.querySelector('[class*="uploadDropChatHint"]')
      expect(hint).not.toBeNull()
      expect(hint!.textContent).toContain('chat')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })
})
