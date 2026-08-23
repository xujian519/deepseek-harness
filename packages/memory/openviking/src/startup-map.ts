/**
 * Memory-library map: one compact category overview injected at session start
 * and refreshed on a user-turn cadence, so the agent knows what the library
 * holds before any question exists. Details are fetched on demand through
 * the tool surface.
 * @module @deepseek-ai/dsh-openviking/startup-map
 */

import { OpenVikingClient } from './client.ts'

/**
 * Library overview provider.
 * @param client - OpenViking client.
 */
export class StartupMap {
  private readonly client: OpenVikingClient
  /** Latest counts fetched from the server; absent until the first refresh. */
  private counts: Record<string, number> | undefined
  /** User-turn count at which the map was last refreshed (cadence guard). */
  lastRefreshTurn = 0

  /**
 * @param client - OpenViking HTTP client.
 */
  constructor(client: OpenVikingClient) {
    this.client = client
  }

  /**
   * The model-visible map block; empty string contributes nothing.
   * @returns the map block, or empty until the first refresh.
   */
  prompt(): string {
    if (this.counts === undefined) return ''
    const entries = Object.entries(this.counts).filter(([, count]) => count > 0)
      .map(([name, count]) => `${name}: ${count}`)
    if (entries.length === 0) return '<memory-library>\n(empty)\n</memory-library>'
    return `<memory-library>\n${entries.join(' | ')}\nSearch or read before asking the user to repeat. Use the OpenViking tools to fetch details.\n</memory-library>`
  }

  /**
 * Fetch fresh category counts; failures keep the previous map.
 * @param signal - Cancellation signal for the request.
 */
  async refresh(signal?: AbortSignal): Promise<void> {
    const stats = await this.client.memoryStats(signal)
    this.counts = { ...stats.by_category, total: stats.total_memories }
  }
}
