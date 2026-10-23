/**
 * Adversary-model evaluation script.
 *
 * Reads the annotated OA retrospective dataset (30 cases / 53 disputes) and
 * evaluates the adversary-model's hit rate against ground truth.
 *
 * Pipeline per record:
 * 1. oa-parse: firstOa.text → office_action (deterministic)
 * 2. response-plan: office_action + claims → response_plan (deterministic)
 * 3. adversary-model: office_action + claims + response_plan → adversary_disputes
 *
 * Hit rate calculation:
 * - Expand each dispute to (statute, claim) pairs
 * - Compare adversary-identified pairs vs ground truth pairs
 * - Wilson score interval (95% CI, z=1.96) + Wald normal approximation interval
 *
 * Output: Markdown report to stdout + optional JSON file.
 *
 * @module dsh-scripts/adversary-eval
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseOaRetroJsonl, type OaRetroCase, type OaRetroDispute } from './patent-oa-retro.ts'

/**
 * Import the atom handlers and adversary module functions
 * via the published package entry point (source-plane vs artifact-plane separation).
 */
import {
  GROUND_TO_STATUTE,
  OaParseHandler,
  ResponsePlanHandler,
  AdversaryModelHandler,
} from '@deepseek-ai/dsh-patent-core'
import type {
  PipelineState,
  StageExecuteInput,
  AdversaryDispute,
} from '@deepseek-ai/dsh-patent-core'

/** (statute, claim) pair for hit rate calculation. */
type StatuteClaimPair = {
  statute: string
  claim: number
}

/** Evaluation result for one case. */
type CaseEvalResult = {
  id: string
  groundTruthPairs: StatuteClaimPair[]
  /** Pairs the existing response-plan baseline covers. */
  baselinePairs: StatuteClaimPair[]
  adversaryPairs: StatuteClaimPair[]
  hitPairs: StatuteClaimPair[]
  missedPairs: StatuteClaimPair[]
  baselineHitPairs: StatuteClaimPair[]
  groundTruthDisputes: OaRetroDispute[]
  adversaryDisputes: AdversaryDispute[]
}

/** Grouped report by statute. */
type StatuteGroupReport = {
  statute: string
  groundTruthCount: number
  hitCount: number
  hitRate: number
}

/** Overall evaluation metrics. */
type EvalMetrics = {
  totalCases: number
  totalGroundTruthPairs: number
  totalHitPairs: number
  hitRate: number
  /** Pairs the existing response-plan baseline covers. */
  baselineHitPairs: number
  /** Baseline hit rate over the same ground truth. */
  baselineHitRate: number
  wilsonLower: number
  wilsonUpper: number
  waldLower: number
  waldUpper: number
  byStatute: StatuteGroupReport[]
  misses: { recordId: string; statute: string; claim: number }[]
}

/**
 * Expand disputes to (statute, claim) pairs.
 * Filters out entries with missing or malformed fields.
 * @param disputes - Disputes with statute and claims array.
 * @returns Expanded pairs.
 */
function expandToPairs(disputes: readonly { statute: string; claims: number[] }[]): StatuteClaimPair[] {
  const pairs: StatuteClaimPair[] = []
  for (const dispute of disputes) {
    if (typeof dispute.statute !== 'string' || dispute.statute === '') continue
    if (!Array.isArray(dispute.claims)) continue
    for (const claim of dispute.claims) {
      if (typeof claim !== 'number') continue
      pairs.push({ statute: dispute.statute, claim })
    }
  }
  return pairs
}

/**
 * Check if a pair exists in an array.
 * @param pairs - Array to search.
 * @param pair - Pair to find.
 * @returns True if found.
 */
function pairExists(pairs: StatuteClaimPair[], pair: StatuteClaimPair): boolean {
  return pairs.some(p => p.statute === pair.statute && p.claim === pair.claim)
}

/**
 * Expand the response-plan baseline to (statute, claim) pairs.
 *
 * The deterministic plan covers one section per rejection type over every
 * affected claim, so its pair set is the cross product of the mapped statutes
 * and `affectedClaims`. This is the baseline the adversary must improve on.
 * @param officeAction - Parsed office action JSON string.
 * @returns Baseline pairs.
 */
function baselinePairs(officeAction: string): StatuteClaimPair[] {
  const parsed: unknown = JSON.parse(officeAction)
  if (parsed === null || typeof parsed !== 'object') return []
  const record = parsed as { rejectionTypes?: unknown; affectedClaims?: unknown }
  const types = Array.isArray(record.rejectionTypes) ? record.rejectionTypes : []
  const claims = Array.isArray(record.affectedClaims)
    ? record.affectedClaims.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0)
    : []
  const statutes = new Set<string>()
  for (const ground of types) {
    if (typeof ground !== 'string') continue
    const statute = GROUND_TO_STATUTE.get(ground)
    if (statute !== undefined) statutes.add(statute)
  }
  const pairs: StatuteClaimPair[] = []
  for (const statute of statutes) {
    for (const claim of claims) pairs.push({ statute, claim })
  }
  return pairs
}

