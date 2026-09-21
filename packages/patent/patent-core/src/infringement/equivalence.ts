/**
 * src/patent/infringement — 等同侵权的三要素记录与一致性核验。
 *
 * 输入 claim-chart 的行级映射与逐要素的等同认定记录（手段/功能/效果是否基本相同、是否
 * 需要创造性劳动、是否构成等同），检出图表与认定之间的矛盾：认定等同却没有认定记录、
 * 认定记录否定等同而图表按等同落格、三项皆否却认定等同、认定等同同时认定需要创造性劳动、
 * 以及认定等同但结论未落到图表上。
 *
 * 等同的成立要件（手段、功能、效果基本相同且本领域技术人员无需经过创造性劳动就能联想
 * 到）见 `EQUIVALENCE_BASIS`；司法依据的具体条号待法律口径裁决后回填（计划 §11.7）。
 *
 * 与上游 Mady `domains/infringement/rules.go` 的差异：
 * - 核验对象是独立输入。上游的等同三要素与 `is_equivalent` 由同一次模型输出携带、组件
 *   自证；本模块要求图表行与认定记录分开输入，核验的是两者是否一致。
 * - 补入创造性劳动要件。上游只核"三项皆否却认定等同"，`NonObviousness` 字段无任何读取
 *   点；认定等同同时认定需要创造性劳动，同样不成立。
 * - 缺记录也算缺陷。上游在无认定记录时直接判过；本模块对按等同落格的行，缺认定记录即
 *   报缺（等同认定无法复核）。
 */

import type { ChartRow } from '../claim-chart/protocol/types.ts'

/** 单条要素的等同三要素记录。 */
export type EquivalenceTriplet = {
  elementId: string
  targetId: string
  /** 手段是否基本相同。 */
  sameMeans: boolean
  /** 功能是否基本相同。 */
  sameFunction: boolean
  /** 效果是否基本相同。 */
  sameEffect: boolean
  /** 本领域技术人员是否需经创造性劳动才能由权利要求特征联想到被诉特征；`true` 即不构成等同。 */
  inventiveEffortRequired: boolean
  /** 是否认定构成等同。 */
  isEquivalent: boolean
}

/** 等同认定的矛盾类型。 */
export type EquivalenceContradictionKind =
  | 'doe-without-triplet'
  | 'duplicate-triplet'
  | 'triplet-denies-doe'
  | 'doe-without-common-element'
  | 'inventive-effort-required'
  | 'equivalence-not-mapped'

/** 一处等同认定的矛盾。 */
export type EquivalenceContradiction = {
  elementId: string
  targetId: string
  kind: EquivalenceContradictionKind
  detail: string
}

/** 等同的成立要件（条号待法律口径裁决后回填，见计划 §11.7）。 */
export const EQUIVALENCE_BASIS = '等同特征：与权利要求记载的技术特征以基本相同的手段、实现基本相同的功能、'
  + '达到基本相同的效果，且本领域技术人员无需经过创造性劳动就能联想到的特征'

/** 图表上表示"按等同覆盖"的映射。 */
const DOE_MAPPING = 'doe'

/** 判定记录已有结论、但图表未按等同落格时的行状态。 */
const UNMAPPED_STATES = new Set(['not-found', 'partial', 'needs-evidence', 'construction-dependent'])

/**
 * 检出等同认定与图表映射之间的矛盾。
 * @param rows - claim-chart 的行级映射。
 * @param triplets - 逐要素的等同三要素记录。
 * @returns 矛盾列表，按行序（按记录序）稳定排列。
 */
export function findEquivalenceContradictions(
  rows: readonly ChartRow[],
  triplets: readonly EquivalenceTriplet[],
): EquivalenceContradiction[] {
  const contradictions: EquivalenceContradiction[] = []
  const byKey = new Map<string, EquivalenceTriplet>()

  for (const triplet of triplets) {
    const key = tripletKey(triplet.elementId, triplet.targetId)
    const seen = byKey.get(key)
    if (seen !== undefined) {
      contradictions.push({
        elementId: triplet.elementId,
        targetId: triplet.targetId,
        kind: 'duplicate-triplet',
        detail: '同一要素与目标有多条等同认定记录，核验以首条为准',
      })
      continue
    }
    byKey.set(key, triplet)
  }

  for (const row of rows) {
    if (row.mapping !== DOE_MAPPING) continue
    const triplet = byKey.get(tripletKey(row.elementId, row.targetId))
    if (triplet === undefined) {
      contradictions.push({
        elementId: row.elementId,
        targetId: row.targetId,
        kind: 'doe-without-triplet',
        detail: '图表按等同落格，但没有对应的等同三要素记录，等同认定无法复核',
      })
      continue
    }
    checkTripletAgainstDoe(row, triplet, contradictions)
  }

  for (const triplet of byKey.values()) {
    if (!triplet.isEquivalent) continue
    const row = rows.find(item => item.elementId === triplet.elementId && item.targetId === triplet.targetId)
    if (row === undefined || UNMAPPED_STATES.has(row.mapping)) {
      contradictions.push({
        elementId: triplet.elementId,
        targetId: triplet.targetId,
        kind: 'equivalence-not-mapped',
        detail: `已认定构成等同，但图表${row === undefined ? '无对应行' : `在该行结论为 ${row.mapping}`}`,
      })
    }
  }

  return contradictions
}

/**
 * 核验按等同落格的行与其认定记录是否一致。
 * @param row - 按等同落格的行。
 * @param triplet - 该行的等同认定记录。
 * @param out - 矛盾收集器。
 */
function checkTripletAgainstDoe(
  row: ChartRow,
  triplet: EquivalenceTriplet,
  out: EquivalenceContradiction[],
): void {
  if (!triplet.isEquivalent) {
    out.push({
      elementId: row.elementId,
      targetId: row.targetId,
      kind: 'triplet-denies-doe',
      detail: '图表按等同落格，但等同认定记录为不构成等同',
    })
  }
  if (triplet.isEquivalent && !triplet.sameMeans && !triplet.sameFunction && !triplet.sameEffect) {
    out.push({
      elementId: row.elementId,
      targetId: row.targetId,
      kind: 'doe-without-common-element',
      detail: '认定构成等同，但手段、功能、效果三项均认定不同，等同不成立',
    })
  }
  if (triplet.isEquivalent && triplet.inventiveEffortRequired) {
    out.push({
      elementId: row.elementId,
      targetId: row.targetId,
      kind: 'inventive-effort-required',
      detail: '认定构成等同，但同时认定需要创造性劳动才能联想到，等同不成立',
    })
  }
}

/**
 * 记录键：要素 id 与目标 id。
 * @param elementId - 要素 id。
 * @param targetId - 目标 id。
 * @returns 组合键。
 */
function tripletKey(elementId: string, targetId: string): string {
  return `${elementId}\u0000${targetId}`
}
