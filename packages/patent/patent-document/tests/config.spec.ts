import { describe, expect, it } from 'vitest'
import { Config } from '@deepseek-ai/dsh-patent-document'

describe('Config', () => {
  it('defaults outputRoot to .dsh/documents', () => {
    const config = Config({})
    expect(config.outputRoot).toBe('.dsh/documents')
    expect(config.chromePath).toBeUndefined()
  })

  it('accepts an explicit chromePath and outputRoot', () => {
    const config = Config({ chromePath: '/usr/bin/chrome', outputRoot: 'out/docs' })
    expect(config.chromePath).toBe('/usr/bin/chrome')
    expect(config.outputRoot).toBe('out/docs')
  })

  it('rejects a non-string chromePath', () => {
    expect(() => Config({ chromePath: 42 as unknown as string })).toThrow()
  })
})
