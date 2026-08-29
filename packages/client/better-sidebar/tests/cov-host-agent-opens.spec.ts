/**
 * `sidebar_open` host coverage for the delivery registry's queue/view
 * lifecycle (queue without views, first-view attach with and without a
 * queued replay, subscriber disposal) and the target classifier's odd
 * shapes (a path under a regular file, a filesystem root). Complements
 * agent-opens.spec.ts, which owns the tool's acceptance contract.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentOpenRegistry, registerOpenTool, type AgentOpenRequest } from '../src/agent-opens.ts'
import type { Context } from '../src/context-types.ts'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'

/** Mount the open tool against a fake tools service; return the definition. */
function mountOpenTool(
  registry: AgentOpenRegistry,
  readPrefs: () => Record<string, unknown> = () => ({ tabsEnabled: {} }),
): ToolDefinition {
  let captured: ToolDefinition | undefined
  const ctx = {
    tools: { register: (tool: unknown) => { captured = tool as ToolDefinition; return () => {} } },
  } as unknown as Context
  registerOpenTool(ctx, registry, async () => '/tmp', readPrefs as never)
  if (captured === undefined) throw new Error('sidebar_open was not registered')
  return captured
}

/** A minimal ToolRunContext bound to one session. */
function exec(sessionId: string): ToolRunContext {
  return { signal: { throwIfAborted: () => {}, aborted: false }, agent: { session: { id: sessionId } } } as unknown as ToolRunContext
}

describe('AgentOpenRegistry queue and view lifecycle', () => {
  it('queues opens with no attached view and replays them on the first attach', () => {
    const registry = new AgentOpenRegistry()
    const delivered: AgentOpenRequest[] = []
    // No views: the open stays queued.
    const first = registry.enqueue('s1', 'file', '/tmp/a.ts', 'a.ts')
    expect(first.delivered).toBe(false)
    // First attach: the queue replays and drains.
    const unsubscribe = registry.attach('s1', request => delivered.push(request))
    expect(delivered).toHaveLength(1)
    expect(delivered[0]!.id).toBe(first.id)
    // A second attach with an empty queue receives nothing new.
    const secondView: AgentOpenRequest[] = []
    const unsubscribe2 = registry.attach('s1', request => secondView.push(request))
    expect(secondView).toHaveLength(0)
    // With a view attached, the next open is consumed on send.
    const second = registry.enqueue('s1', 'url', 'https://example.com', 'example.com')
    expect(second.delivered).toBe(true)
    expect(delivered).toHaveLength(2)
    expect(secondView).toHaveLength(1)
    unsubscribe2()
    unsubscribe()
    // All views gone: the next open queues again.
    const third = registry.enqueue('s1', 'folder', '/tmp/docs', 'docs')
    expect(third.delivered).toBe(false)
    registry.dispose()
  })

  it('drops the queued requests when the feature is turned off (drainAll)', () => {
    const registry = new AgentOpenRegistry()
    registry.enqueue('s1', 'file', '/tmp/a.ts', 'a.ts')
    registry.drainAll()
    const delivered: AgentOpenRequest[] = []
    registry.attach('s1', request => delivered.push(request))
    expect(delivered).toEqual([])
  })

  it('keeps the queue per session', () => {
    const registry = new AgentOpenRegistry()
    const s1: AgentOpenRequest[] = []
    registry.enqueue('s1', 'file', '/tmp/a.ts', 'a.ts')
    registry.enqueue('s2', 'file', '/tmp/b.ts', 'b.ts')
    registry.attach('s1', request => s1.push(request))
    expect(s1).toHaveLength(1)
    expect(s1[0]!.sessionId).toBe('s1')
    registry.dispose()
  })
})

describe('sidebar_open classifier edges', () => {
  it('reports a path under a regular file as a generic failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-opens-'))
    writeFileSync(join(dir, 'plain'), 'x')
    try {
      const tool = mountOpenTool(new AgentOpenRegistry())
      // stat() below a regular file fails with ENOTDIR — neither ENOENT nor
      // EACCES — so the generic "cannot open" branch reports it.
      await expect(tool.execute({ target: join(dir, 'plain', 'child.txt') }, exec('s1'))).rejects.toThrow(/cannot open/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names a filesystem root folder with the raw path when the basename is empty', async () => {
    const registry = new AgentOpenRegistry()
    const tool = mountOpenTool(registry)
    const result = await tool.execute({ target: '/' }, exec('s1')) as { kind: string; target: string; title: string; delivered: boolean }
    expect(result.kind).toBe('folder')
    expect(result.target).toBe('/')
    expect(result.title).toBe('/')
    expect(result.delivered).toBe(false)
  })

  it('reports a disabled editor tab instead of queueing the open', async () => {
    const registry = new AgentOpenRegistry()
    const tool = mountOpenTool(registry, () => ({ tabsEnabled: { editor: false } }))
    await expect(tool.execute({ target: '/' }, exec('s1'))).rejects.toThrow(/editor tab is disabled/)
  })
})

describe('sidebar_open render projections', () => {
  it('renders the delivered and queued outcomes differently', () => {
    const tool = mountOpenTool(new AgentOpenRegistry())
    const render = tool.output?.render?.bind(tool.output)
    if (render === undefined) throw new Error('sidebar_open has no render')
    const delivered = render({}, { kind: 'file', target: '/tmp/a.ts', title: 'a.ts', delivered: true })
    expect(delivered).toEqual([{ type: 'text', text: 'Opened file "a.ts" (/tmp/a.ts) in the sidebar.' }])
    const queued = render({}, { kind: 'url', target: 'https://example.com', title: 'example.com', delivered: false })
    expect((queued[0] as { text: string }).text).toContain('the session sidebar is not connected yet')
  })
})
