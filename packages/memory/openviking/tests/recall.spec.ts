/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access,
   typescript/no-unsafe-call, typescript/no-unsafe-return, typescript/no-unsafe-argument,
   typescript/unbound-method -- Vitest mocks are structurally untyped dynamic shapes;
   only the executed code paths are asserted. */

import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

import { MemoryRecall } from '../src/memory-recall.ts'
import { RepoContext } from '../src/repo-context.ts'
import { StartupMap } from '../src/startup-map.ts'
import type { AutoRecallConfig, RepoContextConfig } from '../src/config.ts'

const RECALL: AutoRecallConfig = {
  enabled: true, limit: 6, scoreThreshold: 0.15, maxContentChars: 500,
  tokenBudget: 2000, agentSpaces: true, refreshSteps: 0, startupMapEveryTurns: 5,
}

function recallConfig(overrides: Partial<AutoRecallConfig> = {}): () => AutoRecallConfig {
  return () => ({ ...RECALL, ...overrides })
}

function agent(id = 'a1'): Agent {
  return { id } as never as Agent
}

function userMessage(text: string, _seq = 1): UserMessage {
  return { content: [{ type: 'text', text }], source: { kind: 'user' } } as UserMessage
}

const logger: Logger = { info: vi.fn(), warn: vi.fn() } as never

function memory(uri: string, abstract: string, score = 0.9): { context_type: 'memory'; uri: string; level: number; score: number; abstract: string } {
  return { context_type: 'memory', uri, level: 0, score, abstract }
}

import type { FindResult, TreeNode } from '../src/client.ts'

const EMPTY_RESULT: FindResult = { memories: [], resources: [], skills: [], total: 0 }

type FindParams = { query: string; targetUri: string; limit: number; scoreThreshold?: number }
type FindCall = (params: FindParams, options: { signal?: AbortSignal }) => Promise<FindResult>
type TreeCall = (uri: string, options: { nodeLimit?: number; levelLimit?: number; signal?: AbortSignal }) => Promise<TreeNode[]>
type StatsCall = (signal?: AbortSignal) => Promise<{ total_memories: number; by_category: Record<string, number> }>

function mockClient() {
  const find = vi.fn<FindCall>(async () => EMPTY_RESULT)
  const tree = vi.fn<TreeCall>(async () => [])
  const memoryStats = vi.fn<StatsCall>(async () => ({ total_memories: 0, by_category: {} }))
  const client = { find, tree, memoryStats } as never
  return { client, find, tree, memoryStats }
}

const signal = () => new AbortController().signal

