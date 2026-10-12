/**
 * Pure projection helpers: event → card mapping, runtime-context filtering,
 * title/cwd heuristics, and blank detection.
 */
import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  MAX_PROCESS_FIELD_LENGTH,
  MAX_THREAD_MESSAGES,
  MAX_THREAD_PROCESS_MESSAGES,
  canvasFloorSeq,
  clampProjectedText,
  contentText,
  foldToolProcessInto,
  isRuntimeContextText,
  projectableEvent,
  sessionCwd,
  projectHistory,
  retainCanvasCards,
  retainCanvasState,
  sessionIsBlank,
  sessionLiveStart,
  sessionTitle,
  titleFromText,
  workspaceTitle,
} from '../src/projection.ts'
import type { ProjectedMessage, Thread, Workspace, WorkspaceState } from '../src/types.ts'

function event(type: string, data: unknown, seq = 0, time = 1): never {
  return { type, seq, time, data } as never
}

describe('projectableEvent', () => {
  it('projects user questions and assistant answers', () => {
    expect(projectableEvent(event('user/message', { content: [{ type: 'text', text: '你好' }] }))).toEqual({ kind: 'user', text: '你好' })
    const answer = projectableEvent(event('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '回你' }] } }))
    expect(answer).toEqual({ kind: 'assistant', text: '回你' })
  })

  it('projects todo snapshots and turn errors, skips boundaries and chunks', () => {
    const todos = projectableEvent(event('todo/write', { todos: [{ content: '写文档', status: 'completed' }] }))
    expect(todos?.text).toContain('[completed] 写文档')
    const error = projectableEvent(event('turn/end', { turn: 1, reason: { kind: 'error', error: { name: 'Llama', code: 'e1', message: '模型挂了' } } }))
    expect(error?.kind).toBe('error')
    expect(projectableEvent(event('turn/start', { turn: 1 }))).toBeNull()
    expect(projectableEvent(event('assistant/chunk', { turn: 1, step: 1, chunk: { text: 'x' } }))).toBeNull()
  })

  it('never turns the DSH runtime-context snapshot into a question card', () => {
    const text = 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nPolicy details.'
    expect(projectableEvent(event('user/message', { content: [{ type: 'text', text }] }))).toBeNull()
    expect(isRuntimeContextText(text)).toBe(true)
    expect(isRuntimeContextText('你是谁')).toBe(false)
  })

  it('drops injected user-role messages: workspace instructions, skill catalogs, and runtime context', () => {
    const injections = [
      { content: [{ type: 'text', text: '<system-reminder> Instructions' }], source: { kind: 'agent-instructions' } },
      { content: [{ type: 'text', text: 'Current runtime context.' }], source: { kind: 'runtime-context' } },
      { content: [{ type: 'text', text: '<system-reminder> A skill' }], source: { kind: 'skill-catalog' } },
    ]
    for (const data of injections) {
      expect(projectableEvent(event('user/message', data))).toBeNull()
    }
    expect(projectableEvent(event('user/message', {
      content: [{ type: 'text', text: '真正的问题' }],
      source: { kind: 'user' },
    }))).toEqual({ kind: 'user', text: '真正的问题' })
  })

  it('truncates long projections with the detail-view marker', () => {
    const long = 'A'.repeat(9_000)
    const projection = projectableEvent(event('user/message', { content: [{ type: 'text', text: long }] }))
    expect(projection?.text.length).toBeLessThan(8_020)
    expect(projection?.text).toContain('（详情查看全文）')
  })
})

describe('clampProjectedText', () => {
  it('keeps a text within the cap whole and marks a longer one', () => {
    expect(clampProjectedText('短文本', 10)).toBe('短文本')
    expect(clampProjectedText('12345', 3)).toBe('123\n——…（详情查看全文）')
  })
})

describe('foldToolProcessInto', () => {
  it('folds a call and its result into the assistant card, keyed by callId', () => {
    const messages: ProjectedMessage[] = [
      { id: 'm1', kind: 'assistant', text: '答', at: '2026-01-01T00:00:00.000Z', turn: 1, step: 1, process: [] },
    ]
    foldToolProcessInto(messages, event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}' }))
    expect(messages[0]?.process?.[0]).toMatchObject({ callId: 'c1', name: 'bash', arguments: '{"cmd":"pnpm test"}', result: null })
    // A repeated call rewrites the same entry instead of adding one.
    foldToolProcessInto(messages, event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file":"a"}' }))
    expect(messages[0]?.process).toHaveLength(1)
    expect(messages[0]?.process?.[0]?.name).toBe('read')
    foldToolProcessInto(messages, event('tool/result', {
      turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] },
    }))
    expect(messages[0]?.process?.[0]?.result).toBe('ok')
  })

  it('folds an orphan result into the turn card and drops an unmatched event', () => {
    const messages: ProjectedMessage[] = [
      { id: 'm1', kind: 'assistant', text: '答', at: '2026-01-01T00:00:00.000Z', turn: 1, step: 1, process: [] },
    ]
    foldToolProcessInto(messages, event('tool/result', {
      turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'orphan' }, content: [{ type: 'text', text: '顺带' }] },
    }))
    expect(messages[0]?.process?.[0]).toMatchObject({ callId: 'orphan', name: '工具调用', arguments: null, result: '顺带' })
    // No assistant card carries that turn/step: nothing to fold into.
    foldToolProcessInto(messages, event('tool/call', { turn: 9, step: 1, callId: 'c9', name: 'bash', arguments: '{}' }))
    expect(messages[0]?.process).toHaveLength(1)
  })
})

