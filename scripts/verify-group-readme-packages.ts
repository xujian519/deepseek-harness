/** Enforce that every package-group README lists every package its directory holds. */

import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const GROUP_PATTERN = 'packages/*/README.md' as const

/** Headings the English and Chinese group READMEs use for the package table. */
const PACKAGES_HEADINGS = new Set(['## Packages', '## 包'])

/** Headings the English and Chinese root package maps use for the group table. */
const GROUP_TABLE_HEADINGS = new Set(['## Package groups', '## 包分组'])

/** The English and Chinese READMEs the root package map and every group directory carry. */
const README_LOCALES = ['README.md', 'README.zh.md'] as const

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

/** Body of one H2 section, up to the next H2 or the `-----` rule. */
function sectionBody(source: string, headings: ReadonlySet<string>): string | undefined {
  const lines = source.split('\n')
  const start = lines.findIndex(line => headings.has(line.trimEnd()))
  if (start === -1) return undefined
  const end = lines.findIndex((line, index) => index > start && (line.startsWith('## ') || line === '-----'))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n')
}

/** Directory names one section's table rows link through `README.md` or `README.zh.md` targets. */
function sectionLinks(section: string): string[] {
  // Section prose may link a directory without listing it; only a table row carries a row.
  const rows = section
    .split('\n')
    .filter(line => line.trimStart().startsWith('|'))
    .join('\n')
  const listed: string[] = []
  for (const match of rows.matchAll(/\]\(([^)\s]+)\/README(?:\.zh)?\.md\)/gu)) {
    const target = match[1] ?? ''
    // A `../` target points at another group; that group's README owns its row.
    if (target.startsWith('../') || target.startsWith('/')) continue
    listed.push(target)
  }
  return listed
}

/**
 * Report the packages one group README's Packages table omits, and the rows it lists that the directory does not hold.
 * A package listed twice is not a diagnostic: the rows collapse in a set, and only the root package map requires unique entries.
 * @param file - Repository-relative README path.
 * @param source - Complete README source.
 * @param packages - Package directory names the group directory holds.
 * @returns One diagnostic per omitted or dangling Packages row.
 */
export function groupReadmePackageErrors(file: string, source: string, packages: readonly string[]): string[] {
  const section = sectionBody(source, PACKAGES_HEADINGS)
  if (section === undefined) return [`${file}: missing \`## Packages\``]

  const held = new Set(packages)
  const rows = new Set(sectionLinks(section))

  return [
    ...packages
      .filter(name => !rows.has(name))
      .map(name => `${file}: no Packages row for \`${name}/\``),
    ...[...rows]
      .filter(name => !held.has(name))
      .map(name => `${file}: Packages row for \`${name}/\`, which the directory does not hold`),
  ]
}

/**
 * Report the extra, dangling, and missing rows in the root package map's group table.
 * @param file - Repository-relative README path.
 * @param source - Complete README source.
 * @param groups - Group directory names that hold a README.
 * @returns One diagnostic per extra, dangling, or missing group row.
 */
export function packageGroupTableErrors(file: string, source: string, groups: readonly string[]): string[] {
  const section = sectionBody(source, GROUP_TABLE_HEADINGS)
  if (section === undefined) return [`${file}: missing \`## Package groups\``]

  const held = new Set(groups)
  const seen = new Set<string>()
  const failures: string[] = []
  for (const name of sectionLinks(section)) {
    if (seen.has(name)) {
      failures.push(`${file}: duplicate group row for \`${name}/\``)
      continue
    }
    seen.add(name)
    if (!held.has(name)) failures.push(`${file}: group row for \`${name}/\`, which holds no group README`)
  }
  for (const name of groups) {
    if (!seen.has(name)) failures.push(`${file}: no group row for \`${name}/\``)
  }
  return failures
}

if (import.meta.main) {
  const groups = groupNames()
  const failures: string[] = []
  let checked = 0
  if (groups.length === 0) failures.push('no package-group READMEs found; the scan is empty or narrowed')
  for (const name of README_LOCALES) {
    const file = `packages/${name}`
    failures.push(...packageGroupTableErrors(file, readFileSync(resolve(root, file), 'utf8'), groups))
  }
  for (const group of groups) {
    const packages = groupPackages(group)
    if (packages.length === 0) {
      failures.push(`packages/${group}: holds no package with a package.json; the scan is empty or narrowed`)
      continue
    }
    for (const name of README_LOCALES) {
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
    console.log(`verify-group-readme-packages: ${String(checked)} group READMEs list every package in their directory, and both root package maps list every group once.`)
  }
}
