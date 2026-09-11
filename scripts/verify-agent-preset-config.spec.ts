/**
 * The boundary table for `verify-agent-preset-config`: every admitted and
 * excluded row form that changes the gate's verdict, plus the corpus floors
 * that keep "no violations" distinguishable from "nothing judged".
 *
 * Compositions are parsed through the gate's own YAML dialect, so the `!!js`
 * cases exercise the real preserved-expression node rather than a hand-built
 * lookalike.
 */

import { Config as PersonaConfig } from '@deepseek-ai/dsh-persona'
import z from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { loadCordisYaml } from './cordis-yaml.ts'
import {
  assertNonEmptyCorpus, findConfigViolations, lineOfRowId, packageNameOf, unjudgedCompositions,
  type ConfigSchema, type RowResolution, type RowResolver,
} from './verify-agent-preset-config.ts'

/** A plugin schema with one required key and one optional key. */
const FixtureConfig = z.object({
  required: z.string().required(),
  count: z.number().default(1),
}) as unknown as ConfigSchema

/** A plugin schema whose every key is defaulted, the shape a tool row meets. */
const OptionalConfig = z.object({
  count: z.number().default(1),
}) as unknown as ConfigSchema

const JUDGED: RowResolution = { kind: 'schema', schema: FixtureConfig }
const SKIPPED: Record<string, RowResolution> = {
  '@fixture/external': { kind: 'skip', reason: 'external' },
  '@fixture/unimportable': { kind: 'skip', reason: 'import-failed' },
  '@fixture/schemaless': { kind: 'skip', reason: 'no-config' },
}

/** A resolver answering from a fixed map, defaulting to an unresolvable name. */
function resolverOf(entries: Record<string, RowResolution>): RowResolver {
  return async name => entries[name] ?? { kind: 'skip', reason: 'external' }
}

/** Every row names the fixture plugin unless it says otherwise. */
const fixtures = (yaml: string, extra: Record<string, RowResolution> = {}): ReturnType<typeof findConfigViolations> =>
  findConfigViolations(loadCordisYaml(yaml), resolverOf({ '@fixture/plugin': JUDGED, ...SKIPPED, ...extra }))

