/**
 * videoProjects fold: settled project calls publish their resolved path, media
 * settlements advance the freshness revision, and the session view dedupes
 * paths across turns.
 */
import { describe, expect, it } from 'vitest'
import type { SessionLiveEventEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  ConversationMatch, ConversationNodeDefinition, ConversationStartMatch, ConversationTimelineSnapshot,
  ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  projectPathOfResult, refreshesStudio, videoProjectsDefinition, videoProjectsViewDefinition,
  type VideoProjectsSnapshot, type VideoTurnProjects,
} from '../src/client/video-projects.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] { return [videoProjectsDefinition] }
  fallbackEntry(): ConversationNodeDefinition | undefined { return undefined }
}

interface TimelineSnapshot { readonly timeline: ConversationTimelineSnapshot }

const timelineViewDefinition: ConversationViewDefinition<ConversationViewNode, TimelineSnapshot> = {
  target: 'test',
  create: () => {
    let current: TimelineSnapshot = { timeline: { turnOrder: [], turns: new Map() } }
    return {
      empty: current,
      replace: ({ timeline }) => (current = { timeline }),
      apply: ({ timeline }) => (current = { timeline }),
    }
  },
}

function at(seq: number, type: string, data: unknown): SessionLiveEventEntry {
  return {
    type: 'event',
    event: {
      seq, time: seq * 1_000, type, data,
      ...(type === 'tool/result' ? { surfaceOp: 'append' } : {}),
    } as SessionEvent,
  }
}

function matched(input: SessionLiveEventEntry, role: 'start'): ConversationStartMatch
function matched(input: SessionLiveEventEntry, role: 'update'): ConversationMatch
function matched(input: SessionLiveEventEntry, role: ConversationMatch['role']): ConversationMatch {
  return { event: input.event, role, location: { kind: 'unresolved' } }
}

function call(seq: number, callId: string, name: string, turn = 1): SessionLiveEventEntry {
  return at(seq, 'tool/call', { turn, step: 1, callId, name, arguments: '{}' })
}

function result(
  seq: number, callId: string,
  options: { readonly isError?: boolean; readonly meta?: unknown; readonly turn?: number } = {},
): SessionLiveEventEntry {
  return at(seq, 'tool/result', {
    turn: options.turn ?? 1, step: 1,
    message: { source: { kind: 'tool', callId }, content: [], isError: options.isError ?? false },
    ...options.meta === undefined ? {} : { meta: options.meta },
  })
}

function assembler(entries: readonly SessionLiveEventEntry[]): ConversationNodeAssembler {
  const views = { entries: () => [timelineViewDefinition], fallbackEntry: () => undefined }
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), views)
  value.retainTarget('test')
  value.replaceWindow(entries, false)
  value.flush()
  return value
}

function turnData(value: ConversationNodeAssembler, turn = 1): Readonly<VideoTurnProjects> | undefined {
  const snapshot = value.snapshot('test') as TimelineSnapshot
  return snapshot.timeline.turns.get(turn)?.data.get('videoProjects')
}

function fold(value: ConversationNodeAssembler): VideoProjectsSnapshot {
  const timeline = (value.snapshot('test') as TimelineSnapshot).timeline
  return videoProjectsViewDefinition.create().replace({ nodes: [], timeline })
}

