/**
 * 证据判定器注册表。
 *
 * 按证据类型分派到对应的判定器实现。
 */

import type { LegalEvidenceType } from '../types.ts'
import { documentaryEvaluator } from './documentary.ts'
import { electronicEvaluator } from './electronic.ts'
import { expertOpinionEvaluator } from './expert-opinion.ts'
import { audioVisualEvaluator, inspectionRecordEvaluator, partyStatementEvaluator, physicalEvaluator } from './other-types.ts'
import { witnessTestimonyEvaluator } from './witness-testimony.ts'
import type { LegalEvidenceEvaluator } from './base.ts'

export { type LegalEvidenceEvaluator } from './base.ts'
export { documentaryEvaluator } from './documentary.ts'
export { electronicEvaluator } from './electronic.ts'
export { expertOpinionEvaluator } from './expert-opinion.ts'
export { witnessTestimonyEvaluator } from './witness-testimony.ts'
export {
  audioVisualEvaluator,
  inspectionRecordEvaluator,
  partyStatementEvaluator,
  physicalEvaluator,
} from './other-types.ts'

/**
 * 按证据类型获取对应的判定器。
 * @param evidenceType - 证据类型。
 * @returns 对应的判定器。
 */
export function getEvaluator(evidenceType: LegalEvidenceType): LegalEvidenceEvaluator {
  switch (evidenceType) {
    case 'party_statement':
      return partyStatementEvaluator
    case 'documentary':
      return documentaryEvaluator
    case 'physical':
      return physicalEvaluator
    case 'audio_visual':
      return audioVisualEvaluator
    case 'electronic':
      return electronicEvaluator
    case 'witness_testimony':
      return witnessTestimonyEvaluator
    case 'expert_opinion':
      return expertOpinionEvaluator
    case 'inspection_record':
      return inspectionRecordEvaluator
    default: {
      const exhaustive: never = evidenceType
      throw new Error(`Unhandled evidence type: ${exhaustive as string}`)
    }
  }
}
