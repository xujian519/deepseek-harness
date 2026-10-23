/**
 * Canonical mapping between rejection grounds and statute articles.
 *
 * Two vocabularies meet here: `oa-parse` emits the notice's rejection types
 * (`clarity`, `scope`, `support`, …), while response plans and procedural
 * findings use the older labels (`claim-clarity`, `amendment`, …). Both are
 * accepted so a structured notice never loses a ground that its parser already
 * recognized.
 *
 * `formal` and `other` stay unmapped: formal defects are governed by the
 * implementing regulations rather than a Patent Law article, and `other` carries
 * no identified provision. Callers must report those as unverified instead of
 * inventing a statute.
 * @module @deepseek-ai/dsh-patent-core/statute-grounds
 */

/** 法条编号 → 常见驳回类型映射（用于生成答复计划与程序理由的规范标签）。 */
export const STATUTE_TO_GROUND: ReadonlyMap<string, string> = new Map([
  ['A22.2', 'novelty'],
  ['A22.3', 'inventiveness'],
  ['A22.4', 'utility'],
  ['A26.3', 'disclosure'],
  ['A26.4', 'claim-clarity'],
  ['A33', 'amendment'],
])

/**
 * 常见驳回类型 → 法条编号映射。
 *
 * 同时接受 `oa-parse` 的驳回类型（`clarity`/`support`/`scope`）与程序理由标签
 * （`claim-clarity`/`amendment` 等）。同一法条有多个别名时由调用方按法条去重。
 */
export const GROUND_TO_STATUTE: ReadonlyMap<string, string> = new Map([
  ['novelty', 'A22.2'],
  ['inventiveness', 'A22.3'],
  ['utility', 'A22.4'],
  ['disclosure', 'A26.3'],
  ['clarity', 'A26.4'],
  ['support', 'A26.4'],
  ['claim-clarity', 'A26.4'],
  ['necessary-features', 'A26.4'],
  ['scope', 'A33'],
  ['amendment', 'A33'],
  ['divisional-amendment', 'A33'],
  ['subject-matter-art2', 'A2.2'],
  ['subject-matter-art5', 'A5'],
  ['subject-matter-art25', 'A25'],
  ['double-patenting', 'A9'],
])
