import { expect, it } from 'vitest'
import { validatePinCite, verifyQuoteInSource } from '@deepseek-ai/dsh-patent-core'

const SOURCE = [
  '说明书',
  '[0032]',
  '本实施例的壳体由不锈钢制成，滤芯含有活性炭。',
  '[0033]',
  '滤芯可拆卸地安装于壳体内。',
].join('\n')

it('合法 pin-cite 且段号存在通过', () => {
  expect(validatePinCite('[D1 段[0032] 图3]', SOURCE)).toEqual({ ok: true })
  expect(validatePinCite('[D1 段[0033]]', SOURCE)).toEqual({ ok: true })
})

it('格式非法报错', () => {
  const res = validatePinCite('D1 段 0032', SOURCE)
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.reason.includes('格式非法')).toBeTruthy()
})

it('段号不存在报错（防幻觉引用）', () => {
  const res = validatePinCite('[D1 段[0099]]', SOURCE)
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.reason.includes('不存在')).toBeTruthy()
})

it('quote 必须是源文子串（归一化空白后）', () => {
  expect(verifyQuoteInSource('壳体由不锈钢制成，滤芯含有活性炭', SOURCE).ok).toBe(true)
  expect(verifyQuoteInSource('壳体由 不锈钢\n制成', SOURCE).ok).toBe(true)
  const bad = verifyQuoteInSource('壳体由钛合金制成', SOURCE)
  expect(bad.ok).toBe(false)
  expect(bad.reason.includes('不存在')).toBeTruthy()
})

it('空引用放行（not-found 行允许空证据）', () => {
  expect(verifyQuoteInSource('', SOURCE).ok).toBe(true)
})
