import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DocumentRenderError,
  getTemplateRoot,
  readTemplateManifest,
  resolveTemplate,
} from '@deepseek-ai/dsh-patent-document'

// The fallback and empty-manifest paths are unreachable against the shipped
// assets; this file runs its own module graph with a stubbed node:fs.
const edgeFs = vi.hoisted(() => ({ blockManifest: false, emptyManifest: false }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: ((p: unknown) => {
      const path = String(p)
      if (edgeFs.blockManifest && path.endsWith('manifest.json')) return false
      return actual.existsSync(p as Parameters<typeof actual.existsSync>[0])
    }) as typeof actual.existsSync,
    readFileSync: ((p: unknown, ...rest: unknown[]) => {
      const path = String(p)
      if (edgeFs.emptyManifest && path.endsWith('manifest.json')) return '{"renders":{"default":"x"}}'
      return (actual.readFileSync as (...args: unknown[]) => unknown)(p, ...rest)
    }) as typeof actual.readFileSync,
  }
})

describe('templateResolver fallback edges', () => {
  it('falls back to the first candidate root when no manifest exists anywhere', () => {
    edgeFs.blockManifest = true
    try {
      const root = getTemplateRoot()
      expect(root.endsWith(join('assets', 'templates', 'patent'))).toBe(true)
    } finally {
      edgeFs.blockManifest = false
    }
  })

  it('treats a manifest without a templates list as empty', () => {
    edgeFs.emptyManifest = true
    try {
      const manifest = readTemplateManifest()
      expect(manifest.templates).toBeUndefined()
      expect(() => resolveTemplate('patentability-opinion')).toThrow(DocumentRenderError)
      expect(() => resolveTemplate('patentability-opinion')).toThrow(/可用: 无/)
    } finally {
      edgeFs.emptyManifest = false
    }
  })
})
