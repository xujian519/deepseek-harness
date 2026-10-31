// @vitest-environment jsdom
/**
 * Video studio plugin body: the registered view tab, its discovery targets,
 * and the injected Host reads and actions, mounted on a real Cordis Context
 * with the real slot, conversation, and locale services.
 */
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { UiConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as hostApply } from '../src/index.ts'
import { apply, inject as pluginInject } from '../src/client/index.ts'
import type { VideoStudioInjected } from '../src/client/StudioView.tsx'

type InjectedFace = Pick<VideoStudioInjected, keyof VideoStudioInjected>
import { en, zh } from '../src/client/locales.ts'

const SESSION = SessionId('s1')

interface SessionEntry {
  cwd?: string
  retainedBy: Record<string, number>
}

interface SessionsState {
  byId: Record<string, SessionEntry | undefined>
}

type OpenRequest = { path: string; action?: 'reveal' }
type OpenResult = { ok: true } | { ok: false; error: { message: string } }

const PROJECT = {
  schemaVersion: 1,
  id: 'ep01',
  title: 'Episode One',
  aspect: '9:16',
  targetSeconds: 30,
  budgetCny: 10,
  shots: [],
  renders: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
}

interface MountOptions {
  readonly sessions?: SessionsState
  readonly sidebar?: { openResource(address: string): void }
  readonly isLoopback?: boolean
  readonly openWorkspacePath?: (request: OpenRequest) => Promise<OpenResult>
  readonly readBytes?: (sessionId: SessionId, path: string) => Promise<unknown>
  readonly stat?: (sessionId: SessionId, path: string) => Promise<unknown>
}

async function mount(options: MountOptions = {}) {
  const ctx = new Context()
  const slots = new SlotRegistry(ctx)
  new UiConversation(ctx, { binding: () => undefined } as never)
  slots.register({
    name: 'root',
    children: { 'conversation.view': { kind: 'list', scope: 'session' } },
    inject: () => ({}),
  }, (_props: { renderSlot?: unknown }) => null)
  ctx.provide('sessions', {
    list: createSnapshotStore<SessionsState>(options.sessions ?? { byId: { s1: { cwd: '/tmp/w', retainedBy: {} } } }),
  } as never)
  if (options.sidebar !== undefined) ctx.provide('sidebarRight', options.sidebar as never)
  ctx.provide('connection', { isLoopback: options.isLoopback ?? true } as never)
  ctx.provide('configForms', { get: () => stubConfigForm().scope } as never)
  const remoteSession = { openWorkspacePath: options.openWorkspacePath ?? (() => Promise.resolve({ ok: true })) }
  const remoteWorkspaceFiles = {
    readBytes: options.readBytes ?? (async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } })),
    stat: options.stat ?? (async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } })),
  }
  ctx.provide('remote', { $on: () => () => {}, session: remoteSession, workspaceFiles: remoteWorkspaceFiles } as never)
  ctx.provide('remote.session', remoteSession as never)
  ctx.provide('remote.workspaceFiles', remoteWorkspaceFiles as never)
  const locale = await import('@deepseek-ai/dsh-client-locale/client')
  await ctx.plugin({ inject: [...locale.inject], apply: locale.apply }).await()
  const fiber = ctx.plugin({ apply, inject: pluginInject })
  await fiber.await()
  const entry = slots.entries('conversation.view')[0]!
  const face = entry.inject!(SESSION as never) as InjectedFace
  return { ctx, fiber, slots, entry, face }
}

afterEach(() => { vi.restoreAllMocks() })

