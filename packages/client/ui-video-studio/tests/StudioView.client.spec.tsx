// @vitest-environment jsdom
/** Production board: empty, loading, project facts, media selection, actions, and failures. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { VIDEO_PROJECTS_TARGET } from '../src/client/video-projects.ts'
import { StudioReadError, type StudioProject } from '../src/client/project-reads.ts'
import { StudioView, type VideoStudioProps } from '../src/client/StudioView.tsx'
import { en } from '../src/client/locales.ts'

const t = makeTranslate(en)

const PROJECT: StudioProject = {
  path: '/work/video/ep01/project.json',
  id: 'ep01',
  title: 'Episode One',
  aspect: '9:16',
  targetSeconds: 30,
  budgetCny: 10,
  updatedAt: '2026-10-01T10:00:00.000Z',
  shots: [
    {
      id: 's01', index: 1, prompt: 'A door opens', durationSec: 3, status: 'ready',
      keyframePath: 'shots/s01.png', clipPath: 'shots/s01.mp4', costCny: 2,
    },
    { id: 's02', index: 2, prompt: 'She turns', durationSec: 4, status: 'draft' },
  ],
  renders: [{ id: 'r1', path: 'out/ep01.mp4', durationSec: 7, costCny: 3, createdAt: '2026-10-01T10:00:00.000Z' }],
  spentCny: 2,
  ledgerCny: 2,
  tasks: [{ id: 't1', provider: 'minimax', model: 'MiniMax-H3', kind: 'video', status: 'running', submittedAt: 1, outputPath: 'shots/s02.mp4' }],
  media: [
    { path: 'shots/s01.png', kind: 'image', absolutePath: '/work/shots/s01.png', version: 'v1' },
    { path: 'shots/s01.mp4', kind: 'video', absolutePath: '/work/shots/s01.mp4', version: 'v1' },
    { path: 'out/ep01.mp4', kind: 'video', absolutePath: '/work/out/ep01.mp4', version: 'v1' },
  ],
}

function board(projects: readonly string[], revision = 1) {
  return { views: new Map([[VIDEO_PROJECTS_TARGET, { projects, revision }]]) }
}

function harness(options: {
  readonly projects?: readonly string[]
  readonly project?: StudioProject
  readonly load?: (path: string, signal: AbortSignal) => Promise<StudioProject | undefined>
  readonly canOpenInSidebar?: boolean
  readonly openInSidebar?: (path: string) => boolean
} = {}) {
  const loadProject = vi.fn(options.load ?? (async () => options.project ?? PROJECT))
  const openInSidebar = vi.fn(options.openInSidebar ?? (() => true))
  const props = {
    useConversation: (selector: (state: returnedState) => unknown) =>
      selector(board(options.projects ?? ['/work/video/ep01/project.json'])),
    loadProject,
    mediaUrl: (path: string, version: string) => `http://host/api/file?path=${encodeURIComponent(path)}&v=${version}`,
    canOpenInSidebar: options.canOpenInSidebar ?? true,
    openInSidebar,
    openFile: vi.fn(async () => {}),
    showInFolder: vi.fn(async () => {}),
    isLoopback: true,
    t,
  } as VideoStudioProps
  return { ...render(<StudioView {...props} />), loadProject, openInSidebar, openFile: props.openFile, showInFolder: props.showInFolder }
}

/** A thenable that rejects with a deliberately non-Error reason. */
function rejecting(reason: unknown): never {
  return {
    then: (_resolve: unknown, reject: (value: unknown) => void) => { reject(reason) },
  } as never
}

/** A catch-only carrier used where the component calls `.catch` on an action. */
function catching(reason: unknown): never {
  return {
    catch: (handler: (value: unknown) => void) => { handler(reason) },
  } as never
}

