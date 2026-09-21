/**
 * src/patent/claim-coverage — 权利要求撰写自检 barrel。
 *
 * - unity.ts：多项独立权利要求之间的单一性判定（A31.1），启发式相似度评分。
 * - coverage.ts：权项—实施例覆盖矩阵与编号断档（A26.3/A26.4 的前置自检）。
 */

export {
  checkClaimUnity,
  claimSimilarity,
  normalizeClaimText,
  type ClaimKind,
  type ClaimUnityGrade,
  type ClaimUnityPair,
  type ClaimUnityVerdict,
  type UnityClaim,
} from './unity.ts'

export {
  MAX_CLAIM_NUMBER,
  checkEmbodimentCoverage,
  type ClaimCoverageEntry,
  type ClaimCoverageItem,
  type ClaimCoverageLevel,
  type EmbodimentCoverageMatrix,
} from './coverage.ts'
