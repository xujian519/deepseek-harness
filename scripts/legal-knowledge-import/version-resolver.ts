/**
 * Multi-version deduplication for law files.
 *
 * Many laws have multiple versions in the data source (e.g. `法律名称(2020-05-28).md`
 * and `法律名称(2023-01-01).md`). This module groups files by law name and
 * retains only the latest version per law.
 * @module legal-knowledge-import/version-resolver
 */

import type { ParsedLaw } from './parse-law-md.ts'

/**
 * Group parsed laws by name and keep only the latest version of each.
 *
 * Version ordering is determined by adoptDate (latest first). Laws without
 * a date are treated as older than any dated version.
 *
 * @param laws - parsed law records (may contain multiple versions of the same law).
 * @returns deduplicated array with one entry per unique law name.
 */
export function deduplicateVersions(laws: ParsedLaw[]): ParsedLaw[] {
  const groups = new Map<string, ParsedLaw[]>()

  for (const law of laws) {
    const key = law.name
    let group = groups.get(key)
    if (!group) {
      group = []
      groups.set(key, group)
    }
    group.push(law)
  }

  const result: ParsedLaw[] = []
  for (const [, group] of groups) {
    // Sort by adoptDate descending; empty dates sort last.
    group.sort((a, b) => {
      const da = a.adoptDate
      const db = b.adoptDate
      if (da === db) return 0
      return da > db ? -1 : 1
    })
    const first = group[0]
    if (first) result.push(first)
  }

  return result
}

/**
 * Group files by law name and return all versions (for diagnostics).
 * @param laws - parsed law records.
 * @returns map from law name to all versions of that law.
 */
export function groupVersions(laws: ParsedLaw[]): Map<string, ParsedLaw[]> {
  const groups = new Map<string, ParsedLaw[]>()
  for (const law of laws) {
    let group = groups.get(law.name)
    if (!group) {
      group = []
      groups.set(law.name, group)
    }
    group.push(law)
  }
  return groups
}
