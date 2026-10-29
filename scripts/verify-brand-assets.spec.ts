import { describe, expect, it } from 'vitest'
import {
  findMissingStrokes,
  findWhaleSignatures,
  inspectMarkGeometry,
  OFFICIAL_WHALE_SIGNATURES,
} from './verify-brand-assets.ts'

/** A minimal SVG carrying the recorded standard mark, whitespace-normalized. */
const RECORDED_MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <g fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path d="M24 14 L10 32 L24 50" stroke="#0F1115" stroke-width="6"/>
    <path d="M24 50 L33.6 42.4" stroke="#0F1115" stroke-width="6"/>
    <path d="M40 14 L54 32 L40 50" stroke="#4D6BFE" stroke-width="6"/>
    <path d="M40 14 L30.4 21.6" stroke="#4D6BFE" stroke-width="6"/>
  </g>
</svg>`

/** An SVG carrying the official whale, as a rebase would bring it back. */
const WHALE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">
  <path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278Z" fill="#4D6BFE"/>
</svg>`

describe('official whale signature matching', () => {
  it('matches the artwork a rebase would reintroduce', () => {
    expect(findWhaleSignatures(WHALE_SVG)).toEqual(['M48.8354 10.0479'])
  })

  it('does not match a recoloured whale, because geometry carries the signature', () => {
    expect(findWhaleSignatures(WHALE_SVG.replace('#4D6BFE', '#000000'))).toHaveLength(1)
  })

  it('leaves the fork mark and unrelated artwork clean', () => {
    expect(findWhaleSignatures(RECORDED_MARK)).toEqual([])
    expect(findWhaleSignatures('<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>')).toEqual([])
  })

  it('treats an empty document as clean rather than matching everything', () => {
    expect(findWhaleSignatures('')).toEqual([])
  })

  it('keeps every signature distinctive enough to survive a partial edit', () => {
    for (const signature of OFFICIAL_WHALE_SIGNATURES) {
      // A signature shorter than a path start would match ordinary icons.
      expect(signature.startsWith('M')).toBe(true)
      expect(signature.length).toBeGreaterThan(10)
    }
  })
})

describe('recorded mark geometry', () => {
  it('accepts the recorded mark', () => {
    expect(findMissingStrokes(RECORDED_MARK)).toEqual([])
  })

  it('ignores path spacing differences that an editor would introduce', () => {
    expect(findMissingStrokes(RECORDED_MARK.replaceAll('M24 14 L10 32', 'M24  14   L10  32'))).toEqual([])
  })

  it('rejects a mark that lost a hook tip', () => {
    const drifted = RECORDED_MARK.replace('M40 14 L30.4 21.6', '')
    expect(findMissingStrokes(drifted).map(stroke => stroke.role)).toEqual(['right hook tip'])
  })

  it('rejects a mark whose hooks stopped interlocking', () => {
    // The G4 "shared spine" variant: both hooks intact, tips removed.
    const drifted = RECORDED_MARK
      .replace('M24 50 L33.6 42.4', '')
      .replace('M40 14 L30.4 21.6', '')
    expect(findMissingStrokes(drifted).map(stroke => stroke.role)).toEqual(['left hook tip', 'right hook tip'])
  })

  it('names the file and the missing role in the reported violation', () => {
    const drifted = RECORDED_MARK.replace('M24 14 L10 32 L24 50', '')
    const [violation] = inspectMarkGeometry('brand/assets/mark.svg', drifted)
    expect(violation).toMatchObject({ file: 'brand/assets/mark.svg' })
    expect(violation?.reason).toContain('left hook body')
  })

  it('reports nothing for a mark that matches', () => {
    expect(inspectMarkGeometry('brand/assets/mark.svg', RECORDED_MARK)).toEqual([])
  })
})

describe('per-variant geometry pinning', () => {
  /** The 8u small variant, a deliberate redraw rather than a scaled standard mark. */
  const SMALL_MARK = `<svg viewBox="0 0 64 64">
    <path d="M25 12 L9 32 L25 52"/><path d="M25 52 L33.9 43.1"/>
    <path d="M39 12 L55 32 L39 52"/><path d="M39 12 L30.1 20.9"/></svg>`

  /** The 22 px tray template: both hooks, no tips. */
  const TRAY_MARK = `<svg viewBox="0 0 64 64">
    <path d="M25 11 L8 32 L25 53"/><path d="M39 11 L56 32 L39 53"/></svg>`

  it('accepts the small variant against its own geometry', () => {
    expect(inspectMarkGeometry('brand/assets/mark-small.svg', SMALL_MARK)).toEqual([])
  })

  it('accepts the tray template, which intentionally omits the hook tips', () => {
    expect(inspectMarkGeometry('brand/assets/mark-tray.svg', TRAY_MARK)).toEqual([])
  })

  it('does not judge the small variant by the standard geometry', () => {
    // The realistic failure: a checker with one frozen geometry would reject
    // every variant that is not the standard mark.
    expect(inspectMarkGeometry('brand/assets/mark.svg', SMALL_MARK).length).toBeGreaterThan(0)
  })

  it('leaves an unpinned variant alone so a new variant can be developed', () => {
    expect(inspectMarkGeometry('brand/assets/mark-experimental.svg', '<svg><path d="M0 0"/></svg>')).toEqual([])
  })

  it('pins by file name regardless of directory depth', () => {
    expect(inspectMarkGeometry('brand/assets/nested/mark-small.svg', SMALL_MARK)).toEqual([])
  })
})
