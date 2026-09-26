import { describe, expect, it } from 'vitest'
import { normalizeLlmFailure } from '../src/adapter-failure.ts'

describe('adapter failure normalization', () => {
  it('contains hostile non-Error coercion', () => {
    const thrown = { [Symbol.toPrimitive]: () => { throw new Error('coercion failed') } }
    expect(normalizeLlmFailure(thrown)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('normalizes empty primitive throws and data descriptors without values', () => {
    expect(normalizeLlmFailure('')).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
    expect(normalizeLlmFailure(null)).toEqual({ message: 'null', code: 'UNKNOWN' })

    const error = new Error('provider failed')
    Object.defineProperty(error, 'failure', { get: () => ({ message: 'ignored', code: 'IGNORED' }) })
    Object.defineProperty(error, 'code', { get: () => 'IGNORED' })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const accessorCode = Object.assign(new Error('provider failed'), {
      failure: { message: 'provider failed', code: 'FOREIGN' },
    })
    Object.defineProperty(accessorCode, 'code', { get: () => 'FOREIGN' })
    expect(normalizeLlmFailure(accessorCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const primitiveFailure = Object.assign(new Error('provider failed'), {
      failure: null,
      code: 'FOREIGN',
    })
    expect(normalizeLlmFailure(primitiveFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('contains hostile Error property reflection', () => {
    const withFailure = new Error('provider failed') as Error & { failure: unknown; code: string }
    withFailure.failure = { message: 'provider failed', code: 'FOREIGN' }
    withFailure.code = 'FOREIGN'
    const hostileCode = new Proxy(withFailure, {
      getOwnPropertyDescriptor(target, property) {
        if (property === 'code') throw new Error('code descriptor failed')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    expect(normalizeLlmFailure(hostileCode)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const hostileFailure = new Proxy(new Error('provider failed'), {
      getOwnPropertyDescriptor() { throw new Error('failure descriptor failed') },
    })
    expect(normalizeLlmFailure(hostileFailure)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('rejects malformed or accessor-backed failure snapshots', () => {
    const malformed = new Error('provider failed') as Error & { failure: unknown; code: string }
    malformed.failure = { message: 'provider failed', code: 'FOREIGN', requestId: '' }
    malformed.code = 'FOREIGN'
    expect(normalizeLlmFailure(malformed)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const accessorBacked = new Error('provider failed') as Error & { failure: unknown }
    accessorBacked.failure = Object.defineProperty({}, 'message', {
      get() { throw new Error('failure getter failed') },
    })
    expect(normalizeLlmFailure(accessorBacked)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })

  it('falls back when an Error message accessor throws', () => {
    const error = new Error('provider failed')
    Object.defineProperty(error, 'message', { get() { throw new Error('message getter failed') } })
    expect(normalizeLlmFailure(error)).toEqual({ message: 'LLM adapter failed', code: 'UNKNOWN' })
  })

  it('preserves a coded diagnostic in a foreign failure snapshot', () => {
    const carrying = new Error('provider failed') as Error & { failure: unknown; code: string }
    carrying.failure = {
      message: 'provider failed',
      code: 'TRANSPORT',
      diagnostic: 'UND_ERR_SOCKET: other side closed',
    }
    carrying.code = 'TRANSPORT'
    expect(normalizeLlmFailure(carrying)).toEqual({
      message: 'provider failed',
      code: 'TRANSPORT',
      diagnostic: 'UND_ERR_SOCKET: other side closed',
    })
  })

  it('rejects an unusable diagnostic instead of retaining the snapshot', () => {
    const blank = new Error('provider failed') as Error & { failure: unknown; code: string }
    blank.failure = { message: 'provider failed', code: 'TRANSPORT', diagnostic: '' }
    blank.code = 'TRANSPORT'
    expect(normalizeLlmFailure(blank)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })

    const numeric = new Error('provider failed') as Error & { failure: unknown; code: string }
    numeric.failure = { message: 'provider failed', code: 'TRANSPORT', diagnostic: 7 }
    numeric.code = 'TRANSPORT'
    expect(normalizeLlmFailure(numeric)).toEqual({ message: 'provider failed', code: 'UNKNOWN' })
  })
})
