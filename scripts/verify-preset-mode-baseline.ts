/**
 * Delivery-mode baseline gate.
 *
 * `verify-preset-divergence` reports which row ids a preset lacks relative to
 * the preset carrying the most, so a row no preset carries — or one the
 * reference itself lacks — is invisible to it. This gate answers the other
 * question: which of the shared rows each preset is *held to*.
 *
 * The baseline names one `authority` preset whose row ids define the shared
 * set, and declares each shipped preset as a `delivery` mode (held to that set)
 * or a `utility` mode (a single-purpose composition, not held to it). A
 * delivery mode must carry every authority row or record an explicit reason for
 * its absence, and must carry the rows it lists as `required` outright. A
 * preset-declaration row (`preset-*`) is per-file by construction and is
 * excluded from the shared set.
 *
 * Run `pnpm run verify-preset-mode-baseline --list` to print what the shipped
 * presets currently carry.
 * @module scripts/verify-preset-mode-baseline
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PRESET_DIR, presetRowBlocks, loadPresets } from './verify-preset-divergence.ts'

const ROOT = resolve(import.meta.dirname, '..')

/** Repository-relative path of the declared delivery-mode baseline. */
export const BASELINE_PATH = 'scripts/preset-mode-baseline.json'

/** Row ids shaped like a preset's own `@deepseek-ai/dsh-agent-preset` declaration row. */
const PRESET_DECLARATION_RE = /^preset-/u

/** A preset's persona `prefix` key in block scalar form. */
const PERSONA_PREFIX_RE = /^(\s*)prefix:[ \t]*[|>][-+]?[0-9]*[ \t]*$/u

/** The declaration fields each mode class may carry. */
const CLASS_FIELDS: Readonly<Record<ModeClass, readonly string[]>> = {
  delivery: ['class', 'requiredRows', 'explainedAbsences', 'personaMaxChars'],
  utility: ['class', 'personaMaxChars'],
}

/** Whether a mode is held to the shared row set or is a single-purpose composition. */
export type ModeClass = 'delivery' | 'utility'

/** One preset's declaration in the baseline. */
export interface ModeDeclaration {
  /**
   * Rows this mode must carry outright. A reason in {@link ModeDeclaration.explainedAbsences}
   * does not excuse one of these: the set is the floor every mode of this class
   * is held to.
   */
  readonly requiredRows?: readonly string[]
  /**
   * Authority rows this mode deliberately does not carry, mapped to the reason.
   * A reason that is empty, or recorded for a row the mode carries, fails.
   */
  readonly explainedAbsences?: Readonly<Record<string, string>>
  /**
   * Ceiling on the persona `prefix` body in characters. The persona is a fixed
   * prefix paid on every request, so the ceiling makes growth a deliberate edit.
   * Required for a delivery mode; optional elsewhere.
   */
  readonly personaMaxChars?: number
  /** Whether the mode is held to the shared row set. */
  readonly class: ModeClass
}

/** Document listing what each shipped preset is held to. */
export interface ModeBaseline {
  /** Preset file name whose row ids define the shared set, e.g. `standard.patch.yml`. */
  readonly authority: string
  /** Preset file name to its declaration. */
  readonly modes: Readonly<Record<string, ModeDeclaration>>
}

/** One preset file and its raw text. */
export interface ModeSource {
  /** File name of the preset. */
  readonly file: string
  /** The preset's raw text. */
  readonly source: string
}

/** One rejected declaration, naming the preset file and what is wrong with it. */
export interface ModeFinding {
  /** Preset file name the finding belongs to. */
  readonly mode: string
  /** What the baseline or the preset gets wrong. */
  readonly detail: string
}

/**
 * Count one line's leading whitespace.
 * @param line - the line to measure.
 * @returns the number of leading space or tab characters.
 */
function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0]?.length ?? 0
}

/**
 * Whether a value names one of the two mode classes.
 * @param value - the value to test.
 * @returns true when the value is `delivery` or `utility`.
 */
function isModeClass(value: unknown): value is ModeClass {
  return value === 'delivery' || value === 'utility'
}

/**
 * Whether a value is an array of strings.
 * @param value - the value to test.
 * @returns true when the value is an array whose every entry is a string.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

/**
 * Whether a value maps every key to a string.
 * @param value - the value to test.
 * @returns true when the value is a non-array object carrying only string values.
 */
function isReasonMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(reason => typeof reason === 'string')
}

/**
 * Whether a value is a positive safe integer.
 * @param value - the value to test.
 * @returns true when the value is a safe integer above zero.
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Reject one malformed baseline declaration.
 * @param file - preset file name the declaration belongs to.
 * @param detail - what is wrong with the declaration.
 * @returns never; the call always throws.
 */
function malformed(file: string, detail: string): never {
  throw new Error(`verify-preset-mode-baseline: ${file}: ${detail}`)
}

