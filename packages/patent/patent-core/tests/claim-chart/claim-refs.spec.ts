import { expect, it } from 'vitest'
import {
  deriveClaimRefs,
  parseReferenceNumbers,
  referencedClosure,
  validateClaimRefs,
} from '@deepseek-ai/dsh-patent-core'

it('单引用的从属权项识别为 dependent 并给出所引权项', () => {
  const text = [
    '1. 一种换热装置，其特征在于，包括壳体。',
    '2. 根据权利要求1所述的换热装置，其特征在于，所述壳体为塑料。',
  ].join('\n')
  expect(deriveClaimRefs(text)).toEqual([
    { claimNo: 1, claimType: 'independent', refersTo: [] },
    { claimNo: 2, claimType: 'dependent', refersTo: [1] },
  ])
})

it('如/按照 与多值、区间引用都识别', () => {
  const text = [
    '1. 一种装置，包括壳体。',
    '2. 如权利要求1所述的装置，其特征在于，还包括滤芯。',
    '3. 根据权利要求1或2所述的装置，其特征在于，所述滤芯可拆。',
    '4. 按照权利要求1至3中任一项所述的装置，其特征在于，所述壳体为金属。',
    '5. 根据权利要求1-3所述的装置，其特征在于，所述滤芯为折叠式。',
  ].join('\n')
  expect(deriveClaimRefs(text).map(ref => ref.refersTo)).toEqual([[], [1], [1, 2], [1, 2, 3], [1, 2, 3]])
})

it('区间展开有跨度上限，超限不展开', () => {
  expect(parseReferenceNumbers('1-3')).toEqual([1, 2, 3])
  expect(parseReferenceNumbers('1-200')).toEqual([])
  expect(parseReferenceNumbers('1、2 或 4')).toEqual([1, 2, 4])
  expect(parseReferenceNumbers('7')).toEqual([7])
})

it('引用语只在权项正文开头一段内生效：正文中途转述不算本权项的引用', () => {
  const text = [
    '1. 一种装置，包括壳体。',
    '2. 一种制造权利要求1所述装置的方法，包括步骤：按权利要求1所述进行装配，其特征在于，温度为200℃。',
  ].join('\n')
  // 引用语在正文开头，仍是从属权项。
  expect(deriveClaimRefs(text)[1]?.refersTo).toEqual([1])

  const mid = [
    '1. 一种装置，包括壳体。',
    '2. 一种制造方法，其步骤包括加热、保温与冷却，其中加热按照本领域常规方式进行，冷却至室温，其特征在于，装配权利要求1所述的装置。',
  ].join('\n')
  expect(deriveClaimRefs(mid)[1]?.claimType).toBe('independent')
})

it('无行首编号时返回空数组（引用关系未知，不臆造）', () => {
  expect(deriveClaimRefs('一种装置，其特征在于，包括壳体。')).toEqual([])
})

it('引用关系校验：自引用、引用不存在、引用编号不更小、成环', () => {
  expect(validateClaimRefs([
    { claimNo: 1, claimType: 'dependent', refersTo: [1] },
  ])).toEqual([
    { kind: 'self-reference', claimNo: 1 },
    { kind: 'later-reference', claimNo: 1, refersTo: [1] },
  ])

  expect(validateClaimRefs([
    { claimNo: 1, claimType: 'independent', refersTo: [] },
    { claimNo: 2, claimType: 'dependent', refersTo: [9] },
  ])).toEqual([
    { kind: 'missing-reference', claimNo: 2, refersTo: [9] },
  ])

  expect(validateClaimRefs([
    { claimNo: 1, claimType: 'dependent', refersTo: [2] },
    { claimNo: 2, claimType: 'dependent', refersTo: [1] },
  ])).toEqual([
    { kind: 'later-reference', claimNo: 1, refersTo: [2] },
    { kind: 'reference-cycle', claimNos: [1, 2] },
  ])

  expect(validateClaimRefs([
    { claimNo: 1, claimType: 'independent', refersTo: [] },
    { claimNo: 2, claimType: 'dependent', refersTo: [1] },
    { claimNo: 3, claimType: 'dependent', refersTo: [1, 2] },
  ])).toEqual([])
})

it('传递闭包取引用链并集，不含自身', () => {
  const refs = [
    { claimNo: 1, claimType: 'independent' as const, refersTo: [] },
    { claimNo: 2, claimType: 'dependent' as const, refersTo: [1] },
    { claimNo: 3, claimType: 'dependent' as const, refersTo: [2] },
    { claimNo: 4, claimType: 'dependent' as const, refersTo: [1, 3] },
  ]
  expect(referencedClosure(refs, 3)).toEqual([1, 2])
  expect(referencedClosure(refs, 4)).toEqual([1, 2, 3])
  expect(referencedClosure(refs, 1)).toEqual([])
  expect(referencedClosure(refs, 9)).toEqual([])
})
