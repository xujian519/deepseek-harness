/**
 * The four-dimension quality evaluation of a drafted passage.
 *
 * The evaluator is a lexical heuristic ported from the Go source
 * (`quality_evaluator.go`). It is a first-pass suggestion, not an authority:
 * each dimension scores containment of the terms a Chinese patent document is
 * expected to use, so a passage that names its structure and its evidence
 * scores higher than one that does not, and a passage of boilerplate cannot.
 * @module @deepseek-ai/dsh-writing-patterns/quality-evaluator
 */

/** Score per dimension, each on a 0-100 scale. */
export type QualityDimensions = {
  /** 结构完整性: heading levels and paragraph count. */
  structure: number
  /** 引用精确度: article, decision, and patent-document references. */
  citation: number
  /** 论证力度: logical connectors and evidence, penalized for filler. */
  argument: number
  /** 专业术语: domain terms, penalized for commercial or absolute wording. */
  terminology: number
}

/** One evaluation result. */
export type QualityEvaluation = {
  dimensions: QualityDimensions
  /** Mean of the four dimensions, on the same 0-100 scale. */
  overall: number
}

// Heuristic tables and base scores are ported verbatim from the Go source; they
// are the calibration of the ported evaluator, not deployment policy.
const STRUCTURE_BASE = 50
const CITATION_BASE = 50
const ARGUMENT_BASE = 40
const TERMINOLOGY_BASE = 60
const CEILING = 95
const FLOOR = 20

const LAW_REFERENCE = ['法第', '条']
const CASE_REFERENCE = ['号决定', '号案']
const PATENT_REFERENCE = ['CN', 'US']
const ATTRIBUTION_PHRASE = '根据'
const ATTRIBUTION_LIMIT = 3
const ATTRIBUTION_PENALTY = 5

const CONNECTORS = ['因此', '因为', '然而', '但是', '虽然', '如果', '则']
const EVIDENCE = ['对比文件', '实施例', '附图', '实验', '测试', '数据']
const FILLER = ['进一步地', '此外', '值得一提的是', '显而易见地']

const TECHNICAL_TERMS = ['技术特征', '本领域', '权利要求', '技术方案', '实施例']
const ABSOLUTE_PHRASES = ['最好', '最佳', '最先进', '绝对', '一定']

/**
 * Evaluate one drafted passage.
 * @param text - the passage to evaluate.
 * @returns the four dimension scores and their mean.
 */
export function evaluateQuality(text: string): QualityEvaluation {
  const dimensions: QualityDimensions = {
    structure: scoreStructure(text),
    citation: scoreCitation(text),
    argument: scoreArgument(text),
    terminology: scoreTerminology(text),
  }
  return {
    dimensions,
    overall: (dimensions.structure + dimensions.citation + dimensions.argument + dimensions.terminology) / 4,
  }
}

/**
 * Heading levels present and paragraphs written. The maximum here is 90, below
 * {@link CEILING}, so this dimension needs no upper clamp.
 */
function scoreStructure(text: string): number {
  let score = STRUCTURE_BASE
  let hasHeading1 = false
  let hasHeading2 = false
  let paragraphs = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) hasHeading1 = true
    if (trimmed.startsWith('## ')) hasHeading2 = true
    if (trimmed !== '' && !trimmed.startsWith('#')) paragraphs++
  }
  if (hasHeading1) score += 15
  if (hasHeading2) score += 15
  if (paragraphs >= 3) score += 10
  else if (paragraphs >= 1) score += 5
  return score
}

/**
 * References to statutes, decisions, and patent documents. The reachable range
 * here is 45-75, inside the reported band, so no clamp applies.
 */
function scoreCitation(text: string): number {
  let score = CITATION_BASE
  if (containsAny(text, LAW_REFERENCE)) score += 15
  if (containsAny(text, CASE_REFERENCE)) score += 15
  if (containsAny(text, PATENT_REFERENCE)) score += 10
  if (countOccurrences(text, ATTRIBUTION_PHRASE) > ATTRIBUTION_LIMIT) score -= ATTRIBUTION_PENALTY
  return score
}

/** Logical connectors and evidence, less filler phrasing. */
function scoreArgument(text: string): number {
  let score = ARGUMENT_BASE
  score += 5 * countPresent(text, CONNECTORS)
  score += 5 * countPresent(text, EVIDENCE)
  score -= 5 * countPresent(text, FILLER)
  return clamp(score)
}

/** Domain terminology, less commercial or absolute wording. */
function scoreTerminology(text: string): number {
  let score = TERMINOLOGY_BASE
  score += 5 * countPresent(text, TECHNICAL_TERMS)
  score -= 10 * countPresent(text, ABSOLUTE_PHRASES)
  return clamp(score)
}

/** Clamp an adjusted score into the reported band. */
function clamp(score: number): number {
  return Math.min(Math.max(score, FLOOR), CEILING)
}

/** Whether the text contains any of the terms. */
function containsAny(text: string, terms: readonly string[]): boolean {
  return terms.some(term => text.includes(term))
}

/** How many of the terms occur at least once. */
function countPresent(text: string, terms: readonly string[]): number {
  return terms.filter(term => text.includes(term)).length
}

/** Non-overlapping occurrences of a phrase, matching the source's count. */
function countOccurrences(text: string, phrase: string): number {
  let count = 0
  let cursor = text.indexOf(phrase)
  while (cursor !== -1) {
    count++
    cursor = text.indexOf(phrase, cursor + phrase.length)
  }
  return count
}
