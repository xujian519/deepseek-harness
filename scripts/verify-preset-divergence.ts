/**
 * Cross-preset divergence gate.
 *
 * The shipped presets keep their shared rows by copying, and most differences
 * between those copies are deliberate. This gate does not force equality: it
 * reports every row id whose block differs across the presets that carry it,
 * and compares that report against the checked-in baseline. A divergence the
 * baseline does not record, a recorded block whose content changed, and a
 * baseline entry that no longer diverges all fail, so a copied row that was
 * forgotten or edited on one side cannot stay silent.
 *
 * A block is the raw text from its `- id:` line to the line before the next
 * `- id:` line, comments and blank lines included — the same slice a maintainer
 * copies. Run `pnpm run verify-preset-divergence --list` to print the current
 * report with per-preset hashes, and `pnpm run preset-divergence:baseline` to
 * re-record the baseline after reviewing every change it shows.
 * @module scripts/verify-preset-divergence
 */

import { createHash } from 'node:crypto'
import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

/** Repository-relative directory of the shipped presets. */
export const PRESET_DIR = 'packages/bundle/web-app/presets'

/** Checked-in record of the deliberate cross-preset divergences. */
export const BASELINE_PATH = 'scripts/preset-divergence-baseline.json'

/** Preset file names paired with their raw text. */
export interface PresetSources {
  /** File name of the preset, e.g. `standard.patch.yml`. */
  readonly file: string
  /** The preset's raw text. */
  readonly source: string
}

/** One row id's divergence: the block hash each preset that carries the id has. */
export type Divergence = ReadonlyMap<string, string>

/** Baseline document: row id to the preset hashes recorded for it. */
export interface PresetDivergenceBaseline {
  /** Recorded divergent row ids. */
  readonly rows: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Comparison of a recorded baseline against the current divergence report. */
export interface DivergenceDiff {
  /** Row ids that diverge now but carry no baseline entry. */
  readonly added: readonly string[]
  /** Baseline blocks whose hash changed, or presets that entered or left the row. */
  readonly changed: readonly { readonly id: string; readonly detail: string }[]
  /** Baseline row ids that no longer diverge. */
  readonly stale: readonly string[]
}

/**
 * Split one preset into its rows: each `- id:` line opens a block that runs to
 * the line before the next `- id:` line.
 * @param source - the preset's raw text.
 * @returns each row id's block text, in file order.
 * @throws Error when one preset carries the same row id twice.
 */
export function presetRowBlocks(source: string): Map<string, string> {
  const lines = source.split('\n')
  const starts: { readonly index: number; readonly id: string }[] = []
  for (const [index, line] of lines.entries()) {
    const match = /^\s*- id: (\S+)\s*$/u.exec(line)
    if (match !== null) starts.push({ index, id: match[1] as string })
  }
  const blocks = new Map<string, string>()
  for (const [position, start] of starts.entries()) {
    if (blocks.has(start.id)) throw new Error(`verify-preset-divergence: row id ${JSON.stringify(start.id)} appears twice in one preset`)
    blocks.set(start.id, lines.slice(start.index, starts[position + 1]?.index ?? lines.length).join('\n'))
  }
  return blocks
}

/**
 * Hash one row block.
 * @param block - the block text.
 * @returns the first ten hex characters of its SHA-256 digest.
 */
export function blockHash(block: string): string {
  return createHash('sha256').update(block).digest('hex').slice(0, 10)
}

/**
 * Report every row id whose block differs across the presets carrying it.
 * @param presets - the shipped presets with their raw text.
 * @returns each divergent row id mapped to the hash of every preset that carries it.
 */
export function presetDivergences(presets: readonly PresetSources[]): Map<string, Map<string, string>> {
  const byPreset = presets.map(preset => ({
    file: preset.file,
    blocks: presetRowBlocks(preset.source),
  }))
  const carriers = new Map<string, string[]>()
  for (const preset of byPreset) {
    for (const id of preset.blocks.keys()) {
      const files = carriers.get(id) ?? []
      files.push(preset.file)
      carriers.set(id, files)
    }
  }
  const divergences = new Map<string, Map<string, string>>()
  for (const [id, files] of carriers) {
    if (files.length < 2) continue
    const hashes = new Map(files.map(file => [
      file,
      blockHash(byPreset.find(preset => preset.file === file)?.blocks.get(id) ?? ''),
    ]))
    if (new Set(hashes.values()).size > 1) divergences.set(id, hashes)
  }
  return divergences
}

/**
 * Compare the recorded baseline against the current divergence report.
 * @param baseline - the checked-in baseline.
 * @param current - {@link presetDivergences} result.
 * @returns divergences to reject and baseline entries that went stale.
 */
export function diffDivergences(
  baseline: PresetDivergenceBaseline,
  current: ReadonlyMap<string, Divergence>,
): DivergenceDiff {
  const added: string[] = []
  const changed: { id: string; detail: string }[] = []
  const stale: string[] = []
  for (const [id, hashes] of [...current].sort(([left], [right]) => left.localeCompare(right))) {
    const recorded = baseline.rows[id]
    if (recorded === undefined) {
      added.push(id)
      continue
    }
    for (const [file, hash] of [...hashes].sort(([left], [right]) => left.localeCompare(right))) {
      const recordedHash = recorded[file]
      if (recordedHash === undefined) changed.push({ id, detail: `${file} entered the row with ${hash}` })
      else if (recordedHash !== hash) changed.push({ id, detail: `${file} changed from ${recordedHash} to ${hash}` })
    }
    for (const file of Object.keys(recorded).sort()) {
      if (!hashes.has(file)) changed.push({ id, detail: `${file} left the row` })
    }
  }
  for (const id of Object.keys(baseline.rows).sort()) {
    if (!current.has(id)) stale.push(id)
  }
  return { added, changed, stale }
}

/**
 * Read the baseline document.
 * @param source - the baseline JSON text.
 * @returns the parsed baseline.
 * @throws Error when the document is not an object carrying a `rows` record.
 */
export function parseBaseline(source: string): PresetDivergenceBaseline {
  const parsed: unknown = JSON.parse(source)
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { rows?: unknown }).rows !== 'object') {
    throw new Error('verify-preset-divergence: the baseline must be an object carrying a rows record')
  }
  return parsed as PresetDivergenceBaseline
}