interface returnedState {
  readonly views: Map<string, { readonly projects: readonly string[]; readonly revision: number }>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('video studio board', () => {
  it('explains how to start when no project was discovered', () => {
    harness({ projects: [] })
    expect(screen.getByText(en['studio.empty.title'])).toBeTruthy()
    expect(screen.getByText(en['studio.empty.hint'])).toBeTruthy()
  })

  it('renders the project, budget, shots, renders, tasks, and media preview', async () => {
    const { container } = harness()
    expect(await screen.findByText('Episode One')).toBeTruthy()
    expect(screen.getByText('2.00 / 10.00 CNY')).toBeTruthy()
    expect(screen.getByText('A door opens')).toBeTruthy()
    expect(screen.getByText(en['studio.shot.status.ready'])).toBeTruthy()
    expect(screen.getByText(en['studio.shot.status.draft'])).toBeTruthy()
    expect(screen.getByText('ep01.mp4')).toBeTruthy()
    expect(screen.getByText('video · MiniMax-H3 · Running')).toBeTruthy()
    expect(screen.getByText('Updated 2026-10-01 10:00')).toBeTruthy()
    // The first video among the media wins the initial preview.
    expect(container.querySelector('video')?.getAttribute('src'))
      .toBe('http://host/api/file?path=%2Fwork%2Fshots%2Fs01.mp4&v=v1')
  })

  it('switches the preview when a shot or a render is chosen', async () => {
    const { container } = harness()
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByText('A door opens'))
    expect(container.querySelector('video')?.getAttribute('src'))
      .toBe('http://host/api/file?path=%2Fwork%2Fshots%2Fs01.mp4&v=v1')
    fireEvent.click(screen.getByText('ep01.mp4'))
    expect(container.querySelector('video')?.getAttribute('src'))
      .toBe('http://host/api/file?path=%2Fwork%2Fout%2Fep01.mp4&v=v1')
  })

  it('shows a keyframe image when the shot offers only one', async () => {
    const keyframeOnly: StudioProject = {
      ...PROJECT,
      media: [PROJECT.media[0]!],
      shots: [{
        id: 's01', index: 1, prompt: 'A door opens', durationSec: 3, status: 'ready',
        keyframePath: 'shots/s01.png', costCny: 2,
      }],
    }
    const { container } = harness({ project: keyframeOnly })
    await screen.findByText('Episode One')
    expect(container.querySelector('img')?.getAttribute('src'))
      .toBe('http://host/api/file?path=%2Fwork%2Fshots%2Fs01.png&v=v1')
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Keyframe: s01.png')
  })

  it('re-reads on refresh and when the discovery revision advances', async () => {
    const { loadProject, rerender } = harness()
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.refresh'] }))
    await waitFor(() => { expect(loadProject).toHaveBeenCalledTimes(2) })
    const props = {
      useConversation: (selector: (state: returnedState) => unknown) =>
        selector(board(['/work/video/ep01/project.json'], 2)),
      loadProject,
      mediaUrl: () => undefined,
      canOpenInSidebar: true,
      openInSidebar: () => true,
      openFile: async () => {},
      showInFolder: async () => {},
      isLoopback: true,
      t,
    } as VideoStudioProps
    rerender(<StudioView {...props} />)
    await waitFor(() => { expect(loadProject).toHaveBeenCalledTimes(3) })
  })

  it('reports missing, malformed, and unreadable projects', async () => {
    harness({ load: async () => undefined })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['studio.error.missing'])
    cleanup()
    harness({ load: async () => { throw new StudioReadError('bad', 'invalid') } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en['studio.error.invalid'])
    cleanup()
    harness({ load: async () => { throw new Error('disk') } })
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent', en['studio.error.read'].replace('{message}', 'disk'))
  })

  it('hands the selected media to the sidebar and reports a refused handoff', async () => {
    const { openInSidebar } = harness()
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.openSidebar'] }))
    expect(openInSidebar).toHaveBeenCalledWith('shots/s01.mp4')
    cleanup()
    harness({ openInSidebar: () => false })
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.openSidebar'] }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent', en['studio.action.failed'].replace('{message}', en['studio.action.unavailable']))
  })