/**
 * Calculate Wilson score interval.
 * @param hits - Number of hits.
 * @param total - Total count.
 * @param z - Z-score for confidence level (default 1.96 for 95%).
 * @returns [lower, upper] bounds.
 */
function wilsonScoreInterval(hits: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0]
  const p = hits / total
  const denominator = 1 + z * z / total
  const center = (p + z * z / (2 * total)) / denominator
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
  return [Math.max(0, center - spread), Math.min(1, center + spread)]
}

/**
 * Calculate Wald normal approximation interval.
 *
 * NOTE: This was previously misnamed as "Clopper-Pearson exact interval" but
 * actually computes the Wald interval (p ± z * sqrt(p*(1-p)/n)). A true
 * Clopper-Pearson implementation would require beta distribution quantiles.
 * @param hits - Number of hits.
 * @param total - Total count.
 * @param z - Z-score for confidence level (default 1.96 for 95%).
 * @returns [lower, upper] bounds.
 */
function waldInterval(hits: number, total: number, z = 1.96): [number, number] {
  if (total === 0) return [0, 0]
  const p = hits / total
  const se = Math.sqrt(p * (1 - p) / total)
  return [Math.max(0, p - z * se), Math.min(1, p + z * se)]
}

/**
 * Run oa-parse atom on first OA text.
 * @param firstOaText - First office action text.
 * @returns Parsed office_action as JSON string.
 */
async function runOaParse(firstOaText: string): Promise<string> {
  const handler = new OaParseHandler()
  const state: PipelineState = { input: firstOaText }
  const input: StageExecuteInput = { state }
  const result = await handler.execute(input)
  return result.office_action as string
}

/**
 * Run response-plan atom.
 * @param officeAction - Parsed office action JSON string.
 * @param claimsText - Claims text.
 * @returns Response plan as string.
 */
async function runResponsePlan(officeAction: string, claimsText: string): Promise<string> {
  const handler = new ResponsePlanHandler()
  const state: PipelineState = { office_action: officeAction, claims: claimsText }
  const input: StageExecuteInput = { state }
  const result = await handler.execute(input)
  return result.response_plan as string
}

/**
 * Run adversary-model atom.
 * @param officeAction - Parsed office action JSON string.
 * @param claimsText - Claims text.
 * @param responsePlan - Response plan string.
 * @returns Adversary disputes array.
 */
async function runAdversaryModel(
  officeAction: string,
  claimsText: string,
  responsePlan: string,
): Promise<AdversaryDispute[]> {
  const handler = new AdversaryModelHandler()
  const state: PipelineState = {
    office_action: officeAction,
    claims: claimsText,
    response_plan: responsePlan,
    response_plan_summary: '',
  }
  const input: StageExecuteInput = { state }
  const result = await handler.execute(input)
  const disputesRaw = result.adversary_disputes
  if (Array.isArray(disputesRaw)) {
    return disputesRaw as AdversaryDispute[]
  }
  return []
}

/**
 * Evaluate one case.
 * @param caseData - Case from dataset.
 * @returns Evaluation result.
 */
async function evaluateCase(caseData: OaRetroCase): Promise<CaseEvalResult> {
  // Step 1: oa-parse
  const officeAction = await runOaParse(caseData.firstOa.text)

  // Step 2: response-plan
  const responsePlan = await runResponsePlan(officeAction, caseData.claims)

  // Step 3: adversary-model
  const adversaryDisputes = await runAdversaryModel(officeAction, caseData.claims, responsePlan)

  // Expand to pairs
  const groundTruthPairs = expandToPairs(caseData.secondOa.disputes)
  const adversaryPairs = expandToPairs(adversaryDisputes)
  const baseline = baselinePairs(officeAction)

  // Calculate hits
  const hitPairs: StatuteClaimPair[] = []
  const missedPairs: StatuteClaimPair[] = []
  const baselineHitPairs: StatuteClaimPair[] = []

  for (const gtPair of groundTruthPairs) {
    if (pairExists(adversaryPairs, gtPair)) {
      hitPairs.push(gtPair)
    } else {
      missedPairs.push(gtPair)
    }
    if (pairExists(baseline, gtPair)) baselineHitPairs.push(gtPair)
  }

  return {
    id: caseData.id,
    groundTruthPairs,
    baselinePairs: baseline,
    adversaryPairs,
    hitPairs,
    missedPairs,
    baselineHitPairs,
    groundTruthDisputes: caseData.secondOa.disputes,
    adversaryDisputes,
  }
}

