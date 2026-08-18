/**
 * The patent-rule PLUGIN: ports the Sati constitutional rule engine and ships
 * the rule assets, wires the RuleOutputGate onto tools/post-execute with review
 * routed through ctx.approval, and registers the EVI-011 evidence-compliance
 * guards via ctx.tools.guard() as monotonic denies.
 *
 * ## Behavior
 *
 * - Delivery-tool results (render_patent_document / draft_claims /
 *   draft_specification / validate_specification, overridable via
 *   {@link Config.gateToolNames}) run through the RuleOutputGate on the
 *   keyword_blocklist subset (selectGateRules). A block-level violation returns
 *   `{ kind: 'block' }`; a review-level violation fires `ctx.get('approval')`
 *   and accepts only on `'allowed-once'` (fail-closed with no answerer, no
 *   agent, or `approvalDisabled`); warn/log violations pass through unchanged.
 * - evaluate_evidence calls are denied by two monotonic EVI-011 guards when an
 *   overseas/foreign evidence record omits its required notarization /
 *   legalization / translation declaration.
 * - Non-matching tools delegate via `next()` (waterfall contract).
 *
 * @module @deepseek-ai/dsh-patent-rule
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
// Type-only: makes `ctx.get('approval')` resolve to the ApprovalService
// augmentation. The seam stays optional at runtime.
import type {} from '@deepseek-ai/dsh-user-approval'
import type { RuleOutputGateResult } from '@deepseek-ai/dsh-patent-core'
import { patentAssetDir } from './asset-location.ts'
import { createEvidenceComplianceGuards } from './guard/evidenceComplianceGuards.ts'
import { loadPatentFullRuleSet, selectGateRules } from './runtime/patent-compliance.ts'
import { RuleOutputGate } from './runtime/output-gate.ts'

// Public library API: the rule engine, loaders, pack assembler, and guards the
// rule_check tool and workflow consumers import alongside the plugin surface.
export {
  evaluateRule,
  evaluateText,
  groupByAction,
  type EvaluateTextOptions,
} from './runtime/RuleEngine.ts'
export {
  applyRuleOverrides,
  asRecord,
  isRuleAction,
  loadRuleSetDir,
  loadRuleSetFromFile,
  mergeRuleSets,
  parseRuleSetFromYaml,
  validateRuleSet,
} from './runtime/RuleLoader.ts'
export {
  checkSynonymRequirements,
  hasNegationContext,
  loadSynonymsAsset,
  matchKeyword,
  parseSynonyms,
  type SynonymCheckResult,
  type SynonymMap,
  type SynonymsLoadResult,
} from './runtime/synonym-engine.ts'
export {
  loadActivationOverrides,
  loadPatentComplianceRuleSet,
  loadPatentElectricalRuleSet,
  loadPatentFullRuleSet,
  selectGateRules,
  type ActivationOverrides,
  type PatentComplianceLoadResult,
} from './runtime/patent-compliance.ts'
export {
  loadRulePack,
  parseRulePackManifest,
  resolvePackDir,
  resolveRulePackManifestPath,
  summarizeRulePackLayers,
  validatePackManifest,
  type PackManifestIssue,
  type RulePackLoadResult,
  type RulePackManifest,
} from './runtime/rule-pack.ts'
export {
  RuleOutputGate,
  type RuleOutputGateOptions,
} from './runtime/output-gate.ts'
export {
  assetRulesRoot,
  candidatePackDirs,
  candidateRuleDirs,
  patentAssetDir,
  resolveRuleAsset,
} from './asset-location.ts'
export {
  EVIDENCE_COMPLIANCE_TOOL,
  createEvidenceComplianceGuards,
  createForeignTranslationGuard,
  createOverseasNotarizationGuard,
  evi011GuardConditionFields,
} from './guard/evidenceComplianceGuards.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'patent-rule'

/** Require the tool registry (guards + the post-execute waterfall are its extension points). */
export const inject = ['tools']

