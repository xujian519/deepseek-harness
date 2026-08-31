/** Copy dictionaries for the plugin-market discovery Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件市场',
  loading: '正在读取插件目录…',
  error: '暂时无法读取插件市场。',
  searchError: '搜索失败，请重试。',
  retry: '重试',
  sources: '目录源',
  noSources: '暂无可用目录源。',
  source: '来源',
  builtin: '内置',
  search: '搜索插件',
  searchPlaceholder: '输入名称或关键词…',
  category: '类目',
  capability: '能力',
  searchButton: '搜索',
  empty: '暂无插件。',
  emptySearch: '没有匹配的插件。',
  preview: '预检',
  previewing: '预检中…',
  previewPlaceholder: 'name@version',
  verified: '已验证',
  previewRejected: '预检未通过',
  version: '版本',
} satisfies Record<string, string>

/** Plugin market locale key union. */
export type PluginMarketLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin market',
  loading: 'Reading plugin catalogs…',
  error: 'Plugins market is temporarily unavailable.',
  searchError: 'Search failed. Please try again.',
  retry: 'Retry',
  sources: 'Catalogs',
  noSources: 'No catalogs are available.',
  source: 'Source',
  builtin: 'Built-in',
  search: 'Search plugins',
  searchPlaceholder: 'Enter a name or keyword…',
  category: 'Category',
  capability: 'Capability',
  searchButton: 'Search',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  preview: 'Preview',
  previewing: 'Previewing…',
  previewPlaceholder: 'name@version',
  verified: 'Verified',
  previewRejected: 'Preview rejected',
  version: 'Version',
} satisfies Record<PluginMarketLocaleKey, string>
