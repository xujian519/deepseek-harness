/**
 * Function plugin registering `evaluate_legal_evidence`: legal evidence triple-attribute
 * assessment for the eight statutory evidence types under PRC Civil Procedure Law Art. 66.
 *
 * The engine is loaded at plugin load, with optional YAML rules asset.
 * @module @deepseek-ai/dsh-legal-evidence
 */

import type { Context } from '@deepseek-ai/cordis'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LegalEvidenceEngine } from './engine.ts'
import { parseLegalRuleSet } from './rule-set.ts'
import { createEvaluateLegalEvidenceTool } from './tool/evaluate-evidence.ts'

// Public library API: the engine, the evaluators, the types, and the tool factory.
export { LegalEvidenceEngine } from './engine.ts'
export { DEFAULT_LEGAL_WEIGHTS, parseLegalRuleSet } from './rule-set.ts'
export {
  documentaryEvaluator,
  electronicEvaluator,
  expertOpinionEvaluator,
  getEvaluator,
  witnessTestimonyEvaluator,
} from './evaluators/index.ts'
export type { LegalEvidenceEvaluator } from './evaluators/index.ts'
export {
  audioVisualEvaluator,
  inspectionRecordEvaluator,
  partyStatementEvaluator,
  physicalEvaluator,
} from './evaluators/index.ts'
export {
  createEvaluateLegalEvidenceTool,
  EvaluateLegalEvidenceToolError,
  type EvaluateLegalEvidenceOutput,
} from './tool/evaluate-evidence.ts'
export type {
  LegalEvidenceAssessment,
  LegalEvidenceDimensionJudgment,
  LegalEvidenceEngineInterface,
  LegalEvidenceFinding,
  LegalEvidenceInput,
  LegalEvidenceRule,
  LegalEvidenceRuleSet,
  LegalEvidenceScore,
  LegalEvidenceType,
} from './types.ts'
export { LEGAL_EVIDENCE_TYPES } from './types.ts'

/** Cordis plugin name. */
export const name = 'legal-evidence'

/** Services the plugin requires before registration. */
export const inject = ['tools']

/** Model-facing legal-evidence plugin configuration. */
export interface Config {
  /** Directory holding the legal-evidence rules YAML file; defaults to the packaged asset. */
  rulesDir?: string
}

/** Thrown when the configured legal-evidence rules asset is missing or unparseable. */
export class LegalEvidenceRuleAssetError extends Error {
  /**
   * @param message - what is wrong with the asset.
   */
  constructor(message: string) {
    super(message)
    this.name = 'LegalEvidenceRuleAssetError'
  }
}

/**
 * Register the evaluate_legal_evidence tool over the configured legal-evidence engine.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - rules directory override.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const engine = loadEngine(config.rulesDir)
  for (const warning of engine.getWarnings()) ctx.logger.warn(`[legal-evidence] ${warning}`)
  ctx.tools.register(createEvaluateLegalEvidenceTool(engine))
}

/**
 * Load the legal evidence engine from an explicit or packaged rules asset.
 *
 * A missing file or an unparseable document fails the plugin load: a tuned
 * deployment must not silently score with default weights. Individual rule
 * entries that fail validation stay warnings and are logged by the caller.
 * @param rulesDir - rules directory override; defaults to the packaged asset.
 * @returns the engine carrying the parsed rule set.
 * @throws LegalEvidenceRuleAssetError when the file is missing or unparseable.
 */
function loadEngine(rulesDir?: string): LegalEvidenceEngine {
  const path = join(rulesDir ?? defaultRulesDir(), 'legal-evidence-rules.yaml')
  if (!existsSync(path)) {
    throw new LegalEvidenceRuleAssetError(`法律证据规则资产不存在：${path}`)
  }
  const text = readFileSync(path, 'utf8')
  const parsed = parseLegalRuleSet(text, path)
  if (parsed.ruleSet === null) {
    throw new LegalEvidenceRuleAssetError(`法律证据规则资产无法解析：${path}（${parsed.warnings.join('；')}）`)
  }
  return new LegalEvidenceEngine(text, path)
}

/** Default rules directory (packaged asset). */
function defaultRulesDir(): string {
  return join(import.meta.dirname, '..', 'assets')
}