describe('video studio plugin body', () => {
  it('registers the dictionary, the discovery targets, and the view tab', async () => {
    const { ctx, fiber, slots, entry } = await mount()
    expect(resolveSlotLabel(entry.options.label)).toBe(en['view.video'])
    expect([zh['view.video'], en['view.video']]).toContain(resolveSlotLabel(entry.options.label))
    expect(entry.options.id).toBe('videoProjects')
    expect(entry.options.order).toBe(30)
    expect(entry.locale).toBe('videoStudio')
    expect(ctx.uiConversation.views.entries().map(view => view.target)).toEqual(['videoProjects'])
    expect(ctx.uiConversation.events.entries().map(event => event.kind)).toEqual(['videoProjects'])
    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
  })

  it('reads a project through the session workspace and builds versioned media URLs', async () => {
    const readBytes = vi.fn(async (_session: SessionId, path: string) => path.endsWith('project.json')
      ? { ok: true, value: { data: new TextEncoder().encode(JSON.stringify(PROJECT)), eof: true } }
      : { ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } })
    const { fiber, face } = await mount({ readBytes })
    const project = await face.loadProject('video/ep01/project.json', new AbortController().signal)
    expect(readBytes).toHaveBeenCalledWith(SESSION, '/tmp/w/video/ep01/project.json', {}, expect.any(AbortSignal))
    expect(project).toMatchObject({ path: '/tmp/w/video/ep01/project.json', title: 'Episode One' })
    expect(face.mediaUrl('/tmp/w/shots/a.mp4', 'v1'))
      .toBe('http://localhost:3000/api/file?path=%2Ftmp%2Fw%2Fshots%2Fa.mp4&v=v1')
    vi.spyOn(Node.prototype, 'baseURI', 'get').mockReturnValue('about:blank')
    expect(face.mediaUrl('/tmp/w/shots/a.mp4', 'v1')).toBeUndefined()
    await fiber.dispose()
  })

  it('opens and reveals a media path through the session remote', async () => {
    const openWorkspacePath = vi.fn((_request: OpenRequest): Promise<OpenResult> => Promise.resolve({ ok: true }))
    const { fiber, face } = await mount({ openWorkspacePath })
    await face.openFile('video/ep01/out/a.mp4')
    expect(openWorkspacePath).toHaveBeenLastCalledWith({ path: '/tmp/w/video/ep01/out/a.mp4' })
    await face.showInFolder('video/ep01/out/a.mp4')
    expect(openWorkspacePath).toHaveBeenLastCalledWith({ path: '/tmp/w/video/ep01/out/a.mp4', action: 'reveal' })
    await fiber.dispose()
  })

  it('rejects with the Host message when it refuses to open the path', async () => {
    const openWorkspacePath = vi.fn((): Promise<OpenResult> =>
      Promise.resolve({ ok: false, error: { message: 'no application registered' } }))
    const { fiber, face } = await mount({ openWorkspacePath })
    await expect(face.openFile('a.mp4')).rejects.toThrow('no application registered')
    await fiber.dispose()
  })

  it('hands a media path to the sidebar preview when that surface is mounted', async () => {
    const openResource = vi.fn()
    const { fiber, face } = await mount({ sidebar: { openResource } })
    expect(face.canOpenInSidebar).toBe(true)
    expect(face.openInSidebar('video/ep01/out/a.mp4')).toBe(true)
    expect(openResource).toHaveBeenCalledWith(fileAddressFor(SESSION, '/tmp/w', 'video/ep01/out/a.mp4'))
    await fiber.dispose()
  })

  it('offers no sidebar handoff without that surface and resolves paths without a root', async () => {
    const openWorkspacePath = vi.fn((_request: OpenRequest): Promise<OpenResult> => Promise.resolve({ ok: true }))
    const { fiber, face } = await mount({ sessions: { byId: {} }, openWorkspacePath })
    expect(face.canOpenInSidebar).toBe(false)
    expect(face.openInSidebar('a.mp4')).toBe(false)
    await face.openFile('a.mp4')
    expect(openWorkspacePath).toHaveBeenCalledWith({ path: 'a.mp4' })
    await fiber.dispose()
  })

  it('keeps the host half inert', () => {
    expect(() => { hostApply() }).not.toThrow()
  })
})
