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

/**
 * Register the evaluate_legal_evidence tool over the configured legal-evidence engine.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - rules directory override.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const engine = loadEngine(config.rulesDir)
  ctx.tools.register(createEvaluateLegalEvidenceTool(engine))
}

/** Load the legal evidence engine with optional YAML rules asset. */
function loadEngine(rulesDir?: string): LegalEvidenceEngine {
  const candidates = rulesDir !== undefined ? [rulesDir] : [defaultRulesDir()]
  for (const dir of candidates) {
    const path = join(dir, 'legal-evidence-rules.yaml')
    if (!existsSync(path)) continue
    // File exists — parse errors must surface; only a missing file is a soft fallback.
    const engine = new LegalEvidenceEngine(readFileSync(path, 'utf8'), path)
    return engine
  }
  return new LegalEvidenceEngine()
}

/** Default rules directory (packaged asset). */
function defaultRulesDir(): string {
  return join(import.meta.dirname, '..', 'assets')
}
