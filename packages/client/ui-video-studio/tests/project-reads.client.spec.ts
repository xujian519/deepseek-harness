/** Studio file reads: sibling paths, document validation, ledger sums, journal states, and media stats. */
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  LEDGER_FILE, StudioReadError, TASKS_FILE, mediaKindOf, parseLedgerTotal, parsePendingTasks,
  parseProjectDocument, readStudioProject, spentCnyOf, storeFilesOf, type StudioRemote,
} from '../src/client/project-reads.ts'

const SESSION = 'session-1' as SessionId

const PROJECT = {
  schemaVersion: 1,
  id: 'ep01',
  title: 'Episode One',
  aspect: '9:16',
  targetSeconds: 30,
  budgetCny: 10,
  shots: [
    {
      id: 's02', index: 2, prompt: 'second', durationSec: 4, status: 'ready',
      clipPath: 'shots/s02.mp4', provider: 'comfyui', model: 'wan2.2-ti2v-5b', costCny: 2,
    },
    { id: 's01', index: 1, prompt: 'first', durationSec: 3, status: 'draft', keyframePath: 'shots/s01.png' },
  ],
  renders: [{ id: 'r1', path: 'out/ep01.mp4', durationSec: 7, costCny: 3, createdAt: '2026-10-01T10:00:00.000Z' }],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
}

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}

function remoteOf(files: Readonly<Record<string, unknown>>, options: {
  readonly failRead?: string
  readonly failStat?: ReadonlySet<string>
} = {}): StudioRemote {
  const readBytes = vi.fn<StudioRemote['readBytes']>(async (_session, path) => {
    if (path === options.failRead) return { ok: false, error: { code: 'workspace-file/io-error', message: 'disk' } } as never
    if (!(path in files)) return { ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } } as never
    const value = files[path]
    return { ok: true, value: {
      data: typeof value === 'string' ? new TextEncoder().encode(value) : bytesOf(value),
      eof: true,
    } } as never
  })
  const stat = vi.fn<StudioRemote['stat']>(async (_session, path) => options.failStat?.has(path) === true
    ? { ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } } as never
    : { ok: true, value: { absolutePath: path, version: 'v1' } } as never)
  return { readBytes, stat }
}

describe('store file paths', () => {
  it('places the ledger and journal beside the project', () => {
    expect(storeFilesOf('/work/video/ep01/project.json')).toEqual({
      ledger: `/work/video/ep01/${LEDGER_FILE}`,
      tasks: `/work/video/ep01/${TASKS_FILE}`,
    })
    expect(storeFilesOf('C:\\work\\video\\ep01\\project.json')).toEqual({
      ledger: `C:\\work\\video\\ep01/${LEDGER_FILE}`,
      tasks: `C:\\work\\video\\ep01/${TASKS_FILE}`,
    })
    expect(storeFilesOf('project.json')).toEqual({ ledger: `/${LEDGER_FILE}`, tasks: `/${TASKS_FILE}` })
  })

  it('classifies previewable media suffixes', () => {
    expect(mediaKindOf('/a/S01.PNG')).toBe('image')
    expect(mediaKindOf('/a/s01.webm')).toBe('video')
    expect(mediaKindOf('/a/s01.wav')).toBeUndefined()
    expect(mediaKindOf('/a/no-suffix')).toBeUndefined()
  })
})

describe('project document parsing', () => {
  it('sorts shots by index and keeps optional fields', () => {
    const parsed = parseProjectDocument(PROJECT)
    expect(parsed.shots.map(shot => shot.id)).toEqual(['s01', 's02'])
    expect(parsed.shots[1]).toMatchObject({ clipPath: 'shots/s02.mp4', costCny: 2 })
    expect(parsed.renders).toEqual([
      { id: 'r1', path: 'out/ep01.mp4', createdAt: '2026-10-01T10:00:00.000Z', durationSec: 7, costCny: 3 },
    ])
  })

  it.each([
    ['not an object', null],
    ['missing title', { ...PROJECT, title: undefined }],
    ['zero target', { ...PROJECT, targetSeconds: 0 }],
    ['negative budget', { ...PROJECT, budgetCny: -1 }],
    ['shots not a list', { ...PROJECT, shots: {} }],
    ['unknown shot status', { ...PROJECT, shots: [{ ...PROJECT.shots[0]!, status: 'done' }] }],
    ['shot without duration', { ...PROJECT, shots: [{ ...PROJECT.shots[0]!, durationSec: undefined }] }],
    ['shot entry not an object', { ...PROJECT, shots: [null] }],
    ['render without path', { ...PROJECT, renders: [{ ...PROJECT.renders[0]!, path: '' }] }],
    ['render entry not an object', { ...PROJECT, renders: [null] }],
  ])('rejects %s', (_name, value) => {
    expect(() => parseProjectDocument(value)).toThrow(StudioReadError)
    try {
      parseProjectDocument(value)
    } catch (error) {
      expect((error as StudioReadError).code).toBe('invalid')
    }
  })
})

