/**
 * Quantification and chemical-characterization checks.
 *
 * Both report the *absence* of required detail: effect sentences that assert an
 * improvement without a number, and a chemical-domain specification that states
 * no product characterization technique at all.
 */

import type { SpecViolation } from './spec-types.ts'

/** Vague-effect boilerplate patterns ("效果显著 / 大幅提升" etc.). */
const VAGUE_EFFECT_RE =
  /(?:效果|性能)(?:显著|良好|优异|优越|极佳|大幅|大大提高|明显提升|显著提高|大幅提升|明显改善|显著改善|明显|好)|(?:大大|显著|明显|大幅|有效)(?:提高|提升|改善|降低|减少|增强)/

/** Chemical-domain product characterization techniques (at least one required). */
export const CHEM_CHARACTERIZATION_TERMS = [
  'NMR', '核磁', 'MS', '质谱', 'IR', '红外', '元素分析', 'XRPD', 'XRD', 'X射线', 'X-射线',
  '晶胞参数', '空间群', '熔点', '旋光度', 'UV', '紫外', 'HPLC', '高效液相', 'GC', '气相色谱',
]

/**
 * Return "effect boilerplate" sentences lacking any number / percentage (truncated to 40 chars).
 * @param text - the text to scan.
 * @returns the effect sentences lacking quantitative data.
 */
export function checkEffectQuantification(text: string): string[] {
  const hits: string[] = []
  for (const raw of text.split(/[。；\n]/)) {
    const sentence = raw.trim()
    if (sentence.length === 0) continue
    if (VAGUE_EFFECT_RE.test(sentence) && !/\d|％|%/.test(sentence)) {
      hits.push(sentence.slice(0, 40))
    }
  }
  return hits
}

/**
 * Chemical domain: return the fully-missing characterization terms.
 * @param text - the text to scan.
 * @returns the characterization terms absent from the text.
 */
export function checkChemicalCharacterization(text: string): string[] {
  return CHEM_CHARACTERIZATION_TERMS.filter(term => !text.includes(term))
}

/**
 * SMILES-validity spot-check, ported from Sati's async RDKit enhancement.
 * RDKit is an optional native dependency that dsh does not bundle, so this
 * reports nothing: it skips when `isRdkitAvailable` reports false (the default),
 * and the candidate-extraction / validation engine is not ported, so even an
 * injected "available" override validates no candidates.
 * @param _text - specification text (kept for the Sati call shape; unused).
 * @param isRdkitAvailable - reports whether the RDKit chemistry engine is loaded.
 * @returns always empty; SMILES validation is unavailable in dsh.
 */
export function checkSmilesValidity(_text: string, isRdkitAvailable: () => boolean): SpecViolation[] {
  if (!isRdkitAvailable()) return []
  // Unreached in dsh (RDKit unbundled): the chemistry engine is not ported.
  return []
}
