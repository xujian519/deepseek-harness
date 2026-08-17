import { describe, expect, it } from 'vitest'
import { compileSignal, signalFor, signalMatches } from '@deepseek-ai/dsh-patent-workflow'
import type { WorkflowStage } from '@deepseek-ai/dsh-patent-workflow'

describe('workflow retry signal', () => {
  it('signalMatches: hit signal with no negation and no sentence boundary before it', () => {
    const signal = compileSignal('不一致|矛盾|缺少')
    expect(signalMatches('PFE 一致性检查：发现特征与效果不一致', signal)).toBe(true)
  })

  it('signalMatches: a negation word before the hit does not trigger', () => {
    const signal = compileSignal('不一致|矛盾|缺少')
    expect(signalMatches('未发现不一致，因果链闭合', signal)).toBe(false)
  })

  it('signalMatches: a sentence boundary before the hit does not trigger', () => {
    const signal = compileSignal('不一致')
    expect(signalMatches('特征完整。不一致的情况不存在', signal)).toBe(false)
  })

  it('signalMatches: g-flag lastIndex resets across calls', () => {
    const signal = compileSignal('不一致')
    expect(signalMatches('甲 不一致 乙', signal)).toBe(true)
    expect(signalMatches('无不一致', signal)).toBe(false)
    expect(signalMatches('再次不一致', signal)).toBe(true)
  })

  it('signalMatches: empty matches do not loop forever', () => {
    const signal = compileSignal('x*')
    expect(signalMatches('abc', signal)).toBe(true)
  })

  it('signalFor: undefined without retry; compiles and caches the same instance with retry', () => {
    const cache = new Map<string, RegExp>()
    const plain: WorkflowStage = { id: 's1', strategy: 'chain', description: 'd' }
    expect(signalFor(plain, cache)).toBeUndefined()

    const withRetry: WorkflowStage = {
      id: 's2',
      strategy: 'chain',
      description: 'd',
      retry: { whenOutputMatches: '不一致|矛盾' },
    }
    const first = signalFor(withRetry, cache)
    expect(first).toBeInstanceOf(RegExp)
    const second = signalFor(withRetry, cache)
    expect(first).toBe(second)
    expect(first!.flags).toBe('gi')
  })
})
