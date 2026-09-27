/**
 * Verify that the tool names a shipped preset's text and skills reference in
 * backticks are tools that preset mounts.
 *
 * Known names come from the package map of `docs/tool-catalog.md`, the
 * freshness-gated catalog that boots every tool plugin; the mounted set comes
 * from the preset's own plugin entries, plus each row's load-time `toolName`
 * and the shipped aliases the catalog records, while a row the preset disables
 * contributes nothing. A backticked name that no
 * mounted tool and no {@link EXEMPT_REFERENCES} entry accounts for fails the
 * gate, so a renamed or invented tool cannot stay in model-facing skill text.
 *
 * Only backticked lowercase snake_case names carrying an underscore are
 * checked; that is the form a tool reference takes here, and it keeps prose
 * values such as status words or field names out of the corpus unless they
 * need an explicit exemption.
 * @module scripts/verify-preset-tool-refs
 */

import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadCordisYaml } from './cordis-yaml.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** Repository-relative path of the freshness-gated tool catalog. */
const CATALOG_PATH = 'docs/tool-catalog.md'

/** Repository-relative directories of the shipped preset corpus. */
const PRESET_DIR = 'packages/bundle/web-app/presets'
const SKILL_DIR = 'packages/bundle/web-app/skills'

/**
 * Backticked names the mounted tool set does not account for, each with the
 * reason it is exempt: a data field, a status value, an external MCP tool, or
 * another plugin's tool that the corpus names without mounting it.
 */
const EXEMPT_REFERENCES: ReadonlyMap<string, string> = new Map([
  ['based_on', 'cnlaw graph relation name'],
  ['brief_ref', 'document brief metadata field'],
  ['char_budget', 'document deliverable metadata field'],
  ['citation_verified', 'patent evidence field'],
  ['cnlaw_graph_ground', 'cnlaw MCP tool, provided by the deployment rather than a packaged plugin'],
  ['cnlaw_graph_patent', 'cnlaw MCP tool, provided by the deployment rather than a packaged plugin'],
  ['cnlaw_inventive_step', 'cnlaw MCP tool, provided by the deployment rather than a packaged plugin'],
  ['decision_result', 'cnlaw case field'],
  ['gate_feedback', 'patent worker contract field'],
  ['in_progress', 'task status value'],
  ['inventive_step', 'cnlaw evidence package key'],
  ['patent_inventiveness_v1', 'workflow manifest id'],
  ['patent_novelty_v1', 'workflow manifest id'],
  ['patent_oa_response_v1', 'workflow manifest id'],
  ['run_in_background', 'bash tool parameter'],
  ['source_path', 'patent evidence field'],
  ['spawn_teammate', 'tool of @deepseek-ai/dsh-experimental-tool-agent-team, which no shipped preset mounts; named only to prohibit its use'],
  ['wait_agent', 'tool of @deepseek-ai/dsh-experimental-tool-agent-team, which no shipped preset mounts; named only to prohibit its use'],
])

/** One corpus file: a preset YAML or one of its skill files. */
export interface PresetFile {
  /** Repository-relative path, used in diagnostics. */
  readonly path: string
  /** File text. */
  readonly source: string
}

/** One preset with the skill files that belong to it. */
export interface PresetCorpus {
  /** Preset name: the `<name>` of `<name>.patch.yml` and of its skills directory. */
  readonly preset: string
  /** The preset YAML file. */
  readonly presetFile: PresetFile
  /** The Markdown files under the preset's skills directory, in path order. */
  readonly skillFiles: readonly PresetFile[]
}

/** A backticked name and the line it appears on. */
export interface ToolReference {
  /** 1-based line number. */
  readonly line: number
  /** The backticked name. */
  readonly name: string
}

/**
 * Parse the tool names and shipped aliases of the catalog's package map.
 * @param source - text of `docs/tool-catalog.md`.
 * @returns every cataloged package's tool names and aliases, keyed by package name.
 */
