import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DocumentRenderError,
  getTemplateRoot,
  readTemplateManifest,
  resolveTemplate,
} from '@deepseek-ai/dsh-patent-document'

// The fallback and malformed-manifest paths are unreachable against the shipped
// assets; this file runs its own module graph with a stubbed node:fs.
const edgeFs = vi.hoisted(() => ({
  blockManifest: false,
  blockTemplateHtml: false,
  manifestBody: null as string | null,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: ((p: unknown) => {
      const path = String(p)
      if (edgeFs.blockManifest && path.endsWith('manifest.json')) return false
      if (edgeFs.blockTemplateHtml && path.endsWith('template.html')) return false
      return actual.existsSync(p as Parameters<typeof actual.existsSync>[0])
    }) as typeof actual.existsSync,
    readFileSync: ((p: unknown, ...rest: unknown[]) => {
      const path = String(p)
      if (edgeFs.manifestBody !== null && path.endsWith('manifest.json')) return edgeFs.manifestBody
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

  it('reports a manifest without a templates list as a manifest error, not an empty template set', () => {
    edgeFs.manifestBody = '{"renders":{"default":"x"}}'
    try {
      expect(() => readTemplateManifest()).toThrow(DocumentRenderError)
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 的 templates 必须是字符串数组/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reports a manifest that is not valid JSON', () => {
    edgeFs.manifestBody = '{"templates": ['
    try {
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 不是合法 JSON/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reports a manifest that is not a JSON object', () => {
    edgeFs.manifestBody = '[]'
    try {
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 不是 JSON 对象/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reports a templates list holding a non-string entry', () => {
    edgeFs.manifestBody = '{"templates":[1]}'
    try {
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 的 templates 必须是字符串数组/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reports a manifest whose root is a scalar', () => {
    edgeFs.manifestBody = '"templates"'
    try {
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 不是 JSON 对象/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reports a manifest whose root is null', () => {
    edgeFs.manifestBody = 'null'
    try {
      expect(() => readTemplateManifest()).toThrow(/manifest\.json 不是 JSON 对象/)
    } finally {
      edgeFs.manifestBody = null
    }
  })

  it('reuses the parsed manifest for the same path', () => {
    expect(readTemplateManifest()).toBe(readTemplateManifest())
  })

  it('resolves a template the manifest lists', () => {
    const resolved = resolveTemplate('patentability-opinion')
    expect(resolved.htmlPath.endsWith(join('patentability-opinion', 'assets', 'template.html'))).toBe(true)
  })

  it('reports a template whose HTML file is missing', () => {
    edgeFs.blockTemplateHtml = true
    try {
      expect(() => resolveTemplate('patentability-opinion')).toThrow(/模板 HTML 缺失/)
    } finally {
      edgeFs.blockTemplateHtml = false
    }
  })

  it('reports an empty available list when the manifest lists no template', async () => {
    // 同样需要一个未缓存的模块实例。
    vi.resetModules()
    edgeFs.manifestBody = '{"templates":[]}'
    try {
      const fresh = await import('@deepseek-ai/dsh-patent-document')
      expect(() => fresh.resolveTemplate('patentability-opinion'))
        .toThrow(/未知模板 "patentability-opinion"（可用: 无）/)
    } finally {
      edgeFs.manifestBody = null
      vi.resetModules()
    }
  })

  it('reports a template the manifest does not list', async () => {
    // 需要一个未缓存的模块实例：前面的用例已经缓存了真实 manifest。
    vi.resetModules()
    edgeFs.manifestBody = '{"templates":["claims-spec"]}'
    try {
      const fresh = await import('@deepseek-ai/dsh-patent-document')
      expect(() => fresh.resolveTemplate('patentability-opinion'))
        .toThrow(/未知模板 "patentability-opinion"（可用: claims-spec）/)
    } finally {
      edgeFs.manifestBody = null
      vi.resetModules()
    }
  })
})