/**
 * Read the persona `prefix` body out of a row block.
 *
 * The persona row states an agent's fixed identity text, and its size is
 * per-request cost, so the ceiling is measured on the scalar body rather than on
 * the surrounding YAML.
 * @param block - the persona row's block text, comments included.
 * @returns the block scalar's text with its indentation removed and trailing
 *   blank lines dropped, or `undefined` when the row carries no block-scalar
 *   prefix.
 */
export function personaPrefixBody(block: string | undefined): string | undefined {
  if (block === undefined) return undefined
  const lines = block.split('\n')
  const keyIndex = lines.findIndex(line => PERSONA_PREFIX_RE.test(line))
  if (keyIndex === -1) return undefined
  const keyIndent = indentOf(lines[keyIndex] ?? '')
  const body: string[] = []
  for (const line of lines.slice(keyIndex + 1)) {
    if (line.trim() === '') {
      body.push('')
      continue
    }
    if (indentOf(line) <= keyIndent) break
    body.push(line)
  }
  while (body.length > 0 && (body[body.length - 1] ?? '').trim() === '') body.pop()
  if (body.length === 0) return undefined
  const contentIndent = body
    .filter(line => line.trim() !== '')
    .reduce((least, line) => Math.min(least, indentOf(line)), Number.MAX_SAFE_INTEGER)
  return body.map(line => line.slice(Math.min(contentIndent, line.length))).join('\n')
}

/**
 * Validate one mode declaration read from the baseline file.
 *
 * The baseline is a hand-written file, so its fields are checked here rather
 * than trusted: a misspelled class or a reason map holding a number would
 * otherwise decide policy silently.
 * @param file - preset file name the declaration belongs to.
 * @param value - the declaration as parsed from JSON.
 * @returns the validated declaration.
 * @throws Error naming the preset file and the field that is malformed.
 */
function parseModeDeclaration(file: string, value: unknown): ModeDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    malformed(file, 'the declaration must be an object')
  }
  const record = value as Record<string, unknown>
  const modeClass = record['class']
  if (!isModeClass(modeClass)) {
    malformed(file, `class must be "delivery" or "utility", not ${JSON.stringify(String(modeClass))}`)
  }
  const requiredRows = record['requiredRows']
  if (requiredRows !== undefined && !isStringArray(requiredRows)) {
    malformed(file, 'requiredRows must be an array of row ids')
  }
  const explainedAbsences = record['explainedAbsences']
  if (explainedAbsences !== undefined && !isReasonMap(explainedAbsences)) {
    malformed(file, 'explainedAbsences must map a row id to a reason string')
  }
  const personaMaxChars = record['personaMaxChars']
  if (personaMaxChars !== undefined && !isPositiveInteger(personaMaxChars)) {
    malformed(file, 'personaMaxChars must be a positive integer')
  }

  const declaration: {
    class: ModeClass
    requiredRows?: readonly string[]
    explainedAbsences?: Record<string, string>
    personaMaxChars?: number
  } = { class: modeClass }
  if (isStringArray(requiredRows)) declaration.requiredRows = requiredRows
  if (isReasonMap(explainedAbsences)) declaration.explainedAbsences = explainedAbsences
  if (isPositiveInteger(personaMaxChars)) declaration.personaMaxChars = personaMaxChars
  return declaration
}

/**
 * Read the declared baseline document.
 * @param source - the baseline JSON text.
 * @returns the parsed baseline.
 * @throws Error when the document is not an object, or lacks an `authority` string or a `modes` record.
 */
export function parseModeBaseline(source: string): ModeBaseline {
  const parsed: unknown = JSON.parse(source)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('verify-preset-mode-baseline: the baseline must be an object')
  }
  const record = parsed as Record<string, unknown>
  const authority = record['authority']
  const modes = record['modes']
  if (typeof authority !== 'string' || authority === '') {
    throw new Error('verify-preset-mode-baseline: the baseline needs a non-empty `authority` string')
  }
  if (typeof modes !== 'object' || modes === null || Array.isArray(modes)) {
    throw new Error('verify-preset-mode-baseline: the baseline needs a `modes` record')
  }
  const declarations: Record<string, ModeDeclaration> = {}
  for (const [file, value] of Object.entries(modes)) declarations[file] = parseModeDeclaration(file, value)
  return { authority, modes: declarations }
}

/**
 * Compare every shipped preset against the declared baseline.
 * @param presets - the shipped presets with their raw text.
 * @param baseline - the declared baseline.
 * @returns one finding per violated declaration, naming the preset file and the row id where a row is at issue.
 */
