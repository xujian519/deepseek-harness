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
/** The directory holding the skills the `patent` preset ships. */
const PATENT_SKILLS = join(REPO_ROOT, 'packages/bundle/web-app/skills/patent')

/**
 * Literal endpoints of the deployment's cnlaw legal base. The persona and the
 * skills address that base through the declaration section `dsh-patent-law`
 * renders from Config, so a port spelled out here would tell the model to use
 * an endpoint its deployment never declared.
 */
const CNLAW_ENDPOINT_LITERAL = /(?:127\.0\.0\.1|localhost)(?::\d+)?|:(?:8100|8001|7687)\b|\b(?:8100|8001|7687)\b/gu

/** Every cnlaw endpoint literal in one text, for the assertion to report. */
function cnlawEndpointLiterals(text: string): string[] {
  return text.match(CNLAW_ENDPOINT_LITERAL) ?? []
}

/** One preset row, flattened out of its group nesting. */
interface PresetRow {
  id?: unknown
  name?: unknown
  disabled?: unknown
  parent?: string
  /** Group rows carry their isolate realm keys here. */
  isolate?: Record<string, unknown>
  /** A row's own config: an array for a group, an object for a configured row. */
  config?: unknown
}

/** The `insert`ed declaration row this spec reads the child composition from. */
interface DeclarationRow {
  name?: unknown
  config?: { id?: unknown; plugins?: unknown }
}

/** One `deliveryGate` entry as the `patent` preset declares it. */
interface DeliveryGateDeclaration {
  tool?: string
  requires?: string[]
  whenArgs?: { template?: string[] }
}

