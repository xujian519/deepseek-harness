import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/figure/office-profile.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/figure/office-profile.ts')>()
  return {
    ...actual,
    sheetNumberText: () => {
      throw 'sheet writer failed'
    },
  }
})

const { resolveSubmission } = await import('../src/tool/figure-submission.ts')

describe('resolveSubmission failure mapping', () => {
  it('wraps a non-Error sheet-number failure as invalid_tool_input', () => {
    expect(() => resolveSubmission({ target_office: 'cnipa' }, '')).toThrow('落版参数非法：sheet writer failed')
  })
})
