/**
 * The deployment's local cnlaw legal base as one model-visible declaration:
 * the resolved endpoints, or the explicit absence of the base, rendered into a
 * system-prompt section. The persona and the patent skills point at this
 * declaration instead of naming a port, so a deployment that moves or omits the
 * base does not leave the model with an instruction that cannot be satisfied.
 * @module @deepseek-ai/dsh-patent-law/cnlaw-declaration
 */

/** Name of the system-prompt section declaring the deployment's cnlaw legal base. */
export const CNLAW_DECLARATION_SECTION = 'patent-law:cnlaw'

/** Position of the declaration, with the other patent-domain sections (TRIZ 111, writing-patterns 112, patent-teams 117). */
export const CNLAW_DECLARATION_SECTION_ORDER = 113

/** Default semantic-search endpoint of the local cnlaw REST base (semantica-cnlaw). */
export const DEFAULT_CNLAW_SEARCH_URL = 'http://127.0.0.1:8100'

/** Default graph/case endpoint of the local cnlaw REST base. */
export const DEFAULT_CNLAW_GRAPH_URL = 'http://127.0.0.1:8001'

/** The local cnlaw legal base this deployment declares, resolved from Config. */
export interface CnlawDeclaration {
  /** Whether the deployment runs the base at all; a disabled base declares no endpoint. */
  readonly enabled: boolean
  /** Semantic-search endpoint: REST routes `/search`, `/search/decisions`, `/search/judgments`. */
  readonly searchUrl: string
  /** Graph/case endpoint: REST routes `/api/cnlaw/graph/*`, `/api/cnlaw/case/*`, `/api/cnlaw/ipc/*`. */
  readonly graphUrl: string
}

/**
 * The guideline/rule channel: neither the cnlaw index nor the packed law index behind
 * `law_verify` carries the guideline text, so the rule text comes from the deployment's
 * external IP knowledge base. Naming the tools is what makes a 未核验 guideline citation
 * actionable — the section is settled by retrieval, never by memory.
 */
const GUIDELINE_TEXT = [
  '- Examination-guideline chapters are not in the cnlaw index, and the packed law index behind `law_verify` holds guideline sections without their text, so a guidelines citation it reports as 未核验 is not a verdict on the rule.',
  '- Retrieve the rule text from this deployment\'s external IP knowledge base: `law_search` with scope=guideline searches the guideline chapters (scope=law searches the statute text), and every hit carries its corpus path as the citation source; `patent_kg_query` (node_type=GuidelineRule) and `patent_wiki_search` hold the rule cards; `patent_case_search` holds decisions that apply a rule.',
  '- A guideline section that no retrieval returns stays 未核验: report it as such instead of reconstructing the section from memory.',
].join('\n')

/**
 * The declaration text for an enabled base: the endpoints the model uses, the
 * routes each one serves, the guideline channel, and the MCP tools that
 * supersede the endpoints where mounted.
 */
function enabledText(declaration: CnlawDeclaration): string {
  return [
    'This deployment declares a local cnlaw legal base (semantica-cnlaw REST): verify law text and case decisions against it after `law_verify`, and record the source_path of every hit. The index holds statutes and decisions, not the examination guidelines.',
    `- Semantic search endpoint: ${declaration.searchUrl} — REST routes \`/search\`, \`/search/decisions\`, \`/search/judgments\`.`,
    `- Graph and case endpoint: ${declaration.graphUrl} — REST routes \`/api/cnlaw/graph/*\`, \`/api/cnlaw/case/*\`, \`/api/cnlaw/ipc/*\`.`,
    GUIDELINE_TEXT,
    'Reach the graph, case, and inventive-step routes through the cnlaw MCP tools (`mcp__cnlaw__*`) whenever this session exposes them, and through the endpoints above otherwise; these endpoints are declared by this deployment (patent-law Config `cnlawSearchUrl` / `cnlawGraphUrl`), so use them instead of assuming a port.',
  ].join('\n')
}

/**
 * The declaration text for a disabled base: the fallback channels, why no
 * endpoint is named, and the guideline channel.
 */
function disabledText(): string {
  return [
    'This deployment declares no local cnlaw legal base (patent-law Config `cnlawEnabled=false`): verify law text, examination guidelines, and case decisions through `patent_case_search` / `patent_wiki_search` and `web_fetch` on an official source, and do not attempt a local cnlaw endpoint.',
    GUIDELINE_TEXT,
  ].join('\n')
}

/**
 * Render the declaration section: the declared endpoints while the base is
 * enabled, otherwise the fallback channels.
 * @param declaration - the base resolved from this deployment's config.
 * @returns the section text.
 */
export function renderCnlawDeclaration(declaration: CnlawDeclaration): string {
  return declaration.enabled ? enabledText(declaration) : disabledText()
}
