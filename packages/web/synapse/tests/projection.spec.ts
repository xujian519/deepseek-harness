/**
 * Pure projection helpers: event → card mapping, runtime-context filtering,
 * title/cwd heuristics, and blank detection.
 */
import { describe, expect, it } from 'vitest'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  contentText,
  isRuntimeContextText,
  projectableEvent,
  sessionCwd,
  sessionIsBlank,
  sessionLiveStart,
  sessionTitle,
  titleFromText,
  workspaceTitle,
} from '../src/projection.ts'

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
      { content: [{ type: 'text', text: 'Current runtime context.' }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } },
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

describe('contentText', () => {
  it('flattens text, tool-call, and nested tool-result blocks', () => {
    const blocks = [
      { type: 'text', text: '第一段' },
      { type: 'tool-call', name: 'bash', arguments: '{}' },
      { type: 'tool-result', content: [{ type: 'text', text: '结果' }] },
    ] as never[]
    const text = contentText(blocks)
    expect(text).toContain('第一段')
    expect(text).toContain('bash')
    expect(text).toContain('结果')
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
    expect(sessionTitle(titled.events as never[])).toBe('标题二')
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
