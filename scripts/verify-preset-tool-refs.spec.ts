import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findToolRefViolations,
  loadPresetCorpus,
  mountedToolNames,
  parseToolCatalog,
  toolReferences,
  type PresetCorpus,
} from './verify-preset-tool-refs.ts'

const root = resolve(import.meta.dirname, '..')

/** A catalog excerpt in the generated package-map format. */
const CATALOG = [
  '| Tool package | Model-visible names | Requires | Writes / affects | Shipped aliases | Deployment note |',
  '| --- | --- | --- | --- | --- | --- |',
  '| `@deepseek-ai/dsh-tool-fs` | `edit`, `read`, `read_image`, `write` | `ctx.tools` | `tool/call` | - | - |',
  '| `@deepseek-ai/dsh-tool-subagent` | `subagent` | `ctx.tools` | `tool/call` | `subagent_fork` | - |',
].join('\n')

/** One corpus entry over a preset YAML and an optional skill file. */
function corpusOf(preset: string, presetSource: string, skillSource = ''): PresetCorpus {
  return {
    preset,
    presetFile: { path: `presets/${preset}.patch.yml`, source: presetSource },
    skillFiles: skillSource === '' ? [] : [{ path: `skills/${preset}/probe/SKILL.md`, source: skillSource }],
  }
}

const FS_PRESET = ['- insert:', "    - name: '@deepseek-ai/dsh-tool-fs'", ''].join('\n')

const tempRoots: string[] = []
afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) rmSync(tempRoot, { recursive: true, force: true })
})

describe('parseToolCatalog', () => {
  it('reads the model-visible names and shipped aliases of each package row', () => {
    const catalog = parseToolCatalog(CATALOG)
    expect(catalog.get('@deepseek-ai/dsh-tool-fs')).toEqual(new Set(['edit', 'read', 'read_image', 'write']))
    expect(catalog.get('@deepseek-ai/dsh-tool-subagent')).toEqual(new Set(['subagent', 'subagent_fork']))
  })

  it('reads no package from prose outside the table', () => {
    expect(parseToolCatalog('A paragraph mentioning `@deepseek-ai/dsh-tool-fs`.')).toEqual(new Map())
  })
})

describe('mountedToolNames', () => {
  it('collects the catalog names of every plugin the preset names', () => {
    expect(mountedToolNames(FS_PRESET, parseToolCatalog(CATALOG))).toEqual(new Set(['edit', 'read', 'read_image', 'write']))
  })

  it('adds a load-time toolName and ignores packages the catalog does not carry', () => {
    const preset = [
      '- insert:',
      "    - name: '@deepseek-ai/dsh-tool-fs'",
      "    - name: '@deepseek-ai/dsh-tool-unlisted'",
      '      config:',
      '        toolName: custom_tool',
      '',
    ].join('\n')
    expect(mountedToolNames(preset, parseToolCatalog(CATALOG))).toEqual(new Set(['edit', 'read', 'read_image', 'write', 'custom_tool']))
  })

  it('drops a row the preset disables, so its package and toolName mount nothing', () => {
    const preset = [
      '- insert:',
      "    - name: '@deepseek-ai/dsh-tool-subagent'",
      '      disabled: true',
      '      config:',
      '        toolName: custom_tool',
      '',
    ].join('\n')
    expect(mountedToolNames(preset, parseToolCatalog(CATALOG))).toEqual(new Set())
  })

  it('keeps a row whose disabled condition evaluates to false', () => {
    const preset = [
      '- insert:',
      "    - name: '@deepseek-ai/dsh-tool-fs'",
      '      disabled: false',
      '',
    ].join('\n')
    expect(mountedToolNames(preset, parseToolCatalog(CATALOG))).toEqual(new Set(['edit', 'read', 'read_image', 'write']))
  })
})

describe('toolReferences', () => {
  it('keeps only backticked snake_case names carrying an underscore, with line numbers', () => {
    expect(toolReferences('use `read` and `foo_bar`\nthen `ls` or `x_y`')).toEqual([
      { line: 1, name: 'foo_bar' },
      { line: 2, name: 'x_y' },
    ])
  })
})

