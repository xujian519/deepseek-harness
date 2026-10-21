/** 金标语料：A33 修改依据检查。 */
export type AmendmentBasisCase = {
  engine: 'amendment-basis'
  id: string
  title: string
  /** 修改后的答复正文。 */
  draft: string
  /** 原权利要求书。 */
  claims: string
  /** 原说明书；省略时不提供。 */
  description?: string
  expectedPassed: boolean
  /** 报出的未记载片段（按报告顺序）。 */
  expectedSpans: readonly string[]
}

/** 原权利要求书：与 `tests/amendment-basis-atom.spec.ts` 使用同一法律事实。 */
const ORIGINAL_CLAIMS = '1. 一种装置，包括壳体，其特征在于，所述壳体上设置有散热孔。'

/**
 * 构造一份包含修改后权利要求段的答复正文。
 * @param claim - 修改后权项文本。
 * @returns 可直接送入 amendment-basis 原子的答复正文。
 */
function responseWithClaims(claim: string): string {
  return ['修改后权利要求书：', claim, '', '意见陈述：对比文件1未公开散热孔。'].join('\n')
}

/** A33 金标语料（当前行为已符合预期的情形）。 */
export const AMENDMENT_BASIS_CASES: readonly AmendmentBasisCase[] = [
  {
    engine: 'amendment-basis',
    id: 'A33-001',
    title: '新增特征记载于原说明书，具备修改依据',
    draft: responseWithClaims(ORIGINAL_CLAIMS.replace('散热孔。', '散热孔和过滤网。')),
    claims: ORIGINAL_CLAIMS,
    description: '所述壳体上设置有散热孔和过滤网。',
    expectedPassed: true,
    expectedSpans: [],
  },
  {
    engine: 'amendment-basis',
    id: 'A33-002',
    title: '新增特征未记载于原申请文件，超出 A33 范围',
    draft: responseWithClaims(
      '1. 一种装置，包括壳体，其特征在于，所述壳体上设置有散热孔，所述壳体内设置有不锈钢材质的过滤网。',
    ),
    claims: ORIGINAL_CLAIMS,
    description: '本申请提供一种装置，壳体上设置有散热孔。',
    expectedPassed: false,
    expectedSpans: ['壳体内设置有不锈钢材质的过滤网'],
  },
  {
    engine: 'amendment-basis',
    id: 'A33-003',
    title: '修改后权项与原权项一致，无需修改依据',
    draft: responseWithClaims(ORIGINAL_CLAIMS),
    claims: ORIGINAL_CLAIMS,
    expectedPassed: true,
    expectedSpans: [],
  },
  {
    engine: 'amendment-basis',
    id: 'A33-004',
    title: '插入单字“不”反转限定方向，超出 A33 范围',
    draft: responseWithClaims(ORIGINAL_CLAIMS.replace('设置有散热孔。', '不设置有散热孔。')),
    claims: ORIGINAL_CLAIMS,
    expectedPassed: false,
    expectedSpans: ['不'],
  },
]
