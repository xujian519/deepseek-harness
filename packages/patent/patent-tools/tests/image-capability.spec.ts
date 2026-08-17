import { describe, expect, it } from 'vitest'
import { checkImageCapability, resolveImageInputModalities } from '../src/figure/image-capability.ts'

describe('checkImageCapability', () => {
  it('allows when image is declared', () => {
    expect(checkImageCapability(['text', 'image'])).toEqual({ allowed: true })
    expect(checkImageCapability(['image'])).toEqual({ allowed: true })
  })

  it('denies an absent modality list (unknown defaults to text-only)', () => {
    const decision = checkImageCapability(undefined, 'deepseek/deepseek-chat')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('expected deny')
    expect(decision.reason).toContain('image')
    expect(decision.reason).toContain('deepseek/deepseek-chat')
    expect(decision.reason).toContain('text-only')
  })

  it('denies a text-only list and names the declared modality', () => {
    const decision = checkImageCapability(['text'], 'deepseek/deepseek-chat')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('expected deny')
    expect(decision.reason).toContain('"text"')
    expect(decision.reason).toContain('image')
    expect(decision.reason).toContain('deepseek/deepseek-chat')
  })

  it('denies an empty list', () => {
    const decision = checkImageCapability([], 'm')
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('expected deny')
    expect(decision.reason).toContain('empty')
  })

  it('names the current model when no label is given', () => {
    const decision = checkImageCapability(['text'])
    expect(decision.allowed).toBe(false)
    if (decision.allowed) throw new Error('expected deny')
    expect(decision.reason).toContain('the current model')
  })
})

describe('resolveImageInputModalities', () => {
  it('returns the declared modalities', async () => {
    const resolveModelInfo = async () => ({ inputModalities: ['text', 'image'] as const })
    await expect(resolveImageInputModalities(resolveModelInfo, 'p', 'm')).resolves.toEqual(['text', 'image'])
  })

  it('returns undefined when the model omits modalities', async () => {
    const resolveModelInfo = async () => ({})
    await expect(resolveImageInputModalities(resolveModelInfo, 'p', 'm')).resolves.toBeUndefined()
  })

  it('returns undefined when resolution throws (unknown capability)', async () => {
    const resolveModelInfo = async () => {
      throw new Error('NO_ADAPTER')
    }
    await expect(resolveImageInputModalities(resolveModelInfo, 'p', 'm')).resolves.toBeUndefined()
  })
})
