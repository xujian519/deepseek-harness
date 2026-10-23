/**
 * Function plugin registering `legal_law_verify`: citation checking against the
 * legal-law index shipped with this package.
 *
 * The index covers all laws in the `assets/legal-law/` directory and is loaded
 * at plugin load, so a missing or malformed asset fails the deployment instead
 * of silently turning the gate into a no-op.
 * @module @deepseek-ai/dsh-legal-law
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { loadLegalLawBaselines } from './baseline.ts'
import { createLegalLawVerifyTool } from './tool/law-verify.ts'
import { DEFAULT_LEGAL_CITATION_POLICY } from './verify.ts'
import { LEGAL_PROPOSITION_SUPPORT_DEFAULT } from './support.ts'
import type { LegalCitationPolicy, LegalCitationPolicySet } from './types.ts'

// Public library API: the reference parser, the index loader, the verifier, and
// the tool factory.
export {
  findLegalArticle,
  LEGAL_LAW_NAMES,
  LegalLawBaselineError,
  loadLegalLawBaselines,
  parseLegalLawBaseline,
} from './baseline.ts'
export { legalLawBaselineDir, listLegalLawFiles } from './asset-location.ts'
export {
  extractLegalLawReferences,
  formatCnNumber,
  formatLegalLawReference,
  parseCnNumber,
  parseLegalLawReference,
  scanUnrecognizedLegalCitations,
} from './reference.ts'
export {
  createLegalOverlapIndex,
  LEGAL_PROPOSITION_SUPPORT_DEFAULT,
  legalTextOverlap,
  legalTopicOverlap,
  type LegalComparableEntry,
  type LegalOverlapIndex,
} from './support.ts'
export {
  DEFAULT_LEGAL_CITATION_POLICY,
  renderLegalCitationFindings,
  renderLegalCitationRows,
  resolveLegalCitationPolicy,
  verifyLegalCitation,
  verifyLegalCitations,
  type LegalCitationRow,
  type LegalVerifyOptions,
} from './verify.ts'
export {
  createLegalLawVerifyTool,
  LegalLawVerifyToolError,
  type LegalLawVerifyFinding,
  type LegalLawVerifyInput,
  type LegalLawVerifyOutput,
  type LegalLawVerifyToolOptions,
} from './tool/law-verify.ts'
export type {
  LegalArticleEntry,
  LegalCitationDecision,
  LegalCitationFinding,
  LegalCitationPolicy,
  LegalCitationPolicySet,
  LegalLawArticleReference,
  LegalLawBaseline,
  LegalLawName,
  LegalLawReference,
} from './types.ts'

/** Cordis plugin name. */
export const name = 'legal-law'

/** Services the plugin requires before registration. */
export const inject = ['tools']

/** Model-facing legal-law plugin configuration. */
export interface Config {
  /** Directory holding the legal-law index YAML files; defaults to the packaged index. */
  baselineDir?: string
  /** Treatment of a citation whose proposition a verified article does not support, while another entry does. */
  onMismatch: LegalCitationPolicy
  /** Treatment of a citation whose proposition no entry of the law supports, so nothing here decides it. */
  onUnmatched: LegalCitationPolicy
  /** Treatment of a citation beyond a verified article ceiling. */
  onOutOfRange: LegalCitationPolicy
  /** Treatment of a citation the index does not hold. */
  onNotIndexed: LegalCitationPolicy
  /** Treatment of an indexed entry whose text has not been transcribed. */
  onUnverified: LegalCitationPolicy
  /**
   * Share of a proposition's weighted character pairs an entry's text must carry
   * before it supports the proposition; greater than 0 and at most 1.
   */
  propositionSupport: number
}

/** Schemastery configuration: index override and the per-decision citation policy. */
export const Config: z<Config> = z.object({
  baselineDir: z.string(),
  onMismatch: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_LEGAL_CITATION_POLICY.mismatch),
  onUnmatched: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_LEGAL_CITATION_POLICY.unmatched),
  onOutOfRange: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_LEGAL_CITATION_POLICY.outOfRange),
  onNotIndexed: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_LEGAL_CITATION_POLICY.notIndexed),
  onUnverified: z.union(['block', 'warn', 'allow'] as const).default(DEFAULT_LEGAL_CITATION_POLICY.unverified),
  propositionSupport: z.number().min(0.0001).max(1).default(LEGAL_PROPOSITION_SUPPORT_DEFAULT),
})

/**
 * Register the legal_law_verify tool over the configured legal-law index.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - index override and the per-decision citation policy.
 */
export function apply(ctx: Context, config: Config): void {
  const baselines = loadLegalLawBaselines(config.baselineDir)
  const policies: LegalCitationPolicySet = {
    mismatch: config.onMismatch,
    unmatched: config.onUnmatched,
    outOfRange: config.onOutOfRange,
    notIndexed: config.onNotIndexed,
    unverified: config.onUnverified,
  }
  ctx.tools.register(createLegalLawVerifyTool({ baselines, policies, supportThreshold: config.propositionSupport }))
}
