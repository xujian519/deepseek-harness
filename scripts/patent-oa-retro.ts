/**
 * OA retrospective dataset validator.
 *
 * A dataset row pairs one first office action with the dispute points the
 * examiner actually maintained in the second office action. The second OA is
 * ground truth: rows without it, or with synthesized disputes, are rejected at
 * review even when this validator passes.
 *
 * Row contract (JSON Lines, one object per line; blank lines and `#` comments
 * are ignored):
 *
 * ```json
 * {
 *   "id": "oa-001",
 *   "firstOa": { "text": "第一次审查意见通知书原文" },
 *   "secondOa": { "text": "第二次审查意见通知书原文", "disputes": [
 *     { "statute": "A22.3", "claims": [1, 2], "point": "审查员在二通中维持的争点" }
 *   ] },
 *   "claims": "第一次审查意见所针对的权利要求书原文",
 *   "outcome": "granted"
 * }
 * ```
 *
 * Annotation rules:
 * - `statute` uses the canonical `A<article>.<paragraph>` form (for example
 *   `A22.3`, `A26.4`, `A33`); guideline-only defects still cite the statute the
 *   examiner invoked.
 * - `claims` lists every claim number the dispute covers, including claims
 *   covered only through a dependent claim's reference chain.
 * - `point` paraphrases the examiner's maintained reasoning; quote distinctive
 *   wording when the paraphrase could shift the legal issue.
 * - `outcome` is optional; when present it records the prosecution result after
 *   the second OA.
 *
 * Anonymization rules:
 * - Remove application/publication numbers, applicant and inventor names,
 *   addresses, agency and agent names, examiner names, phone numbers, emails,
 *   barcodes, and QR codes. Replace comparison documents with stable aliases
 *   (`D1`, `D2`, ...).
 * - Keep statute citations, claim numbers, technical content, and the reasoning
 *   needed to reproduce the dispute. Shift or truncate dates that identify a
 *   party; keep the year when the applicable law version depends on it.
 * - Store the dataset outside the repository (default
 *   `.dsh-work/patent-oa-retro/dataset.jsonl`); never commit client material.
 *
 * The validator checks structure, duplicate ids, statute/claim coverage, the
 * minimum case count (default 30), and identifier patterns that survive
 * anonymization. It cannot judge whether a `point` is faithful to the second
 * OA; that remains a human review step.
 *
 * @module dsh-scripts/patent-oa-retro
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Default minimum number of rows; the M2 acceptance gate uses 30. */
export const DEFAULT_MIN_CASES = 30

/** Canonical statute citation: `A22.3`, `A26`, `A33`. */
const STATUTE_PATTERN = /^A\d+(?:\.\d+)?$/

/** Opaque row id: lower-case letters, digits, and hyphens. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Prosecution results a row may record. */
const OUTCOMES = ['granted', 'rejected', 'pending'] as const

/** Prosecution result after the second office action. */
export type OaRetroOutcome = (typeof OUTCOMES)[number]

/** One dispute the examiner maintained in the second office action. */
export type OaRetroDispute = {
  /** Canonical statute citation, for example `A22.3`. */
  statute: string
  /** Claim numbers covered by the dispute, including dependent claims. */
  claims: number[]
  /** Neutral paraphrase of the examiner's maintained reasoning. */
  point: string
}

/** One first-OA / second-OA pair. */
export type OaRetroCase = {
  /** Opaque row id with no application number. */
  id: string
  /** First office action input. */
  firstOa: { text: string }
  /** Second office action used as ground truth. */
  secondOa: { text: string; disputes: OaRetroDispute[] }
  /** Claims examined by the first office action. */
  claims: string
  /** Optional prosecution result after the second office action. */
  outcome?: OaRetroOutcome
}

/** Validation counts plus every structural or anonymization error. */
export type OaRetroValidation = {
  /** Number of non-empty rows read. */
  cases: number
  /** Number of dispute entries across all rows. */
  disputes: number
  /** Dispute counts keyed by canonical statute. */
  byStatute: Record<string, number>
  /** Dispute counts keyed by claim number. */
  byClaim: Record<string, number>
  /** Human-readable errors; empty means the dataset passed. */
  errors: string[]
}

/** Identifier patterns that indicate incomplete anonymization. */
const ANONYMIZATION_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'patent or application number', pattern: /(?:CN)?\d{9,13}(?:\.\d)?[A-Z]?/u },
  { label: 'application-number field', pattern: /申请号\s*[:：]/u },
  { label: 'applicant field', pattern: /申请人\s*[:：]/u },
  { label: 'inventor field', pattern: /发明人\s*[:：]/u },
  { label: 'agency field', pattern: /代理机构\s*[:：]/u },
  { label: 'agent field', pattern: /代理人\s*[:：]/u },
  { label: 'address field', pattern: /地址\s*[:：]/u },
  { label: 'phone number', pattern: /(?:\+?86[-\s]?)?1[3-9]\d{9}/u },
  { label: 'email address', pattern: /[\w.+-]+@[\w-]+\.[\w.]+/u },
]