describe('retainCanvasCards', () => {
  function card(index: number, extra: Partial<ProjectedMessage> = {}): ProjectedMessage {
    return { id: `m${index}`, kind: 'assistant', text: `答${index}`, at: '2026-01-01T00:00:00.000Z', sourceSeq: index, ...extra }
  }

  it('drops the oldest cards beyond the window and keeps the rest in order', () => {
    const thread = { messages: Array.from({ length: MAX_THREAD_MESSAGES + 3 }, (_, index) => card(index)) }
    expect(retainCanvasCards(thread)).toBe(true)
    expect(thread.messages).toHaveLength(MAX_THREAD_MESSAGES)
    expect(thread.messages[0]?.sourceSeq).toBe(3)
    expect(thread.messages.at(-1)?.sourceSeq).toBe(MAX_THREAD_MESSAGES + 2)
    // A second pass over an already-windowed thread is a no-op.
    expect(retainCanvasCards(thread)).toBe(false)
    expect(canvasFloorSeq(thread)).toBe(3)
    expect(canvasFloorSeq({ messages: [] })).toBeUndefined()
  })

  it('drops the folded tool process of cards older than the process window', () => {
    const kept = MAX_THREAD_PROCESS_MESSAGES + 2
    const thread = {
      messages: Array.from({ length: kept }, (_, index) => card(index, {
        process: [{ callId: `c${index}`, name: 'bash', arguments: '{}', result: 'ok', error: null }],
      })),
    }
    expect(retainCanvasCards(thread)).toBe(true)
    expect(thread.messages[0]?.process).toBeUndefined()
    expect(thread.messages[1]?.process).toBeUndefined()
    expect(thread.messages.at(-1)?.process).toHaveLength(1)
    expect(retainCanvasCards(thread)).toBe(false)
  })

  it('clamps a surviving process field and leaves one inside the cap whole', () => {
    const long = 'x'.repeat(MAX_PROCESS_FIELD_LENGTH + 5)
    const thread = {
      messages: [card(0, {
        process: [
          { callId: 'c1', name: 'read', arguments: long, result: 'ok', error: null },
          { callId: 'c2', name: 'read', arguments: null, result: null, error: 'X: e' },
        ],
      })],
    }
    expect(retainCanvasCards(thread)).toBe(true)
    expect(thread.messages[0]?.process?.[0]?.arguments).toBe('x'.repeat(MAX_PROCESS_FIELD_LENGTH) + '\n——…（详情查看全文）')
    expect(thread.messages[0]?.process?.[0]?.result).toBe('ok')
    expect(thread.messages[0]?.process?.[1]?.error).toBe('X: e')
    // Nothing left to clamp or drop.
    expect(retainCanvasCards(thread)).toBe(false)
  })
})

