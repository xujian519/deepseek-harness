/**
 * Validate every agent-preset row's `config` against the `Config` schema of
 * the plugin that row names.
 *
 * What a preset corpus gets checked for today is structure, not schemas:
 * `dsh-agent-preset-registry` activates a declaration's child rows and reports
 * a failure as a broken roster row, while `verify-runtime-closure` and
 * `verify-default-product-isolation` check that each named package is
 * installed. None of them applies a plugin's own `Config`. A row whose config
 * no longer matches its plugin therefore fails only at activation, which
 * rejects every later binding to that preset:
 * `failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid
 * config: $.prefix missing required value`. That is not hypothetical — the
 * 2026-09-06 system-prompt change split `dsh-persona`'s single `text` field
 * into `prefix`/`suffix`, and the stale spelling sat in shipped and authored
 * presets until a deployment failed. This gate applies the same schema the
 * loader applies, before activation.
 *
 * Validation mirrors the runtime in three places, and each mirror matters:
 * the value under test comes from `exports.default ?? exports`, the way the
 * loader unwraps a plugin (`unwrapExports` in `vendor/loader/src/index.ts`);
 * a plugin with no `Config` passes unchanged (`resolveConfig` in
 * `vendor/cordis/src/fiber.ts`); and the call itself is
 * `schema['~standard'].validate(config)`, the same expression `resolveConfig`
 * evaluates. Rows carrying a `!!js` expression are skipped rather than judged:
 * the loader interpolates that value against a live plugin context before the
 * schema sees it, so judging the parsed node would report a healthy preset as
 * broken — and a broken verdict reaches the chooser, where the preset carries
 * a failed-to-load badge and cannot be selected as the default.
 *
 * What this proves is narrower than "the config is correct". schemastery
 * merges unknown keys instead of rejecting them, so a misspelled OPTIONAL key
 * passes here exactly as it passes at runtime. The gate covers a missing
 * required key and a wrong type on a known key.
 *
 * Importing plugin sources can print their own warnings on stderr (a plugin
 * reaching `node:sqlite` emits `ExperimentalWarning`). Those are not this
 * gate's signal; judge it by its exit code and its own report line.
 *
 * The corpus is the shipped preset declarations: every `*.patch.yml` under
 * `packages/bundle/web-app/presets/`. A patch file inserts the rows it carries
 * instead of listing them at the top level, and an agent-preset declaration
 * holds its child composition under `config.plugins`, so the walk below follows
 * both containers before it judges a row.
 */

import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAgentPresetEntry, isCordisGroupEntry, isJsExpr, loadCordisYaml } from './cordis-yaml.ts'
import { SOURCE_EXTENSIONS, sourcePlaneResolver } from './source-plane.ts'

const root = resolve(import.meta.dirname, '..')

/** Preset declaration files inside the repository, relative to the root. */
const SHIPPED_PRESET_GLOB = 'packages/bundle/web-app/presets/*.patch.yml'

/** Why a row's config is not judged. */
export type SkipReason = 'disabled' | 'conditional' | 'external' | 'not-source' | 'import-failed' | 'no-config'

/** One schema issue, as the runtime's `ValidationError` reads it. */
export interface ConfigIssue {
  readonly message: string
  readonly path?: readonly PropertyKey[]
}

/** What one `validate` call answers. */
export interface ValidationResult {
  readonly issues?: readonly ConfigIssue[]
}

/** The standard-schema face a Cordis plugin exposes as `Config`. */
export interface ConfigSchema {
  readonly '~standard': {
    readonly validate: (value: unknown) => ValidationResult | Promise<ValidationResult>
  }
}

/** What resolving one row's plugin name produced. */
export type RowResolution =
  | { readonly kind: 'schema'; readonly schema: ConfigSchema }
  | { readonly kind: 'skip'; readonly reason: SkipReason }

/** Resolves a row's plugin specifier to the schema the loader would apply. */
export type RowResolver = (name: string) => Promise<RowResolution>

/** One row whose config the plugin it names rejects. */
export interface RowViolation {
  /** `row "id"`, or the row's position when it declares none. */
  readonly label: string
  /** The plugin specifier exactly as the row wrote it. */
  readonly name: string
  /** One entry per schema issue, in the runtime's wording. */
  readonly issues: readonly ConfigIssue[]
}

/** What one composition's rows yielded. */
export interface CompositionReport {
  readonly violations: readonly RowViolation[]
  /** Rows whose config a schema accepted. */
  readonly validated: number
  /** Rows not judged, by reason. */
  readonly skipped: Readonly<Record<SkipReason, number>>
}

