/**
 * `rule_check` tool: run the deterministic constitutional rule engine over text
 * and return violations with severity/action/legal basis. Ported from Sati's
 * ruleCheck.ts; the engine and rule assets live in @deepseek-ai/dsh-patent-rule.
 * @module @deepseek-ai/dsh-patent-tools/tool/rule-check
 */

import { statSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  evaluateText,
  loadPatentComplianceRuleSet,
  loadPatentElectricalRuleSet,
  loadPatentFullRuleSet,
  loadRulePack,
  loadSynonymsAsset,
  resolveRulePackManifestPath,
  summarizeRulePackLayers,
} from '@deepseek-ai/dsh-patent-rule'
import type { RulePackLoadResult } from '@deepseek-ai/dsh-patent-rule'
import type { RuleSet } from '@deepseek-ai/dsh-patent-core'
import type { SynonymMap } from '@deepseek-ai/dsh-patent-rule'
import { PatentToolError } from '../error.ts'

export type RuleCheckInput = {
  /** The text to check. */
  text: string
  /** Rule-set scope (default "patent" = bundled patent compliance rules). */
  scope?: string
}

export type RuleViolationView = {
  ruleId: string
  ruleName: string
  severity: string
  action: string
  legalBasis?: string
  message: string
  evidence: string[]
}

export type RuleCheckOutput = {
  scope: string
  violations: RuleViolationView[]
  /** Layered pack summary (scope=pack only). */
  packHeader?: string
  packWarnings?: string[]
}

/** Injectables mirroring Sati's RuleCheckDeps (tests override; defaults use the bundled assets). */
export type RuleCheckDeps = {
  /** scope → RuleSet loader (default: bundled patent compliance rules). */
  loader?: (scope: string) => RuleSet
  /** Synonym map loader (default: bundled rules/patent/synonyms.yaml). */
  synonyms?: () => SynonymMap
  /** Layered rule-pack loader (default: bundled loadRulePack). */
  pack?: () => RulePackLoadResult
}

/** rule_check supported scopes (shared by the description and the runtime error). */
const AVAILABLE_SCOPES = 'patent, patent-electrical, patent-full, pack'

const DESCRIPTION = [
  'Run deterministic constitutional rule checks (keyword blocklist / pattern / structural / citation range / synonym match)',
  'against the given text and return violations with severity, action and legal basis.',
  'Use before publishing compliance-sensitive output (e.g. patent conclusions, legal opinions).',
  "Scopes: 'patent' (general patent compliance), 'patent-electrical' (H-section electrical rules + general compliance),",
  "'patent-full' (general compliance + full nuo patent rule set, activation-reviewed),",
  "or 'pack' (layered rule pack assembled from the project manifest .sati/rules.yaml: base + domains + overrides).",
].join(' ')

/** Render the canonical rule-check value into model-facing prose. */
function renderRuleCheck(value: RuleCheckOutput): string {
  const header = value.packHeader !== undefined ? `${value.packHeader}\n` : ''
  const warnings = value.packWarnings !== undefined && value.packWarnings.length > 0 ? `\n加载警告: ${value.packWarnings.join('；')}` : ''
  if (value.violations.length === 0) {
    return `${header}rule_check(${value.scope}): 无违规${warnings}`
  }
  const lines = value.violations.map((v) => {
    const basis = v.legalBasis ? `（依据：${v.legalBasis}）` : ''
    const evidence = v.evidence.length > 0 ? ` 命中「${v.evidence.join('」「')}」` : ''
    return `- [${v.severity}/${v.action}] ${v.ruleId} ${v.ruleName}：${v.message}${evidence}${basis}`
  })
  const summary = `rule_check(${value.scope}): 发现 ${value.violations.length} 条违规`
  return `${header}${summary}\n${lines.join('\n')}${warnings}`
}

const VIOLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ruleId: { type: 'string', required: true },
    ruleName: { type: 'string', required: true },
    severity: { type: 'string', required: true },
    action: { type: 'string', required: true },
    legalBasis: { type: 'string' },
    message: { type: 'string', required: true },
    evidence: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/**
 * Build the `rule_check` tool over injectable rule-set loaders.
 * @param deps - optional loader injections (defaults use the bundled patent-rule assets).
 * @returns a registry-ready tool definition.
 */
export function createRuleCheckTool(deps: RuleCheckDeps = {}): ToolDefinition {
  const cache = new Map<string, { ruleSet: RuleSet; pack: RulePackLoadResult | null; key: string | null }>()

  const packCacheKey = (): string | null => {
    const manifestPath = resolveRulePackManifestPath()
    if (manifestPath === null) return null
    try {
      return `${manifestPath}@${statSync(manifestPath).mtimeMs}`
    } catch {
      return null
    }
  }

  const resolve = (scope: string): { ruleSet: RuleSet; pack: RulePackLoadResult | null } => {
    const isPack = scope === 'pack' && deps.loader === undefined
    const key = isPack ? packCacheKey() : null
    const cached = cache.get(scope)
    if (cached !== undefined && cached.key === key) return { ruleSet: cached.ruleSet, pack: cached.pack }
    let ruleSet: RuleSet
    let pack: RulePackLoadResult | null = null
    if (isPack) {
      pack = deps.pack ? deps.pack() : loadRulePack()
      ruleSet = pack.ruleSet
    } else if (deps.loader) {
      ruleSet = deps.loader(scope)
    } else if (scope === 'patent') {
      ruleSet = loadPatentComplianceRuleSet().ruleSet
    } else if (scope === 'patent-electrical') {
      ruleSet = loadPatentElectricalRuleSet().ruleSet
    } else if (scope === 'patent-full') {
      ruleSet = loadPatentFullRuleSet().ruleSet
    } else {
      ruleSet = { rules: [] }
    }
    cache.set(scope, { ruleSet, pack, key })
    return { ruleSet, pack }
  }

  const synonymsCache: SynonymMap = deps.synonyms ? deps.synonyms() : loadSynonymsAsset().synonyms

  return defineTool({
    name: 'rule_check',
    description: DESCRIPTION,
    parameters: {
      text: { type: 'string', required: true, description: 'The text to check.' },
      scope: { type: 'string', description: "Rule set scope. Defaults to 'patent' (bundled patent compliance rules). 'pack' loads the layered rule pack declared by .sati/rules.yaml." },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: { type: 'string', required: true },
          violations: { type: 'array', required: true, items: VIOLATION_SCHEMA },
          packHeader: { type: 'string' },
          packWarnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRuleCheck(value as unknown as RuleCheckOutput) }],
    },
    async execute(args) {
      const scope = args.scope ?? 'patent'
      const { ruleSet, pack } = resolve(scope)
      if (ruleSet.rules.length === 0) {
        throw new PatentToolError('invalid_tool_input', `rule_check(${scope}): 未加载任何规则（scope 未知或规则集为空）。可用 scope: ${AVAILABLE_SCOPES}`, { tool: 'rule_check', scope })
      }
      const evaluation = evaluateText(args.text, ruleSet, synonymsCache)
      const packHeader = pack !== null
        ? `规则分层: ${summarizeRulePackLayers(pack.layers)}（清单: ${pack.manifestPath ?? '无，默认 rules/base'}）`
        : undefined
      return {
        scope,
        violations: evaluation.violations.map(v => ({
          ruleId: v.ruleId,
          ruleName: v.ruleName,
          severity: v.severity,
          action: v.action,
          ...(v.legalBasis !== undefined ? { legalBasis: v.legalBasis } : {}),
          message: v.message,
          evidence: v.evidence,
        })),
        ...(packHeader !== undefined ? { packHeader } : {}),
        ...(pack !== null && pack.warnings.length > 0 ? { packWarnings: pack.warnings } : {}),
      }
    },
  })
}
