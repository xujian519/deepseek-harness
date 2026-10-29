/**
 * Vague-wording check (《专利审查指南》第二部分第二章 2.2.7).
 *
 * The check matches vague quantities in context rather than by substring: 「约束」
 * and 「左右两侧」 are exact technical wording, while 「约 10%」 and 「左右」 after a
 * number are vague. 「例如」 and 「优选」 are drafting aids the guideline explicitly
 * permits, so they are not reported.
 */

import { locateMatch } from '@deepseek-ai/dsh-patent-core'
import type { SpecViolation } from './spec-types.ts'

/** A number token the vague quantifier may modify. */
const QUANTITY = '(?:\\d+(?:\\.\\d+)?|[零一二三四五六七八九十百千万两]+|百分之[零一二三四五六七八九十百]+)'

/** Vague quantifiers that only count when attached to a quantity. */
const VAGUE_QUANTITY_RES = [
  new RegExp(`(?:约|大约|大致)(?:为|是)?\\s*${QUANTITY}`, 'g'),
  new RegExp(`${QUANTITY}\\s*左右`, 'g'),
] as const

/** Words that stay vague in any context. */
const VAGUE_WORDS = ['可能', '较好'] as const

/**
 * Report vague wording with the location of its earliest hit.
 * @param text - the specification text.
 * @returns the clarity violation, or empty when no vague wording is present.
 */
export function checkClarity(text: string): SpecViolation[] {
  const hits: string[] = []
  for (const pattern of VAGUE_QUANTITY_RES) {
    for (const match of text.matchAll(pattern)) {
      if (!hits.includes(match[0])) hits.push(match[0])
    }
  }
  for (const word of VAGUE_WORDS) {
    if (text.includes(word)) hits.push(word)
  }
  if (hits.length === 0) return []
  // oxlint-disable-next-line typescript/no-non-null-assertion -- hits are substrings of text, so a location exists
  const location = locateMatch(text, hits)!
  return [{
    rule: 'clarity',
    family: 'description',
    severity: 'warning',
    message: `说明书包含模糊表述：${hits.join('、')}`,
    suggestion: '用确定的数值、范围或条件替代模糊量；「例如」「优选」本身可以使用，但所举数值应当明确',
    line: location.line,
    matchedSentence: location.matchedSentence,
  }]
}