export function parseToolCatalog(source: string): Map<string, ReadonlySet<string>> {
  const catalog = new Map<string, ReadonlySet<string>>()
  for (const line of source.split('\n')) {
    const row = /^\| `(@deepseek-ai\/[^`]+)` \|/u.exec(line)
    if (row === null) continue
    // | package | names | requires | writes / affects | aliases | note |
    const cells = line.split('|')
    const tools = new Set<string>()
    for (const cell of [cells[2] ?? '', cells[5] ?? '']) {
      for (const name of cell.matchAll(/`([a-z][a-z0-9_]*)`/gu)) tools.add(name[1] as string)
    }
    catalog.set(row[1] as string, tools)
  }
  return catalog
}

/**
 * Resolve the tool names one preset mounts.
 * @param presetSource - the preset YAML text.
 * @param catalog - {@link parseToolCatalog} result.
 * @returns the mounted tool names, including every load-time `toolName` value.
 */
export function mountedToolNames(presetSource: string, catalog: ReadonlyMap<string, ReadonlySet<string>>): Set<string> {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    // A row the preset disables mounts nothing, neither its own tools nor a
    // nested child's; `!!js` conditions arrive evaluated, so a platform-off row
    // is skipped exactly as the load skips it.
    if ((value as Record<string, unknown>).disabled === true) return
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'string' && key === 'name') {
        for (const tool of catalog.get(item) ?? []) names.add(tool)
      }
      if (typeof item === 'string' && key === 'toolName' && item.length > 0) names.add(item)
      visit(item)
    }
  }
  visit(loadCordisYaml(presetSource))
  return names
}

/**
 * Collect the backticked tool-shaped names of one file.
 * @param source - the file text.
 * @returns every backticked lowercase snake_case name carrying an underscore.
 */
export function toolReferences(source: string): ToolReference[] {
  const references: ToolReference[] = []
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/`([a-z][a-z0-9_]*_[a-z0-9_]*)`/gu)) {
      references.push({ line: index + 1, name: match[1] as string })
    }
  }
  return references
}

/**
 * Check every backticked tool reference in a preset corpus.
 * @param catalogSource - text of `docs/tool-catalog.md`.
 * @param corpus - one entry per shipped preset.
 * @param exemptReferences - exempt names, each mapped to its reason.
 * @returns one diagnostic per reference no mounted tool and no exemption accounts for.
 */
export function findToolRefViolations(
  catalogSource: string,
  corpus: readonly PresetCorpus[],
  exemptReferences: ReadonlyMap<string, string> = EXEMPT_REFERENCES,
): string[] {
  const catalog = parseToolCatalog(catalogSource)
  if (catalog.size === 0) throw new Error('verify-preset-tool-refs: the tool catalog carries no package rows')
  const violations: string[] = []
  for (const entry of corpus) {
    const mounted = mountedToolNames(entry.presetFile.source, catalog)
    for (const file of [entry.presetFile, ...entry.skillFiles]) {
      for (const reference of toolReferences(file.source)) {
        if (mounted.has(reference.name) || exemptReferences.has(reference.name)) continue
        violations.push(
          `${file.path}:${String(reference.line)}: \`${reference.name}\` is not a tool preset ${entry.preset} mounts`,
        )
      }
    }
  }
  return violations
}

/**
 * Load every shipped preset with the skill files that belong to it.
 * @param root - repository root.
 * @returns one corpus entry per preset, in path order.
 * @throws Error when a skills directory has no matching preset.
 */
export function loadPresetCorpus(root: string): PresetCorpus[] {
  const presetRoot = resolve(root, PRESET_DIR)
  const skillRoot = resolve(root, SKILL_DIR)
  const presetFiles = readdirSync(presetRoot).filter(file => file.endsWith('.patch.yml')).sort()
  const presetNames = new Set(presetFiles.map(file => file.replace(/\.patch\.yml$/u, '')))
  const skillDirs = existsSync(skillRoot)
    ? readdirSync(skillRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    : []
  const orphans = skillDirs.filter(directory => !presetNames.has(directory))
  if (orphans.length > 0) {
    throw new Error(`verify-preset-tool-refs: skills director(ies) without a preset: ${orphans.join(', ')}`)
  }
  return presetFiles.map((file) => {
    const preset = file.replace(/\.patch\.yml$/u, '')
    const presetPath = `${PRESET_DIR}/${file}`
    const skillFiles = globSync(`${SKILL_DIR}/${preset}/**/*.md`, { cwd: root }).sort().map(path => ({
      path,
      source: readFileSync(resolve(root, path), 'utf8'),
    }))
    return {
      preset,
      presetFile: { path: presetPath, source: readFileSync(resolve(root, presetPath), 'utf8') },
      skillFiles,
    }
  })
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const corpus = loadPresetCorpus(ROOT)
  const references = corpus.reduce(
    (sum, entry) => sum
      + [entry.presetFile, ...entry.skillFiles].reduce((fileSum, file) => fileSum + toolReferences(file.source).length, 0),
    0,
  )
  if (corpus.length === 0 || references === 0) {
    throw new Error('verify-preset-tool-refs: the shipped preset corpus scanned empty')
  }
  const violations = findToolRefViolations(readFileSync(resolve(ROOT, CATALOG_PATH), 'utf8'), corpus)
  if (violations.length > 0) {
    process.stderr.write('verify-preset-tool-refs: violations found:\n')
    for (const violation of violations) process.stderr.write(`  ${violation}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `verify-preset-tool-refs: ${String(references)} reference(s) across ${String(corpus.length)} preset(s) resolve.\n`,
  )
}
