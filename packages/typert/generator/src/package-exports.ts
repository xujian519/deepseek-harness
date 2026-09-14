/**
 * `package.json` export-map reading for the analyzer: which subpaths a package
 * publishes, which face owns them, and which source file produces each target.
 * @module @deepseek-ai/dsh-typert-generator/package-exports
 */

import { resolve } from 'node:path'

/**
 * Report whether a manifest declares a client face with client export subpaths.
 * @param manifest - the parsed `package.json`.
 * @returns true when the package publishes a client face.
 */
export function isDualFacePackage(manifest: Record<string, unknown>): boolean {
  const dsh = manifest.dsh
  const client = dsh !== null && typeof dsh === 'object'
    ? (dsh as Record<string, unknown>).client
    : undefined
  return client !== null
    && typeof client === 'object'
    && clientExportSubpaths(manifest).length > 0
}

/**
 * List the export subpaths the host face owns.
 * @param manifest - the parsed `package.json`.
 * @returns the subpaths other than `./client` and `./remote`.
 */
export function hostExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath !== './client'
      && !subpath.startsWith('./client/')
      && subpath !== './remote')
}

/**
 * List the export subpaths the client face owns.
 * @param manifest - the parsed `package.json`.
 * @returns the `./client` subpaths.
 */
export function clientExportSubpaths(manifest: Record<string, unknown>): string[] {
  return packageExportTargets(manifest)
    .map(([subpath]) => subpath)
    .filter(subpath => subpath === './client' || subpath.startsWith('./client/'))
}

/**
 * Resolve a manifest's `exports`, falling back to `types`, into subpath-to-target pairs.
 * @param manifest - the parsed `package.json`.
 * @returns the pairs, sorted by subpath.
 */
export function packageExportTargets(manifest: Record<string, unknown>): [string, string][] {
  const exportsField = manifest.exports
  if (typeof exportsField === 'string') return [['.', exportsField]]
  if (exportsField === null || typeof exportsField !== 'object') {
    const types = manifest.types
    return typeof types === 'string' ? [['.', types]] : []
  }
  if (Array.isArray(exportsField)
    || !Object.keys(exportsField).some(key => key.startsWith('.'))) {
    const target = exportTarget(exportsField)
    return target === undefined ? [] : [['.', target]]
  }
  const result: [string, string][] = []
  for (const [subpath, value] of Object.entries(exportsField as Record<string, unknown>)) {
    if (!subpath.startsWith('.')) continue
    const target = exportTarget(value)
    if (target !== undefined) result.push([subpath, target])
  }
  return result.sort(([left], [right]) => left.localeCompare(right))
}

function exportTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate)
      if (target !== undefined) return target
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const conditions = value as Record<string, unknown>
  for (const key of ['types', 'import', 'default']) {
    const target = exportTarget(conditions[key])
    if (target !== undefined) return target
  }
  for (const candidate of Object.values(conditions)) {
    const target = exportTarget(candidate)
    if (target !== undefined) return target
  }
  return undefined
}

/**
 * Map a published export target back to the source file that produces it.
 * @param packageRoot - the package directory.
 * @param target - the published export target.
 * @returns the absolute source path.
 */
export function sourcePathForExport(packageRoot: string, target: string): string {
  const normalized = target.replace(/^\.\//, '')
  if (normalized.startsWith('lib/types/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/types/'.length).replace(/\.d\.(?:mts|cts|ts)$/, '.ts'))
  }
  if (normalized.startsWith('lib/')) {
    return resolve(packageRoot, 'src', normalized.slice('lib/'.length).replace(/\.(?:mjs|cjs|js|d\.ts)$/, '.ts'))
  }
  return resolve(packageRoot, normalized)
}