describe('findToolRefViolations', () => {
  it('accepts a reference the preset mounts and a cataloged alias', () => {
    const preset = [FS_PRESET, "    - name: '@deepseek-ai/dsh-tool-subagent'", ''].join('\n')
    const violations = findToolRefViolations(CATALOG, [corpusOf('a', preset, 'use `read` and `subagent_fork`')])
    expect(violations).toEqual([])
  })

  it('reports a backticked name no mounted tool carries', () => {
    const violations = findToolRefViolations(CATALOG, [corpusOf('a', FS_PRESET, 'use `foo_bar`')])
    expect(violations).toEqual(['skills/a/probe/SKILL.md:1: `foo_bar` is not a tool preset a mounts'])
  })

  it('reports a reference to a tool whose preset row is disabled', () => {
    const preset = ['- insert:', "    - name: '@deepseek-ai/dsh-tool-subagent'", '      disabled: true', ''].join('\n')
    expect(findToolRefViolations(CATALOG, [corpusOf('a', preset, 'use `subagent_fork`')])).toEqual([
      'skills/a/probe/SKILL.md:1: `subagent_fork` is not a tool preset a mounts',
    ])
  })

  it('reports a tool another preset mounts but this one does not', () => {
    const corpus = [
      corpusOf('a', FS_PRESET, 'use `read_image`'),
      corpusOf('b', ['- insert:', "    - name: '@deepseek-ai/dsh-tool-subagent'", ''].join('\n'), 'use `read_image`'),
    ]
    expect(findToolRefViolations(CATALOG, corpus)).toEqual([
      'skills/b/probe/SKILL.md:1: `read_image` is not a tool preset b mounts',
    ])
  })

  it('accepts an explicitly exempted name and still reports the rest', () => {
    const violations = findToolRefViolations(
      CATALOG,
      [corpusOf('a', FS_PRESET, '`source_path` and `foo_bar`')],
      new Map([['source_path', 'patent evidence field']]),
    )
    expect(violations).toEqual(['skills/a/probe/SKILL.md:1: `foo_bar` is not a tool preset a mounts'])
  })

  it('scans the preset YAML itself, not only its skills', () => {
    const preset = [FS_PRESET, '# call `foo_bar` here', ''].join('\n')
    expect(findToolRefViolations(CATALOG, [corpusOf('a', preset)])).toEqual([
      'presets/a.patch.yml:4: `foo_bar` is not a tool preset a mounts',
    ])
  })

  it('fails loud on an empty catalog package map', () => {
    expect(() => findToolRefViolations('# no rows', [corpusOf('a', FS_PRESET)])).toThrow(/carries no package rows/)
  })
})

describe('loadPresetCorpus', () => {
  it('pairs each preset with the skill files under its directory', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-preset-tool-refs-'))
    tempRoots.push(tempRoot)
    const presetRoot = join(tempRoot, 'packages/bundle/web-app/presets')
    const skillDir = join(tempRoot, 'packages/bundle/web-app/skills/a/probe')
    mkdirSync(presetRoot, { recursive: true })
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(presetRoot, 'a.patch.yml'), FS_PRESET)
    writeFileSync(join(skillDir, 'SKILL.md'), 'use `read`')
    const corpus = loadPresetCorpus(tempRoot)
    expect(corpus.map(entry => entry.preset)).toEqual(['a'])
    expect(corpus[0]?.skillFiles.map(file => file.path)).toEqual(['packages/bundle/web-app/skills/a/probe/SKILL.md'])
  })

  it('fails loud on a skills directory without a preset', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'dsh-preset-tool-refs-'))
    tempRoots.push(tempRoot)
    mkdirSync(join(tempRoot, 'packages/bundle/web-app/presets'), { recursive: true })
    mkdirSync(join(tempRoot, 'packages/bundle/web-app/skills/orphan'), { recursive: true })
    expect(() => loadPresetCorpus(tempRoot)).toThrow(/without a preset: orphan/)
  })
})

describe('shipped preset corpus', () => {
  it('resolves every backticked tool reference', () => {
    const corpus = loadPresetCorpus(root)
    expect(corpus.length).toBeGreaterThan(0)
    expect(corpus.filter(entry => entry.skillFiles.length > 0).length).toBeGreaterThan(0)
    const violations = findToolRefViolations(readFileSync(resolve(root, 'docs/tool-catalog.md'), 'utf8'), corpus)
    expect(violations).toEqual([])
  })
})