describe('MemoryRecall', () => {
  it('is a no-op when disabled', async () => {
    const { client, find } = mockClient()
    const recall = new MemoryRecall(client, recallConfig({ enabled: false }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('what do I know about xyz')], signal())
    expect(find).not.toHaveBeenCalled()
    expect(recall.renderContext('a1')).toBe('')
  })

  it('stages a block from user + agent space searches', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async ({ targetUri }: { targetUri: string }) => ({
      memories: [memory(targetUri === 'viking://agent/' ? 'viking://agent/cases/c1' : 'viking://user/memories/preferences/w', 'A preference', 0.77)],
      resources: [], skills: [], total: 1,
    }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('what are my preferences? long enough')], signal())
    expect(find).toHaveBeenCalledTimes(2)
    const block = recall.renderContext('a1')
    expect(block).toContain('<relevant-memories>')
    expect(block).toContain('viking://agent/cases/c1')
    expect(recall.userTurnCount('a1')).toBe(1)
  })

  it('skips undefined slots and ignores short queries', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('au2'), 1, [userMessage('real query here'), undefined as never], signal())
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('skips agent space when disabled and ignores short queries', async () => {
    const { client, find } = mockClient()
    const recall = new MemoryRecall(client, recallConfig({ agentSpaces: false }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('hi')], signal())
    await recall.prepareStep(agent(), 1, [{ content: [{ type: 'text', text: 'ignored' }], source: { kind: 'plugin', plugin: 'x' } } as UserMessage], signal())
    expect(find).not.toHaveBeenCalled()
  })

  it('does not re-search the same query within one message', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [memory('viking://user/memories/x.md', 'X')], resources: [], skills: [], total: 1 }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('tell me about my project setup')], signal())
    await recall.prepareStep(agent(), 2, [userMessage('tell me about my project setup')], signal())
    expect(find).toHaveBeenCalledTimes(2)
    expect(recall.userTurnCount('a1')).toBe(1)
    expect(recall.renderContext('a1')).toContain('X')
  })

  it('caps items by limit, per-item chars, and the total budget', async () => {
    const { client } = mockClient()
    const items = Array.from({ length: 20 }, (_v, index) =>
      memory(`viking://user/memories/m${index}.md`, 'long abstract '.repeat(50), 0.5 + index * 0.001))
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async () => ({ memories: items, resources: [], skills: [], total: 20 }))
    const recall = new MemoryRecall(client, recallConfig({ limit: 3, maxContentChars: 100, tokenBudget: 2 }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('show me everything about the long project')], signal())
    const block = recall.renderContext('a1')
    expect(block.split('\n').filter(line => line.startsWith('- [memory]'))).toHaveLength(1)
  })

  it('dedupes already-shown URIs on a mid-message refresh', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [memory('viking://user/memories/one.md', 'first', 0.9)], resources: [], skills: [], total: 1 }))
    const recall = new MemoryRecall(client, recallConfig({ refreshSteps: 2, limit: 6 }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('how do I recover from a failure here')], signal())
    expect(recall.renderContext('a1')).toContain('one.md')
    find.mockImplementation(async () => ({ memories: [memory('viking://user/memories/two.md', 'second', 0.8)], resources: [], skills: [], total: 2 }))
    await recall.prepareStep(agent(), 3, [userMessage('how do I recover from a failure here')], signal())
    const block = recall.renderContext('a1')
    expect(block).toContain('two.md')
    expect(block).not.toContain('one.md')
  })

  it('runs the procedure lane for procedural queries and reserves the winner', async () => {
    const { client, find, tree } = mockClient()
    find.mockImplementation(async ({ targetUri }: { targetUri: string }) => ({
      memories: targetUri.startsWith('viking://user/memories/playbooks')
        ? [memory('viking://user/memories/playbooks/recovery.md', 'The recovery playbook', 0.4)]
        : [memory('viking://user/memories/events/e1.md', 'An event', 0.99)],
      resources: [], skills: [], total: 1,
    }))
    tree.mockImplementation(async () => [{ path: 'viking://user/memories/playbooks/', type: 'dir', children: [{ path: 'viking://user/memories/playbooks/recovery.md', type: 'file' }] }])
    const recall = new MemoryRecall(client, recallConfig({ limit: 2 }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('what are the steps to recover from a failed migration?')], signal())
    expect(tree).toHaveBeenCalledTimes(1)
    const block = recall.renderContext('a1')
    expect(block.indexOf('recovery.md')).toBeLessThan(block.indexOf('e1.md'))
  })

  it('never fails the step when procedure branches time out', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [{ path: 'viking://user/memories/playbooks/', type: 'dir' }])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/playbooks/') return new Promise(() => {})
      return { memories: [memory('viking://user/memories/events/e.md', 'Event', 0.9)], resources: [], skills: [], total: 1 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('how do I audit my steps to recover?')], signal())
    expect(recall.renderContext('a1')).toContain('events/e.md')
  })

  it('clears state on forget and keeps the block across a no-hit query', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [memory('viking://user/memories/pref.md', 'Pref', 0.7)], resources: [], skills: [], total: 1 }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('about preferences and habits')], signal())
    const block = recall.renderContext('a1')
    find.mockImplementation(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    await recall.prepareStep(agent(), 1, [userMessage('about zzz unknown noise topic')], signal())
    expect(recall.renderContext('a1')).toBe(block)
    expect(recall.userTurnCount('a1')).toBe(2)
    recall.forget('a1')
    expect(recall.renderContext('a1')).toBe('')
  })
})

describe('RepoContext', () => {
  const repoConfig = (enabled = true, cacheTtlMs = 60000): (() => RepoContextConfig) => () => ({ enabled, cacheTtlMs })

  it('contributes nothing when disabled or empty', async () => {
    const { client, tree: treeSpy } = mockClient()
    const repo = new RepoContext(client, repoConfig(false), logger)
    await repo.refresh()
    expect(treeSpy).not.toHaveBeenCalled()
    expect(repo.prompt()).toBe('')
  })

  it('lists indexed resources with TTL caching', async () => {
    const { client, tree: treeSpy } = mockClient()
    treeSpy.mockImplementation(async () => [
      { name: 'docs', path: 'viking://resources/docs/', type: 'dir' },
      { name: 'api', path: 'viking://resources/api/', type: 'dir' },
    ])
    const repo = new RepoContext(client, repoConfig(), logger)
    await repo.refresh()
    await repo.refresh()
    expect(treeSpy).toHaveBeenCalledTimes(1)
    expect(repo.prompt()).toContain('docs/')
    expect(repo.prompt()).toContain('api/')
  })

  it('keeps the last successful cache when refresh fails', async () => {
    const { client, tree: treeSpy } = mockClient()
    treeSpy.mockResolvedValueOnce([{ name: 'docs', path: 'viking://resources/docs/', type: 'dir' }])
      .mockRejectedValueOnce(new Error('down'))
    const repo = new RepoContext(client, repoConfig(), logger)
    await repo.refresh()
    await repo.refresh()
    expect(repo.prompt()).toContain('docs/')
  })
})