export function modeBaselineFindings(
  presets: readonly ModeSource[],
  baseline: ModeBaseline,
): ModeFinding[] {
  const findings: ModeFinding[] = []
  const blocks = new Map(presets.map(preset => [preset.file, presetRowBlocks(preset.source)]))
  const carriedBy = new Map([...blocks].map(([file, rows]) => [file, new Set(rows.keys())]))
  const authorityRows = carriedBy.get(baseline.authority)
  if (authorityRows === undefined) {
    findings.push({ mode: baseline.authority, detail: 'names an authority preset that does not ship' })
  }

  for (const file of Object.keys(baseline.modes).sort()) {
    if (!carriedBy.has(file)) findings.push({ mode: file, detail: 'is declared in the baseline but does not ship' })
  }
  for (const preset of presets) {
    if (baseline.modes[preset.file] === undefined) {
      findings.push({ mode: preset.file, detail: 'ships without a baseline declaration' })
    }
  }

  const authorityDeclared = authorityRows === undefined
    ? undefined
    : new Set([...authorityRows].filter(id => !PRESET_DECLARATION_RE.test(id)))

  for (const file of Object.keys(baseline.modes).sort()) {
    const declaration = baseline.modes[file]
    const carried = carriedBy.get(file)
    if (declaration === undefined || carried === undefined) continue
    const allowed = new Set(CLASS_FIELDS[declaration.class])
    for (const key of Object.keys(declaration).sort()) {
      if (!allowed.has(key)) {
        findings.push({ mode: file, detail: `declares ${key}, which a ${declaration.class} mode does not carry` })
      }
    }

    const declaredRows = [...carried].filter(id => PRESET_DECLARATION_RE.test(id))
    if (declaredRows.length !== 1) {
      findings.push({
        mode: file,
        detail: `carries ${String(declaredRows.length)} preset-declaration rows; a preset declares exactly one`,
      })
    }

    const explained = declaration.explainedAbsences ?? {}
    for (const [id, reason] of Object.entries(explained).sort(([left], [right]) => left.localeCompare(right))) {
      if (reason.trim() === '') findings.push({ mode: file, detail: `explains ${id} with no reason` })
      if (carried.has(id)) findings.push({ mode: file, detail: `carries ${id} again; drop the recorded absence` })
    }

    const required = declaration.requiredRows
    if (declaration.class === 'delivery' && required === undefined) {
      findings.push({ mode: file, detail: 'is a delivery mode with no requiredRows' })
    }
    const requiredSet = new Set(required ?? [])
    for (const id of declaration.class === 'delivery' ? required ?? [] : []) {
      if (authorityDeclared !== undefined && !authorityDeclared.has(id)) {
        findings.push({ mode: file, detail: `requires ${id}, which ${baseline.authority} does not carry` })
      }
      if (explained[id] !== undefined) {
        findings.push({ mode: file, detail: `both requires and explains ${id}` })
      }
      if (!carried.has(id)) {
        findings.push({ mode: file, detail: `does not carry ${id}, a required row` })
      }
    }

    if (declaration.class === 'delivery' && authorityDeclared !== undefined) {
      for (const id of [...authorityDeclared].sort()) {
        if (!carried.has(id) && explained[id] === undefined && !requiredSet.has(id)) {
          findings.push({ mode: file, detail: `does not carry ${id}, and records no reason for its absence` })
        }
      }
    }

    if (declaration.personaMaxChars !== undefined) {
      const body = personaPrefixBody(blocks.get(file)?.get('persona'))
      if (body === undefined) {
        findings.push({ mode: file, detail: 'declares personaMaxChars but carries no persona prefix body' })
      }
      else if (body.length > declaration.personaMaxChars) {
        findings.push({
          mode: file,
          detail: `persona prefix body is ${String(body.length)} characters, over the ${String(declaration.personaMaxChars)} ceiling`,
        })
      }
    }
  }

  return findings
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const presets: ModeSource[] = loadPresets(ROOT)
  if (presets.length === 0) throw new Error('verify-preset-mode-baseline: no shipped preset was scanned')
  const baseline = parseModeBaseline(readFileSync(resolve(ROOT, BASELINE_PATH), 'utf8'))
  if (process.argv.includes('--list')) {
    for (const preset of presets) {
      const declaration = baseline.modes[preset.file]
      if (declaration === undefined) {
        process.stdout.write(`${preset.file.padEnd(20)} undeclared\n`)
        continue
      }
      const rows = presetRowBlocks(preset.source)
      const body = personaPrefixBody(rows.get('persona'))
      process.stdout.write(
        `${preset.file.padEnd(20)} ${declaration.class.padEnd(8)} rows=${String(rows.size).padEnd(3)}`
        + ` required=${String(declaration.requiredRows?.length ?? 0).padEnd(3)}`
        + ` explained=${String(Object.keys(declaration.explainedAbsences ?? {}).length).padEnd(3)}`
        + ` persona=${body === undefined ? '-' : String(body.length)}\n`,
      )
    }
  }
  const findings = modeBaselineFindings(presets, baseline)
  if (findings.length > 0) {
    process.stderr.write(`verify-preset-mode-baseline: declarations outside the baseline (${PRESET_DIR}):\n`)
    for (const finding of findings) process.stderr.write(`  ${finding.mode}: ${finding.detail}\n`)
    process.exit(1)
  }
  const delivery = Object.values(baseline.modes).filter(mode => mode.class === 'delivery').length
  process.stdout.write(
    `verify-preset-mode-baseline: ${String(delivery)} delivery mode(s) of ${String(presets.length)} preset(s)`
    + ` carry ${baseline.authority} or record why not.\n`,
  )
}
