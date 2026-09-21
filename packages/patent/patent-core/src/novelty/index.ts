/**
 * src/patent/novelty — 新颖性领域的确定性判定 barrel。
 *
 * numeric-range.ts：数值范围重叠的确定性核验，与 LLM 语义轨并行并做一致性对照。
 */

export {
  analyzeNumericRanges,
  crossCheckNumericVerdict,
  extractNumericFindings,
  extractNumericRanges,
  isNumericVerdict,
  readNumericVerdict,
  type NumericLlmAgreement,
  type NumericRangeAnalysis,
  type NumericRangeFinding,
  type NumericRangeInput,
  type NumericRangeOverlap,
  type NumericRangeVerdict,
} from './numeric-range.ts'
