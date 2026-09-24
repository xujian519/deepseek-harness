/**
 * Keep the patent team's role catalog and the shipped team-composition skill in step.
 *
 * `role-contracts.ts` states that the catalog corresponds one-to-one with the
 * role table in `patent-team-composition/SKILL.md`. Nothing held that
 * correspondence: the catalog, the skill table, and the preset READMEs were kept
 * in step by hand, so a role added to one of them drifts from the others until a
 * reader notices. This gate reads the shipped skill's role table and compares its
 * role ids with `defaultRoleContracts()`.
 *
 * It judges the role table alone. The scenario packs below it name roles in task
 * rows and member lists, which this gate does not parse.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultRoleContracts } from '@deepseek-ai/dsh-patent-workflow'

const root = resolve(import.meta.dirname, '..')

/** The shipped team-composition skill owning the role table, relative to the repository root. */
export const ROSTER_SKILL_PATH = 'packages/bundle/web-app/skills/patent/patent-team-composition/SKILL.md'

/** The heading introducing the role table. */
const ROSTER_HEADING = '## 角色总表'

/**
 * Collect the role ids from a skill's role table, in table order.
 * @param markdown - the skill file's text.
 * @returns the second-column ids with backticks removed; empty when the heading or table is absent.
 */
export function parseRosterRoleIds(markdown: string): string[] {
  const ids: string[] = []
  let inTable = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      if (inTable) break
      inTable = line.startsWith(ROSTER_HEADING)
      continue
    }
    if (!inTable || !line.startsWith('|')) continue
    // '| 制图员 | `illustrator` | … |' splits into ['', '制图员', '`illustrator`', …, ''].
    const cell = line.split('|')[2]?.trim().replaceAll('`', '')
    if (cell === undefined || cell === '' || cell === 'role id' || cell.startsWith('-')) continue
    ids.push(cell)
  }
  return ids
}

/**
 * Compare the registered roles with the ones the role table lists.
 * @param catalog - role ids from the worker/role catalog.
 * @param table - role ids parsed from the skill.
 * @returns one message per divergence; empty when the two agree.
 */
export function rosterDrift(catalog: readonly string[], table: readonly string[]): string[] {
  const problems: string[] = []
  for (const role of catalog) {
    if (!table.includes(role)) problems.push(`角色总表缺少 "${role}"（role-contracts.ts 已注册）`)
  }
  for (const role of table) {
    if (!catalog.includes(role)) problems.push(`角色总表多出 "${role}"（role-contracts.ts 未注册）`)
  }
  return problems
}

if (import.meta.main) {
  const catalog = defaultRoleContracts().map(contract => contract.role)
  const table = parseRosterRoleIds(readFileSync(resolve(root, ROSTER_SKILL_PATH), 'utf8'))
  const problems = rosterDrift(catalog, table)
  if (problems.length > 0) {
    console.error('verify-patent-team-roster failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error(`\nUpdate ${ROSTER_SKILL_PATH} and packages/patent/patent-workflow/src/role-contracts.ts together.`)
    process.exit(1)
  }
  console.log(`verify-patent-team-roster: ${catalog.length} roles agree between role-contracts.ts and the skill table.`)
}