describe('videoProjects discovery', () => {
  it('classifies result metadata and refresh tools', () => {
    expect(projectPathOfResult({ projectPath: '/work/video/a/project.json' })).toBe('/work/video/a/project.json')
    expect(projectPathOfResult({ projectPath: '  ' })).toBeUndefined()
    expect(projectPathOfResult({ projectPath: 3 })).toBeUndefined()
    expect(projectPathOfResult(null)).toBeUndefined()
    expect(refreshesStudio('video_project')).toBe(true)
    expect(refreshesStudio('media')).toBe(true)
    expect(refreshesStudio('video_assemble')).toBe(false)
  })

  it('records the resolved path of a settled project call', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'init', 'video_project'),
      result(3, 'init', { meta: { projectPath: '/work/video/a/project.json' } }),
    ])
    expect(turnData(value)).toEqual({
      projects: [{ path: '/work/video/a/project.json', seq: 3 }],
      revision: 3,
    })
  })

  it('advances the revision without adding a path for media settlements', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'init', 'video_project'),
      result(3, 'init', { meta: { projectPath: '/work/video/a/project.json' } }),
      call(4, 'gen', 'media'),
      result(5, 'gen'),
    ])
    expect(turnData(value)).toEqual({
      projects: [{ path: '/work/video/a/project.json', seq: 3 }],
      revision: 5,
    })
  })

  it('ignores failures, orphan results, unrelated tools, and duplicate paths', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'init', 'video_project'),
      result(3, 'init', { meta: { projectPath: '/work/video/a/project.json' } }),
      call(4, 'fail', 'video_project'),
      result(5, 'fail', { isError: true, meta: { projectPath: '/work/video/b/project.json' } }),
      result(6, 'ghost', { meta: { projectPath: '/work/video/c/project.json' } }),
      call(7, 'assemble', 'video_assemble'),
      result(8, 'assemble'),
      call(9, 'again', 'video_project'),
      result(10, 'again', { meta: { projectPath: '/work/video/a/project.json' } }),
      call(11, 'bare', 'video_project'),
      result(12, 'bare'),
    ])
    expect(turnData(value)).toEqual({
      projects: [{ path: '/work/video/a/project.json', seq: 3 }],
      // The final meta-less project result still settles: it advances freshness
      // even when it names no new path.
      revision: 12,
    })
  })

  it('folds every turn in first-seen order and keeps the highest revision', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'a', 'video_project'),
      result(3, 'a', { meta: { projectPath: '/work/video/a/project.json' } }),
      at(4, 'turn/start', { turn: 2 }),
      call(5, 'b', 'video_project', 2),
      result(6, 'b', { turn: 2, meta: { projectPath: '/work/video/b/project.json' } }),
      call(7, 'a2', 'video_project', 2),
      result(8, 'a2', { turn: 2, meta: { projectPath: '/work/video/a/project.json' } }),
      call(9, 'media', 'media', 2),
      result(10, 'media', { turn: 2 }),
    ])
    expect(fold(value)).toEqual({
      projects: ['/work/video/a/project.json', '/work/video/b/project.json'],
      revision: 10,
    })
  })

  it('publishes only at turn scope', () => {
    const match = matched(at(1, 'turn/start', { turn: 1 }), 'start')
    const start = videoProjectsDefinition.start?.({} as never, match, {} as never)
    const state = start === undefined ? undefined : {
      ...start,
      projects: [{ path: '/work/video/a/project.json', seq: 3 }],
      revision: 3,
    }
    expect(videoProjectsDefinition.buildLocationData?.({ state } as never, 'turn', null)).toEqual({
      kind: 'turn',
      turn: 1,
      key: 'videoProjects',
      value: { projects: [{ path: '/work/video/a/project.json', seq: 3 }], revision: 3 },
    })
    expect(videoProjectsDefinition.buildLocationData?.({ state } as never, 'step', null)).toBeNull()
  })

  it('rejects a start without turn/start', () => {
    const wrong = matched(at(1, 'user', { message: { role: 'user', content: [] } }), 'start')
    expect(() => videoProjectsDefinition.start?.({} as never, wrong, {} as never)).toThrow(/start requires turn\/start/)
  })
})

describe('videoProjects fold edges', () => {
  it('ignores a non-append result and an orphan result without a matching call', () => {
    const replacement = result(9, 'ghost')
    const nonAppend = {
      ...replacement,
      event: {
        ...replacement.event,
        surfaceOp: { op: 'replace', start: 1, end: 1 },
      } as SessionEvent,
    }
    expect(videoProjectsDefinition.match(nonAppend as never)).toBeNull()
    expect(videoProjectsDefinition.match(at(3, 'user/message', {}) as never)).toBeNull()
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      nonAppend,
      result(11, 'orphan'),
    ])
    expect(turnData(value)).toEqual({ projects: [], revision: 0 })
  })

  it('leaves the state unchanged for an orphan or unrelated result', () => {
    const state = { turn: 1, calls: new Map(), projects: [], revision: 0 }
    const orphan = matched(result(4, 'ghost'), 'update')
    expect(videoProjectsDefinition.update?.({ state } as never, orphan)).toBe(state)
    const other = matched(at(6, 'user/message', {}), 'update')
    expect(videoProjectsDefinition.update?.({ state } as never, other)).toBe(state)
    const unrelated = {
      ...state,
      calls: new Map([['assemble', { name: 'video_assemble' }]]),
    }
    const assembled = matched(result(5, 'assemble'), 'update')
    expect(videoProjectsDefinition.update?.({ state: unrelated } as never, assembled)).toBe(unrelated)
  })

  it('folds an empty window and keeps a media-only revision', () => {
    const emptyTimeline = assembler([at(1, 'turn/start', { turn: 1 })])
    const timeline = (emptyTimeline.snapshot('test') as TimelineSnapshot).timeline
    const builder = videoProjectsViewDefinition.create()
    expect(builder.replace({ nodes: [], timeline })).toEqual({ projects: [], revision: 0 })
    expect(builder.apply({ upserts: [], timeline })).toEqual({ projects: [], revision: 0 })
    // A turn that published other data contributes nothing.
    const other = {
      turnOrder: [1],
      turns: new Map([[1, { data: new Map([['other', {}]]) }]]),
    } as never
    expect(builder.replace({ nodes: [], timeline: other })).toEqual({ projects: [], revision: 0 })

    const mediaOnly = assembler([
      at(1, 'turn/start', { turn: 1 }),
      call(2, 'media', 'media'),
      result(3, 'media'),
    ])
    expect(fold(mediaOnly)).toEqual({ projects: [], revision: 3 })
  })
})
