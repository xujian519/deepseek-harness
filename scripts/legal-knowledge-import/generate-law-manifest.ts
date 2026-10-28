/**
 * Rebuild the legal-law index manifest from the YAML files in a directory.
 *
 * The runtime reads `manifest.json` to learn which law each index file holds
 * without parsing article data, so the manifest is a build product of the YAML
 * assets: regenerate it whenever they change.
 *
 * `manifest.json` shape:
 *
 * ```json
 * { "laws": [["民法典", "中华人民共和国民法典", "civil-code.yaml"]] }
 * ```
 *
 * Each entry is the law name, the document title, and the file name; entries
 * are sorted by law name.
 * @module generate-law-manifest
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { LEGAL_LAW_MANIFEST_FILE } from '../../packages/legal/legal-law/src/asset-location.ts'

/** One law's manifest row: law name, document title, and index file. */
type ManifestRow = [law: string, document: string, file: string]

/**
 * Read the law name and document title of one index file.
 * @param dir - the index directory.
 * @param file - the file name inside it.
 * @returns the manifest row.
 * @throws Error when the file does not declare both fields.
 */
function readManifestRow(dir: string, file: string): ManifestRow {
  const source = readFileSync(join(dir, file), 'utf8')
  const document = yamlLoad(source) as { law?: unknown; document?: unknown } | null
  if (document === null || typeof document !== 'object') {
    throw new Error(`${file}: 不是 YAML 映射`)
  }
  const { law, document: title } = document
  if (typeof law !== 'string' || law.trim() === '') throw new Error(`${file}: 缺少 law`)
  if (typeof title !== 'string' || title.trim() === '') throw new Error(`${file}: 缺少 document`)
  return [law, title, file]
}

/**
 * Build the manifest text for a legal-law index directory.
 * @param dir - directory holding the index YAML files.
 * @returns the manifest JSON text, newline-terminated.
 * @throws Error when a file declares no law, or two files declare the same law.
 */
export function buildLawManifest(dir: string): string {
  const rows = readdirSync(dir)
    .filter(entry => entry.endsWith('.yaml'))
    .sort()
    .map(file => readManifestRow(dir, file))
  const seen = new Map<string, string>()
  for (const [law, , file] of rows) {
    const duplicate = seen.get(law)
    if (duplicate !== undefined) throw new Error(`同一部法律被索引了两次：${law}（${duplicate}、${file}）`)
    seen.set(law, file)
  }
  rows.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
  return `${JSON.stringify({ laws: rows })}\n`
}

/**
 * Write `manifest.json` for a legal-law index directory.
 * @param dir - directory holding the index YAML files.
 * @returns the number of laws the manifest lists.
 * @throws Error when the manifest text cannot be built.
 */
export function writeLawManifest(dir: string): number {
  const text = buildLawManifest(dir)
  writeFileSync(join(dir, LEGAL_LAW_MANIFEST_FILE), text, 'utf8')
  return (JSON.parse(text) as { laws: ManifestRow[] }).laws.length
}

const isDirectRun = process.argv[1] !== undefined && (
  process.argv[1].endsWith('generate-law-manifest.ts') ||
  process.argv[1].endsWith('generate-law-manifest')
)
if (isDirectRun) {
  const dir = process.argv[2]
  if (dir === undefined) {
    console.error('Usage: tsx generate-law-manifest.ts <legal-law-index-dir>')
    process.exit(1)
  }
  try {
    const count = writeLawManifest(dir)
    console.log(`Wrote ${LEGAL_LAW_MANIFEST_FILE} for ${count} laws to ${dir}`)
  } catch (error: unknown) {
    console.error(error)
    process.exit(1)
  }
}
