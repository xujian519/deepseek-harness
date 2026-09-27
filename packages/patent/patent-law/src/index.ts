/**
 * Function plugin registering `law_verify`: citation checking against the law
 * index shipped with this package (《专利法》《专利法实施细则》《专利审查指南》).
 *
 * The index is loaded at plugin load, so a missing or malformed asset fails the
 * deployment instead of silently turning the gate into a no-op that reports every
 * citation as checked.
 * @module @deepseek-ai/dsh-patent-law
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadLawBaselines } from './baseline.ts'
import {
  CNLAW_DECLARATION_SECTION,
  CNLAW_DECLARATION_SECTION_ORDER,
  DEFAULT_CNLAW_GRAPH_URL,
  DEFAULT_CNLAW_SEARCH_URL,
  renderCnlawDeclaration,
} from './cnlaw-declaration.ts'
import { createLawVerifyTool } from './tool/law-verify.ts'
import { DEFAULT_CITATION_POLICY } from './verify.ts'
import type { CitationPolicy, CitationPolicySet } from './types.ts'

// Public library API: the reference parser, the index loader, the verifier, and
// the tool factory.
export {
  findArticle,
  findSection,
  LAW_NAMES,
  LawBaselineError,
  loadLawBaselines,
  parseLawBaseline,
} from './baseline.ts'
export { lawBaselineDir, LAW_FILE_NAMES, listLawFiles } from './asset-location.ts'
export {
  CNLAW_DECLARATION_SECTION,
  CNLAW_DECLARATION_SECTION_ORDER,
  DEFAULT_CNLAW_GRAPH_URL,
  DEFAULT_CNLAW_SEARCH_URL,
  renderCnlawDeclaration,
  type CnlawDeclaration,
} from './cnlaw-declaration.ts'
export {
  extractLawReferences,
  formatCnNumber,
  formatLawReference,
  parseCnNumber,
  parseLawReference,
} from './reference.ts'
export {
  DEFAULT_CITATION_POLICY,
  renderCitationFindings,
  renderCitationRows,
  resolveCitationPolicy,
  verifyCitation,
  verifyCitations,
  type CitationRow,
  type VerifyOptions,
} from './verify.ts'
export {
  createLawVerifyTool,
  LawVerifyToolError,
  type LawVerifyFinding,
  type LawVerifyInput,
  type LawVerifyOutput,
  type LawVerifyToolOptions,
} from './tool/law-verify.ts'
export type {
  ArticleEntry,
  CitationDecision,
  CitationFinding,
  CitationPolicy,
  CitationPolicySet,
  GuidelineReference,
  LawArticleReference,
  LawBaseline,
  LawName,
  LawReference,
  SectionEntry,
  StatuteName,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'patent-law'

/** Services the plugin requires before registration. */
export const inject = ['tools']

/** Model-facing patent-law plugin configuration. */
export interface Config {
  /** Directory holding the law-index YAML files; defaults to the packaged index. */
  baselineDir?: string
  /** Whether this deployment runs the local cnlaw legal base. Defaults to `true`. */
  cnlawEnabled: boolean
  /** Semantic-search endpoint of the local cnlaw base; defaults to `http://127.0.0.1:8100`. */
  cnlawSearchUrl: string
  /** Graph/case endpoint of the local cnlaw base; defaults to `http://127.0.0.1:8001`. */
  cnlawGraphUrl: string
  /** Treatment of a citation whose proposition a verified article does not support. */
  onMismatch: CitationPolicy
  /** Treatment of a citation beyond a verified article ceiling. */
  onOutOfRange: CitationPolicy
  /** Treatment of a citation the index does not hold. */
  onNotIndexed: CitationPolicy
  /** Treatment of an indexed entry whose text has not been transcribed. */
  onUnverified: CitationPolicy
}

/** Schemastery configuration: index override, the declared cnlaw base, and the per-decision citation policy. */
export const Config: z<Config> = z.object({
  baselineDir: z.string(),
  cnlawEnabled: z.boolean().default(true),
  cnlawSearchUrl: z.string().default(DEFAULT_CNLAW_SEARCH_URL),
  cnlawGraphUrl: z.string().default(DEFAULT_CNLAW_GRAPH_URL),
  onMismatch: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_CITATION_POLICY.mismatch),
  onOutOfRange: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_CITATION_POLICY.outOfRange),
  onNotIndexed: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_CITATION_POLICY.notIndexed),
  onUnverified: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_CITATION_POLICY.unverified),
})

/**
 * Register the law_verify tool over the configured law index, and declare the
 * deployment's cnlaw legal base where a prompt registry is mounted.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - index override, the cnlaw base endpoints, and the per-decision citation policy.
 */
export function apply(ctx: Context, config: Config): void {
  const baselines = loadLawBaselines(config.baselineDir)
  // The schema defaults every policy field, so each one is resolved by the time it arrives.
  const policies: CitationPolicySet = {
    mismatch: config.onMismatch,
    outOfRange: config.onOutOfRange,
    notIndexed: config.onNotIndexed,
    unverified: config.onUnverified,
  }
  ctx.tools.register(createLawVerifyTool({ baselines, policies }))
  // Optional injection: without a prompt registry there is no model to declare
  // the base to, and the tool stands on its own.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.section({
      name: CNLAW_DECLARATION_SECTION,
      order: CNLAW_DECLARATION_SECTION_ORDER,
      text: renderCnlawDeclaration({
        enabled: config.cnlawEnabled,
        searchUrl: config.cnlawSearchUrl,
        graphUrl: config.cnlawGraphUrl,
      }),
    })
  })
}
