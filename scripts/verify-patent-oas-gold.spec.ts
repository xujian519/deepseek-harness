// `verify-patent-oas-gold` 是「有脚本 + verify-* 命名」的假绿候选：基线不在仓库里
// 是它的默认状态，因此它必须在缺基线时以非 0 退出，而不是打印「回归层休眠」并放行。

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { main } from './verify-patent-oas-gold.ts'

const baselinePath = resolve(import.meta.dirname, '../packages/self-evolve/evaluation/patent-oas-baseline.json')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('verify-patent-oas-gold', () => {
  it('refuses to pass while the regression baseline is missing', async () => {
    // The case is about the missing-baseline path; a checked-in baseline would
    // mean this test needs a new shape, not that the gate started passing.
    expect(existsSync(baselinePath)).toBe(false)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(main([])).resolves.toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain('基线未记录')
    expect(log.mock.calls.flat().join('\n')).not.toContain('回归层休眠')
  })
})
