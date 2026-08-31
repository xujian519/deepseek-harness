/** Read-only Host plugin-market discovery registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { PluginMarketTab, type PluginMarketTabInjected } from './PluginMarketTab.tsx'
import { en, zh, type PluginMarketLocaleKey } from './locales.ts'

export type { PluginMarketTabInjected, PluginMarketTabProps } from './PluginMarketTab.tsx'
export type { PluginMarketLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin-market discovery copy. */
    'settings.pluginMarket': PluginMarketLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginMarket'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginMarket']

/**
 * The subset of Typert's `RemoteResult<T>` this package unwraps. The full
 * protocol type is not named here, so the UI package stays off that types
 * surface; a carrier failure the browser resolves carries `code` and `message`
 * alongside its details.
 */
type RemoteValue<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Resolve one plugin-market Remote call to its value, rethrowing the carrier
 * failure as an actionable Error that names the verb which failed.
 * @param call - the Remote promise to unwrap.
 * @param kind - the Remote verb, for the failure message.
 * @returns the call's value, or a rejected Error with the verb and failure.
 */
const unwrap = async <T>(call: Promise<RemoteValue<T>>, kind: string): Promise<T> => {
  const result = await call
  if (!result.ok) throw new Error(`pluginMarket.${kind} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Contribute the lazy market tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plugin-market: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): PluginMarketTabInjected => ({
    listSources: () => unwrap(ctx.remote.pluginMarket.listSources(), 'listSources'),
    search: (sourceId, remoteQuery) => unwrap(ctx.remote.pluginMarket.search(sourceId, remoteQuery), 'search'),
    preview: ref => unwrap(ctx.remote.pluginMarket.preview(ref), 'preview'),
  })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'market',
    order: 30,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginMarketTab))
}