/**
 * Render the baseline document with sorted keys.
 * @param current - {@link presetDivergences} result.
 * @returns the JSON text to check in.
 */
export function renderBaseline(current: ReadonlyMap<string, Divergence>): string {
  const rows: Record<string, Record<string, string>> = {}
  for (const [id, hashes] of [...current].sort(([left], [right]) => left.localeCompare(right))) {
    rows[id] = Object.fromEntries([...hashes].sort(([left], [right]) => left.localeCompare(right)))
  }
  return `${JSON.stringify({ rows }, null, 2)}\n`
}

/**
 * Read every shipped preset.
 * @param root - repository root.
 * @returns the presets in file-name order.
 */
export function loadPresets(root: string): PresetSources[] {
  return globSync(`${PRESET_DIR}/*.patch.yml`, { cwd: root }).sort().map(path => ({
    file: basename(path),
    source: readFileSync(resolve(root, path), 'utf8'),
  }))
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  const presets = loadPresets(ROOT)
  if (presets.length === 0) throw new Error('verify-preset-divergence: no shipped preset was scanned')
  const current = presetDivergences(presets)
  if (process.argv.includes('--write')) {
    writeFileSync(resolve(ROOT, BASELINE_PATH), renderBaseline(current))
    process.stdout.write(`verify-preset-divergence: recorded ${String(current.size)} divergent row id(s) in ${BASELINE_PATH}.\n`)
  }
  else {
    if (process.argv.includes('--list')) {
      for (const [id, hashes] of current) {
        process.stdout.write(`${id}:\n`)
        for (const [file, hash] of hashes) process.stdout.write(`  ${file.padEnd(20)} ${hash}\n`)
      }
    }
    const diff = diffDivergences(parseBaseline(readFileSync(resolve(ROOT, BASELINE_PATH), 'utf8')), current)
    if (diff.added.length > 0 || diff.changed.length > 0 || diff.stale.length > 0) {
      process.stderr.write('verify-preset-divergence: divergences outside the baseline:\n')
      for (const id of diff.added) {
        process.stderr.write(`  ${id}: new divergence\n`)
        for (const [file, hash] of current.get(id) ?? []) process.stderr.write(`    ${file.padEnd(20)} ${hash}\n`)
      }
      for (const entry of diff.changed) process.stderr.write(`  ${entry.id}: ${entry.detail}\n`)
      for (const id of diff.stale) process.stderr.write(`  ${id}: no longer diverges; drop its baseline entry\n`)
      process.exit(1)
    }
    process.stdout.write(`verify-preset-divergence: ${String(current.size)} recorded divergence(s) match ${String(presets.length)} preset(s).\n`)
  }
}
