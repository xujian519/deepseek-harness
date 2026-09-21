/**
 * src/patent/claim-coverage — 权项—实施例覆盖矩阵。
 *
 * 每条权利要求列出其技术特征，逐特征判断是否在点名的实施例引用中出现。覆盖度由
 * 本模块从 `features` 与 `embodimentRefs` 两列**计算**得出，不读取调用方给出的
 * 覆盖度判读（确定性纪律：结论只能来自可复核的输入列，模型的自评不作为输入）。
 *
 * 同时检出权利要求编号断档。断档只在全部条目编号合法时推断：非法条目本应占据的
 * 编号未知，此时声称某编号"缺失"会把撰写人引向补一条已存在的权利要求——非法条目
 * 已在 `items[].invalidReason` 逐条标注，应优先修复。
 *
 * 对照：本模块判定"特征是否被点名的实施例支持"；说明书全文层面的 A26.4 支持性
 * 检查（权利要求特征是否在说明书出现）由 patent-tools 的 `validate_specification`
 * 工具以 `claim_coverage` 规则承担，两者输入与判定对象都不同。
 */

/** 单条权利要求的覆盖核验输入（调用方只提供两列事实，覆盖度由本模块计算）。 */
export type ClaimCoverageEntry = {
  /** 权利要求标识，形如 `claim_<n>`。 */
  claimId: string
  /** 该权利要求的技术特征。 */
  features: readonly string[]
  /** 支持该权利要求的实施例引用（实施例原文片段或编号说明）。 */
  embodimentRefs: readonly string[]
}

/** 覆盖度：full（全部特征有实施例支持）/ partial / none。 */
export type ClaimCoverageLevel = 'full' | 'partial' | 'none'

/** 单条权利要求的核验结果：编号非法时只带原因，不给出未成立的覆盖度。 */
export type ClaimCoverageItem =
  | {
    claimId: string
    valid: true
    /** 解析出的权利要求编号。 */
    claimNumber: number
    coverage: ClaimCoverageLevel
    /** 参与判定的去重特征数。 */
    featureCount: number
    /** 未获实施例支持的特征（去重后）。 */
    uncovered: string[]
  }
  | {
    claimId: string
    valid: false
    /** 条目非法原因。 */
    invalidReason: string
  }

/** 覆盖核验汇总。 */
export type EmbodimentCoverageMatrix = {
  items: ClaimCoverageItem[]
  fullCount: number
  partialCount: number
  noneCount: number
  coveredFeatureCount: number
  uncoveredFeatureCount: number
  /** 权利要求编号断档（仅在全部条目编号合法时推断）。 */
  gaps: number[]
}

/** 单份申请的权项编号上限：编号是自由输入，须有确定性上界，避免无界编号通过校验。 */
export const MAX_CLAIM_NUMBER = 1000

const CLAIM_ID_PATTERN = /^claim_(\d+)$/

/**
 * 核验每条权利要求的特征是否得到实施例支持，并检出编号断档。
 * @param entries - 逐权项的覆盖条目。
 * @param claimCount - 该申请的权利要求总数（提供时，编号超出总数的条目判为非法）。
 * @returns 覆盖矩阵汇总。
 */
export function checkEmbodimentCoverage(
  entries: readonly ClaimCoverageEntry[],
  claimCount?: number,
): EmbodimentCoverageMatrix {
  const matrix: EmbodimentCoverageMatrix = {
    items: [],
    fullCount: 0,
    partialCount: 0,
    noneCount: 0,
    coveredFeatureCount: 0,
    uncoveredFeatureCount: 0,
    gaps: [],
  }

  const numbers: number[] = []
  let allValid = true
  for (const entry of entries) {
    const item = checkCoverageEntry(entry, claimCount)
    matrix.items.push(item)
    if (!item.valid) {
      allValid = false
      continue
    }
    switch (item.coverage) {
      case 'full':
        matrix.fullCount++
        break
      case 'partial':
        matrix.partialCount++
        break
      default:
        matrix.noneCount++
        break
    }
    matrix.coveredFeatureCount += item.featureCount - item.uncovered.length
    matrix.uncoveredFeatureCount += item.uncovered.length
    numbers.push(item.claimNumber)
  }

  if (allValid) {
    numbers.sort((left, right) => left - right)
    for (let i = 1; i < numbers.length; i++) {
      const previous = numbers[i - 1] ?? 0
      const current = numbers[i] ?? 0
      for (let n = previous + 1; n < current; n++) matrix.gaps.push(n)
    }
  }
  return matrix
}

function checkCoverageEntry(entry: ClaimCoverageEntry, claimCount?: number): ClaimCoverageItem {
  const reject = (reason: string): ClaimCoverageItem => ({
    claimId: entry.claimId,
    valid: false,
    invalidReason: reason,
  })

  const matched = CLAIM_ID_PATTERN.exec(entry.claimId)
  if (matched === null) return reject('claim id 格式非法（应为 claim_<n>）')
  const number = Number(matched[1])
  if (number <= 0 || number > MAX_CLAIM_NUMBER) return reject('claim 编号超出上限（1..1000）')
  if (claimCount !== undefined && number > claimCount) return reject('claim 编号超出权利要求数量')

  const features = dedupeFeatures(entry.features)
  // 无特征时没有可核验的对象：两个已给事实列都为空，"全部特征获支持"与"全部特征未获
  // 支持"都是空真的结论，故按条目非法处理，由消费方报出而不是给出一个覆盖率读数。
  if (features.length === 0) return reject('未提供技术特征（features 为空），无法核验覆盖度')
  if (entry.embodimentRefs.length === 0) {
    return {
      claimId: entry.claimId,
      claimNumber: number,
      valid: true,
      coverage: 'none',
      featureCount: features.length,
      uncovered: features,
    }
  }
  const joined = entry.embodimentRefs.join(' ')
  const uncovered = features.filter(feature => !joined.includes(feature))
  return {
    claimId: entry.claimId,
    claimNumber: number,
    valid: true,
    coverage: coverageLevel(uncovered.length, features.length),
    featureCount: features.length,
    uncovered,
  }
}

/** 覆盖度：无未覆盖特征为 full；部分未覆盖为 partial；全部未覆盖为 none。 */
function coverageLevel(uncoveredCount: number, featureCount: number): ClaimCoverageLevel {
  if (uncoveredCount === 0) return 'full'
  return uncoveredCount < featureCount ? 'partial' : 'none'
}

/** 去重并保留顺序；空白特征不参与覆盖判定。 */
function dedupeFeatures(features: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of features) {
    const feature = raw.trim()
    if (feature.length === 0 || seen.has(feature)) continue
    seen.add(feature)
    out.push(feature)
  }
  return out
}
