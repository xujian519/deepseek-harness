import { expect, it } from 'vitest'
import { normalizeWhitespace, validateElements } from '@deepseek-ai/dsh-patent-core'
import type { ClaimElement } from '@deepseek-ai/dsh-patent-core'

const CLAIM = '1. 一种过滤装置，包括壳体和滤芯，所述滤芯含有活性炭。'

function el(id: string, text: string): ClaimElement {
  return { id, claimNo: Number(id[0]), text, kind: 'limitation' }
}

it('normalizeWhitespace 归一化空白', () => {
  expect(normalizeWhitespace(' 包括壳体  和滤芯\n')).toBe('包括壳体 和滤芯')
})

it('合法要素全部通过', () => {
  const res = validateElements([el('1a', '包括壳体'), el('1b', '和滤芯'), el('1c', '所述滤芯含有活性炭')], CLAIM)
  expect(res.ok).toBe(true)
})

it('要素文本被改写（非原文连续子串）时报错', () => {
  const res = validateElements([el('1a', '包括外壳')], CLAIM)
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.errors[0]!.includes('不是权利要求原文的连续子串')).toBeTruthy()
  }
})

it('要素编号跳号时报错', () => {
  const res = validateElements([el('1a', '包括壳体'), el('1c', '和滤芯')], CLAIM)
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.errors.some(e => e.includes('跳号'))).toBeTruthy()
  }
})

it('编号重复与格式非法报错', () => {
  const res = validateElements([el('1a', '包括壳体'), el('1a', '和滤芯'), el('X', '所述滤芯含有活性炭')], CLAIM)
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.errors.some(e => e.includes('重复'))).toBeTruthy()
    expect(res.errors.some(e => e.includes('格式非法'))).toBeTruthy()
  }
})

it('claimNo 与编号不一致报错', () => {
  const res = validateElements([{ id: '1a', claimNo: 2, text: '包括壳体', kind: 'limitation' }], CLAIM)
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.errors.some(e => e.includes('claimNo'))).toBeTruthy()
  }
})

it('权利要求原文为空或要素列表为空报错', () => {
  expect(validateElements([el('1a', 'x')], '').ok).toBe(false)
  expect(validateElements([], CLAIM).ok).toBe(false)
})

it('claim 原文含换行折行时要素仍通过（空白不参与比较）', () => {
  const wrapped = '1. 一种过滤装置，包括\n壳体和滤芯，所述滤芯含有活性炭。'
  const res = validateElements([el('1a', '包括壳体'), el('1b', '和滤芯'), el('1c', '所述滤芯含有活性炭')], wrapped)
  expect(res.ok).toBe(true)
})

it('多 claim 共存且各自连续时通过，跨 claim 跳号报错', () => {
  const multi = '1. 一种过滤装置，包括壳体和滤芯。2. 所述滤芯含有活性炭。'
  const ok = validateElements([el('1a', '包括壳体'), el('1b', '和滤芯'), el('2a', '所述滤芯含有活性炭')], multi)
  expect(ok.ok).toBe(true)

  const bad = validateElements(
    [el('1a', '包括壳体'), el('1b', '和滤芯'), el('2a', '所述滤芯含有活性炭'), el('2c', '活性炭')],
    multi,
  )
  expect(bad.ok).toBe(false)
  if (!bad.ok) {
    expect(bad.errors.some(e => e.includes('跳号'))).toBeTruthy()
  }
})

it('要素文本必须来自自身 claim 段（跨 claim 借用被拒）', () => {
  const multi = '1. 一种过滤装置，包括壳体和滤芯。\n2. 如权利要求1所述，所述滤芯含有活性炭。'
  // 1a 的文本实际来自 claim 2 的段 → 应在 claim 1 段内找不到
  const bad = validateElements([el('1a', '所述滤芯含有活性炭'), el('2a', '所述滤芯含有活性炭')], multi)
  expect(bad.ok).toBe(false)
  if (!bad.ok) {
    expect(bad.errors.some(e => e.includes('claim 1 段内未找到'))).toBeTruthy()
  }
  // 各自段内命中则通过
  const ok = validateElements([el('1a', '包括壳体'), el('1b', '和滤芯'), el('2a', '所述滤芯含有活性炭')], multi)
  expect(ok.ok).toBe(true)
})

it('空白-only 要素文本报错', () => {
  const res = validateElements([el('1a', '   ')], CLAIM)
  expect(res.ok).toBe(false)
  if (!res.ok) {
    expect(res.errors.some(e => e.includes('文本为空'))).toBeTruthy()
  }
})