/**
 * Aggregate evaluation results into metrics.
 * @param results - Per-case results.
 * @returns Overall metrics.
 */
function aggregateMetrics(results: CaseEvalResult[]): EvalMetrics {
  let totalGroundTruthPairs = 0
  let totalHitPairs = 0
  let totalBaselineHitPairs = 0
  const byStatuteMap = new Map<string, { groundTruthCount: number; hitCount: number }>()
  const misses: { recordId: string; statute: string; claim: number }[] = []

  for (const result of results) {
    totalGroundTruthPairs += result.groundTruthPairs.length
    totalHitPairs += result.hitPairs.length
    totalBaselineHitPairs += result.baselineHitPairs.length

    // Group by statute
    for (const pair of result.groundTruthPairs) {
      const entry = byStatuteMap.get(pair.statute) ?? { groundTruthCount: 0, hitCount: 0 }
      entry.groundTruthCount = entry.groundTruthCount + 1
      if (pairExists(result.hitPairs, pair)) {
        entry.hitCount += 1
      }
      byStatuteMap.set(pair.statute, entry)
    }

    // Record misses
    for (const pair of result.missedPairs) {
      misses.push({ recordId: result.id, statute: pair.statute, claim: pair.claim })
    }
  }

  const hitRate = totalGroundTruthPairs > 0 ? totalHitPairs / totalGroundTruthPairs : 0
  const baselineHitRate = totalGroundTruthPairs > 0 ? totalBaselineHitPairs / totalGroundTruthPairs : 0
  const [wilsonLower, wilsonUpper] = wilsonScoreInterval(totalHitPairs, totalGroundTruthPairs)
  const [waldLower, waldUpper] = waldInterval(totalHitPairs, totalGroundTruthPairs)

  const byStatute: StatuteGroupReport[] = []
  for (const [statute, counts] of byStatuteMap.entries()) {
    byStatute.push({
      statute,
      groundTruthCount: counts.groundTruthCount,
      hitCount: counts.hitCount,
      hitRate: counts.groundTruthCount > 0 ? counts.hitCount / counts.groundTruthCount : 0,
    })
  }
  byStatute.sort((a, b) => a.statute.localeCompare(b.statute))

  return {
    totalCases: results.length,
    totalGroundTruthPairs,
    totalHitPairs,
    hitRate,
    baselineHitPairs: totalBaselineHitPairs,
    baselineHitRate,
    wilsonLower,
    wilsonUpper,
    waldLower,
    waldUpper,
    byStatute,
    misses,
  }
}

/**
 * Render evaluation report as Markdown.
 * @param metrics - Evaluation metrics.
 * @returns Markdown report.
 */
function renderReport(metrics: EvalMetrics): string {
  const lines: string[] = []

  lines.push('# Adversary-Model 评测报告')
  lines.push('')
  lines.push('## 总体指标')
  lines.push('')
  lines.push(`- **评测案例数**: ${metrics.totalCases}`)
  lines.push(`- **Ground truth (statute, claim) 对数**: ${metrics.totalGroundTruthPairs}`)
  lines.push(`- **命中对数**: ${metrics.totalHitPairs}`)
  lines.push(`- **命中率**: ${(metrics.hitRate * 100).toFixed(1)}%`)
  lines.push(`- **基线（response-plan）命中率**: ${(metrics.baselineHitRate * 100).toFixed(1)}%（${metrics.baselineHitPairs}/${metrics.totalGroundTruthPairs}）`)
  lines.push(`- **相对基线增量**: ${((metrics.hitRate - metrics.baselineHitRate) * 100).toFixed(1)} 个百分点`)
  lines.push('')
  lines.push('### 置信区间（95% 置信水平）')
  lines.push('')
  lines.push(`- **Wilson score interval**: [${(metrics.wilsonLower * 100).toFixed(1)}%, ${(metrics.wilsonUpper * 100).toFixed(1)}%]`)
  lines.push(`- **Wald 正态近似区间**: [${(metrics.waldLower * 100).toFixed(1)}%, ${(metrics.waldUpper * 100).toFixed(1)}%]`)
  lines.push('')

  lines.push('## 按法条分组报告')
  lines.push('')
  lines.push('| 法条 | Ground Truth 对数 | 命中数 | 命中率 |')
  lines.push('|------|------------------|--------|--------|')
  for (const group of metrics.byStatute) {
    lines.push(`| ${group.statute} | ${group.groundTruthCount} | ${group.hitCount} | ${(group.hitRate * 100).toFixed(1)}% |`)
  }
  lines.push('')

  if (metrics.misses.length > 0) {
    lines.push('## 未命中记录')
    lines.push('')
    lines.push(`共 ${metrics.misses.length} 条未命中：`)
    lines.push('')
    lines.push('| 案例 ID | 法条 | 权项 |')
    lines.push('|---------|------|------|')
    for (const miss of metrics.misses) {
      lines.push(`| ${miss.recordId} | ${miss.statute} | ${miss.claim} |`)
    }
    lines.push('')
  }

  lines.push('## 说明')
  lines.push('')
  lines.push('- **命中率** = |adversary 识别的 (statute, claim) 对 ∩ ground truth| / |ground truth|')
  lines.push('- **宽松匹配**：adversary 可多报但不应漏报')
  lines.push('- 当前 adversary-model 为确定性骨架（不调用模型），完整版应通过 StageProvider.llm 做独立证据评估')
  lines.push('')

  return lines.join('\n')
}

