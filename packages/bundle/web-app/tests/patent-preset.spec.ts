/**
 * The `patent` preset pairs each service-providing row with the consumer that
 * reads it: `patent-data` publishes `patentData` and `patent-tools` reads it
 * when it builds the PDF-download channel. Both sit in one entry-local isolate
 * realm, which is what makes the consumer resolve this mount's instance.
 *
 * The 2026-09-21 audit found `patent_pdf_download` failing every call in this
 * deployment because the consumer had read `ctx.get('patentData')` during its own
 * apply(), one dependency hop before that service activates; the wiring now
 * resolves the service per call. This spec keeps the pairing itself from
 * disappearing silently — a preset that drops, renames, or disables either row,
 * or names a package this workspace does not contain, fails here rather than at
 * the first download attempt.
 *
 * The preset is this bundle's own `presets/patent.patch.yml`, so the spec reads
 * the file it ships and unwraps the declaration the patch inserts.
 */

import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
/** The bundle's shipped `patent` preset declaration. */
const PATENT_PRESET = join(REPO_ROOT, 'packages/bundle/web-app/presets/patent.patch.yml')

/** One preset row, flattened out of its group nesting. */
interface PresetRow {
  id?: unknown
  name?: unknown
  disabled?: unknown
  parent?: string
  /** Group rows carry their isolate realm keys here. */
  isolate?: Record<string, unknown>
}

/** The `insert`ed declaration row this spec reads the child composition from. */
interface DeclarationRow {
  name?: unknown
  config?: { id?: unknown; plugins?: unknown }
}

/** Flatten a preset's entry list, keeping each row's enclosing group id. */
function flattenRows(entries: unknown[], parent?: string): PresetRow[] {
  const rows: PresetRow[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as PresetRow & { config?: unknown }
    rows.push({ ...row, ...(parent === undefined ? {} : { parent }) })
    if (Array.isArray(row.config)) {
      rows.push(...flattenRows(row.config, typeof row.id === 'string' ? row.id : parent))
    }
  }
  return rows
}

/** Read the `patent` declaration's rows out of the bundle's patch file. */
async function patentRows(): Promise<PresetRow[]> {
  const source = await readFile(PATENT_PRESET, 'utf8')
  const entries: unknown = yaml.load(source, { schema: entryListSchema })
  if (!Array.isArray(entries)) throw new TypeError('the patent preset patch must contain a Cordis entry list')
  const inserted: unknown[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const insert = (entry as { insert?: unknown }).insert
    if (Array.isArray(insert)) for (const row of insert) inserted.push(row)
  }
  const declaration = inserted.find((entry): entry is DeclarationRow => {
    const row = entry as DeclarationRow
    return row.name === '@deepseek-ai/dsh-agent-preset' && row.config?.id === 'patent'
  })
  const plugins = declaration?.config?.plugins
  if (!Array.isArray(plugins)) throw new TypeError('the patent preset patch must declare the `patent` preset with a plugin list')
  return flattenRows(plugins)
}

/** Every package name this workspace contains. */
function workspacePackageNames(): Set<string> {
  const names = new Set<string>()
  for (const relative of globSync('packages/*/*/package.json', { cwd: REPO_ROOT })) {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, relative), 'utf8')) as { name?: string }
    if (typeof manifest.name === 'string') names.add(manifest.name)
  }
  return names
}

/** The isolate realm keys declared by the patent group. */
function patentRealmKeys(rows: PresetRow[]): string[] {
  const group = rows.find(row => row.id === 'patent' && row.parent === undefined)
  return Object.keys(group?.isolate ?? {})
}

/** The package part of a row name: scoped rows may append a subpath slot. */
function packageOf(name: string): string {
  const segments = name.split('/')
  return name.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] as string
}

describe('patent preset composition', () => {
  it('names only packages this workspace contains', async () => {
    const known = workspacePackageNames()
    const unknown = (await patentRows())
      .map(row => row.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith('@deepseek-ai/'))
      .map(packageOf)
      .filter(name => !known.has(name))
    expect(unknown).toEqual([])
  })

  it('keeps the patent-data provider and its consumer enabled in one realm', async () => {
    const rows = await patentRows()
    const provider = rows.find(row => row.id === 'patent-data')
    const consumer = rows.find(row => row.id === 'patent-tools')

    expect(provider?.name).toBe('@deepseek-ai/dsh-patent-data')
    expect(consumer?.name).toBe('@deepseek-ai/dsh-patent-tools')
    expect(provider?.disabled).toBeUndefined()
    expect(consumer?.disabled).toBeUndefined()
    // Same enclosing group: a consumer outside the realm resolves the host's
    // registry instead of this mount's instance.
    expect(provider?.parent).toBe(consumer?.parent)
    expect(provider?.parent).toBe('patent')
    expect(patentRealmKeys(rows)).toContain('patentData')
  })

  it('enables the model-facing web tool with its fetch channel', async () => {
    const rows = await patentRows() as Array<PresetRow & { config?: { fetch?: unknown } }>
    const toolWeb = rows.find(row => row.id === 'tool-web')
    expect(toolWeb?.config?.fetch).toBe(true)
  })

  it('mounts the law index checker the fact-check gate calls', async () => {
    // The persona and the fact-check / quality-gate skills instruct the model to run
    // law_verify first; without this row the tool is absent from the session.
    const rows = await patentRows()
    const row = rows.find(entry => entry.id === 'patent-law')
    expect(row?.name).toBe('@deepseek-ai/dsh-patent-law')
    expect(row?.disabled).toBeUndefined()
  })

  it('mounts the fee index tool the number gate calls', async () => {
    // patent-quality-gate item 4 and the persona require the fee amounts to come from
    // patent_fees; without this row the model has no tool to price them with.
    const rows = await patentRows()
    const row = rows.find(entry => entry.id === 'patent-fees')
    expect(row?.name).toBe('@deepseek-ai/dsh-patent-fees')
    expect(row?.disabled).toBeUndefined()
  })
})
