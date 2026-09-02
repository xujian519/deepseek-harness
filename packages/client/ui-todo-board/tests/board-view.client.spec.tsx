// @vitest-environment jsdom
/**
 * BoardView acceptance: the empty board's ghost preview, the three-column
 * grid with per-column counts, card badges that navigate to the owning
 * session, the empty-column dash, and the tag filter (including its reset
 * when the active tag vanishes).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import { SessionId, type SessionId as SessionIdOf } from '@deepseek-ai/dsh-session/types'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { BoardViewInjected } from '../src/client/BoardView.tsx'
import { BoardView } from '../src/client/BoardView.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh, commonZh)

afterEach(cleanup)

const sid = (id: string): SessionIdOf => SessionId(id)
const wid = (id: string): WorkspaceSnapshot['items'][number]['workspaceId'] =>
  SessionId(id) as never

function summary(id: string, todos: readonly TodoItem[] | null | undefined) {
  return {
    id: sid(id),
    displayTitle: `会话 ${id}`,
    running: false,
    blank: false,
    updatedAt: 1,
    ...(todos === undefined ? {} : { projectionValues: { todosLatest: todos } }),
  }
}

function viewProps(
  list: SessionListState,
  workspaces: WorkspaceSnapshot['items'],
  openSession: BoardViewInjected['openSession'],
): Parameters<typeof BoardView>[0] {
  return {
    useSessions: (selector: (state: SessionListState) => unknown) => selector(list),
    useWorkspaces: (selector: (state: WorkspaceSnapshot) => unknown) =>
      selector({ items: workspaces } as WorkspaceSnapshot),
    openSession,
    t,
  } as unknown as Parameters<typeof BoardView>[0]
}

function stateOf(
  entries: ReturnType<typeof summary>[],
  current?: string,
): SessionListState {
  return {
    ids: entries.map(entry => entry.id),
    byId: Object.fromEntries(entries.map(entry => [entry.id as string, entry])),
    current: current === undefined ? undefined : sid(current),
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  } as unknown as SessionListState
}

const WORKSPACES: WorkspaceSnapshot['items'] = [
  {
    workspaceId: wid('w'),
    path: '/tmp/w',
    title: 'w',
    sessionIds: [sid('s1'), sid('s2')],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

const TODO_A: TodoItem[] = [{ content: '起草发布说明', status: 'pending' }]
const MIXED: TodoItem[] = [
  { content: '写组件', status: 'in_progress' },
  { content: '补测试', status: 'completed' },
]
const TAGGED: TodoItem[] = [
  { content: '起草发布说明', status: 'pending', tags: ['docs'] },
  { content: '回归测试', status: 'pending', tags: ['release', 'docs'] },
  { content: '写组件', status: 'in_progress' },
]
const TAGGED_OTHER: TodoItem[] = [
  { content: '回归测试', status: 'pending', tags: ['release'] },
  { content: '写组件', status: 'in_progress' },
]

describe('BoardView', () => {
  it('renders the ghost preview when no scoped session has todos', () => {
    const state = stateOf([summary('s1', null), summary('s2', undefined)], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    expect(screen.getByText('还没有待办')).toBeTruthy()
    // One ghost chip per column, each carrying the shape explanation.
    expect(screen.getAllByTitle('形状预览——下面的卡片只用于示意三列布局；会话真正写入待办后，卡片会落在这里。')).toHaveLength(3)
    expect(screen.getByText('起草发布说明')).toBeTruthy()
    // The ghost carries no card badges (no navigation from preview cards).
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders three counted columns and cards from the todosLatest column', () => {
    const state = stateOf([
      summary('s1', TODO_A),
      summary('s2', MIXED),
    ], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    expect(screen.getByRole('region', { name: '任务看板' })).toBeTruthy()
    expect(screen.getByText('待开始')).toBeTruthy()
    expect(screen.getByText('进行中')).toBeTruthy()
    expect(screen.getByText('已完成')).toBeTruthy()
    expect(screen.getByText('起草发布说明')).toBeTruthy()
    expect(screen.getByText('写组件')).toBeTruthy()
    expect(screen.getByText('补测试')).toBeTruthy()
  })

  it('navigates to the owning session from the card badge', () => {
    const openSession = vi.fn()
    const state = stateOf([
      summary('s1', TODO_A),
      summary('s2', MIXED),
    ], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, openSession)} />)
    fireEvent.click(screen.getByRole('button', { name: '跳转到会话 会话 s2：写组件' }))
    expect(openSession).toHaveBeenCalledWith(sid('s2'))
  })

  it('shows the empty-column dash while one status has no cards', () => {
    const state = stateOf([summary('s1', TODO_A)], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    const dashes = screen.getAllByText('—')
    expect(dashes).toHaveLength(2)
  })

  it('renders card tag chips and a filter bar when tags exist', () => {
    const state = stateOf([summary('s1', TAGGED)], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    expect(screen.getByRole('group', { name: '按标签筛选' })).toBeTruthy()
    // Sorted unique options: All plus docs and release.
    expect(screen.getByRole('button', { name: '全部' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '筛选标签 docs' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '筛选标签 release' })).toBeTruthy()
    // Tag text appears on the tagged cards AND once as each filter option:
    // docs = 2 cards + 1 option, release = 1 card + 1 option.
    expect(screen.getAllByText('docs')).toHaveLength(3)
    expect(screen.getAllByText('release')).toHaveLength(2)
  })

  it('filters cards by the active tag and resets via All or a second click', () => {
    const state = stateOf([summary('s1', TAGGED)], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    fireEvent.click(screen.getByRole('button', { name: '筛选标签 release' }))
    expect(screen.queryByText('写组件')).toBeNull()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText('回归测试')).toBeTruthy()
    // The All reset brings the unfiltered board back.
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText('写组件')).toBeTruthy()
    // Clicking the active tag again also clears the filter.
    fireEvent.click(screen.getByRole('button', { name: '筛选标签 docs' }))
    fireEvent.click(screen.getByRole('button', { name: '筛选标签 docs' }))
    expect(screen.getByText('写组件')).toBeTruthy()
  })

  it('drops a filter whose tag vanished from every card', () => {
    const view = render(<BoardView {...viewProps(stateOf([summary('s1', TAGGED)], 's1'), WORKSPACES, vi.fn())} />)
    fireEvent.click(screen.getByRole('button', { name: '筛选标签 docs' }))
    expect(screen.queryByText('写组件')).toBeNull()
    // The owning list is rewritten without `docs`; the stale selection filters
    // nothing, so every card returns while the remaining tags keep their bar.
    view.rerender(<BoardView {...viewProps(stateOf([summary('s1', TAGGED_OTHER)], 's1'), WORKSPACES, vi.fn())} />)
    expect(screen.getByText('写组件')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '筛选标签 docs' })).toBeNull()
    expect(screen.getByRole('button', { name: '筛选标签 release' })).toBeTruthy()
  })

  it('shows no filter bar while no card carries a tag', () => {
    const state = stateOf([summary('s1', TODO_A), summary('s2', MIXED)], 's1')
    render(<BoardView {...viewProps(state, WORKSPACES, vi.fn())} />)
    expect(screen.queryByRole('group', { name: '按标签筛选' })).toBeNull()
  })
})
