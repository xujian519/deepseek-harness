/**
 * Host-bundled catalog: a small fixed set of real DeepSeek Harness packages
 * served as an always-available source so `ctx.pluginMarket` works out of the
 * box without a registered online source. The data is a release-bundled
 * snapshot — it refreshes with each publish, never over the network. Entries
 * are provenance-stamped at query time; search is a pure in-memory filter.
 * @module @deepseek-ai/dsh-host-plugin-market/builtin-catalog
 */

import type { CatalogItem, CatalogPage, CatalogQuery, PluginMarketSource, SourceId } from './index.ts'

/** Stable identity of the bundled catalog (host-issued, never a provider's claim). */
export const BUILTIN_SOURCE_ID = 'builtin-deepseek' as SourceId

/** The bundled catalog source as a `PluginMarketSource`; `builtin` marks it in-memory. */
export const BUILTIN_SOURCE: PluginMarketSource = {
  id: BUILTIN_SOURCE_ID,
  providerId: 'builtin-deepseek',
  name: 'DeepSeek 官方目录',
  description: 'Harness 自带的离线插件目录快照，随每次发布更新。',
  homepage: 'https://github.com/deepseek-ai/deepseek-harness',
  attribution: { name: 'DeepSeek AI', url: 'https://github.com/deepseek-ai/deepseek-harness' },
  // The bundled catalog never fetches its endpoint; a non-URL marks it plainly.
  endpoint: 'builtin://catalog',
  query: { supported: ['q', 'category', 'capability', 'limit'] },
  builtin: true,
}

/** The bundled entries, without host provenance (added at query time). */
const BUILTIN_ITEMS: readonly Omit<CatalogItem, 'source'>[] = [
  {
    id: 'dsh-tool-bash',
    name: 'Bash 工具',
    description: '在沙箱内执行 shell 命令并捕获输出，是 Agent 执行本地任务的基础工具。',
    package: '@deepseek-ai/dsh-tool-bash',
    version: '0.1.2-alpha.1',
    category: 'tool',
    capability: ['exec', 'shell', 'sandbox'],
    homepage: 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/shell/tool-bash',
    license: 'MIT',
  },
  {
    id: 'dsh-tool-web',
    name: 'Web 工具',
    description: '网络检索与网页抓取，为 Agent 提供外部事实来源。',
    package: '@deepseek-ai/dsh-tool-web',
    version: '0.1.2-alpha.1',
    category: 'tool',
    capability: ['web', 'search', 'fetch'],
    homepage: 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/web/tool-web',
    license: 'MIT',
  },
  {
    id: 'dsh-skill-filesystem',
    name: '文件系统技能',
    description: '以 Skill 形式封装的文件读写与目录遍历能力，可被会话按需加载。',
    package: '@deepseek-ai/dsh-skill-filesystem',
    version: '0.1.2-alpha.1',
    category: 'skill',
    capability: ['fs', 'skill'],
    homepage: 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/skill/skill-filesystem',
    license: 'MIT',
  },
  // A minimal bundled entry: no description/category/capability, so the
  // filter's optional-field nullish branches are reachable against the real
  // snapshot. Discovery still hits it by name and package.
  {
    id: 'dsh-session-persistence-jsonl',
    name: 'JSONL 会话持久化',
    package: '@deepseek-ai/dsh-session-persistence-jsonl',
    version: '0.1.2-alpha.1',
    homepage: 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/session/session-persistence-jsonl',
    license: 'MIT',
  },
  {
    id: 'dsh-plan-mode',
    name: 'Plan 模式',
    description: '在复杂任务前先规划、得到用户确认再执行，降低不可逆动作的风险。',
    package: '@deepseek-ai/dsh-plan-mode',
    version: '0.1.2-alpha.1',
    category: 'agent',
    capability: ['plan', 'planning', 'approval'],
    homepage: 'https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/plan/plan-mode',
    license: 'MIT',
  },
]

/**
 * Search the bundled catalog. Filters by free text, then exact category and
 * capability, and clamps to the requested page size. Provenance is stamped
 * with the bundled source's providerId.
 * @param query - the search parameters.
 * @returns one provenance-stamped page.
 */
export function searchBuiltinCatalog(query: CatalogQuery = {}): CatalogPage {
  const q = query.q?.trim().toLowerCase()
  const category = query.category?.trim().toLowerCase()
  const capability = query.capability?.trim().toLowerCase()
  const needle = q === '' ? undefined : q
  const matches = BUILTIN_ITEMS.filter((item) => {
    if (needle !== undefined) {
      const haystack = `${item.name} ${item.description ?? ''} ${item.package} ${item.category ?? ''} ${(item.capability ?? []).join(' ')}`
      if (!haystack.toLowerCase().includes(needle)) return false
    }
    if (category !== undefined && category !== '' && item.category?.toLowerCase() !== category) return false
    if (capability !== undefined && capability !== '' && !(item.capability ?? []).some(c => c.toLowerCase() === capability)) return false
    return true
  })
  const limit = Math.max(0, query.limit ?? 20)
  return {
    items: matches.slice(0, limit).map(item => ({ ...item, source: BUILTIN_SOURCE.providerId })),
  }
}