/** Whether `value` holds a preserved `!!js` expression anywhere inside it. */
function containsJsExpr(value: unknown): boolean {
  if (isJsExpr(value)) return true
  if (Array.isArray(value)) return value.some(containsJsExpr)
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value).some(containsJsExpr)
}

/**
 * Whether the loader would start this row.
 *
 * The loader reads `Boolean(options.disabled)` (`unresolvableRows` in
 * `discovery.ts` documents the same rule for the health check), so `disabled: 0`
 * names a row that DOES start and must be judged; a `!!js` expression is an
 * object and therefore truthy, which skips the row.
 * @param row - one parsed Loader entry.
 * @returns whether the row is disabled.
 */
function rowDisabled(row: Record<string, unknown>): boolean {
  return Boolean(row.disabled)
}

/**
 * Judge every row of one parsed composition against the schema its plugin
 * declares, recursing the row containers the loader recurses: a group's
 * `config` list, an `insert` list, and an agent-preset declaration's
 * `config.plugins`.
 *
 * A group row's own `name` is never judged — `cordis:group` is a container,
 * not a plugin the loader resolves. An agent-preset declaration is judged like
 * any other row, and the child composition it carries is judged beside it.
 * @param rows - the parsed composition, or any nested row list.
 * @param resolveRow - resolves one row's plugin specifier.
 * @returns the violations and the judged/skipped counts.
 */
export async function findConfigViolations(
  rows: unknown,
  resolveRow: RowResolver,
): Promise<CompositionReport> {
  const violations: RowViolation[] = []
  const skipped: Record<SkipReason, number> = {
    disabled: 0, conditional: 0, external: 0, 'not-source': 0, 'import-failed': 0, 'no-config': 0,
  }
  let validated = 0

  const visit = async (list: unknown, at: string): Promise<void> => {
    if (!Array.isArray(list)) return
    for (const [index, entry] of list.entries()) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const row = entry as Record<string, unknown>
      const positional = at === '' ? `row ${String(index + 1)}` : `${at} row ${String(index + 1)}`
      if (isCordisGroupEntry(row)) {
        await visit(row.config, positional)
        continue
      }
      // A patch file adds its rows through an `insert` list, so the rows that
      // matter sit one level below the file's top-level list.
      if (Array.isArray(row.insert)) await visit(row.insert, positional)
      // A declaration's `config.plugins` is the composition its Agents run.
      if (isAgentPresetEntry(row)) await visit(row.config.plugins, positional)
      if (typeof row.name !== 'string' || row.name === '') continue
      if (rowDisabled(row)) {
        skipped.disabled += 1
        continue
      }
      if (containsJsExpr(row.config)) {
        skipped.conditional += 1
        continue
      }
      const resolution = await resolveRow(row.name)
      if (resolution.kind === 'skip') {
        skipped[resolution.reason] += 1
        continue
      }
      // Passed through unchanged, `undefined` included: the loader hands the
      // entry's raw `config` to the same schema.
      const result = await resolution.schema['~standard'].validate(row.config)
      if ('then' in result) throw new TypeError('verify-agent-preset-config: async config validation is not supported')
      if (result.issues === undefined) {
        validated += 1
        continue
      }
      violations.push({
        label: typeof row.id === 'string' && row.id !== '' ? `row "${row.id}"` : positional,
        name: row.name,
        issues: result.issues,
      })
    }
  }

  await visit(rows, '')
  return { violations, validated, skipped }
}

/**
 * The unwrapped plugin value of one imported module, mirroring the loader.
 *
 * `Loader.unwrapExports` takes `exports.default ?? exports` and repeats the
 * step for an `__esModule` marker (`vendor/loader/src/index.ts`), and
 * `Registry.plugin` records `Config` from that value. Reading a NAMED `Config`
 * when a default export exists would judge a different schema than the runtime
 * applies.
 * @param module - the imported module namespace.
 * @returns the value the loader would treat as the plugin.
 */
function unwrapPlugin(module: Record<string, unknown>): Record<string, unknown> {
  const first: unknown = module.default ?? module
  if (typeof first !== 'object' || first === null) return module
  const value = first as Record<string, unknown>
  if (value.__esModule !== true) return value
  const second: unknown = value.default ?? value
  return typeof second === 'object' && second !== null ? second as Record<string, unknown> : value
}

