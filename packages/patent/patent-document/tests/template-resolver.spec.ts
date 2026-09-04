import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DocumentRenderError,
  getTemplateRoot,
  readTemplateHtml,
  readTemplateManifest,
  resolveTemplate,
} from '@deepseek-ai/dsh-patent-document'

describe('templateResolver', () => {
  it('resolves the template root and reads the manifest', () => {
    const root = getTemplateRoot()
    expect(existsSync(join(root, 'manifest.json'))).toBe(true)

    const manifest = readTemplateManifest()
    expect(Array.isArray(manifest.templates)).toBe(true)
    expect(manifest.templates).toEqual([
      'patentability-opinion',
      'search-report',
      'oa-response',
      'claims-spec',
      'invalidation-opinion',
      'rectification-response',
      're-examination-request',
      'infringement-opinion',
      'litigation-pleading',
    ])
  })

  it('resolves the html path for every manifest template', () => {
    for (const id of ['patentability-opinion', 'search-report', 'oa-response', 'claims-spec', 'invalidation-opinion', 'rectification-response', 're-examination-request', 'infringement-opinion', 'litigation-pleading'] as const) {
      const { root, htmlPath } = resolveTemplate(id)
      expect(htmlPath).toBe(join(root, id, 'assets', 'template.html'))
      expect(existsSync(htmlPath)).toBe(true)
    }
  })

  it('rejects an unknown template with DocumentRenderError', () => {
    expect(() => resolveTemplate('no-such-template' as never)).toThrow(DocumentRenderError)
    expect(() => resolveTemplate('no-such-template' as never)).toThrow(/未知模板/)
  })

  it('rejects a manifest-listed template whose html file is missing', () => {
    const { htmlPath } = resolveTemplate('oa-response')
    const backup = htmlPath + '.bak'
    renameSync(htmlPath, backup)
    try {
      expect(() => resolveTemplate('oa-response')).toThrow(/模板 HTML 缺失/)
    } finally {
      renameSync(backup, htmlPath)
    }
  })

  it('reads template html text', () => {
    const html = readTemplateHtml('patentability-opinion')
    expect(html).toContain('<head')
    expect(html).toContain('--sati-doc-firm')
  })
})
