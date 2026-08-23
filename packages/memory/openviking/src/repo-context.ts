/**
 * Indexed-repository context: the direct children of `viking://resources/`,
 * TTL-cached, injected so the model knows what is indexed before searching.
 * @module @deepseek-ai/dsh-openviking/repo-context
 */

import type { Logger } from '@deepseek-ai/cordis'

import { OpenVikingClient } from './client.ts'
import type { RepoContextConfig } from './config.ts'

/** Direct-child names of the resources space. */
export class RepoContext {
  private readonly client: OpenVikingClient
  private readonly config: () => RepoContextConfig
  private readonly logger: Logger
  private cached: { at: number; names: string[] } | undefined

  /**
 * @param client - OpenViking HTTP client.
 * @param config - Configuration snapshot for the operation.
 */
  constructor(client: OpenVikingClient, config: () => RepoContextConfig, logger: Logger) {
    this.client = client
    this.config = config
    this.logger = logger
  }

  /**
 * The model-visible repository list; empty string contributes nothing.
 * @returns tring {.
 */
  prompt(): string {
    if (!this.config().enabled) return ''
    const names = this.cached?.names ?? []
    if (names.length === 0) return ''
    return `Indexed resources under viking://resources/: ${names.join(', ')}`
  }

  /**
 * Refresh the cached list; failures keep the last successful cache.
 * @param signal - Cancellation signal for the request.
 */
  async refresh(signal?: AbortSignal): Promise<void> {
    const config = this.config()
    if (!config.enabled) return
    if (this.cached !== undefined && Date.now() - this.cached.at < config.cacheTtlMs) return
    try {
      const nodes = await this.client.tree('viking://resources/', { nodeLimit: 50, levelLimit: 1, signal })
      this.cached = {
        at: Date.now(),
        names: nodes.map(node => `viking://resources/${node.path.replace(/^viking:\/\/resources\/?/, '')}`),
      }
    } catch (error) {
      // Keep the last successful cache; warn once per refresh failure.
      this.logger.info('openviking repository list refresh failed', { error: String(error) })
    }
  }
}
