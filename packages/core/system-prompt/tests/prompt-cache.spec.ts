import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { CachedPromptSection, PromptCache, PromptCacheKey } from '@deepseek-ai/dsh-system-prompt/prompt-cache'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'

/** In-memory PromptCache stub: records calls and serves exact-key entries. */
class StubCache implements PromptCache {
  entries = new Map<string, CachedPromptSection[]>()
  getCalls = 0
  setCalls = 0
  invalidateCalls: Array<ScopeKey | undefined> = []

  async get(key: PromptCacheKey): Promise<CachedPromptSection[] | undefined> {
    this.getCalls += 1
    return this.entries.get(this.keyOf(key))
  }

  async set(key: PromptCacheKey, sections: readonly CachedPromptSection[]): Promise<void> {
    this.setCalls += 1
    this.entries.set(this.keyOf(key), [...sections])
  }

  async invalidate(scope: ScopeKey | undefined): Promise<void> {
    this.invalidateCalls.push(scope)
    const prefix = scope === undefined ? 'scope=global' : 'scope=scoped'
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key)
    }
  }

  private keyOf(key: PromptCacheKey): string {
    const scope = key.scope === undefined ? 'scope=global' : 'scope=scoped'
    return `${scope}|sig=${key.signature}|cfg=${key.configFingerprint}`
  }
}

describe('SystemPrompt stable-prefix cache', () => {
  it('evaluates a stable static prefix once across two assembles', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    const a1 = await ctx.systemPrompt.assemble()
    const a2 = await ctx.systemPrompt.assemble()

    expect(renderPrompt(a1)).toBe(renderPrompt(a2))
    // identity + persona are stable strings: first assemble evaluates and
    // writes, the second reads the cache.
    expect(cache.setCalls).toBe(1)
    expect(cache.getCalls).toBe(2)
  })

  it('skips a function provider declared stable after the first assembly', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    let calls = 0
    ctx.systemPrompt.section({
      name: 'stable-fn',
      order: 10,
      stable: true,
      text: () => `resolved ${++calls}`,
    })

    await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(calls).toBe(1)
    expect(renderPrompt(second)).toContain('resolved 1')
  })

  it('re-evaluates a function provider that does not declare stable', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    let calls = 0
    ctx.systemPrompt.section({
      name: 'live-fn',
      order: 10,
      text: () => `live ${++calls}`,
    })

    const first = await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(calls).toBe(2)
    expect(renderPrompt(first)).toContain('live 1')
    expect(renderPrompt(second)).toContain('live 2')
  })

  it('treats a variable value change as a signature change (miss)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    let ticks = 0
    ctx.systemPrompt.variable('ts', () => String(++ticks))
    ctx.systemPrompt.section({ name: 'stamped', order: 10, text: 'now {{ts}}' })

    const first = await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(renderPrompt(first)).toContain('now 1')
    expect(renderPrompt(second)).toContain('now 2')
    // Each changed variable value recomputed the prefix: never served stale.
    expect(cache.setCalls).toBe(2)
  })

  it('invalidating the scope forces re-evaluation', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    let calls = 0
    ctx.systemPrompt.section({
      name: 'stable-fn',
      order: 10,
      stable: true,
      text: () => `resolved ${++calls}`,
    })

    await ctx.systemPrompt.assemble()
    await ctx.systemPrompt.assemble()
    expect(calls).toBe(1)

    await cache.invalidate(undefined)
    await ctx.systemPrompt.assemble()

    expect(calls).toBe(2)
  })

  it('restores a cached complete section as the sole prompt section', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    ctx.systemPrompt.section({
      name: 'complete-stable',
      order: 10,
      stable: true,
      complete: true,
      text: 'The complete prompt.',
    })

    const first = await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(renderPrompt(first)).toBe('The complete prompt.')
    expect(renderPrompt(second)).toBe('The complete prompt.')
    // The second assembly spliced the cached sections, then restored the
    // cached complete section.
    expect(cache.getCalls).toBe(2)
  })

  it('includes undefined variable values in the signature', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    ctx.systemPrompt.variable('optional', () => undefined)

    const first = await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(renderPrompt(first)).toBe(renderPrompt(second))
    // Both assembles produced the same signature; the second hit the cache.
    expect(cache.setCalls).toBe(1)
    expect(cache.getCalls).toBe(2)
  })

  it('caches only the contiguous stable prefix, excluding later unstable sections', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })
    const cache = new StubCache()
    ctx.provide('promptCache', cache)

    let calls = 0
    ctx.systemPrompt.section({ name: 'live-fn', order: 10, text: () => `live ${++calls}` })

    await ctx.systemPrompt.assemble()
    await ctx.systemPrompt.assemble()

    // The stable prefix stops at the first unstable section; live-fn is
    // evaluated per assembly and never enters the cache.
    const lastSet = [...cache.entries.values()].at(-1)!
    expect(lastSet.map(s => s.name)).toEqual(['harness:identity', 'deployment:persona'])
    expect(calls).toBe(2)
  })

  it('behaves unchanged when no cache strategy is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'You are p.' })

    let calls = 0
    ctx.systemPrompt.section({ name: 'live-fn', order: 10, text: () => `live ${++calls}` })

    const first = await ctx.systemPrompt.assemble()
    const second = await ctx.systemPrompt.assemble()

    expect(calls).toBe(2)
    expect(renderPrompt(first)).toContain('live 1')
    expect(renderPrompt(second)).toContain('live 2')
  })
})