/**
 * The standard-schema face a plugin's `Config` export carries, or undefined.
 *
 * A schemastery schema is a callable object, so both an object and a function
 * can carry the face; anything else is a module that declares no usable schema.
 * @param value - the plugin value's `Config` export, or any candidate.
 * @returns the schema face, or undefined when the value carries none.
 */
export function pluginConfigSchema(value: unknown): ConfigSchema | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || !('~standard' in value)) {
    return undefined
  }
  return value as ConfigSchema
}

/** Every workspace package name, mapped to its repository-relative directory. */
function workspacePackageDirectories(): Map<string, string> {
  const directories = new Map<string, string>()
  for (const manifestPath of globSync(['packages/*/*/package.json', 'vendor/*/package.json'], { cwd: root })) {
    const manifest = JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8')) as { name?: string }
    if (manifest.name !== undefined) directories.set(manifest.name, dirname(manifestPath))
  }
  return directories
}

/**
 * The package a specifier names, or undefined when it names no package.
 *
 * A relative path, an absolute path, and a URL scheme (`cordis:group`) all
 * name something other than an installed package, and none of them resolves
 * through `node_modules`.
 * @param specifier - the row's `name`.
 * @returns the package name, without any subpath.
 */
export function packageNameOf(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || /^[a-z][a-z+.-]*:/i.test(specifier)) return undefined
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined
  return segments[0] === '' ? undefined : segments[0]
}

/**
 * A resolver that judges only the workspace packages whose specifiers reach
 * TypeScript source through the tsconfig `paths` facade, importing each one
 * once.
 *
 * Resolution is TypeScript's own, not `import.meta.resolve`: the latter sees a
 * workspace package only while the `tsx` paths hook is active, so a loader
 * change would turn every row into a skip and report success for having
 * checked nothing.
 * @returns the resolver.
 */
function workspaceResolver(): RowResolver {
  const directories = workspacePackageDirectories()
  const resolveSpecifier = sourcePlaneResolver(root, resolve(root, 'scripts/verify-agent-preset-config.ts'))
  const loaded = new Map<string, RowResolution>()

  return async (name) => {
    const cached = loaded.get(name)
    if (cached !== undefined) return cached
    const resolution = await resolveOne(name)
    loaded.set(name, resolution)
    return resolution
  }

  async function resolveOne(name: string): Promise<RowResolution> {
    const packageName = packageNameOf(name)
    if (packageName === undefined || !directories.has(packageName)) return { kind: 'skip', reason: 'external' }
    const resolved = resolveSpecifier(name)
    if (resolved === undefined || !SOURCE_EXTENSIONS.has(resolved.extension)) return { kind: 'skip', reason: 'not-source' }
    let module: Record<string, unknown>
    try {
      module = await import(pathToFileURL(resolved.resolvedFileName).href) as Record<string, unknown>
    } catch {
      // A browser package reaching a `.css` import is the standing case: it is
      // importable by Vite and not by Node. The row is real and so is its
      // plugin; this gate simply cannot read the schema from here.
      return { kind: 'skip', reason: 'import-failed' }
    }
    const schema = pluginConfigSchema(unwrapPlugin(module).Config)
    if (schema === undefined) return { kind: 'skip', reason: 'no-config' }
    return { kind: 'schema', schema }
  }
}

/**
 * The line declaring `id` in a composition source, or undefined.
 *
 * `js-yaml` records no node positions, so the line number is found by text.
 * Loader entry ids must be unique within a composition, which is what makes
 * the first match the right one.
 * @param source - the composition file's text.
 * @param id - the row id to locate.
 * @returns the 1-based line number, or undefined when the id is not found.
 */
export function lineOfRowId(source: string, id: string): number | undefined {
  const lines = source.split('\n')
  const index = lines.findIndex(line => line.includes(`id: ${id}`))
  return index === -1 ? undefined : index + 1
}

/** Every declaration file to judge, in a stable order. */
function compositionFiles(): string[] {
  return globSync(SHIPPED_PRESET_GLOB, { cwd: root }).sort().map(file => resolve(root, file))
}

/**
 * Refuse to report success over a corpus that no longer matches.
 *
 * The globs name what this gate exists to judge; an empty result means they
 * stopped matching, not that the repository is clean.
 * @param files - the composition files the globs produced.
 */
export function assertNonEmptyCorpus(files: readonly string[]): void {
  if (files.length === 0) {
    throw new Error('verify-agent-preset-config: no preset compositions found; the shipped-preset glob no longer matches.')
  }
}

