import type { AllElementsCase } from './all-elements.ts'
import type { AmendmentBasisCase } from './amendment-basis.ts'
import type { ClaimRefsCase } from './claim-refs.ts'
import type { NumericRangeCase } from './numeric-range.ts'
import type { OfficeActionCase } from './office-action.ts'
import type { PriorArtFilterCase } from './prior-art-filter.ts'
import { ALL_ELEMENTS_CASES } from './all-elements.ts'
import { AMENDMENT_BASIS_CASES } from './amendment-basis.ts'
import { CLAIM_REFS_CASES } from './claim-refs.ts'
import { NUMERIC_RANGE_CASES } from './numeric-range.ts'
import { OFFICE_ACTION_CASES } from './office-action.ts'
import { PRIOR_ART_FILTER_CASES } from './prior-art-filter.ts'

/** 金标语料用例：按确定性引擎分派。 */
export type LegalCorpusCase =
  | NumericRangeCase
  | ClaimRefsCase
  | AmendmentBasisCase
  | PriorArtFilterCase
  | OfficeActionCase
  | AllElementsCase

/** 全部金标语料用例。 */
export const LEGAL_CORPUS: readonly LegalCorpusCase[] = [
  ...NUMERIC_RANGE_CASES,
  ...CLAIM_REFS_CASES,
  ...AMENDMENT_BASIS_CASES,
  ...PRIOR_ART_FILTER_CASES,
  ...OFFICE_ACTION_CASES,
  ...ALL_ELEMENTS_CASES,
]
