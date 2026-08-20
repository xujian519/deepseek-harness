/**
 * Prompt-prefix cache: the default assembly-prefix cache strategy for
 * `SystemPrompt.assemble()`. The service mounts at `ctx.promptCache`; when it
 * is absent, `system-prompt` takes the pre-existing per-assembly path
 * byte-for-byte. Registration changes invalidate every scope's entries (a
 * `system-prompt/change` event fires for any prompt-provider change, and each
 * scope's signature would change anyway).
 *
 * @module @deepseek-ai/dsh-prompt-cache
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import type {
  CachedPromptSection,
  PromptCache as PromptCacheIface,
  PromptCacheKey,
} from '@deepseek-ai/dsh-system-prompt/prompt-cache'
// Loads the system-prompt event declarations (`system-prompt/change`).
import type {} from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/cordis' {
  interface Context {
    promptCache: PromptCache
  }
}

/** The default in-memory entry lifetime: one day. */
export const DEFAULT_PROMPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/** Plugin config: deployment-varying cache lifetime. */
export interface Config {
  /** In-memory entry lifetime in milliseconds. */
  ttlMs: number
}

interface Entry {
  sections: CachedPromptSection[]
  expiresAt: number
}

function storeKeyOf(key: PromptCacheKey): string {
  return `${key.signature}\u0000${key.configFingerprint}`
}

/** In-memory TTL strategy: one bucket per scope, lazy expiry on read. */
class MemoryPromptCacheStrategy implements PromptCacheIface {
  private readonly buckets = new Map<ScopeKey | undefined, Map<string, Entry>>()

  constructor(private readonly ttlMs: number) {}

  get(key: PromptCacheKey): Promise<CachedPromptSection[] | undefined> {
    const bucket = this.buckets.get(key.scope)
    if (bucket === undefined) return Promise.resolve(undefined)
    const storeKey = storeKeyOf(key)
    const entry = bucket.get(storeKey)
    if (entry === undefined) return Promise.resolve(undefined)
    if (entry.expiresAt <= Date.now()) {
      bucket.delete(storeKey)
      return Promise.resolve(undefined)
    }
    return Promise.resolve(entry.sections)
  }

  set(key: PromptCacheKey, sections: readonly CachedPromptSection[]): Promise<void> {
    let bucket = this.buckets.get(key.scope)
    if (bucket === undefined) {
      bucket = new Map()
      this.buckets.set(key.scope, bucket)
    }
    bucket.set(storeKeyOf(key), {
      sections: [...sections],
      expiresAt: Date.now() + this.ttlMs,
    })
    return Promise.resolve()
  }

  invalidate(scope: ScopeKey | undefined): Promise<void> {
    this.buckets.delete(scope)
    return Promise.resolve()
  }

  /** Drop every entry: the `system-prompt/change` response. */
  clearAll(): void {
    this.buckets.clear()
  }
}

/**
 * The `ctx.promptCache` service: a TTL-bounded in-memory store keyed by
 * `(scope, signature, configFingerprint)`. Delegates to
 * {@link MemoryPromptCacheStrategy}; a future persistent strategy replaces the
 * strategy selection without changing the service surface.
 */
export default class PromptCache extends Service implements PromptCacheIface {
  static Config: z<Config> = z.object({
    ttlMs: z.number().min(1).default(DEFAULT_PROMPT_CACHE_TTL_MS),
  })

  private readonly strategy: MemoryPromptCacheStrategy

  constructor(ctx: Context, config: Config) {
    super(ctx, 'promptCache')
    this.strategy = new MemoryPromptCacheStrategy(config.ttlMs)
    // A prompt-provider change alters every scope's stable signature; drop
    // all entries rather than guess which scope moved.
    this.ctx.on('system-prompt/change', () => {
      this.strategy.clearAll()
    })
  }

  /**
   * Resolve one stable prefix.
   * @param key - the cache identity.
   * @returns the cached stable sections, or `undefined` on a miss.
   */
  get(key: PromptCacheKey): Promise<CachedPromptSection[] | undefined> {
    return this.strategy.get(key)
  }

  /**
   * Persist one stable prefix.
   * @param key - the cache identity.
   * @param sections - the resolved stable sections, in prefix order.
   */
  set(key: PromptCacheKey, sections: readonly CachedPromptSection[]): Promise<void> {
    return this.strategy.set(key, sections)
  }

  /**
   * Drop every entry belonging to one scope (`undefined` = the global layer).
   * @param scope - the scope whose entries to clear.
   */
  invalidate(scope: ScopeKey | undefined): Promise<void> {
    return this.strategy.invalidate(scope)
  }
}
