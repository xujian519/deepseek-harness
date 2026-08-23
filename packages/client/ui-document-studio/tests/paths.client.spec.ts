/**
 * parentDir: the workspace-relative containing folder of a produced file,
 * which the show-in-folder action opens (the host has no reveal intent).
 */
import { describe, expect, it } from 'vitest'
import { parentDir } from '../src/client/paths.ts'

describe('parentDir', () => {
  it('returns the containing directory for nested paths', () => {
    expect(parentDir('out/report.html')).toBe('out')
    expect(parentDir('a/b/deck.html')).toBe('a/b')
  })

  it('returns the empty string for workspace-root files', () => {
    expect(parentDir('index.html')).toBe('')
  })

  it('handles Windows separators', () => {
    expect(parentDir('out\\report.docx')).toBe('out')
  })
})