/** The persona text a row declares, or `''` when the row carries none. */
function personaPrefix(row: PresetRow | undefined): string {
  const config = row?.config
  if (typeof config !== 'object' || config === null) return ''
  const prefix = 'prefix' in config ? config.prefix : undefined
  return typeof prefix === 'string' ? prefix : ''
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

/** The shipped `deepseek-official` model catalog source (the adapter's default list). */
const DEEPSEEK_CATALOG = join(REPO_ROOT, 'packages/llm/llm-deepseek/src/models.ts')

/** Catalog text used to pin the entry-scoped extractor below. */
const CATALOG_FIXTURE = [
  'export const DEFAULT_MODELS = [',
  '  {',
  "    id: 'alpha',",
  "    inputModalities: ['text'],",
  '  },',
  '  {',
  "    id: 'beta',",
  "    inputModalities: ['text', 'image'],",
  '  },',
  ']',
].join('\n')

/**
 * The `inputModalities` an entry declares in one catalog source, or null when the
 * catalog has no such entry. Entries are brace-delimited object literals; the
 * extraction is scoped to one entry so a neighbouring model's modalities cannot
 * satisfy the preset's requirement.
 * @param source - catalog source text.
 * @param id - model id to look up.
 * @returns the declared modalities, or null when the id is absent.
 */
function imageModalitiesIn(source: string, id: string): string[] | null {
  for (const match of source.matchAll(/\{\s*\n\s*id:\s*'([^']+)'([\s\S]*?)\n\s*\}/g)) {
    if (match[1] !== id) continue
    const declared = /inputModalities:\s*\[([^\]]*)\]/.exec(match[2] ?? '')
    return (declared?.[1] ?? '').split(',').map(part => part.trim().replace(/'/g, '')).filter(part => part !== '')
  }
  return null
}

/** Modalities the shipped `deepseek-official` catalog declares for one model id. */
function shippedCatalogModalities(id: string): string[] | null {
  return imageModalitiesIn(readFileSync(DEEPSEEK_CATALOG, 'utf8'), id)
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
    const rows = await patentRows() as Array<PresetRow & { config?: { nuoRequestChannel?: unknown } }>
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
    // The nuo browser path turns itself on wherever `ego-browser` is installed on
    // macOS, and search returns zero hits behind a non-fatal warning there.
    expect(provider?.config?.nuoRequestChannel).toBe('native')
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

  it('gates a delivery render on the gate runs the persona requires', async () => {
    // The delivery discipline also lives in the persona prefix; this declaration is
    // what makes it an execution point. A required tool whose package the preset does
    // not mount, or a template id the renderer does not ship, leaves a gate that looks
    // armed and never fires.
    const rows = await patentRows()
    const row = rows.find(entry => entry.id === 'patent-rule')
    const gate = (row?.config as { deliveryGate?: DeliveryGateDeclaration[] } | undefined)?.deliveryGate
    expect(gate).toHaveLength(2)

    const [compliance, closure] = gate ?? []
    expect(compliance?.tool).toBe('render_patent_document')
    expect(compliance?.requires).toEqual(['rule_check', 'law_verify'])
    expect(closure?.tool).toBe('render_patent_document')
    expect(closure?.requires).toEqual(['patent_workflow_run'])

    // Every required tool comes from a build package this preset enables:
    // rule_check and patent_workflow_run from patent-tools, law_verify from patent-law.
    for (const id of ['patent-tools', 'patent-law']) {
      const mounted = rows.find(entry => entry.id === id)
      expect(mounted?.name).toBe(`@deepseek-ai/dsh-${id}`)
      expect(mounted?.disabled).toBeUndefined()
    }

    // Every gated template is one the renderer ships. The closure entry covers the
    // analysis templates plus claims-spec, whose disclosure manifest ends in a claims
    // draft; rectification-response has no manifest entry and stays out.
    const catalog = JSON.parse(readFileSync(
      join(REPO_ROOT, 'packages/patent/patent-document/assets/templates/patent/manifest.json'),
      'utf8',
    )) as { templates?: string[] }
    const shippedTemplates = catalog.templates ?? []
    const closureTemplates = [...(closure?.whenArgs?.template ?? [])].sort()
    expect(closureTemplates.length).toBeGreaterThan(0)
    expect(closureTemplates.filter(template => !shippedTemplates.includes(template))).toEqual([])
    expect(closureTemplates).toContain('claims-spec')
    expect(closureTemplates).not.toContain('rectification-response')
  })

  it('sends the model to the cnlaw declaration instead of a literal endpoint', async () => {
    // The base's endpoints are deployment Config, rendered into the prompt by
    // dsh-patent-law; a port spelled out here would survive a deployment that
    // moved or did not mount the base.
    const text = personaPrefix((await patentRows()).find(row => row.id === 'persona'))
    expect(text).toContain('cnlaw 声明段')
    expect(cnlawEndpointLiterals(text)).toEqual([])
  })

  it('keeps the evidence check and the conditional figure route the zero-call audit added', async () => {
    // The 2026-10-03 zero-call audit gave evaluate_evidence its first route and
    // narrowed add_patent_figure_references to self-drawn or external SVG input.
    // Both rules live only in this persona prefix — no other file states them — so
    // a rewrite that drops either one leaves every other gate green.
    const text = personaPrefix((await patentRows()).find(row => row.id === 'persona'))
    expect(text).toContain('`evaluate_evidence`')
    expect(text).toContain('自绘或外部来源的 SVG')
    expect(text).toContain('`.sati/figures-index.json`')
    // The persona states the model's task; the guard's name and wiring are
    // deployment implementation detail, not prompt content (packages/AGENTS.md).
    expect(text).not.toContain('EVI-011')
  })

  it('names a figure-analysis route the shipped catalog declares image-capable', async () => {
    // analyze_patent_figure is gated on the route's DECLARED input modalities, and an
    // uncatalogued model is treated as text-only. A preset naming a route the shipped
    // catalog does not declare with "image" denies every figure-analysis call — the
    // 2026-09-28 incident. The catalog below is the one this bundle's deployments get.
    const rows = await patentRows() as Array<PresetRow & { config?: { imageModel?: { provider?: unknown; model?: unknown } } }>
    const route = rows.find(row => row.id === 'patent-tools')?.config?.imageModel
    expect(route?.provider).toBe('deepseek-official')
    const model = String(route?.model)
    const declared = shippedCatalogModalities(model)
    expect(declared, `deepseek-official catalog has no entry for ${model}`).not.toBeNull()
    expect(declared, `catalog entry ${model} must declare image input`).toContain('image')
  })

  it('reports an image modality only for the model it belongs to', () => {
    // The extractor above passes on a catalog whose entries all declare image only if it
    // actually scopes to one entry; this fixture pins that scoping.
    expect(imageModalitiesIn(CATALOG_FIXTURE, 'alpha')).toEqual(['text'])
    expect(imageModalitiesIn(CATALOG_FIXTURE, 'beta')).toEqual(['text', 'image'])
    expect(imageModalitiesIn(CATALOG_FIXTURE, 'gamma')).toBeNull()
  })

  it('states no cnlaw endpoint literal in the shipped patent skills', () => {
    const offenders = globSync('**/*.md', { cwd: PATENT_SKILLS })
      .map(relative => ({ relative, hits: cnlawEndpointLiterals(readFileSync(join(PATENT_SKILLS, relative), 'utf8')) }))
      .filter(entry => entry.hits.length > 0)
      .map(entry => `${entry.relative}: ${entry.hits.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('reports a literal endpoint when one is present', () => {
    // The two assertions above pass on a corpus that has no endpoint only if this
    // detector actually finds one.
    expect(cnlawEndpointLiterals('curl -sG "http://127.0.0.1:8100/search" -d q=…'))
      .toEqual(['127.0.0.1:8100'])
    expect(cnlawEndpointLiterals('cnlaw 服务（:8001 图谱 + Neo4j 7687）')).toEqual([':8001', '7687'])
  })
})
