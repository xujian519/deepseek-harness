// @vitest-environment jsdom
/**
 * StudioView presentation behavior: produced-file list, selection, preview
 * pane (HTML frame vs text), and the open / show-in-folder / print actions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  StudioView, isHtmlPath, isTextPreviewable,
  type StudioViewInjected, type StudioViewProps,
} from '../src/client/StudioView.tsx'
import { en, zh } from '../src/client/locales.ts'
// Type-only: pulls the LocaleNamespaceMap augmentation into this program.
import type {} from '../src/client/index.ts'

const t: StudioViewProps['t'] = makeTranslate(zh, en)

interface HostFacts { canOpenPath: boolean }

function session(produced: Array<{ seq: number; path: string }>) {
  const store = createSnapshotStore<ConversationSnapshot>({
    views: {
      get: () => (produced.length === 0 ? undefined : { produced }),
    },
  } as unknown as ConversationSnapshot)
  return {
    store,
    useSession: ((select: (snapshot: ConversationSnapshot) => unknown) =>
      select(store.getSnapshot())) as StudioViewProps['useSession'],
  }
}

function hostDescription(canOpenPath: boolean) {
  const store = createSnapshotStore<HostFacts>({ canOpenPath })
  return {
    store,
    useHostDescription: ((select: (facts: HostFacts | undefined) => unknown) =>
      select(store.getSnapshot())) as StudioViewProps['useHostDescription'],
  }
}

function injected(overrides: Partial<StudioViewInjected> = {}): StudioViewInjected {
  return {
    isLoopback: true,
    hooks: { hostDescription: createSnapshotStore<HostFacts>({ canOpenPath: true }) as never },
    openFile: vi.fn(() => Promise.resolve()),
    showInFolder: vi.fn(() => Promise.resolve()),
    readFileText: vi.fn((path: string) => Promise.resolve({ content: `<h1>${path}</h1>`, truncated: false })),
    ...overrides,
  }
}

function studioProps(
  produced: Array<{ seq: number; path: string }>,
  host: { useHostDescription: StudioViewProps['useHostDescription'] },
  overrides: Partial<StudioViewInjected> = {},
): StudioViewProps {
  const s = session(produced)
  // The full session-scope standard kit the outlet would bake; members the
  // studio does not read are stubbed inert (the trajectory spec pattern).
  return {
    sessionId: 's1',
    useSession: s.useSession,
    useSessions: (() => undefined) as never,
    useWorkspaces: (() => undefined) as never,
    useProjection: (() => undefined) as never,
    useInput: (() => undefined) as never,
    inputActions: {} as never,
    useHostDescription: host.useHostDescription,
    ...injected(overrides),
    t,
  } as unknown as StudioViewProps
}

afterEach(cleanup)

describe('StudioView', () => {
  it('shows the empty state when the session produced no files', () => {
    const host = hostDescription(true)
    render(<StudioView {...studioProps([], host)} />)
    expect(screen.getByText(t('studio.empty'))).toBeTruthy()
  })

  it('lists produced files, auto-selects the first, and previews HTML in a sandboxed frame', async () => {
    const host = hostDescription(true)
    const readFileText = vi.fn((path: string) => {
      if (path === 'out/index.html') return Promise.resolve({ content: '<h1>Hi</h1>', truncated: false })
      return Promise.resolve({ content: '# Notes', truncated: true })
    })
    const { container } = render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }, { seq: 2, path: 'notes.md' }], host, { readFileText })} />,
    )
    expect(screen.getAllByText('index.html').length).toBeGreaterThan(0)
    expect(screen.getAllByText('notes.md').length).toBeGreaterThan(0)
    expect(screen.getByText(t('studio.files', { count: 2 }))).toBeTruthy()
    // First file auto-selected → HTML frame (content loads asynchronously).
    const frame = await screen.findByTitle('index.html') as unknown as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.srcdoc).toContain('<h1>Hi</h1>')
    // Selecting the markdown file shows the text pane with the truncation note.
    const notesChip = screen.getAllByText('notes.md')[0]
    expect(notesChip).toBeDefined()
    fireEvent.click(notesChip!)
    expect(await screen.findByText('# Notes')).toBeTruthy()
    expect(container.querySelector('pre')).toBeNull()
    expect(screen.getByText(t('studio.preview.truncated'))).toBeTruthy()
  })

  it('runs the open and show-in-folder actions and gates the folder action on host capability', () => {
    const host = hostDescription(true)
    const openFile = vi.fn(() => Promise.resolve())
    const showInFolder = vi.fn(() => Promise.resolve())
    render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/report.md' }], host, { openFile, showInFolder })} />,
    )
    fireEvent.click(screen.getByText(t('studio.action.open')))
    expect(openFile).toHaveBeenCalledWith('out/report.md')
    fireEvent.click(screen.getByText(t('studio.action.folder')))
    expect(showInFolder).toHaveBeenCalledWith('out/report.md')

    cleanup()
    const noFolder = hostDescription(false)
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/report.md' }], noFolder, { isLoopback: false })} />)
    expect(screen.queryByText(t('studio.action.folder'))).toBeNull()
  })

  it('prints the HTML preview through a print window and tolerates a blocked popup', async () => {
    const host = hostDescription(true)
    const write = vi.fn()
    const print = vi.fn()
    const open = vi.spyOn(window, 'open')
    open.mockReturnValueOnce({
      document: { open: vi.fn(), write, close: vi.fn() },
      focus: vi.fn(),
      print,
    } as never)
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }], host)} />)
    await screen.findByTitle('index.html')
    fireEvent.click(screen.getByText(t('studio.action.print')))
    expect(write).toHaveBeenCalledWith('<h1>out/index.html</h1>')
    expect(print).toHaveBeenCalled()
    // Blocked popup: window.open returns null and the helper returns early.
    open.mockReturnValueOnce(null)
    fireEvent.click(screen.getByText(t('studio.action.print')))
    expect(print).toHaveBeenCalledTimes(1)
    open.mockRestore()
  })

  it('surfaces read failures in the preview pane and keeps the hint for non-previewable files', async () => {
    const host = hostDescription(true)
    const readFileText = vi.fn(() => Promise.reject(new Error('boom')))
    const { container } = render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/broken.html' }, { seq: 2, path: 'out/archive.pdf' }], host, { readFileText })} />,
    )
    expect(await screen.findByText(t('studio.preview.error', { message: 'boom' }))).toBeTruthy()
    const pdfChip = screen.getAllByText('archive.pdf')[0]
    expect(pdfChip).toBeDefined()
    fireEvent.click(pdfChip!)
    expect(screen.getByText(t('studio.preview.hint'))).toBeTruthy()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('exports through the desktop bridge when present and falls back to browser print otherwise', async () => {
    const host = hostDescription(true)
    const printHtmlToPdf = vi.fn(() => Promise.resolve({ path: '/tmp/report.pdf' }))
    ;(window as unknown as Window & { desktop?: { printHtmlToPdf: typeof printHtmlToPdf } }).desktop = {
      printHtmlToPdf,
    }
    try {
      render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }], host)} />)
      await screen.findByTitle('index.html')
      fireEvent.click(screen.getByText(t('studio.action.print')))
      expect(await screen.findByText(t('studio.print.exported', { path: '/tmp/report.pdf' }))).toBeTruthy()
      expect(printHtmlToPdf).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<h1>out/index.html</h1>', suggestedName: 'index.html' }),
      )
      // A failing export surfaces the message (typed via the bridge's result union).
      ;(printHtmlToPdf as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: 'printer offline' })
      fireEvent.click(screen.getByText(t('studio.action.print')))
      expect(await screen.findByText(t('studio.print.failed', { message: 'printer offline' }))).toBeTruthy()
    } finally {
      delete (window as Window & { desktop?: unknown }).desktop
    }
  })

  it('re-reads the full document before printing when the preview head was truncated', async () => {
    const host = hostDescription(true)
    const printHtmlToPdf = vi.fn(() => Promise.resolve({ path: '/tmp/full.pdf' }))
    ;(window as unknown as Window & { desktop?: { printHtmlToPdf: typeof printHtmlToPdf } }).desktop = {
      printHtmlToPdf,
    }
    const readFileText = vi.fn((_path: string, maxBytes?: number) => {
      if (maxBytes === 4 * 1024 * 1024) return Promise.resolve({ content: '<h1>FULL</h1>', truncated: false })
      return Promise.resolve({ content: '<h1>HEAD</h1>', truncated: true })
    })
    try {
      render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }], host, { readFileText })} />)
      await screen.findByTitle('index.html')
      fireEvent.click(screen.getByText(t('studio.action.print')))
      expect(await screen.findByText(t('studio.print.exported', { path: '/tmp/full.pdf' }))).toBeTruthy()
      // The full re-read feeds the bridge, not the truncated preview head.
      expect(printHtmlToPdf).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<h1>FULL</h1>', suggestedName: 'index.html' }),
      )
    } finally {
      delete (window as Window & { desktop?: unknown }).desktop
    }
  })

  it('blocks print with an explanation when the full read is still truncated', async () => {
    const host = hostDescription(true)
    const printHtmlToPdf = vi.fn(() => Promise.resolve({ path: '/tmp/x.pdf' }))
    ;(window as unknown as Window & { desktop?: { printHtmlToPdf: typeof printHtmlToPdf } }).desktop = {
      printHtmlToPdf,
    }
    const readFileText = vi.fn(() => Promise.resolve({ content: '<h1>HEAD</h1>', truncated: true }))
    try {
      render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }], host, { readFileText })} />)
      await screen.findByTitle('index.html')
      fireEvent.click(screen.getByText(t('studio.action.print')))
      expect(await screen.findByText(t('studio.print.failed', { message: t('studio.print.tooLarge') }))).toBeTruthy()
      expect(printHtmlToPdf).not.toHaveBeenCalled()
    } finally {
      delete (window as Window & { desktop?: unknown }).desktop
    }
  })

  it('classifies preview kinds by extension', () => {
    expect(isHtmlPath('a.html')).toBe(true)
    expect(isHtmlPath('a.htm')).toBe(true)
    expect(isHtmlPath('a.HTML')).toBe(true)
    expect(isHtmlPath('a.pdf')).toBe(false)
    expect(isTextPreviewable('a.md')).toBe(true)
    expect(isTextPreviewable('a.json')).toBe(true)
    expect(isTextPreviewable('a.yml')).toBe(true)
    expect(isTextPreviewable('a.csv')).toBe(true)
    expect(isTextPreviewable('a.png')).toBe(false)
  })
})