/**
 * Test whether a value is a non-null, non-array object.
 * @param value - Value to test.
 * @returns True for plain object records.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Test whether a value is a non-blank string.
 * @param value - Value to test.
 * @returns True for non-blank strings.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Test whether a value is a supported prosecution outcome.
 * @param value - Value to test.
 * @returns True for a declared outcome.
 */
function isOutcome(value: unknown): value is OaRetroOutcome {
  return typeof value === 'string' && OUTCOMES.some(outcome => outcome === value)
}

/**
 * Find identifier patterns that survived anonymization in one text field.
 * @param text - Text to scan.
 * @returns Unique pattern labels found in the text.
 */
export function findAnonymizationLeaks(text: string): string[] {
  const labels: string[] = []
  for (const { label, pattern } of ANONYMIZATION_PATTERNS) {
    if (pattern.test(text) && !labels.includes(label)) labels.push(label)
  }
  return labels
}

/**
 * Parse a JSON Lines dataset, ignoring blank lines and `#` comments.
 * @param text - JSONL file content.
 * @returns One parsed value per data line.
 * @throws Error when a data line is not valid JSON.
 */
export function parseOaRetroJsonl(text: string): unknown[] {
  const records: unknown[] = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      throw new Error(`line ${index + 1}: invalid JSON`)
    }
  }
  return records
}

/**
 * Validate one dispute entry and return its normalized values.
 * @param value - Parsed dispute value.
 * @param prefix - Error prefix identifying the row and dispute index.
 * @param errors - Error sink.
 * @returns Normalized statute/claims when the entry is structurally valid.
 */
function readDispute(
  value: unknown,
  prefix: string,
  errors: string[],
): { statute: string; claims: number[] } | undefined {
  if (!isRecord(value)) {
    errors.push(`${prefix}: dispute is not an object`)
    return undefined
  }
  const statute = value['statute']
  const claims = value['claims']
  const point = value['point']
  let valid = true
  if (!isNonEmptyString(statute) || !STATUTE_PATTERN.test(statute)) {
    errors.push(`${prefix}: statute must look like A22.3`)
    valid = false
  }
  if (!Array.isArray(claims) || claims.length === 0) {
    errors.push(`${prefix}: claims must be a non-empty array`)
    valid = false
  }
  if (!isNonEmptyString(point)) {
    errors.push(`${prefix}: point must be a non-empty string`)
    valid = false
  }
  if (!valid || !isNonEmptyString(statute) || !isNonEmptyString(point) || !Array.isArray(claims)) {
    return undefined
  }
  const claimValues: unknown[] = claims
  const claimNumbers: number[] = []
  for (const claim of claimValues) {
    if (typeof claim !== 'number' || !Number.isInteger(claim) || claim < 1) {
      errors.push(`${prefix}: claim numbers must be positive integers`)
      return undefined
    }
    if (!claimNumbers.includes(claim)) claimNumbers.push(claim)
  }
  return { statute, claims: claimNumbers }
}

/**
 * Validate a parsed dataset.
 *
 * Structure is checked per row; anonymization scans every text field. The
 * function never throws for malformed rows so a report lists all defects at
 * once.
 * @param records - Parsed JSONL values.
 * @param options - Minimum row count (defaults to {@link DEFAULT_MIN_CASES}).
 * @returns Counts and the complete error list.
 */
