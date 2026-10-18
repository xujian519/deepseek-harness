import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildBrandStyle, loadBrandFromPath, mergeBrand } from '@deepseek-ai/dsh-patent-document'

describe('brandInjector', () => {
  it('builds CSS with quoted prose and unquoted colors', () => {
    const css = buildBrandStyle({ firm: 'Test Firm', accent: '#123456' })
    expect(css).toMatch(/--sati-doc-firm: "Test Firm";/)
    expect(css).toMatch(/--sati-doc-accent: #123456;/)
    expect(css).toContain(':root {')
    expect(css.trim().endsWith('}')).toBe(true)
  })

  it('merges explicit brand over config brand', () => {
    const brand = mergeBrand({ firm: 'Explicit' }, { firm: 'Config', accent: '#000' })
    expect(brand.firm).toBe('Explicit')
    expect(brand.accent).toBe('#000')
  })

  it('escapes destructive characters and quotes', () => {
    const css = buildBrandStyle({ accent: '#123; } body { display:none', firm: 'A"B' })
    expect((css.match(/\{/g) ?? []).length).toBe(1)
    expect((css.match(/\}/g) ?? []).length).toBe(1)
    expect(css).not.toMatch(/\{ body|\} body/)
    expect(css).toMatch(/--sati-doc-firm: "A\\"B";/)
  })

  it('escapes style-closing tags so a brand value cannot inject HTML', () => {
    const payload = 'x</style><script>alert(1)</script>'
    const quoted = buildBrandStyle({ firm: payload })
    expect(quoted).not.toContain('</style')
    expect(quoted).not.toContain('<script')
    expect(quoted).toContain('\\3C ')

    const unquoted = buildBrandStyle({ accent: payload })
    expect(unquoted).not.toContain('</style')
    expect(unquoted).not.toContain('<script')
    expect(unquoted).toContain('\\3C ')
  })

  it('skips unknown keys and blank values', () => {
    const css = buildBrandStyle({ notAKey: 'x', firm: '   ' })
    expect(css).not.toContain('notAKey')
    expect(css).not.toContain('--sati-doc-firm:')
  })

  it('loads documents.patent brand from a theme.json path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-brand-'))
    try {
      const path = join(dir, 'theme.json')
      writeFileSync(path, JSON.stringify({ documents: { patent: { firm: '事务所', accent: '#112233' } } }))
      expect(loadBrandFromPath(path)).toEqual({ firm: '事务所', accent: '#112233' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty brand for a missing path', () => {
    expect(loadBrandFromPath('/no/such/theme.json')).toEqual({})
    expect(loadBrandFromPath(undefined)).toEqual({})
  })

  it('falls back to an empty brand for a corrupt theme.json or a missing documents.patent namespace', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-brand-'))
    try {
      const corrupt = join(dir, 'corrupt.json')
      writeFileSync(corrupt, '{not json')
      expect(loadBrandFromPath(corrupt)).toEqual({})

      const noPatent = join(dir, 'no-patent.json')
      writeFileSync(noPatent, JSON.stringify({ documents: { other: { firm: 'x' } } }))
      expect(loadBrandFromPath(noPatent)).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('merges an explicit brand with no config source', () => {
    expect(mergeBrand({ firm: 'Explicit' })).toEqual({ firm: 'Explicit' })
  })
})
