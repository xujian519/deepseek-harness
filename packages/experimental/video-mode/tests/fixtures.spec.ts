/**
 * Deterministic fixture encoders and artifact signature checks: dimension and
 * sample-rate guards, every accepted media signature, and the unchecked
 * fallback for a media type without a four-byte signature.
 */

import { describe, expect, it } from 'vitest'
import { colorFor, silentWav, solidPng } from '../src/index.ts'
import { signatureOf } from '../src/fixture-bytes.ts'

/** Signature table used by the artifact validator. */
const SIGNATURES: readonly (readonly [string, Uint8Array, Uint8Array])[] = [
  ['image/png', solidPng(1, 1, 1, 2, 3), new Uint8Array([0x89, 0x50])],
  ['image/jpeg', new Uint8Array([0xff, 0xd8, 0xff]), new Uint8Array([1])],
  ['image/webp', new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBP')]), new Uint8Array([1])],
  ['video/mp4', new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode('ftyp'), 0, 0, 0, 0]), new Uint8Array([1])],
  ['audio/wav', new Uint8Array([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WAVE')]), new Uint8Array([1])],
  ['audio/mpeg', new Uint8Array([0xff, 0xe0]), new Uint8Array([1])],
]

describe('fixture encoders', () => {
  it('rejects invalid PNG dimensions', () => {
    expect(() => solidPng(0, 1, 0, 0, 0)).toThrow(/positive integer dimensions/)
    expect(() => solidPng(1, 4097, 0, 0, 0)).toThrow(/positive integer dimensions/)
  })

  it('rejects invalid WAV parameters', () => {
    expect(() => silentWav(0)).toThrow(/positive duration/)
    expect(() => silentWav(1, 0)).toThrow(/integer sample rate/)
  })

  it('derives distinct colors from different prompts', () => {
    expect(colorFor('')).not.toEqual(colorFor('x'))
  })
})

describe('artifact signatures', () => {
  it('accepts every supported media type and rejects a mismatched payload', () => {
    for (const [mediaType, valid, invalid] of SIGNATURES) {
      const check = signatureOf(mediaType)
      expect(check, mediaType).toBeDefined()
      expect(check?.(valid), mediaType).toBe(true)
      expect(check?.(invalid), mediaType).toBe(false)
    }
  })

  it('leaves an unknown media type unchecked', () => {
    expect(signatureOf('application/octet-stream')).toBeUndefined()
  })
})