export function validateOaRetroDataset(
  records: readonly unknown[],
  options: { minCases?: number } = {},
): OaRetroValidation {
  const minCases = options.minCases ?? DEFAULT_MIN_CASES
  const errors: string[] = []
  const ids = new Set<string>()
  const byStatute: Record<string, number> = {}
  const byClaim: Record<string, number> = {}
  let disputes = 0

  if (!Number.isInteger(minCases) || minCases < 1) {
    errors.push(`minCases must be a positive integer, got ${minCases}`)
  } else if (records.length < minCases) {
    errors.push(`dataset has ${records.length} cases; at least ${minCases} required`)
  }

  for (const [index, record] of records.entries()) {
    const prefix = `case ${index + 1}`
    if (!isRecord(record)) {
      errors.push(`${prefix}: not an object`)
      continue
    }
    const id = record['id']
    if (!isNonEmptyString(id) || !ID_PATTERN.test(id)) {
      errors.push(`${prefix}: id must use lower-case letters, digits, and hyphens`)
    } else if (ids.has(id)) {
      errors.push(`${prefix}: duplicate id ${id}`)
    } else {
      ids.add(id)
    }

    const firstOa = record['firstOa']
    const firstOaText = isRecord(firstOa) && isNonEmptyString(firstOa['text']) ? firstOa['text'] : undefined
    if (firstOaText === undefined) {
      errors.push(`${prefix}: firstOa.text must be a non-empty string`)
    }

    const claimsText = record['claims']
    if (!isNonEmptyString(claimsText)) {
      errors.push(`${prefix}: claims must be a non-empty string`)
    }

    const outcome = record['outcome']
    if (outcome !== undefined && !isOutcome(outcome)) {
      errors.push(`${prefix}: outcome must be granted, rejected, or pending`)
    }

    const secondOa = record['secondOa']
    if (!isRecord(secondOa) || !isNonEmptyString(secondOa['text'])) {
      errors.push(`${prefix}: secondOa.text must be a non-empty string`)
      continue
    }
    const rawDisputes = secondOa['disputes']
    if (!Array.isArray(rawDisputes) || rawDisputes.length === 0) {
      errors.push(`${prefix}: secondOa.disputes must be a non-empty array`)
      continue
    }

    const disputeValues: unknown[] = rawDisputes
    for (const [disputeIndex, rawDispute] of disputeValues.entries()) {
      const disputePrefix = `${prefix} dispute ${disputeIndex + 1}`
      const dispute = readDispute(rawDispute, disputePrefix, errors)
      if (dispute === undefined) continue
      disputes += 1
      byStatute[dispute.statute] = (byStatute[dispute.statute] ?? 0) + 1
      for (const claim of dispute.claims) {
        const key = String(claim)
        byClaim[key] = (byClaim[key] ?? 0) + 1
      }
    }

    const texts = [firstOaText, secondOa['text'], claimsText]
    for (const rawDispute of disputeValues) {
      if (isRecord(rawDispute) && isNonEmptyString(rawDispute['point'])) texts.push(rawDispute['point'])
    }
    const leaks = new Set<string>()
    for (const text of texts) {
      if (typeof text !== 'string') continue
      for (const label of findAnonymizationLeaks(text)) leaks.add(label)
    }
    for (const label of leaks) errors.push(`${prefix}: anonymization leak: ${label}`)
  }

  return { cases: records.length, disputes, byStatute, byClaim, errors }
}

/**
 * Render a validation report for terminal output.
 * @param result - Validation result.
 * @returns Multi-line human-readable report.
 */
export function renderValidationReport(result: OaRetroValidation): string {
  const statutes = Object.entries(result.byStatute)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([statute, count]) => `${statute}=${count}`)
  const claims = Object.entries(result.byClaim)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([claim, count]) => `${claim}=${count}`)
  const lines = [
    `OA retro dataset: ${result.cases} cases, ${result.disputes} disputes`,
    `Statutes: ${statutes.length > 0 ? statutes.join(', ') : '-'}`,
    `Claims: ${claims.length > 0 ? claims.join(', ') : '-'}`,
  ]
  for (const error of result.errors) lines.push(`ERROR: ${error}`)
  return lines.join('\n')
}

/** Printed usage and dataset contract. */
const HELP = `Usage: pnpm exec tsx scripts/patent-oa-retro.ts <dataset.jsonl> [options]

Validate a first-OA / second-OA retrospective dataset.

Options:
  --min-cases <n>  Minimum row count (default ${DEFAULT_MIN_CASES}).
  --json           Print the validation result as JSON.
  --template       Print one empty row template and exit.
  --help           Print this help and exit.

The second office action is ground truth. Rows with synthesized disputes or
without a real second OA do not satisfy the M0-T3 acceptance gate even when
this validator passes. Keep datasets outside the repository; the default
suggested path is .dsh-work/patent-oa-retro/dataset.jsonl.`

/**
 * Run the CLI.
 * @param argv - Arguments after the script path.
 * @returns Process exit code: 0 when the dataset passes, 1 otherwise.
 */
function main(argv: readonly string[]): number {
  if (argv.includes('--help')) {
    console.log(HELP)
    return 0
  }
  if (argv.includes('--template')) {
    const template: OaRetroCase = {
      id: 'oa-001',
      firstOa: { text: '第一次审查意见通知书原文（已匿名化）' },
      secondOa: {
        text: '第二次审查意见通知书原文（已匿名化）',
        disputes: [{ statute: 'A22.3', claims: [1], point: '审查员在二通中维持的争点' }],
      },
      claims: '权利要求书原文（已匿名化）',
      outcome: 'pending',
    }
    console.log(JSON.stringify(template))
    return 0
  }

  let minCases = DEFAULT_MIN_CASES
  const positional: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--min-cases') {
      const raw = argv[index + 1]
      const parsed = raw === undefined ? Number.NaN : Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1) {
        console.error('--min-cases requires a positive integer')
        return 1
      }
      minCases = parsed
      index += 1
      continue
    }
    if (argument.startsWith('--')) {
      console.error(`unknown option: ${argument}`)
      return 1
    }
    positional.push(argument)
  }
  const path = positional[0]
  if (path === undefined) {
    console.error(HELP)
    return 1
  }
  let records: unknown[]
  try {
    records = parseOaRetroJsonl(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
  const result = validateOaRetroDataset(records, { minCases })
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(renderValidationReport(result))
  }
  return result.errors.length === 0 ? 0 : 1
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = main(process.argv.slice(2))
}
