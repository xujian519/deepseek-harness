/**
 * WorkspaceStore semantics: persistence round-trip, DSH projection, fork
 * lineage and dedupe, removal cascade, and the v1–v4 migrations.
 */
import { describe, expect, it, vi } from 'vitest'
import { utimesSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@deepseek-ai/dsh-session'
import { WorkspaceStore, type SessionRow } from '../src/store.ts'

function tempFile(prefix: string): string {
  return join(tmpdir(), `${prefix}-s6iw2-9kb1-${Math.random().toString(36).slice(2)}`)
}

function session(id: string, events: unknown[], header: Record<string, unknown> = {}): Session {
  return {
    id,
    header: { version: 0, id, createdAt: 0, ...header },
    firstLiveSeq: 0,
    events,
    snapshotEvents: () => events,
    seq: events.length,
  } as unknown as Session
}

describe('WorkspaceStore', () => {
  it('persists a manual workspace, a DSH-linked thread, and a message', async () => {
    const dataFile = tempFile('dsh-synapse-store')
    const store = new WorkspaceStore(dataFile)
    const workspace = await store.create('调研 DSH 插件')
    const thread = await store.createThread(workspace.id, { title: 'DSH 会话', dshSessionId: 'session-1' })
    await store.addMessage(thread.id, '确定使用已有 Web Server')

    const reloaded = new WorkspaceStore(dataFile)
    const saved = await reloaded.get(workspace.id)
    expect(saved.title).toBe('调研 DSH 插件')
    expect(saved.threads[0]?.dshSessionId).toBe('session-1')
    expect(saved.threads[0]?.messages[0]?.text).toBe('确定使用已有 Web Server')
    expect(await readFile(dataFile, 'utf8')).toMatch(/"version": ?4/)
  })

  it('projects committed events once, folds tool process, and keeps fork lineage', async () => {
    const store = new WorkspaceStore(tempFile('dsh-synapse-projection'))
    const parent = session('session-parent', [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '分析登录异常' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '我来检查。' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    ])
    await store.projectSession(parent)
    await store.projectEvent(parent, (parent.snapshotEvents()[2] as unknown as Parameters<WorkspaceStore['projectEvent']>[1]))
    const child = session('session-child', [], { parentSession: 'session-parent' })
    ;(child as unknown as { firstLiveSeq: number }).firstLiveSeq = 4
    await store.projectSession(child, child.firstLiveSeq)

    const [workspace] = await store.list()
    const graph = await store.get(workspace!.id)
    const parentThread = graph.threads.find(t => t.dshSessionId === 'session-parent')
    const childThread = graph.threads.find(t => t.dshSessionId === 'session-child')
    expect(workspace!.title).toBe('DSH 任务')
    expect(parentThread?.messages).toHaveLength(2)
    const assistant = parentThread?.messages.find(m => m.kind === 'assistant')
    expect(assistant?.process).toHaveLength(1)
    expect(assistant?.process?.[0]?.result).toBe('ok')
    expect(childThread?.parentId).toBe(parentThread?.id)
    expect(parentThread?.messages?.some(m => m.sourceSeq === 0)).toBe(true)
    expect(parentThread?.messages?.some(m => m.sourceSeq === 3)).toBe(false)
  })

  it('dedupes the fork race: the branch row and the session/created replay land one node', async () => {
    const store = new WorkspaceStore(tempFile('dsh-synapse-forkrace'))
    const parent = session('session-parent', [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '第一轮' }] } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '第一答' }] } } },
    ], { seedLength: 1 })
    await store.projectSession(parent)
    const [workspace] = await store.list()
    const graph = await store.get(workspace!.id)
    const parentThread = graph.threads.find(t => t.dshSessionId === 'session-parent')
    const child = session('session-child', [], { parentSession: 'session-parent', seedLength: 1 })
    await store.branch(parentThread!.id, { title: '分支问题', dshSessionId: 'session-child' })
    await store.projectSession(child, 8)
    const graph2 = await store.get(workspace!.id)
    expect(graph2.threads.filter(t => t.dshSessionId === 'session-child')).toHaveLength(1)
  })

  it('removal cascades to descendants and hides the session from future projection', async () => {
    const store = new WorkspaceStore(tempFile('dsh-synapse-remove'))
    const root = session('root', [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '根问题' }] } },
    ])
    const child = session('child', [], { parentSession: 'root' })
    await store.projectSession(root)
    await store.projectSession(child, 2)
    const [workspace] = await store.list()
    const graph = await store.get(workspace!.id)
    const rootThread = graph.threads.find(t => t.dshSessionId === 'root')
    await store.removeThread(rootThread!.id)
    // The cascade empties the projection workspace, which then disappears; the
    // archived ids keep it from being re-created by later projection.
    expect((await store.list()).find(w => w.kind === 'dsh')).toBeUndefined()
    await store.projectSession(root)
    expect((await store.list()).find(w => w.kind === 'dsh')).toBeUndefined()
  })

  it('syncSessions creates threads from browser rows and skips blank/hidden ids', async () => {
    const store = new WorkspaceStore(tempFile('dsh-synapse-sync'))
    const rows: SessionRow[] = [
      { id: 'a', cwd: '/tmp/alpha', title: '会话 A' },
      { id: 'b', cwd: '/tmp/alpha', title: '分支 B', parentId: 'a', blank: false },
      { id: 'blank', cwd: '/tmp/alpha', blank: true },
    ]
    const summaries = await store.syncSessions(rows)
    const workspace = summaries.find(s => s.kind === 'dsh')
    const graph = await store.get(workspace!.id)
    expect(graph.threads.map(t => t.dshSessionId).sort()).toEqual(['a', 'b'])
    // removedSessionIds mirrors a DSH-side deletion: the id is absent from
    // the rows and the canvas node goes away; a later sync recreates it.
    const afterRemoval = await store.syncSessions(rows.filter(row => row.id !== 'b'), ['b'])
    const graph2 = await store.get(workspace!.id)
    expect(graph2.threads.map(t => t.dshSessionId)).toEqual(['a'])
    expect(afterRemoval.find(w => w.kind === 'dsh')?.threadCount).toBe(1)
    const again = await store.syncSessions(rows)
    const graph3 = await store.get(workspace!.id)
    expect(graph3.threads.map(t => t.dshSessionId)).toEqual(['a', 'b'])
    expect(again.find(w => w.kind === 'dsh')?.threadCount).toBe(2)
  })

  it('migrates v1 data: flat event lists become one thread and legacy tool cards fold', async () => {
    const dataFile = tempFile('dsh-synapse-v1')
    const store = new WorkspaceStore(dataFile)
    await store.create('旧工作区')
    // hand-write a v1 file
    const v1 = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      workspaces: [{
        id: 'w1',
        title: '旧项目',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        events: [
          { id: 'e1', text: '老问题', at: '2026-01-01T00:00:01.000Z' },
        ],
      }],
    }
    await import('node:fs/promises').then(fs => fs.writeFile(dataFile, JSON.stringify(v1)))
    const reloaded = new WorkspaceStore(dataFile)
    await reloaded.ready
    const summaries = await reloaded.list()
    const graph = await reloaded.get(summaries[0]!.id)
    expect(graph.title).toBe('旧项目')
    expect(graph.threads[0]?.messages[0]?.text).toBe('老问题')
    expect((JSON.parse(await readFile(dataFile, 'utf8')) as { version: number }).version).toBe(4)
  })

  it('rejects malformed input loudly and clamps positions', async () => {
    const store = new WorkspaceStore(tempFile('dsh-synapse-valid'))
    await expect(store.create('')).rejects.toThrow('不能为空')
    const workspace = await store.create('板')
    // Out-of-range coordinates clamp instead of failing; a non-finite pair fails.
    const thread = await store.createThread(workspace.id, { title: '节点', position: { x: 99999, y: -99999 } })
    expect(thread.position).toEqual({ x: 5000, y: -2000 })
    await store.updateThread(thread.id, { position: { x: 100, y: 100 } })
    const saved = await store.get(workspace.id)
    expect(saved.threads[0]?.position).toEqual({ x: 100, y: 100 })
    await expect(store.createThread(workspace.id, { title: '坏点', position: { x: Number.NaN, y: 1 } })).rejects.toThrow('坐标')
  })

  it('adopts disk state instead of clobbering when another instance wrote the file', async () => {
    const dataFile = tempFile('dsh-synapse-conflict')
    const store = new WorkspaceStore(dataFile)
    await store.create('本实例板')
    // Simulate a second instance: rewrite the file with different state and a
    // newer mtime (force a distinct mtime; a same-ms write would not collide).
    await writeFile(dataFile, JSON.stringify({ version: 4, hiddenSessionIds: [], workspaces: [{ id: 'w-ext', kind: 'manual', cwd: null, title: '外部板', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', threads: [] }] }), 'utf8')
    const now = new Date()
    utimesSync(dataFile, now, new Date(now.getTime() + 2000))
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await store.create('本实例增量') // save() detects the external write
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('已重载磁盘状态'))
    warn.mockRestore()
    const summaries = await new WorkspaceStore(dataFile).list()
    expect(summaries.map(w => w.title)).toEqual(['外部板'])
  })
})
