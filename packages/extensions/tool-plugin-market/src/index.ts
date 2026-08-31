/**
 * Model-facing plugin catalog tools: list the registered catalog sources,
 * search one catalog, and preview a package before install. All three are
 * read-only — installation stays on the `dsh plugin` CLI so an Agent never
 * commits a package without an explicit operator decision.
 * @module @deepseek-ai/dsh-tool-plugin-market
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-host-plugin-market'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { PLUGIN_MARKET_SYSTEM_PROMPT } from './prompt.ts'

export const name = 'tool-plugin-market'
export const inject = ['tools', 'systemPrompt', 'pluginMarket']

function requireAgent(exec: ToolExecution): Agent {
  if (exec.agent === undefined) throw new Error('plugin-market tools require an Agent-backed session')
  return exec.agent
}

/**
 * Resolve the source to query. An explicit sourceId must exist; otherwise the
 * bundled catalog is chosen, and a non-bundled source is a fallback so a
 * model-visible read still works when no bundled source is present.
 */
async function resolveSource(ctx: Context, sourceId?: string): Promise<string> {
  const sources = await ctx.pluginMarket.listSources()
  if (sourceId !== undefined) {
    if (!sources.some(source => source.id === sourceId)) {
      throw new Error(`no catalog source "${sourceId}"; call market_source_list first`)
    }
    return sourceId
  }
  const builtin = sources.find(source => source.builtin === true)
  if (builtin !== undefined) return builtin.id
  const first = sources[0]
  if (first === undefined) throw new Error('no catalog source registered; call market_source_list first')
  return first.id
}

/** Register the plugin-market tools and their model-facing system prompt section. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'tool:plugin-market',
    order: ctx.systemPrompt.getSectionOrder('TOOL_PLUGIN_MARKET'),
    text: PLUGIN_MARKET_SYSTEM_PROMPT,
  })

  ctx.tools.register(defineTool({
    name: 'market_source_list',
    description:
      'List every catalog source currently available to the plugin market, including the host-bundled '
      + 'DeepSeek catalog and any user-registered HTTPS catalogs. Each entry shows its stable source id, '
      + 'provider id, display name, whether it is the bundled offline catalog, and the query parameters it '
      + 'accepts. Call this Tool before market_plugin_search when you do not already know a valid source id; '
      + 'a source id is required by search unless you rely on the bundled catalog default.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(_args, exec): Promise<JsonValue> {
      requireAgent(exec)
      return ctx.pluginMarket.listSources().then(sources => sources.map(source => ({
        id: String(source.id),
        providerId: source.providerId,
        name: source.name,
        ...source.description === undefined ? {} : { description: source.description },
        builtin: source.builtin === true,
        query: { supported: [...source.query.supported] },
      })) as unknown as JsonValue)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'market_plugin_search',
    description:
      'Search one catalog source for plugins. When sourceId is omitted the bundled DeepSeek catalog is '
      + 'queried; pass an explicit source id from market_source_list to search a user-registered catalog. '
      + 'Filter with q (free text), category, and capability. The result is a page of entries, each with the '
      + 'exact npm package name, pinned version, description, capability labels, and the source it came from. '
      + 'Search is read-only: use market_plugin_preview to check a package against the registry, and keep '
      + 'installation on the dsh plugin CLI — do not claim a package was installed.',
    parameters: {
      sourceId: { type: 'string', description: 'Source id from market_source_list; defaults to the bundled catalog.' },
      q: { type: 'string', description: 'Free-text search term.' },
      category: { type: 'string', description: 'Exact category label to filter by.' },
      capability: { type: 'string', description: 'Exact capability label to filter by.' },
      limit: { type: 'number', description: 'Maximum entries to return (the source may clamp it).' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      requireAgent(exec)
      const sourceId = await resolveSource(ctx, args.sourceId)
      const page = await ctx.pluginMarket.search(sourceId, {
        ...args.q === undefined ? {} : { q: args.q },
        ...args.category === undefined ? {} : { category: args.category },
        ...args.capability === undefined ? {} : { capability: args.capability },
        ...args.limit === undefined ? {} : { limit: args.limit },
      })
      return { sourceId, ...page } as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'market_plugin_preview',
    description:
      'Preview a package reference (`name@version`) against the npm registry without touching any profile. '
      + 'It reports whether the reference resolved to a real, non-deprecated release; any rejection reasons; '
      + 'the lifecycle scripts the package declares; and whether its engines constraints accept the running '
      + 'Node. Call this Tool before recommending an install, and when a search entry carries a pinned version '
      + 'use exactly that version string. Preview is read-only and never installs.',
    parameters: {
      ref: { type: 'string', required: true, description: 'Package reference as `name@version`, e.g. @deepseek-ai/dsh-tool-bash@0.1.2-alpha.1.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec) {
      requireAgent(exec)
      return await ctx.pluginMarket.preview(args.ref) as unknown as JsonValue
    },
  }))
}