describe('ledger and journal parsing', () => {
  it('sums the ledger by task id in fen', () => {
    expect(parseLedgerTotal({ entries: [
      { taskId: 'a', costCny: 0.1 }, { taskId: 'b', costCny: 0.2 }, { taskId: 'a', costCny: 0.1 },
      { taskId: 'bad', costCny: -1 }, { costCny: 1 },
    ] })).toBe(0.3)
    expect(parseLedgerTotal(undefined)).toBe(0)
    expect(parseLedgerTotal({ entries: 'nope' })).toBe(0)
  })

  it('lists only readable pending records', () => {
    const pending = {
      schemaVersion: 1,
      tasks: [
        { task: { id: 't1', provider: 'minimax', model: 'H3', kind: 'video', status: 'running' }, submittedAt: 1, outputPath: 'shots/a.mp4' },
        { task: { id: 't2', provider: 'minimax', model: 'H3', kind: 'video', status: 'succeeded' }, submittedAt: 2, outputPath: 'shots/b.mp4' },
        { task: { id: 't3', provider: 'minimax', model: 'H3', kind: 'video', status: 'running' } },
        { task: 'nope' },
      ],
    }
    expect(parsePendingTasks(pending)).toEqual([
      { id: 't1', provider: 'minimax', model: 'H3', kind: 'video', status: 'running', submittedAt: 1, outputPath: 'shots/a.mp4' },
    ])
    expect(parsePendingTasks(null)).toEqual([])
  })

  it('takes the larger of selected-shot costs and the ledger', () => {
    const shots = parseProjectDocument(PROJECT).shots
    expect(spentCnyOf(shots, 0.5)).toBe(2)
    expect(spentCnyOf(shots, 4.25)).toBe(4.25)
  })
})

describe('project reads', () => {
  const projectPath = '/work/video/ep01/project.json'
  const ledgerPath = `/work/video/ep01/${LEDGER_FILE}`
  const taskPath = `/work/video/ep01/${TASKS_FILE}`

  it('reads the document, ledger, journal, and media metadata', async () => {
    const remote = remoteOf({
      [projectPath]: PROJECT,
      [ledgerPath]: { schemaVersion: 1, entries: [{ taskId: 't1', kind: 'video', model: 'H3', costCny: 2.5, at: 'now' }] },
      [taskPath]: { schemaVersion: 1, tasks: [{ task: { id: 't2', provider: 'minimax', model: 'H3', kind: 'video', status: 'submitted' }, submittedAt: 1, outputPath: 'shots/s02.mp4' }] },
    })
    const resolve = (path: string): string => `/work/${path}`
    const project = await readStudioProject(remote, SESSION, projectPath, resolve)
    expect(project).toMatchObject({
      path: projectPath,
      title: 'Episode One',
      ledgerCny: 2.5,
      spentCny: 2.5,
      tasks: [{ id: 't2', status: 'submitted' }],
    })
    expect(project?.media).toEqual([
      { path: 'shots/s01.png', kind: 'image', absolutePath: '/work/shots/s01.png', version: 'v1' },
      { path: 'shots/s02.mp4', kind: 'video', absolutePath: '/work/shots/s02.mp4', version: 'v1' },
      { path: 'out/ep01.mp4', kind: 'video', absolutePath: '/work/out/ep01.mp4', version: 'v1' },
    ])
  })

  it('keeps a project whose ledger or journal is malformed or absent', async () => {
    const remote = remoteOf({ [projectPath]: PROJECT, [ledgerPath]: '{not json' })
    const project = await readStudioProject(remote, SESSION, projectPath, path => path)
    expect(project?.ledgerCny).toBe(0)
    expect(project?.tasks).toEqual([])
  })

  it('marks a media file the Host cannot stat as missing', async () => {
    const remote = remoteOf({ [projectPath]: PROJECT }, { failStat: new Set(['shots/s02.mp4']) })
    const project = await readStudioProject(remote, SESSION, projectPath, path => path)
    expect(project?.media.find(entry => entry.path === 'shots/s02.mp4')).toEqual({ path: 'shots/s02.mp4', kind: 'video' })
  })

  it('returns undefined for an absent project and reports other read failures', async () => {
    expect(await readStudioProject(remoteOf({}), SESSION, projectPath, path => path)).toBeUndefined()
    await expect(readStudioProject(remoteOf({}, { failRead: projectPath }), SESSION, projectPath, path => path))
      .rejects.toMatchObject({ name: 'StudioReadError', code: 'read' })
  })

  it('reports a failed optional read and skips media with no preview suffix', async () => {
    const withAudio = {
      ...PROJECT,
      renders: [...PROJECT.renders, { id: 'r2', path: 'voice/s01.wav', createdAt: '2026-10-01' }],
    }
    await expect(readStudioProject(
      remoteOf({ [projectPath]: withAudio }, { failRead: ledgerPath }), SESSION, projectPath, path => path,
    )).rejects.toMatchObject({ code: 'read' })
    const remote = remoteOf({ [projectPath]: withAudio, [ledgerPath]: { entries: [] } })
    const project = await readStudioProject(remote, SESSION, projectPath, path => path)
    expect(project?.media.map(entry => entry.path)).toEqual(['shots/s01.png', 'shots/s02.mp4', 'out/ep01.mp4'])
  })

  it('reports non-JSON and non-UTF-8 documents as invalid', async () => {
    await expect(readStudioProject(remoteOf({ [projectPath]: '{oops' }), SESSION, projectPath, path => path))
      .rejects.toMatchObject({ code: 'invalid' })
    const remote: StudioRemote = {
      readBytes: vi.fn(async () => ({ ok: true, value: { data: new Uint8Array([0xff, 0xfe]), eof: true } })) as never,
      stat: vi.fn() as never,
    }
    await expect(readStudioProject(remote, SESSION, projectPath, path => path)).rejects.toMatchObject({ code: 'invalid' })
  })
})