describe('judging a preset row against the schema its plugin declares', () => {
  it('accepts a config carrying every required key', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  config:
    required: ok
`)
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(1)
  })

  it('reports a missing required key', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  config:
    count: 2
`)
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.label).toBe('row "target"')
    expect(report.violations[0]?.name).toBe('@fixture/plugin')
    expect(report.violations[0]?.issues[0]?.message).toBe('$.required missing required value')
    expect(report.violations[0]?.issues[0]?.path).toEqual(['required'])
  })

  it('reports a wrong type on a known key', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  config:
    required: ok
    count: not-a-number
`)
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.issues[0]?.path).toEqual(['count'])
  })

  it('accepts an unknown key, because schemastery merges rather than rejects', async () => {
    // The gate's real guarantee: a missing required key and a wrong type on a
    // known key. A misspelled OPTIONAL key passes here exactly as it passes at
    // runtime, so this case pins that limit instead of claiming more.
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  config:
    required: ok
    requried: typo
`)
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(1)
  })

  it('reports a missing required key for a row that declares no config at all', async () => {
    // The loader hands the raw `config` to the schema, so an absent one is
    // validated as `undefined` rather than skipped.
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
`)
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.issues[0]?.message).toBe('$.required missing required value')
  })

  it('accepts a config-less row when its plugin requires nothing', async () => {
    // The shape most tool rows take: no config, and a plugin whose schema has
    // only defaulted keys.
    const report = await fixtures(`
- id: target
  name: '@fixture/optional'
`, { '@fixture/optional': { kind: 'schema', schema: OptionalConfig } })
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(1)
  })

  it('labels a row without an id by its position', async () => {
    const report = await fixtures(`
- name: '@fixture/plugin'
  config: {}
`)
    expect(report.violations[0]?.label).toBe('row 1')
  })
})

describe('walking the row containers the loader walks', () => {
  it('recurses into a group', async () => {
    const report = await fixtures(`
- id: outer
  name: cordis:group
  group: true
  config:
    - id: inner
      name: '@fixture/plugin'
      config: {}
`)
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.label).toBe('row "inner"')
    expect(report.validated).toBe(0)
  })

  it('recurses into a nested group', async () => {
    const report = await fixtures(`
- id: outer
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  config:
    - id: middle
      name: cordis:group
      group: true
      config:
        - id: inner
          name: '@fixture/plugin'
          config:
            required: ok
`)
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(1)
  })

  it('never judges a group row by its own name', async () => {
    const report = await fixtures(`
- id: outer
  name: cordis:group
  group: true
  config: []
`)
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(0)
    expect(report.skipped.external).toBe(0)
  })
})

describe('rows the gate excludes, and why', () => {
  it('skips a row whose config carries a !!js expression', async () => {
    // The loader interpolates the expression against a live plugin context
    // before the schema sees it; judging the parsed node would report a
    // healthy preset as broken.
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  config:
    required: !!js process.platform
`)
    expect(report.violations).toEqual([])
    expect(report.skipped.conditional).toBe(1)
    expect(report.validated).toBe(0)
  })

  it('skips a row whose disabled is a truthy expression', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  disabled: !!js process.platform !== 'darwin'
  config: {}
`)
    expect(report.skipped.disabled).toBe(1)
    expect(report.validated).toBe(0)
  })

  it('skips a row disabled by true', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  disabled: true
  config: {}
`)
    expect(report.skipped.disabled).toBe(1)
    expect(report.validated).toBe(0)
  })

  it('judges a row whose disabled is 0, which the loader still starts', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/plugin'
  disabled: 0
  config: {}
`)
    expect(report.skipped.disabled).toBe(0)
    expect(report.violations).toHaveLength(1)
  })

  it('counts a plugin outside the workspace as external', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/external'
  config: {}
`)
    expect(report.skipped.external).toBe(1)
    expect(report.validated).toBe(0)
  })

  it('counts a module that will not import without calling it a violation', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/unimportable'
  config: {}
`)
    expect(report.skipped['import-failed']).toBe(1)
    expect(report.violations).toEqual([])
  })

  it('counts a plugin that declares no Config', async () => {
    const report = await fixtures(`
- id: target
  name: '@fixture/schemaless'
  config:
    anything: goes
`)
    expect(report.skipped['no-config']).toBe(1)
    expect(report.validated).toBe(0)
  })

  it('skips a row that names no plugin', async () => {
    const report = await fixtures(`
- name: ''
  config: {}
`)
    expect(report.validated).toBe(0)
    expect(report.violations).toEqual([])
  })
})

describe('reading a plugin specifier', () => {
  it('names the package of a bare and a scoped specifier', () => {
    expect(packageNameOf('some-plugin')).toBe('some-plugin')
    expect(packageNameOf('@scope/plugin')).toBe('@scope/plugin')
  })

  it('drops a subpath from the package it names', () => {
    expect(packageNameOf('@deepseek-ai/dsh-tool-subagent-control/list-agents')).toBe('@deepseek-ai/dsh-tool-subagent-control')
  })

  it('names no package for a relative, absolute, or scheme specifier', () => {
    expect(packageNameOf('./plugin.mjs')).toBeUndefined()
    expect(packageNameOf('/opt/plugin.mjs')).toBeUndefined()
    expect(packageNameOf('file:///opt/plugin.mjs')).toBeUndefined()
    expect(packageNameOf('cordis:group')).toBeUndefined()
  })
})

describe('locating a row id in composition source', () => {
  it('returns the 1-based line declaring the id', () => {
    expect(lineOfRowId('- id: first\n  name: a\n- id: second\n', 'second')).toBe(3)
  })

  it('returns undefined for an id the source does not declare', () => {
    expect(lineOfRowId('- id: first\n', 'absent')).toBeUndefined()
  })
})

describe('the corpus floors', () => {
  it('refuses a corpus the globs no longer match', () => {
    expect(() => { assertNonEmptyCorpus([]) }).toThrow(/no preset compositions found/)
  })

  it('accepts a non-empty corpus', () => {
    expect(() => { assertNonEmptyCorpus(['a/agent.cordis.yml']) }).not.toThrow()
  })

  it('names every composition where nothing was judged', () => {
    expect(unjudgedCompositions([
      { file: 'a/agent.cordis.yml', validated: 0 },
      { file: 'b/agent.cordis.yml', validated: 3 },
    ])).toEqual(['a/agent.cordis.yml'])
  })
})

describe('the schema a real plugin declares', () => {
  const persona: RowResolution = { kind: 'schema', schema: PersonaConfig as unknown as ConfigSchema }

  it('rejects the text field the 2026-09-06 persona change replaced', async () => {
    const report = await findConfigViolations(loadCordisYaml(`
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    text: persona prose
`), resolverOf({ '@deepseek-ai/dsh-persona': persona }))
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.issues[0]?.message).toBe('$.prefix missing required value')
  })

  it('accepts the prefix field that replaced it', async () => {
    const report = await findConfigViolations(loadCordisYaml(`
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    prefix: persona prose
`), resolverOf({ '@deepseek-ai/dsh-persona': persona }))
    expect(report.violations).toEqual([])
    expect(report.validated).toBe(1)
  })
})
