/** Enforce that every package-group README lists every package its directory holds. */

import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const GROUP_PATTERN = 'packages/*/README.md' as const

/** Headings the English and Chinese group READMEs use for the package table. */
const PACKAGES_HEADINGS = new Set(['## Packages', '## 包'])

/** Group directory names that hold a README and at least one package. */
function groupNames(): string[] {
  return globSync(GROUP_PATTERN, { cwd: root, exclude: ['**/node_modules/**'] })
    .map(file => file.replaceAll('\\', '/').split('/')[1] ?? '')
    .filter(Boolean)
    .sort()
}

/** Package directory names the group directory holds directly. */
function groupPackages(group: string): string[] {
  return readdirSync(resolve(root, 'packages', group), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', group, entry.name, 'package.json')))
    .map(entry => entry.name)
    .sort()
}

/** Body of the Packages section, which may hold one table per family. */
function packagesSection(source: string): string | undefined {
  const lines = source.split('\n')
  const start = lines.findIndex(line => PACKAGES_HEADINGS.has(line.trimEnd()))
  if (start === -1) return undefined
  const end = lines.findIndex((line, index) => index > start && (line.startsWith('## ') || line === '-----'))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

/**
 * Report the packages one group README's Packages table omits.
 * @param file - Repository-relative README path.
 * @param source - Complete README source.
 * @param packages - Package directory names the group directory holds.
 * @returns One diagnostic per package absent from the Packages section.
 */
export function groupReadmePackageErrors(file: string, source: string, packages: readonly string[]): string[] {
  const section = packagesSection(source)
  if (section === undefined) return [`${file}: missing \`## Packages\``]

  const listed = new Set<string>()
  for (const match of section.matchAll(/\]\(([^)\s]+)\/README(?:\.zh)?\.md\)/gu)) {
    const target = match[1] ?? ''
    // A `../` target points at another group; that group's README owns its row.
    if (target.startsWith('../') || target.startsWith('/')) continue
    listed.add(target)
  }

  return packages
    .filter(name => !listed.has(name))
    .map(name => `${file}: no Packages row for \`${name}/\``)
}

if (import.meta.main) {
  const groups = groupNames()
  const failures: string[] = []
  let checked = 0
  if (groups.length === 0) failures.push('no package-group READMEs found; the scan is empty or narrowed')
  for (const group of groups) {
    const packages = groupPackages(group)
    if (packages.length === 0) {
      failures.push(`packages/${group}: holds no package with a package.json; the scan is empty or narrowed`)
      continue
    }
    for (const name of ['README.md', 'README.zh.md'] as const) {
      const file = `packages/${group}/${name}`
      failures.push(...groupReadmePackageErrors(file, readFileSync(resolve(root, file), 'utf8'), packages))
      checked += 1
    }
  }

  if (failures.length > 0) {
    console.error('verify-group-readme-packages: violations found:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`verify-group-readme-packages: ${String(checked)} group READMEs list every package in their directory.`)
  }
}
