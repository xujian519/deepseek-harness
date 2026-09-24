/**
 * The boundary table for `verify-patent-team-roster`: which rows the parser
 * admits, and the two drift directions the gate must reject. The last case runs
 * the gate's own functions over the shipped skill and the shipped catalog, so a
 * green pair is distinguishable from a parser that found no table at all.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultRoleContracts } from '@deepseek-ai/dsh-patent-workflow'
import { describe, expect, it } from 'vitest'
import { ROSTER_SKILL_PATH, parseRosterRoleIds, rosterDrift } from './verify-patent-team-roster.ts'

const FIXTURE = [
  '## 角色总表',
  '',
  '| 角色 | role id | 立场 |',
  '|---|---|---|',
  '| 检索员 | `researcher` | 中立 |',
  '| 制图员 | `illustrator` | 中立（流程） |',
  '',
  '立场纪律：裁判角色不得参与任一方案略起草。',
  '',
  '## 场景角色包与任务 DAG',
  '',
  '| 任务 | 负责人 |',
  '|---|---|',
  '| t1 | 撰写员 |',
].join('\n')

describe('parseRosterRoleIds', () => {
  it('reads the role table and stops at the next heading', () => {
    expect(parseRosterRoleIds(FIXTURE)).toEqual(['researcher', 'illustrator'])
  })

  it('returns nothing when the skill carries no role table', () => {
    expect(parseRosterRoleIds('## 别的章节\n\n| a | b |\n|---|---|\n')).toEqual([])
  })
})

describe('rosterDrift', () => {
  it('reports a registered role missing from the table', () => {
    expect(rosterDrift(['researcher', 'illustrator'], ['researcher']))
      .toEqual(['角色总表缺少 "illustrator"（role-contracts.ts 已注册）'])
  })

  it('reports a table row with no registered role', () => {
    expect(rosterDrift(['researcher'], ['researcher', 'ghost']))
      .toEqual(['角色总表多出 "ghost"（role-contracts.ts 未注册）'])
  })

  it('reports nothing when the table and the catalog agree', () => {
    expect(rosterDrift(['researcher', 'illustrator'], ['illustrator', 'researcher'])).toEqual([])
  })
})

describe('shipped roster', () => {
  it('matches the registered roles', () => {
    const markdown = readFileSync(resolve(import.meta.dirname, '..', ROSTER_SKILL_PATH), 'utf8')
    const table = parseRosterRoleIds(markdown)
    expect(table.length).toBeGreaterThan(0)
    expect(rosterDrift(defaultRoleContracts().map(contract => contract.role), table)).toEqual([])
  })
})
