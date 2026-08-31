/**
 * Host Remote owner for the open plugin-catalog discovery seam. It projects
 * the read-only face of `ctx.pluginMarket` — source listing, catalog search,
 * and install preview — onto the generated `ctx.remote.pluginMarket`
 * namespace. Installs stay with the `dsh plugin` CLI: this controller exposes
 * no write, so a browser session can discover and preview but never mutate a
 * profile.
 *
 * @module @deepseek-ai/dsh-api-plugin-market-controller
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { CatalogPage, CatalogQuery, InstallPreview, PluginMarketSource } from '@deepseek-ai/dsh-host-plugin-market/types'
import { PluginMarketError } from '@deepseek-ai/dsh-host-plugin-market'
import type { PluginMarket } from '@deepseek-ai/dsh-host-plugin-market'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the generated `pluginMarket` Remote namespace. */
    pluginMarketController: PluginMarketController
  }
}

/**
 * Host service backing the generated `ctx.remote.pluginMarket` namespace.
 * Every method is a read-only projection of the `ctx.pluginMarket` seam: the
 * catalog stays discoverable from a browser while installs and uninstalls
 * remain the profile CLI's owner.
 */
export class PluginMarketController extends TypertRemoteService {
  /**
   * Register the `pluginMarket` namespace. It stays registered when no
   * provider is mounted so each call returns an actionable missing-provider
   * diagnostic instead of the namespace silently being absent.
   * @param ctx - Host context where the plugin-market provider may be mounted.
   */
  constructor(ctx: Context) {
    super(ctx, 'pluginMarketController', { namespace: 'pluginMarket' })
  }

  /**
   * List the registered catalog sources.
   * @returns every registered source.
   * @throws RemoteError when the source listing fails or no provider is mounted.
   */
  @Remote
  async listSources(): Promise<readonly PluginMarketSource[]> {
    try {
      return await this.market().listSources()
    } catch (error: unknown) {
      throw marketFailure(error)
    }
  }

  /**
   * Query one source's catalog.
   * @param sourceId - the source to query.
   * @param query - search parameters; unsupported ones are dropped by the provider.
   * @returns one page of provenance-stamped entries.
   * @throws RemoteError when the source query fails or no provider is mounted.
   */
  @Remote
  async search(sourceId: string, query: CatalogQuery | undefined): Promise<CatalogPage> {
    try {
      return await this.market().search(sourceId, query ?? {})
    } catch (error: unknown) {
      throw marketFailure(error, sourceId)
    }
  }

  /**
   * Preview an installation against the npm registry without touching the profile.
   * @param ref - `name@version` package reference.
   * @returns the verification result.
   * @throws RemoteError when the preview fails or no provider is mounted.
   */
  @Remote
  async preview(ref: string): Promise<InstallPreview> {
    try {
      return await this.market().preview(ref)
    } catch (error: unknown) {
      throw marketFailure(error, ref)
    }
  }

  /** Resolve the optional provider or report how to supply it. */
  private market(): PluginMarket {
    const market = this.ctx.get('pluginMarket')
    if (market === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'plugin-market service is absent: this deployment does not mount a catalog provider (e.g. @deepseek-ai/dsh-host-plugin-market/provider) in its composition',
        {},
      )
    }
    return market
  }
}

/**
 * Map a market refusal to an actionable Remote failure. A `PluginMarketError`
 * carries a closed business code that becomes the wire code; anything else is
 * an internal failure carrying the provider's message.
 * @param error - whatever the seam threw.
 * @param subject - the source id or package ref the call addressed; omitted
 * when no single subject exists, as for a source-listing call.
 * @returns the failure to raise.
 */
function marketFailure(error: unknown, subject?: string): RemoteError {
  if (error instanceof PluginMarketError) {
    const details = subject === undefined ? {} : { subject }
    return new RemoteError(error.code, error.message, details)
  }
  return new RemoteError(
    'gateway/internal',
    error instanceof Error ? error.message : String(error),
    {},
    { cause: error },
  )
}

export default PluginMarketController