/**
 * Compositions where every row was skipped.
 *
 * A preset whose rows are all conditional, external, or schema-less says
 * nothing about the repository — it says the resolver plane decided the
 * outcome, so reporting it as passing would hide a stale preset behind a gate
 * that judged nothing. A composition whose only judged row violated the
 * schema is not unjudged: it said something, and that something is the
 * violation the caller has to report.
 * @param entries - one entry per composition, with its judged row count.
 * @returns the files whose judged count is zero.
 */
export function unjudgedCompositions(
  entries: readonly { readonly file: string; readonly judged: number }[],
): string[] {
  return entries.filter(entry => entry.judged === 0).map(entry => entry.file)
}

/**
 * Judge every composition file, reporting violations and the counts that make
 * "no violations" distinguishable from "nothing judged".
 * @returns violations with their source locations, and the corpus counts.
 */
async function verify(): Promise<{
  violations: string[]
  presets: number
  rows: number
  validated: number
  skipped: Record<SkipReason, number>
  unjudged: string[]
}> {
  const files = compositionFiles()
  assertNonEmptyCorpus(files)
  const resolveRow = workspaceResolver()
  const violations: string[] = []
  const judged: { file: string; judged: number }[] = []
  const skipped: Record<SkipReason, number> = {
    disabled: 0, conditional: 0, external: 0, 'not-source': 0, 'import-failed': 0, 'no-config': 0,
  }
  let rows = 0
  let validated = 0
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const document = loadCordisYaml(source)
    const report = await findConfigViolations(document, resolveRow)
    rows += countRows(document)
    validated += report.validated
    for (const reason of Object.keys(skipped) as SkipReason[]) skipped[reason] += report.skipped[reason]
    if (!relative(root, file).startsWith('..')) {
      judged.push({ file, judged: report.validated + report.violations.length })
    }
    for (const violation of report.violations) {
      const id = /^row "(.*)"$/.exec(violation.label)?.[1]
      const line = id === undefined ? undefined : lineOfRowId(source, id)
      const where = line === undefined ? file : `${file}:${String(line)}`
      violations.push(`${where}  ${violation.label}  ${violation.name}\n`
        + violation.issues.map(issue => issue.path === undefined
          ? `    ${issue.message}`
          : `    ${issue.message} (at ${issue.path.join('.')})`).join('\n'))
    }
  }
  return { violations, presets: files.length, rows, validated, skipped, unjudged: unjudgedCompositions(judged) }
}

/** Every row the loader would consider, at any nesting depth. */
function countRows(value: unknown): number {
  if (Array.isArray(value)) {
    let total = 0
    for (const item of value as unknown[]) total += countRows(item)
    return total
  }
  if (typeof value !== 'object' || value === null) return 0
  const row = value as Record<string, unknown>
  if (isCordisGroupEntry(row)) return countRows(row.config)
  if (isAgentPresetEntry(row)) return 1 + countRows(row.config.plugins)
  if (Array.isArray(row.insert)) return countRows(row.insert)
  return typeof row.name === 'string' ? 1 : 0
}

/** Format the per-reason skip counts for the report line. */
function skipSummary(skipped: Record<SkipReason, number>): string {
  return (Object.entries(skipped) as [SkipReason, number][])
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${String(count)}`)
    .join(', ')
}

if (import.meta.main) {
  const result = await verify()
  // A preset whose every row was skipped means the resolver plane, not the
  // preset, decided the outcome; reporting success there would hide a stale
  // preset behind a gate that judged nothing. Both findings print: a corpus
  // can hold an unjudged preset and a violating row at once, and the person
  // fixing the violations must not have to re-run the gate to see them.
  if (result.unjudged.length > 0) {
    console.error('verify-agent-preset-config: no row was judged in:')
    for (const file of result.unjudged) console.error(`- ${file}`)
    console.error(`  skipped: ${skipSummary(result.skipped) || 'none'}`)
  }
  if (result.violations.length > 0) {
    console.error('verify-agent-preset-config: preset rows whose config the named plugin rejects:')
    for (const violation of result.violations) console.error(`- ${violation}`)
  }
  if (result.unjudged.length > 0 || result.violations.length > 0) {
    process.exitCode = 1
  } else {
    console.log(
      `verify-agent-preset-config: ${String(result.presets)} preset(s), ${String(result.rows)} row(s), `
      + `${String(result.validated)} validated, skipped: ${skipSummary(result.skipped) || 'none'}.`,
    )
  }
}
