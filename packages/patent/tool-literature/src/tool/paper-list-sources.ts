/**
 * `paper_list_sources` tool: list the available data sources in the literature Connector registry.
 *
 * The model discovers `db` ids here first, then queries via `paper_search`, so the model-facing
 * tool count stays constant no matter how many sources are wired in.
 * @module @deepseek-ai/dsh-tool-literature/tool/paper-list-sources
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CatalogEntry } from '../protocol/types.ts'
import type { ConnectorRegistry } from '../runtime/connector-registry.ts'

/** Input for the paper_list_sources tool. */
export type PaperListSourcesInput = {
  /** Optional domain filter (currently only "literature"). */
  domain?: string
}

/** Output of the paper_list_sources tool. */
export type PaperListSourcesOutput = {
  sources: CatalogEntry[]
  domains: string[]
}

const DESCRIPTION = [
  '- Lists the scholarly literature databases available to search via `paper_search`',
  '- Returns each source\'s id, name, and description',
  '- Call this first to discover which `db` id to pass to `paper_search`',
].join('\n')

/** Render the canonical source list into model-facing prose. */
function renderSources(args: PaperListSourcesInput, value: PaperListSourcesOutput): string {
  const { sources } = value
  if (sources.length === 0) {
    return args.domain
      ? `No literature sources registered for domain "${args.domain}".`
      : 'No literature sources are registered.'
  }
  const rows = sources.map(e => `- **${e.id}** (${e.name}) — ${e.description}`)
  return [`Available literature sources (${sources.length}):`, '', rows.join('\n')].join('\n')
}

/**
 * Build the `paper_list_sources` tool over a given connector registry.
 * @param registry - the literature connector registry to enumerate.
 * @returns a registry-ready tool definition.
 */
export function createPaperListSourcesTool(registry: ConnectorRegistry): ToolDefinition {
  return defineTool({
    name: 'paper_list_sources',
    description: DESCRIPTION,
    parameters: {
      domain: {
        type: 'string',
        description: "Optional domain filter (currently only 'literature')",
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sources: { type: 'array', required: true },
          domains: { type: 'array', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: renderSources(args, value as unknown as PaperListSourcesOutput) }],
    },
    // oxlint-disable-next-line typescript/require-await -- ToolDefinition.execute must return Promise<unknown>
    execute: async (args) => {
      const entries = registry.catalog().filter(e => !args.domain || e.domain === args.domain)
      const domains = [...new Set(entries.map(e => e.domain))]
      return { sources: entries as unknown as JsonValue[], domains }
    },
  })
}