/** Delivery tools whose results run through the output gate by default. */
const DEFAULT_GATE_TOOL_NAMES = [
  'render_patent_document',
  'draft_claims',
  'draft_specification',
  'validate_specification',
] as const

/** Plugin config. */
export interface Config {
  /**
   * Rule-asset root override, mirroring the packaged assets/rules/ layout
   * (patent/, base/, domains/). Omitted uses the packaged assets.
   */
  rulesDir?: string
  /** Tool names whose results run through the output gate. Defaults to the delivery tools. */
  gateToolNames?: string[]
  /** When true, review-level violations block without an approval round-trip (unattended fail-closed). */
  approvalDisabled?: boolean
}

export const Config: z<Config> = z.object({
  rulesDir: z.string(),
  gateToolNames: z.array(z.string()).default([...DEFAULT_GATE_TOOL_NAMES]),
  approvalDisabled: z.boolean().default(false),
})

/** Extract the concatenated plain-text content of a tool result (empty for non-text blocks). */
function resultText(result: Readonly<ToolExecutionResult>): string {
  let text = ''
  for (const block of result.content) {
    if (block.type === 'text') text += block.text
  }
  return text
}

/** A model-visible one-line summary of the review/block rule ids that fired. */
function hitSummary(result: RuleOutputGateResult): string {
  const ids = [...new Set([...result.blockHits, ...result.reviewHits])]
  const first = result.violations[0]
  /* v8 ignore next -- only called with block/review hits, so violations is non-empty. */
  const label = first ? '（' + first.ruleName + '）' : ''
  /* v8 ignore next -- only called with block/review hits, so ids is non-empty. */
  return ids.length > 0 ? ids.join(', ') + label : '(none)'
}

/**
 * Register the patent-rule contribution.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const gateToolNames = new Set(config.gateToolNames ?? DEFAULT_GATE_TOOL_NAMES)
  const approvalDisabled = config.approvalDisabled === true

  const { ruleSet, warnings } = loadPatentFullRuleSet(config.rulesDir)
  for (const warning of warnings) ctx.logger.warn('patent-rule: ' + warning)
  const gate = new RuleOutputGate(selectGateRules(ruleSet))

  // EVI-011 evidence-compliance guards: monotonic deny (no allow result), so no
  // allow/ask permission rule can override them.
  const ruleDirs = [patentAssetDir(config.rulesDir)]
  for (const guard of createEvidenceComplianceGuards(ruleDirs)) {
    ctx.tools.guard(guard)
  }

  ctx.on('tools/post-execute', async (exec: ToolExecution, result, next): Promise<PostToolDecision> => {
    if (!gateToolNames.has(exec.name) || result.isError) return next()
    const text = resultText(result)
    if (text.trim().length === 0) return next()

    const gateResult = gate.process(text)
    if (gateResult.blockHits.length > 0) {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: '专利输出门禁拦截 ' + exec.name + '：命中强制规则 ' + hitSummary(gateResult) }],
      }
    }
    // warn/log 原样放行（post-execute 无法改写已生成的结果文本）；
    // warn 命中记日志，避免"计算后丢弃"的静默。
    if (gateResult.warnHits.length > 0) {
      ctx.logger.warn('patent-rule: ' + exec.name + ' 命中 warn 级规则 ' + gateResult.warnHits.join(', '))
    }
    if (gateResult.reviewHits.length === 0) return next()

    const reason = '专利输出门禁请求审批 ' + exec.name + '：命中待审规则 ' + hitSummary(gateResult)
    const approval = ctx.get('approval')
    // fail-closed：无审批通道（未配/无 agent/approvalDisabled）时按拦截处理。
    if (approvalDisabled || exec.agent === undefined || approval === undefined) {
      return { kind: 'block', feedback: [{ type: 'text', text: reason + '（无审批通道，按拦截处理）' }] }
    }
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      reason,
      signal: exec.signal,
    })
    if (outcome !== 'allowed-once') {
      return { kind: 'block', feedback: [{ type: 'text', text: reason + '（审批未通过，按拦截处理）' }] }
    }
    return next()
  })
}
