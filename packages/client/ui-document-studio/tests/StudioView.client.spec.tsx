// @vitest-environment jsdom
/**
 * StudioView presentation behavior: produced-file list, selection, preview
 * pane (HTML frame vs text vs sidebar handoff), the quality-gate claim, the
 * machine-check badges, the workspace probes, and the file actions.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  allowAllAccess, bindSnapshotSelector, conversationSnapshot, makeTranslate, sessionSnapshot, workspaceSnapshot,
} from '@deepseek-ai/dsh-client-test-runtime'
import type {
  ConversationSnapshot, ConversationViewSnapshotMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { DOCUMENT_DELIVERABLES_TARGET } from '../src/client/document-deliverables.ts'
import {
  StudioView, isHtmlPath, isTextPreviewable, parseDocumentSections,
  type StudioViewInjected, type StudioViewProps,
} from '../src/client/StudioView.tsx'
import type { CompleteReadText } from '../src/client/file-reads.ts'
import { WorkspaceReadError } from '../src/client/file-reads.ts'
import { en, zh } from '../src/client/locales.ts'
// Type-only: pulls the LocaleNamespaceMap augmentation into this program.
import type {} from '../src/client/index.ts'

const t: StudioViewProps['t'] = makeTranslate(zh, en)

/** Empty global standard-kit hooks the studio does not read. */
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const useResource = (() => ({
  status: 'none' as const, value: undefined, failure: undefined, reload: () => {},
})) as GlobalStandardProps['useResource']

interface ProducedFile {
  seq: number
  path: string
  format?: string
  gate?: { p0: string[]; p1: string[] }
  checks?: {
    status: string
    reason?: string
    findings: Array<{ check: string; level: string; detail: string; line?: number }>
  }
  briefRef?: string
}

function session(produced: Array<ProducedFile>) {
  const views: ConversationSnapshot['views'] = {
    // The target check makes this assertion exact for the one registered target.
    get: <Target extends Extract<keyof ConversationViewSnapshotMap, string>>(target: Target) =>
      (target === DOCUMENT_DELIVERABLES_TARGET ? { produced } : undefined) as
        ConversationViewSnapshotMap[Target] | undefined,
    grouped: () => undefined,
  }
  const store = createSnapshotStore<ConversationSnapshot>(conversationSnapshot({ views }))
  return { store, useConversation: bindSnapshotSelector(store) }
}

function sessionsOf(preset: string | null = 'document') {
  const summary: SessionSummary = {
    id: SessionId('s1'),
    displayTitle: 's1',
    running: false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
    projectionValues: { agentPreset: preset },
  }
  const store = createSnapshotStore<SessionListState>({
    ids: [summary.id],
    byId: { [summary.id]: summary },
    phase: 'ready',
    projectionsBySession: {},
  })
  return bindSnapshotSelector(store)
}

function injected(overrides: Partial<StudioViewInjected> = {}): StudioViewInjected {
  return {
    isLoopback: true,
    canOpenInSidebar: true,
    openFile: vi.fn(() => Promise.resolve()),
    showInFolder: vi.fn(() => Promise.resolve()),
    openInSidebar: vi.fn(() => true),
    readFileText: vi.fn((path: string) => Promise.resolve({ content: `<h1>${path}</h1>`, truncated: false })),
    readFileTextComplete: vi.fn((path: string): Promise<CompleteReadText> =>
      Promise.resolve({ truncated: false, content: `<h1>${path}</h1>` })),
    statVersions: vi.fn((paths: readonly string[]) => Promise.resolve(
      Object.fromEntries(paths.map(path => [path, `v1:${path}`])),
    )),
    probeUnregistered: vi.fn(() => Promise.resolve([])),
    insertDraft: vi.fn(() => true),
    ...overrides,
  }
}

function studioProps(
  produced: Array<ProducedFile>,
  overrides: Partial<StudioViewInjected> = {},
  preset: string | null = 'document',
): StudioViewProps {
  const s = session(produced)
  // The full session-scope standard kit the outlet would bake; members the
  // studio does not read are stubbed inert (the trajectory spec pattern).
  return {
    sessionId: SessionId('s1'),
    useConversation: s.useConversation,
    useSessions: sessionsOf(preset),
    useSession: bindSnapshotSelector(createSnapshotStore(sessionSnapshot(SessionId('s1')))),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map())),
    useChat: () => { throw new Error('unused') },
    useTrajectory: () => { throw new Error('unused') },
    useSessionRetainInfo: () => undefined,
    useWorkspaces: bindSnapshotSelector(createSnapshotStore(workspaceSnapshot())),
    useProjection: () => undefined,
    useInput: (() => undefined) as StudioViewProps['useInput'],
    inputActions: {} as StudioViewProps['inputActions'],
    ...allowAllAccess,
    usePanelInfo,
    useResource,
    inspectCall: undefined,
    viewRequest: null,
    openView: () => {},
    completeViewRequest: vi.fn(),
    ...injected(overrides),
    t,
  }
}

