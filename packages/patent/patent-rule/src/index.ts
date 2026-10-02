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
 *   check families selected by {@link Config.gateCheckTypes} (default: the
 *   keyword_blocklist subset; an absence-based family is rejected with a
 *   warning). A block-level violation returns
 *   `{ kind: 'block' }`; a review-level violation fires `ctx.get('approval')`
 *   and accepts only on `'allowed-once'` (fail-closed with no answerer, no
 *   agent, or `approvalDisabled`); warn/log violations pass through unchanged.
 * - A declared structural gate ({@link Config.structuralGate}) denies a
 *   delivery-tool call before dispatch when the artifact text in its arguments
 *   violates a named absence-based rule: those rules cannot judge a tool
 *   result's prose (plain text is always "missing" most expected elements), so
 *   they run on the artifact a production tool is about to render or write.
 * - A declared delivery gate ({@link Config.deliveryGate}) denies a
 *   delivery-tool call whose declared prerequisite calls have not succeeded
 *   earlier in the same session, so a deliverable cannot ship without the gate
 *   runs the delivery discipline requires. Successful prerequisite calls are
 *   recorded from tools/post-execute; the deny is a monotonic guard.
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
import type { RuleOutputGate as PatentRuleOutputGate, RuleOutputGateResult } from '@deepseek-ai/dsh-patent-core'
import { patentAssetDir } from './asset-location.ts'
import { createEvidenceComplianceGuards } from './guard/evidenceComplianceGuards.ts'
import {
  ARTIFACT_GATE_CHECK_TYPES,
  DEFAULT_GATE_CHECK_TYPES,
  GATE_CHECK_TYPES,
  isGateCheckType,
  loadPatentFullRuleSet,
  selectGateRules,
  type GateCheckType,
} from './runtime/patent-compliance.ts'
import { RuleOutputGate } from './runtime/output-gate.ts'
import {
  deliveryGateMissing,
  DeliveryAttemptLedger,
  renderDeliveryGateDenial,
  resolveDeliveryGate,
  type DeliveryGateEntry,
  type DeliveryGatePlan,
} from './runtime/delivery-gate.ts'
import {
  renderStructuralGateDenial,
  resolveStructuralGate,
  structuralGateViolations,
  type StructuralGateEntry,
  type StructuralGatePlan,
} from './runtime/structural-gate.ts'

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
  DEFAULT_GATE_CHECK_TYPES,
  GATE_CHECK_TYPES,
  INCIDENT_GATE_CHECK_TYPES,
  ARTIFACT_GATE_CHECK_TYPES,
  isGateCheckType,
  loadActivationOverrides,
  loadPatentComplianceRuleSet,
  loadPatentElectricalRuleSet,
  loadPatentFullRuleSet,
  patentCaseDomains,
  selectGateRules,
  PATENT_CASE_DOMAINS,
  type ActivationOverrides,
  type GateCheckType,
  type PatentCaseScope,
  type PatentComplianceLoadResult,
} from './runtime/patent-compliance.ts'
export {
  renderStructuralGateDenial,
  resolveStructuralGate,
  structuralGateText,
  structuralGateViolations,
  type ResolvedStructuralGateEntry,
  type StructuralGateEntry,
  type StructuralGatePlan,
} from './runtime/structural-gate.ts'
export {
  declaredArgsMatch,
  jsonRecord,
  type DeclaredArgValue,
} from './runtime/args-match.ts'
export {
  DeliveryAttemptLedger,
  deliveryGateMissing,
  renderDeliveryGateDenial,
  resolveDeliveryGate,
  type DeliveryGateEntry,
  type DeliveryGatePlan,
} from './runtime/delivery-gate.ts'
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

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The rule output gate for the loaded rule pack; present only when this plugin is mounted (patent-teams gating). */
    patentRuleGate?: PatentRuleOutputGate
  }
}

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
  /**
   * Check families the result gate keeps. Defaults to `keyword_blocklist`
   * (incident: a hit is a violation). Widening to
   * `pattern_analysis` / `citation_analysis` / `quote_repetition` is a
   * deployment choice; the absence-based families (`structural_analysis` /
   * `synonym_match`) are rejected with a warning, because a tool result's prose
   * is always "missing" most expected elements — they run through
   * {@link Config.structuralGate} instead. Widening adds log lines only while
   * the shipped incident-family rules are `action: warn`.
   */
  gateCheckTypes?: string[]
  /**
   * Artifact structural gate: entries naming a tool, the arguments holding its
   * artifact text, and the absence-based rule ids to judge it by. A block-level
   * hit denies the call before dispatch, so a non-conforming artifact is never
   * rendered or written. No entry ships: a template renderer's arguments hold
   * slot fragments, so absence checks on them report defects the rendered
   * document does not have — declare an entry only where the argument is the
   * whole document text.
   */
  structuralGate?: StructuralGateEntry[]
  /**
   * Delivery gate: entries naming a delivery tool and the tools that must have
   * succeeded earlier in the same session before it may run. An unsatisfied
   * entry denies the call through a monotonic guard, so a deliverable cannot
   * ship while the gate runs its discipline requires are missing from the
   * session's call record. `whenArgs` narrows an entry to matching calls, which
   * lets one tool's forms carry different prerequisites. No entry ships: the
   * prerequisites a deployment requires are its delivery policy, not this
   * package's.
   */
  deliveryGate?: DeliveryGateEntry[]
  /** When true, review-level violations block without an approval round-trip (unattended fail-closed). */
  approvalDisabled?: boolean
}

