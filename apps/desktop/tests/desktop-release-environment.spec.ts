import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_PRODUCT_NAME,
  DESKTOP_ICON_DIR_ENV,
  DESKTOP_PRODUCT_NAME_ENV,
  resolveDesktopIconDir,
  resolveDesktopProductName,
} from '../scripts/desktop-release-environment.mjs'

describe('desktop release environment branding', () => {
  it('defaults the product name and keeps no icon directory', () => {
    expect(resolveDesktopProductName({})).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopProductName({ [DESKTOP_PRODUCT_NAME_ENV]: '   ' })).toBe(DEFAULT_DESKTOP_PRODUCT_NAME)
    expect(resolveDesktopIconDir({})).toBeUndefined()
    expect(resolveDesktopIconDir({ [DESKTOP_ICON_DIR_ENV]: ' ' })).toBeUndefined()
  })

  it('trims and returns a valid branded name and icon directory', () => {
    expect(resolveDesktopProductName({ [DESKTOP_PRODUCT_NAME_ENV]: '  DSH Patent  ' })).toBe('DSH Patent')
    expect(resolveDesktopIconDir({ [DESKTOP_ICON_DIR_ENV]: ' /tmp/icons ' })).toBe('/tmp/icons')
  })

  it('rejects over-long names', () => {
    expect(() => resolveDesktopProductName({ [DESKTOP_PRODUCT_NAME_ENV]: 'x'.repeat(65) }))
      .toThrowError(/at most 64 characters/)
  })

  it('rejects control characters and path separators', () => {
    for (const name of ['DSH\nPatent', 'DSH/Patent', 'DSH\\Patent']) {
      expect(() => resolveDesktopProductName({ [DESKTOP_PRODUCT_NAME_ENV]: name }))
        .toThrowError(/control characters or path separators/)
    }
  })
})