afterEach(cleanup)

describe('StudioView', () => {
  it('shows the empty state when the session produced no files', async () => {
    const probeUnregistered = vi.fn(() => Promise.resolve([]))
    render(<StudioView {...studioProps([], { probeUnregistered })} />)
    expect(screen.getByText(t('studio.empty'))).toBeTruthy()
    // The probe runs once on mount, never on a timer.
    await screen.findByRole('button', { name: t('studio.empty.scan') })
    expect(probeUnregistered).toHaveBeenCalledTimes(1)
    expect(probeUnregistered).toHaveBeenCalledWith([])
  })

  it('reports unregistered deliverable files beside the empty state instead of claiming nothing was produced', async () => {
    const probeUnregistered = vi.fn(() => Promise.resolve(['out/report.docx', 'out/deck.pptx']))
    render(<StudioView {...studioProps([], { probeUnregistered })} />)
    expect(await screen.findByText(t('studio.empty.unregistered', { count: 2 }))).toBeTruthy()
    expect(screen.getByText('out/report.docx')).toBeTruthy()
    expect(screen.getByText(t('studio.empty.unregisteredHint'))).toBeTruthy()
  })

  it('surfaces a failed workspace probe as its own state, and rescans on request', async () => {
    const probeUnregistered = vi.fn()
      .mockRejectedValueOnce(new Error('permission denied'))
      .mockResolvedValueOnce(['a.html'])
    render(<StudioView {...studioProps([], { probeUnregistered })} />)
    expect(await screen.findByText(t('studio.empty.scanFailed', { message: 'permission denied' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('studio.empty.scan') }))
    expect(await screen.findByText(t('studio.empty.unregistered', { count: 1 }))).toBeTruthy()
    expect(probeUnregistered).toHaveBeenCalledTimes(2)
  })

  it('lists produced files, auto-selects the first, and previews HTML in a sandboxed frame', async () => {
    const readFileText = vi.fn((path: string) => {
      if (path === 'out/index.html') return Promise.resolve({ content: '<h1>Hi</h1>', truncated: false })
      return Promise.resolve({ content: '# Notes', truncated: true })
    })
    render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }, { seq: 2, path: 'notes.md' }], { readFileText })} />,
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
    expect(screen.getByText(t('studio.preview.truncated'))).toBeTruthy()
  })

  it('marks a truncated HTML preview instead of passing the head off as the document', async () => {
    const readFileText = vi.fn(() => Promise.resolve({ content: '<section data-doc-id="a">x</section>', truncated: true }))
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }], { readFileText })} />)
    expect(await screen.findByText(t('studio.preview.truncated'))).toBeTruthy()
    expect(screen.getByTitle('index.html').getAttribute('sandbox')).toBe('')
  })

  it('keeps the declared quality gate neutral and lists its items as the model\'s claim', () => {
    render(
      <StudioView {...studioProps([
        {
          seq: 1, path: 'out/report.html',
          format: 'html', gate: { p0: ['命名规范'], p1: ['可访问性'] }, briefRef: 'brief.md',
        },
        { seq: 2, path: 'out/report.md' },
      ])} />,
    )
    expect(screen.getByText('html')).toBeTruthy()
    // The claim badge says it is a claim, and names the declared items.
    expect(screen.getByText(t('studio.file.gateIds', { ids: '命名规范 · 可访问性' }))).toBeTruthy()
    // The expansion lists them as items, under the claim label.
    expect(screen.getByText(t('studio.claim.title'))).toBeTruthy()
    expect(screen.getByText(t('studio.claim.p0'))).toBeTruthy()
    expect(screen.getAllByText('命名规范').length).toBeGreaterThan(0)
    expect(screen.getAllByText('可访问性').length).toBeGreaterThan(0)
    expect(screen.getByText(t('studio.file.gateMissing'))).toBeTruthy()
  })

  it('renders stable P0 ids verbatim and falls back to counts for a long claim list', () => {
    render(
      <StudioView {...studioProps([
        {
          seq: 1, path: 'out/short.html', format: 'html',
          gate: { p0: ['P0-1 命名', 'P0-2 自包含'], p1: [] },
        },
        {
          seq: 2, path: 'out/long.html', format: 'html',
          gate: { p0: ['P0-1 命名', 'P0-2 自包含', 'P0-3 无占位残留', 'P0-4 断链'], p1: [] },
        },
      ])} />,
    )
    // Short claims name their ids; the badge is not a bare count.
    expect(screen.getByText(t('studio.file.gateIds', { ids: 'P0-1 命名 · P0-2 自包含' }))).toBeTruthy()
    // A claim list too long for the badge keeps the count there.
    expect(screen.getByText(t('studio.file.gateClaim', { p0: 4, p1: 0 }))).toBeTruthy()
    // Selecting that file still lists every declared item verbatim.
    fireEvent.click(screen.getAllByText('long.html')[0]!)
    expect(screen.getAllByText('P0-3 无占位残留').length).toBeGreaterThan(0)
    expect(screen.getAllByText('P0-4 断链').length).toBeGreaterThan(0)
  })

  it('keeps the missing-gate badge for document sessions only', () => {
    cleanup()
    render(<StudioView {...studioProps([{ seq: 1, path: 'src/app.ts' }], {}, 'standard')} />)
    expect(screen.queryByText(t('studio.file.gateMissing'))).toBeNull()
  })

  it('renders the machine-check badge per recorded status, with its findings as the tooltip', () => {
    render(
      <StudioView {...studioProps([
        {
          seq: 1, path: 'out/clean.html', format: 'html',
          checks: { status: 'checked', findings: [] },
        },
        {
          seq: 2, path: 'out/warned.md', format: 'markdown',
          checks: {
            status: 'checked',
            findings: [{ check: 'empty_section', level: 'warn', detail: '第 5 行的标题 "空节" 下没有任何内容', line: 5 }],
          },
        },
        {
          seq: 3, path: 'out/deck.pdf', format: 'pdf',
          checks: { status: 'unchecked', reason: 'pdf 格式没有文本读取器', findings: [] },
        },
        {
          seq: 4, path: 'out/partial.docx', format: 'docx',
          checks: { status: 'unreadable', reason: 'DOCX 结构报告 malformed-xml，投影文本可能不完整', findings: [] },
        },
        { seq: 5, path: 'out/unregistered.txt' },
      ])} />,
    )
    expect(screen.getByText(t('studio.file.checkedPassed'))).toBeTruthy()
    const warned = screen.getByText(t('studio.file.checkedFindings', { count: 1 }))
    expect(warned.getAttribute('title')).toBe('第 5 行的标题 "空节" 下没有任何内容')
    expect(screen.getByText(t('studio.file.checkedSkipped')).getAttribute('title')).toBe('pdf 格式没有文本读取器')
    expect(screen.getByText(t('studio.file.checkedFailed')).getAttribute('title')).toBe('DOCX 结构报告 malformed-xml，投影文本可能不完整')
    // A file with no recorded checks renders no machine-check badge at all.
    expect(screen.getByText('unregistered.txt').closest('button')?.textContent).not.toContain(t('studio.file.checkedPassed'))
  })

  it('withdraws the verdict once the file\'s freshness token moved', async () => {
    const statVersions = vi.fn()
      .mockResolvedValueOnce({ 'out/report.html': 'v1' })
      .mockResolvedValueOnce({ 'out/report.html': 'v2' })
    const props = studioProps([
      {
        seq: 1, path: 'out/report.html', format: 'html', gate: { p0: ['命名规范'], p1: [] },
        checks: { status: 'checked', findings: [] },
      },
    ], { statVersions })
    const { rerender } = render(<StudioView {...props} />)
    expect(await screen.findByText(t('studio.file.checkedPassed'))).toBeTruthy()
    // A new produced list (the log moved) re-checks the token.
    rerender(<StudioView {...studioProps([{
      seq: 1, path: 'out/report.html', format: 'html', gate: { p0: ['命名规范'], p1: [] },
      checks: { status: 'checked', findings: [] },
    }], { statVersions })} />)
    expect(await screen.findByText(t('studio.file.changed'))).toBeTruthy()
    expect(screen.queryByText(t('studio.file.checkedPassed'))).toBeNull()
  })

  it('runs the open and reveal actions and reports a failed one instead of swallowing it', async () => {
    const openFile = vi.fn(() => Promise.resolve())
    const showInFolder = vi.fn(() => Promise.resolve())
    render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/report.md' }], { openFile, showInFolder })} />,
    )
    fireEvent.click(screen.getByText(t('studio.action.open')))
    expect(openFile).toHaveBeenCalledWith('out/report.md')
    fireEvent.click(screen.getByText(t('studio.action.folder')))
    expect(showInFolder).toHaveBeenCalledWith('out/report.md')

    cleanup()
    const failing = vi.fn(() => Promise.reject(new Error('no desktop')))
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/report.md' }], { openFile: failing })} />)
    fireEvent.click(screen.getByText(t('studio.action.open')))
    expect(await screen.findByText(t('studio.action.openFailed', { message: 'no desktop' }))).toBeTruthy()
  })

  it('gates the reveal action on loopback', () => {
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/report.md' }], { isLoopback: false })} />)
    expect(screen.queryByText(t('studio.action.folder'))).toBeNull()
  })

  it('prints the HTML preview through a print window and reports a blocked popup', async () => {
    const write = vi.fn()
    const print = vi.fn()
    const open = vi.spyOn(window, 'open')
    open.mockReturnValueOnce({
      document: { open: vi.fn(), write, close: vi.fn() },
      focus: vi.fn(),
      print,
    } as never)
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/index.html' }])} />)
    await screen.findByTitle('index.html')
    // The export hint is visible before the browser print dialog opens.
    expect(screen.getByText(t('studio.print.note'))).toBeTruthy()
    fireEvent.click(screen.getByText(t('studio.action.print')))
    expect(write).toHaveBeenCalledWith('<h1>out/index.html</h1>')
    expect(print).toHaveBeenCalled()
    // Blocked popup: window.open returns null and the view says so.
    open.mockReturnValueOnce(null)
    fireEvent.click(screen.getByText(t('studio.action.print')))
    expect(print).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(t('studio.print.failed', { message: t('studio.print.blocked') }))).toBeTruthy()
    open.mockRestore()
  })

  it('localizes a read failure from its Host code instead of showing the wire text', async () => {
    const readFileText = vi.fn(() => Promise.reject(
      new WorkspaceReadError('no entry at "out/gone.md"', 'workspace-file/not-found'),
    ))
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/gone.md' }], { readFileText })} />)
    expect(await screen.findByText(t('studio.error.notFound'))).toBeTruthy()
    expect(screen.queryByText('no entry at "out/gone.md"')).toBeNull()
  })

  it('hands a non-previewable file to the sidebar instead of asking which file to select', async () => {
    const openInSidebar = vi.fn(() => true)
    render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/report.docx' }], { openInSidebar })} />,
    )
    expect(await screen.findByText(t('studio.preview.sidebarOnly'))).toBeTruthy()
    // The old hint told the user to select a file that was already selected.
    expect(screen.queryByText(t('studio.preview.hint'))).toBeNull()
    fireEvent.click(screen.getAllByText(t('studio.action.previewSidebar'))[0]!)
    expect(openInSidebar).toHaveBeenCalledWith('out/report.docx')
  })

  it('omits the sidebar handoff when no preview surface is mounted', async () => {
    render(<StudioView {...studioProps([{ seq: 1, path: 'out/report.docx' }], { canOpenInSidebar: false })} />)
    expect(await screen.findByText(t('studio.preview.sidebarOnly'))).toBeTruthy()
    expect(screen.queryByText(t('studio.action.previewSidebar'))).toBeNull()
  })

  it('fills the composer draft with the machine findings and never sends it', async () => {
    const insertDraft = vi.fn((text: string) => text.length > 0)
    render(
      <StudioView {...studioProps([
        {
          seq: 1, path: 'out/warned.md', format: 'markdown', gate: { p0: ['命名规范'], p1: [] },
          checks: {
            status: 'checked',
            findings: [{ check: 'empty_section', level: 'warn', detail: '空标题下没有任何内容', line: 5 }],
          },
        },
      ], { insertDraft })} />,
    )
    fireEvent.click(screen.getByText(t('studio.action.revise')))
    expect(insertDraft).toHaveBeenCalledTimes(1)
    const draft = insertDraft.mock.calls[0]?.[0] ?? ''
    expect(draft).toContain(t('studio.revise.prefix'))
    expect(draft).toContain('空标题下没有任何内容')
    expect(draft).toContain(t('studio.revise.line', { line: 5 }))
    // The insert is the only write: the message is a draft, and the view says so.
    expect(await screen.findByText(t('studio.revise.inserted'))).toBeTruthy()
  })

  it('inserts a section reference draft for a delivered HTML file', async () => {
    const insertDraft = vi.fn((text: string) => text.length > 0)
    const html = '<html><body><section data-doc-id="sec-intro"><h2>引言</h2><p>a</p></section>'
      + '<section data-doc-id="sec-end"><h2>结论</h2><p>b</p></section></body></html>'
    render(
      <StudioView {...studioProps([{ seq: 1, path: 'out/report.html' }], {
        insertDraft,
        readFileText: vi.fn(() => Promise.resolve({ content: html, truncated: false })),
      })} />,
    )
    await screen.findByTitle('report.html')
    fireEvent.change(screen.getByLabelText(t('studio.section.pick')), { target: { value: 'sec-end' } })
    fireEvent.click(screen.getByText(t('studio.section.insert')))
    expect(insertDraft).toHaveBeenCalledTimes(1)
    const draft = insertDraft.mock.calls[0]?.[0] ?? ''
    expect(draft).toContain(t('studio.section.reference', { path: 'out/report.html', id: 'sec-end' }))
    expect(draft).toContain('结论')
    expect(draft).toContain(t('studio.section.instruction'))
    expect(await screen.findByText(t('studio.section.inserted'))).toBeTruthy()
  })

  it('distinguishes two files that share a basename', () => {
    render(
      <StudioView {...studioProps([
        { seq: 1, path: 'out/v1/report.html' },
        { seq: 2, path: 'out/v2/report.html' },
      ])} />,
    )
    expect(screen.getByText('report.html · out/v1')).toBeTruthy()
    expect(screen.getByText('report.html · out/v2')).toBeTruthy()
  })

  it('keeps every action reachable in one row for a narrow panel', async () => {
    // jsdom has no layout, so the 390px acceptance is asserted structurally:
    // all five actions render and each one is wired.
    const openFile = vi.fn(() => Promise.resolve())
    render(
      <StudioView {...studioProps([
        {
          seq: 1, path: 'out/report.html', format: 'html', gate: { p0: ['x'], p1: [] },
          checks: { status: 'checked', findings: [] },
        },
      ], { openFile })} />,
    )
    await screen.findByTitle('report.html')
    for (const label of [
      t('studio.action.open'),
      t('studio.action.folder'),
      t('studio.action.previewSidebar'),
      t('studio.action.print'),
      t('studio.action.revise'),
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    fireEvent.click(screen.getByText(t('studio.action.open')))
    expect(openFile).toHaveBeenCalled()
  })

  it('honors a one-shot focus request naming a produced file', async () => {
    const completeViewRequest = vi.fn()
    const props = {
      ...studioProps([{ seq: 1, path: 'a.html' }, { seq: 2, path: 'out/b.md' }]),
      completeViewRequest,
    }
    const { rerender } = render(<StudioView {...props} />)
    expect(await screen.findByTitle('a.html')).toBeTruthy()
    rerender(<StudioView {...{
      ...props,
      viewRequest: { view: 'documentDeliverables', focus: 'out/b.md' },
    }} />)
    expect(await screen.findByText('<h1>out/b.md</h1>')).toBeTruthy()
    expect(completeViewRequest).toHaveBeenCalledTimes(1)
  })

  it('classifies preview kinds by extension and parses declared sections', () => {
    expect(isHtmlPath('a.html')).toBe(true)
    expect(isHtmlPath('a.htm')).toBe(true)
    expect(isHtmlPath('a.HTML')).toBe(true)
    expect(isHtmlPath('a.pdf')).toBe(false)
    expect(isTextPreviewable('a.md')).toBe(true)
    expect(isTextPreviewable('a.json')).toBe(true)
    expect(isTextPreviewable('a.yml')).toBe(true)
    expect(isTextPreviewable('a.csv')).toBe(true)
    expect(isTextPreviewable('a.png')).toBe(false)

    expect(parseDocumentSections(
      '<section data-doc-id="one"><h2>One &amp; only</h2></section>'
      + '<section class="x" data-doc-id=\'two\'><p>no heading</p></section>'
      + '<section data-doc-id="one"><h2>duplicate</h2></section>',
    )).toEqual([
      { id: 'one', heading: 'One & only' },
      { id: 'two', heading: '' },
    ])
  })
})