describe('StartupMap', () => {
  it('renders nothing until a refresh; then category counts; stays fresh on failure', async () => {
    const { client, memoryStats } = mockClient()
    const map = new StartupMap(client)
    expect(map.prompt()).toBe('')
    memoryStats.mockResolvedValueOnce({ total_memories: 7, by_category: { preferences: 3, events: 4 } })
    await map.refresh()
    expect(map.prompt()).toContain('preferences: 3')
    expect(map.prompt()).toContain('total: 7')
    memoryStats.mockRejectedValueOnce(new Error('down'))
    await expect(map.refresh()).rejects.toThrow('down')
    expect(map.prompt()).toContain('preferences: 3')
  })

  it('renders the empty placeholder for an empty library', async () => {
    const { client } = mockClient()
    const map = new StartupMap(client)
    await map.refresh()
    expect(map.prompt()).toContain('(empty)')
  })
})

describe('MemoryRecall edge paths', () => {
  it('gives up silently when the signal aborts mid-search', async () => {
    const { client, find } = mockClient()
    find.mockImplementation((_query: unknown, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => { reject(new Error('aborted'))  }, { once: true })
    }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    const controller = new AbortController()
    const pending = recall.prepareStep(agent(), 1, [userMessage('some long query about events')], controller.signal)
    controller.abort()
    await pending
    expect(recall.renderContext('a1')).toBe('')
  })

  it('logs and continues when a space search rejects', async () => {
    const { client } = mockClient()
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async () => { throw new Error('space down') })
    const info = vi.fn()
    const recall = new MemoryRecall(client, recallConfig(), { info, warn: vi.fn() } as never)
    await recall.prepareStep(agent(), 1, [userMessage('remember anything about my long memory?')], signal())
    expect(info).toHaveBeenCalledTimes(2)
    expect(recall.renderContext('a1')).toBe('')
  })

  it('picks resource or skill hits as procedure winners and tolerates empty branches', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/playbooks/') {
        return { memories: [], resources: [{ context_type: 'resource', uri: 'viking://user/memories/playbooks/a.md', level: 0, score: 0.6, abstract: 'Resource playbook' }], skills: [], total: 1 }
      }
      return { memories: [], resources: [], skills: [{ context_type: 'skill', uri: 'viking://agent/skills/s.md', level: 0, score: 0.5, abstract: 'Skill playbook' }], total: 1 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('list the steps to run the migration recovery plan')], signal())
    const block = recall.renderContext('a1')
    expect(block).toContain('playbooks/a.md')
  })

  it('handles a procedure branch tree read failure', async () => {
    const { client, tree } = mockClient()
    tree.mockRejectedValueOnce(new Error('tree down'))
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent(), 1, [userMessage('tell me the audit and recovery steps, please')], signal())
    expect(recall.renderContext('a1')).toBe('')
  })

  it('breaks on the item limit before the budget when the limit binds first', async () => {
    const { client } = mockClient()
    const items = Array.from({ length: 5 }, (_v, index) => memory(`viking://x/m${index}.md`, 'short', 0.9 - index * 0.1))
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async () => ({ memories: items, resources: [], skills: [], total: 5 }))
    const recall = new MemoryRecall(client, recallConfig({ limit: 2, maxContentChars: 500, tokenBudget: 2000 }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('about my project events and files')], signal())
    const block = recall.renderContext('a1')
    expect(block.split('\n').filter(line => line.startsWith('- [memory]'))).toHaveLength(2)
  })

  it('keeps the previous block when a mid-message refresh has no new hits', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [memory('viking://user/memories/p.md', 'P', 0.8)], resources: [], skills: [], total: 1 }))
    const recall = new MemoryRecall(client, recallConfig({ refreshSteps: 2 }), logger)
    await recall.prepareStep(agent(), 1, [userMessage('about the process and steps to do this')], signal())
    const before = recall.renderContext('a1')
    find.mockImplementation(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    await recall.prepareStep(agent(), 4, [userMessage('about the process and steps to do this')], signal())
    expect(recall.renderContext('a1')).toBe(before)
    expect(recall.userTurnCount('a1')).toBe(1)
  })
})