export const Config: z<Config> = z.object({
  rulesDir: z.string(),
  gateToolNames: z.array(z.string()).default([...DEFAULT_GATE_TOOL_NAMES]),
  gateCheckTypes: z.array(z.string()).default([...DEFAULT_GATE_CHECK_TYPES]),
  structuralGate: z.array(z.object({
    tool: z.string().required(),
    textArgs: z.array(z.string()).required(),
    ruleIds: z.array(z.string()).required(),
    whenArgs: z.dict(z.string()).default({}),
  })).default([]),
  deliveryGate: z.array(z.object({
    tool: z.string().required(),
    requires: z.array(z.string()).required(),
    whenArgs: z.dict(z.union([z.string(), z.array(z.string())])),
  })).default([]),
  approvalDisabled: z.boolean().default(false),
})

/** 解析门禁检查族：未知取值与「缺失即违规」族都告警并跳过，其余按声明顺序保留。 */
function resolveGateCheckTypes(declared: readonly string[], warnings: string[]): GateCheckType[] {
  const resolved: GateCheckType[] = []
  for (const value of declared) {
    if (!isGateCheckType(value)) {
      warnings.push(`未知的门禁检查类型 "${value}"（可用：${GATE_CHECK_TYPES.join(' / ')}），已忽略`)
      continue
    }
    if ((ARTIFACT_GATE_CHECK_TYPES as readonly string[]).includes(value)) {
      warnings.push(`门禁检查类型 "${value}" 是「缺失即违规」族，对工具结果全文评测会海量误报；该族只经制品结构门禁（structuralGate，按声明的入参取制品文本）执行，已忽略`)
      continue
    }
    resolved.push(value)
  }
  return resolved
}

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
  const gateCheckTypes = resolveGateCheckTypes(config.gateCheckTypes ?? DEFAULT_GATE_CHECK_TYPES, warnings)
  const structuralGate: StructuralGatePlan = resolveStructuralGate(ruleSet, config.structuralGate ?? [])
  warnings.push(...structuralGate.warnings)
  const deliveryGate: DeliveryGatePlan = resolveDeliveryGate(config.deliveryGate ?? [])
  warnings.push(...deliveryGate.warnings)
  for (const warning of warnings) ctx.logger.warn('patent-rule: ' + warning)
  const gate = new RuleOutputGate(selectGateRules(ruleSet, gateCheckTypes))
  // Expose the same gate to team-consumers (e.g. patent-teams) so a task
  // completion can be rule-gated consistently with the tools/post-execute path.
  ctx.provide('patentRuleGate', gate)

  // EVI-011 evidence-compliance guards: monotonic deny (no allow result), so no
  // allow/ask permission rule can override them.
  const ruleDirs = [patentAssetDir(config.rulesDir)]
  for (const guard of createEvidenceComplianceGuards(ruleDirs)) {
    ctx.tools.guard(guard)
  }

  // 制品结构门禁：在调用前判定入参里的制品文本。「缺失即违规」的规则不能作用于工具
  // 结果全文，只能在制品进入渲染/落盘之前拦下——这是它们唯一的硬执行点。
  if (structuralGate.entries.length > 0) {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const violations = structuralGateViolations(structuralGate, exec.name, exec.arguments)
      if (violations.length === 0) return next()
      return { kind: 'deny', reason: renderStructuralGateDenial(exec.name, violations) }
    })
  }

  // 交付前置门禁：纪律（先跑哪个闸门才能出件）在此处成为执行点。台账只记成功返回的
  // 调用，判定与登记分开——调用前的 guard 只能看到「即将调用」，看不到结果。
  const deliveryLedger = new DeliveryAttemptLedger()
  const gatedTools = new Set(deliveryGate.entries.map(entry => entry.tool))
  const requiredTools = new Set(deliveryGate.entries.flatMap(entry => entry.requires))
  if (deliveryGate.entries.length > 0) {
    ctx.tools.guard((exec) => {
      if (!gatedTools.has(exec.name)) return undefined
      const missing = deliveryGateMissing(deliveryGate, deliveryLedger, exec.agent, exec.name, exec.arguments)
      return missing.length === 0 ? undefined : renderDeliveryGateDenial(exec.name, missing)
    })
  }

  ctx.on('tools/post-execute', async (exec: ToolExecution, result, next): Promise<PostToolDecision> => {
    // 先登记再判定：前置工具本身通常不在 gateToolNames 里，下面的输出门禁会直接放行。
    if (!result.isError && exec.agent !== undefined && requiredTools.has(exec.name)) {
      deliveryLedger.record(exec.agent, exec.name)
    }
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
    // warn/log 命中不改变结果文本：门禁只硬拦截 block、经审批放行 review；
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