describe('retainCanvasState', () => {
  function thread(id: string, count: number): Thread {
    return {
      id,
      title: '会话',
      parentId: null,
      sourceParentSessionId: null,
      sourceSeedLength: null,
      dshSessionId: id,
      dshSessionTitle: null,
      color: '#0f766e',
      position: { x: 0, y: 0 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: Array.from({ length: count }, (_, index) => ({
        id: `${id}-${index}`, kind: 'assistant', text: '答', at: '2026-01-01T00:00:00.000Z', sourceSeq: index,
      })),
    }
  }
  function workspace(kind: Workspace['kind'], count: number): Workspace {
    return {
      id: `w-${kind}`,
      kind,
      cwd: kind === 'dsh' ? '/work' : null,
      title: '板',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [thread(`t-${kind}`, count)],
    }
  }

  it('windows projected workspaces and leaves manual boards untouched', () => {
    const state: WorkspaceState = {
      version: 4,
      hiddenSessionIds: [],
      workspaces: [workspace('dsh', MAX_THREAD_MESSAGES + 5), workspace('manual', MAX_THREAD_MESSAGES + 5)],
    }
    expect(retainCanvasState(state)).toBe(true)
    expect(state.workspaces[0]?.threads[0]?.messages).toHaveLength(MAX_THREAD_MESSAGES)
    // Manual notes are user-authored, not derived: never dropped.
    expect(state.workspaces[1]?.threads[0]?.messages).toHaveLength(MAX_THREAD_MESSAGES + 5)
  })

  it('reports no change for a state already inside the window', () => {
    const state: WorkspaceState = { version: 4, hiddenSessionIds: [], workspaces: [workspace('dsh', 1)] }
    expect(retainCanvasState(state)).toBe(false)
  })
})

describe('contentText', () => {
  it('flattens text and tool-call blocks and drops blank text', () => {
    const blocks = [
      { type: 'text', text: '第一段' },
      { type: 'tool-call', name: 'bash', arguments: '{}' },
      { type: 'text', text: '   ' },
    ] as never[]
    const text = contentText(blocks)
    expect(text).toBe('第一段\nbash\n{}')
  })
})

describe('titles and cwds', () => {
  it('derives a question title and the workspace title from the cwd segment', () => {
    expect(titleFromText('分析登录异常')).toBe('分析登录异常')
    expect(titleFromText(('问').repeat(60))).toMatch(/\.\.\.$/)
    expect(workspaceTitle('/tmp/project-x', 'DSH 任务')).toBe('project-x')
    expect(workspaceTitle('未指定工作目录', 'DSH 任务')).toBe('DSH 任务')
  })

  it('reads session titles from the last session/title event and blank from user messages', () => {
    const titled = {
      events: [
        event('session/title', { title: '标题一' }),
        event('session/title', { title: '标题二' }),
      ],
    }
    expect(sessionTitle(titled.events)).toBe('标题二')
    const blank = [event('turn/start', { turn: 1 })]
    expect(sessionIsBlank(blank)).toBe(true)
    const used = [event('user/message', { content: [{ type: 'text', text: '问' }] })]
    expect(sessionIsBlank(used)).toBe(false)
    expect(sessionLiveStart([event('session/end-seed', {}, 5), event('turn/start', { turn: 1 }, 6)])).toBe(6)
    expect(sessionLiveStart([])).toBe(0)
    expect(sessionCwd({ header: { cwd: '/work/a' } } as unknown as Session)).toBe('/work/a')
    expect(sessionCwd({ header: {} } as unknown as Session)).toBe('未指定工作目录')
  })
})

describe('projectHistory', () => {
  it('keeps the full record: human turns, injected context, tool process, errors', () => {
    const long = 'A'.repeat(9_000)
    const events = [
      { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '问题一' }], source: { kind: 'user' } } },
      { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答一' }] } } },
      { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
      { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
      { type: 'user/message', seq: 4, time: 5, data: { content: [{ type: 'text', text: '<system-reminder> workspace instructions ' + long.slice(0, 500) }], source: { kind: 'agent-instructions' } } },
      { type: 'user/message', seq: 5, time: 6, data: { content: [{ type: 'text', text: '问题二' }], source: { kind: 'user' } } },
      { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'error', error: { name: 'L', code: 'e', message: '模型挂了' } } } },
      { type: 'todo/write', seq: 7, time: 8, data: { todos: [{ content: '写文档', status: 'in_progress' }] } },
    ] as never[]
    const messages = projectHistory(events)
    expect(messages.map(m => m.kind)).toEqual(['user', 'assistant', 'context', 'user', 'error', 'todo'])
    expect(messages[1]?.process?.[0]?.result).toBe('ok')
    expect(messages[2]?.text).toContain('workspace instructions')
    expect(messages[2]?.text.length).toBeGreaterThan(500)
    expect(messages[0]?.text).toBe('问题一')
  })

  it('folds tool results that arrive without a preceding call into the turn card', () => {
    const events = [
      { type: 'assistant/message', seq: 0, time: 1, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '准备' }] } } },
      { type: 'tool/result', seq: 1, time: 2, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'x9' }, content: [{ type: 'text', text: '顺带结果' }] } } },
    ] as never[]
    const messages = projectHistory(events)
    expect(messages[0]?.process?.[0]).toMatchObject({ callId: 'x9', name: '工具调用', result: '顺带结果' })
  })

  it('pages to the most recent limit while keeping the default full record', () => {
    const events = pagingFixture()
    expect(projectHistory(events)).toHaveLength(6)
    const tail = projectHistory(events, { limit: 2 })
    expect(tail.map(m => m.kind)).toEqual(['error', 'todo'])
    const mid = projectHistory(events, { limit: 3 })
    expect(mid.map(m => m.kind)).toEqual(['user', 'error', 'todo'])
  })

  it('pages an older segment with an exclusive beforeSeq that never duplicates the boundary', () => {
    const events = pagingFixture()
    // sourceSeq strictly below 5: seq 0,1,4 (the seq-5 user is excluded).
    const older = projectHistory(events, { beforeSeq: 5 })
    expect(older.map(m => m.kind)).toEqual(['user', 'assistant', 'context'])
    // seq-5 human question is the boundary; the exclusive filter keeps it out.
    expect(older.map(m => m.sourceSeq)).toEqual([0, 1, 4])
    // combined with limit: filter then take the newest two of [0,1,4].
    const page = projectHistory(events, { beforeSeq: 5, limit: 2 })
    expect(page.map(m => m.sourceSeq)).toEqual([1, 4])
  })

  it('keeps tool process folded when the page cuts after the tool turn', () => {
    const events = pagingFixture()
    const page = projectHistory(events, { beforeSeq: 4 })
    // The assistant card carries the tool process folded before the slice.
    expect(page[1]?.process?.[0]?.result).toBe('ok')
  })
})

function pagingFixture(): never[] {
  return [
    { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: '问题一' }], source: { kind: 'user' } } },
    { type: 'assistant/message', seq: 1, time: 2, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: '答一' }] } } },
    { type: 'tool/call', seq: 2, time: 3, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{}' } },
    { type: 'tool/result', seq: 3, time: 4, data: { turn: 1, step: 1, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
    { type: 'user/message', seq: 4, time: 5, data: { content: [{ type: 'text', text: '<system-reminder> instructions' }], source: { kind: 'agent-instructions' } } },
    { type: 'user/message', seq: 5, time: 6, data: { content: [{ type: 'text', text: '问题二' }], source: { kind: 'user' } } },
    { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'error', error: { name: 'L', code: 'e', message: '模型挂了' } } } },
    { type: 'todo/write', seq: 7, time: 8, data: { todos: [{ content: '写文档', status: 'in_progress' }] } },
  ] as never[]
}