describe('MemoryRecall targeted branch coverage', () => {
  it('agent space search runs when enabled (explicit)', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    const recall = new MemoryRecall(client, recallConfig({ agentSpaces: true }), logger)
    await recall.prepareStep(agent('ag'), 1, [userMessage('query about the agent workspace')], signal())
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('returns an empty procedure list when branches return no hits', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/playbooks/') return { memories: [], resources: [], skills: [], total: 0 }
      return { memories: [memory('viking://user/memories/events/e.md', 'Event', 0.9)], resources: [], skills: [], total: 1 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('ag2'), 1, [userMessage('follow the audit and recovery steps now')], signal())
    expect(recall.renderContext('ag2')).toContain('events/e.md')
  })
})

describe('MemoryRecall final branches', () => {
  it('searches only the user space when agentSpaces is off', async () => {
    const { client, find } = mockClient()
    find.mockImplementation(async () => ({ memories: [], resources: [], skills: [], total: 0 }))
    const recall = new MemoryRecall(client, recallConfig({ agentSpaces: false }), logger)
    await recall.prepareStep(agent('au'), 1, [userMessage('remember anything useful about my long running project tasks?')], signal())
    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ targetUri: 'viking://user/memories/' }), expect.anything())
  })

  it('picks the highest-scoring procedure candidate among several branches', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
      { path: 'viking://user/memories/方法/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/') return { memories: [memory('viking://u/p.md', 'low', 0.2)], resources: [], skills: [], total: 1 }
      if (targetUri === 'viking://agent/') return { memories: [], resources: [], skills: [], total: 0 }
      if (targetUri === 'viking://user/memories/playbooks/') return { memories: [memory('viking://u/p.md', 'low', 0.4)], resources: [], skills: [], total: 1 }
      return { memories: [memory('viking://u/f.md', 'high', 0.6)], resources: [], skills: [], total: 1 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('ab'), 1, [userMessage('walk me through the audit and recovery flow please')], signal())
    const block = recall.renderContext('ab')
    expect(block).toContain('f.md')
    expect(block).toContain('p.md')
    expect(block).toContain('high')
  })
})

describe('MemoryRecall last binary path', () => {
  it('keeps the best candidate when a later branch scores lower', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
      { path: 'viking://user/memories/方法/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/') return { memories: [], resources: [], skills: [], total: 0 }
      if (targetUri === 'viking://agent/') return { memories: [], resources: [], skills: [], total: 0 }
      if (targetUri === 'viking://user/memories/playbooks/') return { memories: [memory('viking://u/high.md', 'high', 0.7)], resources: [], skills: [], total: 1 }
      return { memories: [memory('viking://u/low.md', 'low', 0.3)], resources: [], skills: [], total: 1 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('ac'), 1, [userMessage('show me the audit and recovery flow please')], signal())
    expect(recall.renderContext('ac')).toContain('high.md')
    expect(recall.renderContext('ac')).not.toContain('low.md')
  })
})

describe('MemoryRecall resource/skill chain', () => {
  it('prefers a skill-only procedure branch hit', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/playbooks/') return { memories: [], resources: [], skills: [memory('viking://agent/skills/s.md', 'Skill hit', 0.55) as never], total: 1 }
      return { memories: [], resources: [], skills: [], total: 0 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('ad'), 1, [userMessage('give me the procedural audit and recovery runbook please')], signal())
    expect(recall.renderContext('ad')).toContain('s.md')
  })
})

describe('MemoryRecall branch filtering', () => {
  it('skips marker files and non-procedure leaf directories', async () => {
    const { client, tree } = mockClient()
    tree.mockImplementation(async () => [
      { path: 'viking://user/memories/playbooks.md', type: 'file' },
      { path: 'viking://user/memories/events/', type: 'dir' },
      { path: 'viking://user/memories/playbooks/', type: 'dir' },
    ])
    ;(client as { find: ReturnType<typeof vi.fn> }).find = vi.fn(async ({ targetUri }: { targetUri: string }) => {
      if (targetUri === 'viking://user/memories/playbooks/') return { memories: [memory('viking://u/pb.md', 'Found', 0.5)], resources: [], skills: [], total: 1 }
      return { memories: [], resources: [], skills: [], total: 0 }
    })
    const recall = new MemoryRecall(client, recallConfig(), logger)
    await recall.prepareStep(agent('ae'), 1, [userMessage('what is the recovery and audit procedure')], signal())
    expect(tree).toHaveBeenCalledTimes(1)
    expect(recall.renderContext('ae')).toContain('pb.md')
  })
})