/** CLI help text. */
const HELP = `Usage: pnpm exec tsx scripts/adversary-eval.ts [options]

Evaluate adversary-model hit rate against annotated OA retrospective dataset.

Options:
  --dataset <path>  Path to dataset.jsonl (default: .dsh-work/patent-oa-retro/annotated/dataset.jsonl)
  --json <path>     Write detailed JSON results to file
  --help            Print this help and exit

Output:
  Markdown evaluation report to stdout.
`

/**
 * Main entry point.
 * @param argv - Command line arguments.
 * @returns Exit code.
 */
async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help')) {
    console.log(HELP)
    return 0
  }

  let datasetPath = '.dsh-work/patent-oa-retro/annotated/dataset.jsonl'
  let jsonOutputPath: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--dataset') {
      const next = argv[i + 1]
      if (next === undefined) {
        console.error('--dataset requires a path argument')
        return 1
      }
      datasetPath = next
      i += 1
    } else if (arg === '--json') {
      const next = argv[i + 1]
      if (next === undefined) {
        console.error('--json requires a path argument')
        return 1
      }
      jsonOutputPath = next
      i += 1
    } else if (arg.startsWith('--')) {
      console.error(`Unknown option: ${arg}`)
      return 1
    }
  }

  // Read dataset
  let datasetText: string
  try {
    datasetText = readFileSync(datasetPath, 'utf8')
  } catch (error) {
    console.error(`Failed to read dataset: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const records = parseOaRetroJsonl(datasetText)
  const cases: OaRetroCase[] = []

  for (const [index, record] of records.entries()) {
    if (!isOaRetroCase(record)) {
      console.error(`Case ${index + 1}: invalid structure`)
      continue
    }
    cases.push(record)
  }

  if (cases.length === 0) {
    console.error('No valid cases found in dataset')
    return 1
  }

  console.error(`Evaluating ${cases.length} cases...`)

  // Evaluate each case
  const results: CaseEvalResult[] = []
  for (const caseData of cases) {
    try {
      const result = await evaluateCase(caseData)
      results.push(result)
    } catch (error) {
      console.error(`Failed to evaluate case ${caseData.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Aggregate metrics
  const metrics = aggregateMetrics(results)

  // Output report
  const report = renderReport(metrics)
  console.log(report)

  // Optional JSON output
  if (jsonOutputPath !== undefined) {
    const jsonOutput = {
      metrics: {
        totalCases: metrics.totalCases,
        totalGroundTruthPairs: metrics.totalGroundTruthPairs,
        totalHitPairs: metrics.totalHitPairs,
        hitRate: metrics.hitRate,
        wilsonInterval: [metrics.wilsonLower, metrics.wilsonUpper],
        waldInterval: [metrics.waldLower, metrics.waldUpper],
        byStatute: metrics.byStatute,
      },
      misses: metrics.misses,
      perCase: results.map(r => ({
        id: r.id,
        groundTruthPairs: r.groundTruthPairs,
        adversaryPairs: r.adversaryPairs,
        hitPairs: r.hitPairs,
        missedPairs: r.missedPairs,
      })),
    }
    writeFileSync(jsonOutputPath, JSON.stringify(jsonOutput, null, 2))
    console.error(`JSON results written to: ${jsonOutputPath}`)
  }

  return 0
}

/**
 * Type guard for OaRetroCase.
 * @param value - Value to check.
 * @returns True if valid OaRetroCase.
 */
function isOaRetroCase(value: unknown): value is OaRetroCase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return false
  if (typeof record.firstOa !== 'object' || record.firstOa === null) return false
  if (typeof (record.firstOa as Record<string, unknown>).text !== 'string') return false
  if (typeof record.secondOa !== 'object' || record.secondOa === null) return false
  const secondOa = record.secondOa as Record<string, unknown>
  if (typeof secondOa.text !== 'string') return false
  if (!Array.isArray(secondOa.disputes)) return false
  if (typeof record.claims !== 'string') return false
  return true
}

// CLI entry point
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code },
    (error: unknown) => {
      console.error(error)
      process.exitCode = 1
    },
  )
}