  it('marks a media file without stat metadata as missing', async () => {
    const missing: StudioProject = {
      ...PROJECT,
      media: [{ path: 'out/ep01.mp4', kind: 'video' }],
    }
    harness({ project: missing })
    await screen.findByText('Episode One')
    expect(screen.getByText(en['studio.preview.missing'])).toBeTruthy()
  })
})

describe('video studio board states', () => {
  it('renders without a discovery snapshot as the empty state', () => {
    const props = {
      useConversation: (selector: (state: { views: Map<string, unknown> }) => unknown) => selector({ views: new Map() }),
      loadProject: vi.fn(),
      mediaUrl: () => undefined,
      canOpenInSidebar: false,
      openInSidebar: () => false,
      openFile: async () => {},
      showInFolder: async () => {},
      isLoopback: false,
      t,
    } as VideoStudioProps
    render(<StudioView {...props} />)
    expect(screen.getByText(en['studio.empty.title'])).toBeTruthy()
  })

  it('shows empty sections, no preview, and an over-budget bar', async () => {
    const over: StudioProject = {
      ...PROJECT,
      shots: [], renders: [], tasks: [], media: [],
      spentCny: 12, ledgerCny: 12, budgetCny: 10,
      updatedAt: '2026-10-01',
    }
    harness({ project: over })
    await screen.findByText('Episode One')
    expect(screen.getByText(en['studio.shots.empty'])).toBeTruthy()
    expect(screen.getByText(en['studio.renders.empty'])).toBeTruthy()
    expect(screen.getByText(en['studio.tasks.empty'])).toBeTruthy()
    expect(screen.getByText(en['studio.preview.empty'])).toBeTruthy()
    expect(screen.getByText(en['studio.budget.over'])).toBeTruthy()
    expect(screen.getByText('Updated 2026-10-01')).toBeTruthy()
  })

  it('handles a zero budget and a read failure that is not an Error', async () => {
    harness({ project: { ...PROJECT, budgetCny: 0, spentCny: 0, ledgerCny: 0 } })
    await screen.findByText('Episode One')
    expect(screen.getByText('0.00 / 0.00 CNY')).toBeTruthy()
    cleanup()
    harness({ load: () => rejecting({ toString: () => 'plain' }) })
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent', en['studio.error.read'].replace('{message}', 'plain'))
  })

  it('selects a keyframe-only shot and ignores a shot with no media', async () => {
    const mixed: StudioProject = {
      ...PROJECT,
      shots: [
        { id: 'k', index: 1, prompt: 'keyframe only', durationSec: 2, status: 'ready', keyframePath: 'shots/s01.png' },
        { id: 'n', index: 2, prompt: 'no media', durationSec: 2, status: 'draft' },
      ],
      media: [PROJECT.media[0]!],
    }
    const { container } = harness({ project: mixed })
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByText('keyframe only'))
    expect(container.querySelector('img')?.getAttribute('src')).toContain('s01.png')
    fireEvent.click(screen.getByText('no media'))
    expect(container.querySelector('img')?.getAttribute('src')).toContain('s01.png')
  })

  it('renders every shot and task state', async () => {
    const states: StudioProject = {
      ...PROJECT,
      shots: [
        { id: 'a', index: 1, prompt: 'draft', durationSec: 1, status: 'draft' },
        { id: 'b', index: 2, prompt: 'ready', durationSec: 1, status: 'ready' },
        { id: 'c', index: 3, prompt: 'generating', durationSec: 1, status: 'generating' },
        { id: 'd', index: 4, prompt: 'failed', durationSec: 1, status: 'failed' },
      ],
      tasks: [
        { id: 'q', provider: 'p', model: 'm', kind: 'video', status: 'queued', submittedAt: 1, outputPath: 'a.mp4' },
        { id: 's', provider: 'p', model: 'm', kind: 'video', status: 'submitted', submittedAt: 2, outputPath: 'b.mp4' },
      ],
      media: [],
    }
    harness({ project: states })
    await screen.findByText('Episode One')
    for (const status of ['draft', 'ready', 'generating', 'failed'] as const) {
      expect(screen.getByText(en[`studio.shot.status.${status}`])).toBeTruthy()
    }
    expect(screen.getByText('video · m · Queued')).toBeTruthy()
    expect(screen.getByText('video · m · Submitted')).toBeTruthy()
  })

  it('switches projects through the selector', async () => {
    const secondPath = '/work/video/ep02/project.json'
    const second = { ...PROJECT, path: secondPath, title: 'Episode Two' }
    const load = vi.fn(async (path: string) => path === secondPath ? second : PROJECT)
    harness({ projects: [PROJECT.path, secondPath], load })
    await screen.findByText('Episode One')
    const select = screen.getByRole('combobox', { name: en['studio.project.label'] }) as HTMLSelectElement
    expect(select.value).toBe(PROJECT.path)
    fireEvent.change(select, { target: { value: secondPath } })
    expect(await screen.findByText('Episode Two')).toBeTruthy()
    expect(load).toHaveBeenLastCalledWith(secondPath, expect.any(AbortSignal))
  })

  it('ignores a settled read after unmount', async () => {
    const deferred = Promise.withResolvers<StudioProject | undefined>()
    const { unmount } = harness({ load: () => deferred.promise })
    expect(screen.getByText(en['studio.loading'])).toBeTruthy()
    unmount()
    deferred.resolve(PROJECT)
    await Promise.resolve()
    cleanup()
    const rejected = Promise.withResolvers<StudioProject | undefined>()
    const second = harness({ load: () => rejected.promise })
    expect(screen.getByText(en['studio.loading'])).toBeTruthy()
    second.unmount()
    rejected.reject(new Error('late'))
    await Promise.resolve()
  })

  it('runs the open and reveal actions on the selected media', async () => {
    const { openFile, showInFolder } = harness()
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.openFile'] }))
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.reveal'] }))
    expect(openFile).toHaveBeenCalledWith('shots/s01.mp4')
    expect(showInFolder).toHaveBeenCalledWith('shots/s01.mp4')
  })

  it('reports an Error and a non-Error action failure', async () => {
    const failing = (openFile: VideoStudioProps['openFile']): void => {
      const props = {
        useConversation: (selector: (state: { views: Map<string, unknown> }) => unknown) =>
          selector(board([PROJECT.path])),
        loadProject: async () => PROJECT,
        mediaUrl: () => undefined,
        canOpenInSidebar: false,
        openInSidebar: () => false,
        openFile,
        showInFolder: async () => {},
        isLoopback: false,
        t,
      } as VideoStudioProps
      render(<StudioView {...props} />)
    }
    failing(async () => { throw new Error('denied') })
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.openFile'] }))
    expect(await screen.findByText(en['studio.action.failed'].replace('{message}', 'denied'))).toBeTruthy()
    cleanup()
    failing(() => catching({ toString: () => 'plain' }))
    await screen.findByText('Episode One')
    fireEvent.click(screen.getByRole('button', { name: en['studio.action.openFile'] }))
    expect(await screen.findByText(en['studio.action.failed'].replace('{message}', 'plain'))).toBeTruthy()
  })

  it('omits sidebar and reveal actions when those surfaces are absent', async () => {
    const props = {
      useConversation: (selector: (state: { views: Map<string, unknown> }) => unknown) =>
        selector(board([PROJECT.path])),
      loadProject: async () => PROJECT,
      mediaUrl: () => undefined,
      canOpenInSidebar: false,
      openInSidebar: () => false,
      openFile: async () => {},
      showInFolder: async () => {},
      isLoopback: false,
      t,
    } as VideoStudioProps
    render(<StudioView {...props} />)
    await screen.findByText('Episode One')
    expect(screen.queryByRole('button', { name: en['studio.action.openSidebar'] })).toBeNull()
    expect(screen.queryByRole('button', { name: en['studio.action.reveal'] })).toBeNull()
    expect(screen.getByRole('button', { name: en['studio.action.openFile'] })).toBeTruthy()
  })
})
