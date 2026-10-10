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
 * Block comparison only sees row ids two or more presets carry, so a preset
 * that dropped a whole row would stay silent. The second report covers that:
 * against the preset carrying the most row ids, it lists the row ids every
 * other preset lacks, and a gap the baseline does not record fails.
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

/** Baseline document: divergent row blocks, and the row-id gap of each preset. */
export interface PresetDivergenceBaseline {
  /** Recorded divergent row ids. */
  readonly rows: Readonly<Record<string, Readonly<Record<string, string>>>>
  /** Recorded row-id gaps: preset file name to the row ids the reference carries and it does not. */
  readonly rowSets: Readonly<Record<string, readonly string[]>>
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

/** One preset's row-id gap against the reference preset. */
export interface RowSetReference {
  /** File name of the preset carrying the most row ids. */
  readonly reference: string
  /** Preset file name to the row ids the reference carries and that preset does not. */
  readonly gaps: ReadonlyMap<string, readonly string[]>
}

/**
 * Report each preset's row-id gap against the preset carrying the most row ids.
 *
 * {@link presetDivergences} compares the blocks of row ids two or more presets
 * carry, so a preset that dropped a whole row leaves nothing for it to compare
 * and the gate stays silent. This is the other half: which rows the reference
 * carries and another preset does not.
 * @param presets - the shipped presets with their raw text.
 * @returns the reference preset and every preset's missing row ids.
 */
export function presetRowSetGaps(presets: readonly PresetSources[]): RowSetReference {
  const ids = new Map(presets.map(preset => [preset.file, [...presetRowBlocks(preset.source).keys()]]))
  const best = [...ids].sort(([fileA, a], [fileB, b]) => b.length - a.length || fileA.localeCompare(fileB))[0]
  if (best === undefined) throw new Error('verify-preset-divergence: no preset carries a row')
  const carried = new Set(best[1])
  const gaps = new Map<string, readonly string[]>()
  for (const [file, rowIds] of [...ids].sort(([left], [right]) => left.localeCompare(right))) {
    const present = new Set(rowIds)
    gaps.set(file, [...carried].filter(id => !present.has(id)).sort())
  }
  return { reference: best[0], gaps }
}

/** Comparison of the recorded row-id gaps against the current ones. */
export interface RowSetDiff {
  /** Row ids a preset no longer carries that the baseline does not record. */
  readonly added: readonly { readonly file: string; readonly id: string }[]
  /** Recorded gaps whose row id the preset carries again. */
  readonly stale: readonly { readonly file: string; readonly id: string }[]
}

/**
 * Compare the recorded row-id gaps against the current ones.
 * @param recorded - the baseline's `rowSets` section.
 * @param current - {@link presetRowSetGaps} result.
 * @returns gaps to reject and recorded gaps that went stale.
 */
export function diffRowSets(
  recorded: Readonly<Record<string, readonly string[]>>,
  current: RowSetReference,
): RowSetDiff {
  const added: { file: string; id: string }[] = []
  const stale: { file: string; id: string }[] = []
  for (const [file, missing] of [...current.gaps].sort(([left], [right]) => left.localeCompare(right))) {
    const known = new Set(recorded[file] ?? [])
    for (const id of missing) {
      if (!known.has(id)) added.push({ file, id })
    }
  }
  for (const file of Object.keys(recorded).sort()) {
    const present = new Set(current.gaps.get(file) ?? [])
    for (const id of recorded[file] ?? []) {
      if (!present.has(id)) stale.push({ file, id })
    }
  }
  return { added, stale }
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
  const document = typeof parsed === 'object' && parsed !== null
    ? parsed as { rows?: unknown; rowSets?: unknown }
    : undefined
  if (document === undefined
    || typeof document.rows !== 'object' || document.rows === null
    || typeof document.rowSets !== 'object' || document.rowSets === null) {
    throw new Error('verify-preset-divergence: the baseline must be an object carrying rows and rowSets records')
  }
  return document as PresetDivergenceBaseline
}

/**
 * Render the baseline document with sorted keys.
 * @param current - {@link presetDivergences} result.
 * @param rowSets - {@link presetRowSetGaps} result.
 * @returns the JSON text to check in.
 */
export function renderBaseline(current: ReadonlyMap<string, Divergence>, rowSets: RowSetReference): string {
  const rows: Record<string, Record<string, string>> = {}
  for (const [id, hashes] of [...current].sort(([left], [right]) => left.localeCompare(right))) {
    rows[id] = Object.fromEntries([...hashes].sort(([left], [right]) => left.localeCompare(right)))
  }
  const gaps: Record<string, readonly string[]> = {}
  for (const [file, ids] of [...rowSets.gaps].sort(([left], [right]) => left.localeCompare(right))) {
    gaps[file] = ids
  }
  return `${JSON.stringify({ rows, rowSets: gaps }, null, 2)}\n`
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
  const rowSets = presetRowSetGaps(presets)
  if (process.argv.includes('--write')) {
    writeFileSync(resolve(ROOT, BASELINE_PATH), renderBaseline(current, rowSets))
    process.stdout.write(`verify-preset-divergence: recorded ${String(current.size)} divergent row id(s) in ${BASELINE_PATH}.\n`)
  }
  else {
    if (process.argv.includes('--list')) {
      for (const [id, hashes] of current) {
        process.stdout.write(`${id}:\n`)
        for (const [file, hash] of hashes) process.stdout.write(`  ${file.padEnd(20)} ${hash}\n`)
      }
      process.stdout.write(`row-set gaps against ${rowSets.reference}:\n`)
      for (const [file, missing] of rowSets.gaps) {
        if (missing.length === 0) continue
        process.stdout.write(`  ${file.padEnd(20)} missing ${missing.join(', ')}\n`)
      }
    }
    const baseline = parseBaseline(readFileSync(resolve(ROOT, BASELINE_PATH), 'utf8'))
    const diff = diffDivergences(baseline, current)
    const rowDiff = diffRowSets(baseline.rowSets, rowSets)
    if (diff.added.length > 0 || diff.changed.length > 0 || diff.stale.length > 0
      || rowDiff.added.length > 0 || rowDiff.stale.length > 0) {
      process.stderr.write('verify-preset-divergence: divergences outside the baseline:\n')
      for (const id of diff.added) {
        process.stderr.write(`  ${id}: new divergence\n`)
        for (const [file, hash] of current.get(id) ?? []) process.stderr.write(`    ${file.padEnd(20)} ${hash}\n`)
      }
      for (const entry of diff.changed) process.stderr.write(`  ${entry.id}: ${entry.detail}\n`)
      for (const id of diff.stale) process.stderr.write(`  ${id}: no longer diverges; drop its baseline entry\n`)
      for (const gap of rowDiff.added) {
        process.stderr.write(
          `  ${gap.file}: no longer carries ${gap.id} (reference ${rowSets.reference}); restore the row or record the gap\n`,
        )
      }
      for (const gap of rowDiff.stale) {
        process.stderr.write(`  ${gap.file}: carries ${gap.id} again; drop the recorded gap\n`)
      }
      process.exit(1)
    }
    process.stdout.write(
      `verify-preset-divergence: ${String(current.size)} recorded divergence(s) and `
      + `${String([...rowSets.gaps.values()].flat().length)} recorded row-set gap(s) match ${String(presets.length)} preset(s).\n`,
    )
  }
}
