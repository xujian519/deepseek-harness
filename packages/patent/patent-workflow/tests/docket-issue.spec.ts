import { describe, expect, it } from 'vitest'
import {
  ISSUE_BLOCKING_GRADES,
  ISSUE_DISPOSITIONS,
  ISSUE_KINDS,
  IssueDispositionError,
  loadIssueDispositions,
  openBlockingIssues,
  openTerminalIssues,
  parseIssueDispositions,
  resolveDocketIssue,
  roundCapReached,
  type DocketIssue,
} from '@deepseek-ai/dsh-patent-workflow'

/** 资产的最小合法形状：每个类别一行，判据非空。 */
function assetRows(): { kind: string; disposition: string; blocking: string; criteria: string }[] {
  return ISSUE_KINDS.map(kind => ({
    kind,
    disposition: ISSUE_DISPOSITIONS[0],
    blocking: ISSUE_BLOCKING_GRADES[0],
    criteria: `${kind} 的判据`,
  }))
}

function parse(rows: unknown, source = 'fixture.json') {
  return parseIssueDispositions(JSON.stringify({ kinds: rows }), source)
}

/** 逐档构造一条 open 条目，用于不变量断言。 */
function issue(overrides: Partial<DocketIssue>): DocketIssue {
  return {
    id: 'issue-1',
    summary: '示例',
    kind: 'machine_format',
    disposition: 'application_fix',
    status: 'open',
    blocking: 'none',
    round_opened: 1,
    ...overrides,
  }
}

describe('处置资产', () => {
  it('随包资产恰好覆盖词表的每个类别，且取值都在词表内', () => {
    const table = loadIssueDispositions()
    expect([...table.keys()].sort()).toEqual([...ISSUE_KINDS].sort())
    for (const row of table.values()) {
      expect(ISSUE_DISPOSITIONS).toContain(row.disposition)
      expect(ISSUE_BLOCKING_GRADES).toContain(row.blocking)
      expect(row.criteria).not.toBe('')
    }
  })

  it('问人的类别默认阻塞，可改文件的类别默认不阻塞', () => {
    const table = loadIssueDispositions()
    expect(table.get('evidence_gap')?.disposition).toBe('ask_human')
    expect(table.get('evidence_gap')?.blocking).toBe('blocking')
    // 可由修改克服的实质缺陷拦在派工前会死锁：下一轮派工正是闭合手段。
    expect(table.get('substantive')?.blocking).toBe('none')
    // 范围策略默认问人但不拦住写作。
    expect(table.get('scope_strategy')?.disposition).toBe('ask_human')
    expect(table.get('scope_strategy')?.blocking).toBe('none')
    expect(table.get('noise')?.disposition).toBe('ignore')
  })

  it('解析合法资产并保留判据', () => {
    const table = parse(assetRows())
    expect(table.size).toBe(ISSUE_KINDS.length)
    expect(table.get('noise')?.criteria).toBe('noise 的判据')
  })

  it('缺 kinds 数组或词表缺行都抛 IssueDispositionError', () => {
    expect(() => parseIssueDispositions('{}', 'fixture.json')).toThrow(/缺少 kinds 数组/)
    expect(() => parseIssueDispositions('{"kinds":"all"}', 'fixture.json')).toThrow(/缺少 kinds 数组/)
    expect(() => parse(assetRows().slice(1))).toThrow(/缺 kind 行 machine_format/)
  })

  it('词表外的 kind、非法的处置与阻塞档位、空判据都抛错', () => {
    const rows = assetRows()
    expect(() => parse([...rows, { kind: 'typo', disposition: 'ignore', blocking: 'none', criteria: 'x' }]))
      .toThrow(/词表外的 kind "typo"/)
    expect(() => parse(rows.map((row, idx) => (idx === 0 ? { ...row, disposition: 'fix' } : row))))
      .toThrow(/disposition 取值非法/)
    expect(() => parse(rows.map((row, idx) => (idx === 0 ? { ...row, blocking: 'hard' } : row))))
      .toThrow(/blocking 取值非法/)
    expect(() => parse(rows.map((row, idx) => (idx === 0 ? { ...row, criteria: '   ' } : row))))
      .toThrow(/缺少 criteria/)
  })

  it('重复的 kind 行抛错，且报错带来源', () => {
    const rows = assetRows()
    expect(() => parse([...rows, rows[0]!], 'assets/issue-dispositions.json'))
      .toThrow(/assets\/issue-dispositions.json: kind machine_format 重复/)
  })
})

describe('resolveDocketIssue', () => {
  it('用类别默认值补全处置与阻塞档位，状态置 open 并记开启轮次', () => {
    const table = loadIssueDispositions()
    const resolved = resolveDocketIssue({ id: 'i-1', summary: '对比文件 D1 未给段落', kind: 'evidence_gap' }, 2, table)
    expect(resolved).toEqual({
      id: 'i-1',
      summary: '对比文件 D1 未给段落',
      kind: 'evidence_gap',
      disposition: 'ask_human',
      status: 'open',
      blocking: 'blocking',
      round_opened: 2,
    })
  })

  it('逐条覆盖优先于类别默认值，锚点按需带上', () => {
    const table = loadIssueDispositions()
    const resolved = resolveDocketIssue(
      { id: 'i-2', summary: '独权范围待定', kind: 'scope_strategy', blocking: 'blocking', anchor: '权项1' },
      3,
      table,
    )
    expect(resolved.blocking).toBe('blocking')
    expect(resolved.disposition).toBe('ask_human')
    expect(resolved.anchor).toBe('权项1')
  })

  it('处置表缺该类别时抛错，不静默取默认值', () => {
    expect(() => resolveDocketIssue({ id: 'i-3', summary: 'x', kind: 'noise' }, 1, new Map()))
      .toThrow(IssueDispositionError)
  })
})

describe('案卷不变量', () => {
  it('只有未闭合且阻塞档位不为 none 的条目命中', () => {
    const issues = [
      issue({ id: 'a', blocking: 'none' }),
      issue({ id: 'b', blocking: 'blocking' }),
      issue({ id: 'c', blocking: 'terminal' }),
      issue({ id: 'd', blocking: 'blocking', status: 'closed' }),
    ]
    expect(openBlockingIssues(issues).map(i => i.id)).toEqual(['b', 'c'])
    expect(openTerminalIssues(issues).map(i => i.id)).toEqual(['c'])
    expect(openBlockingIssues([])).toEqual([])
  })

  it('轮次上限封顶：达到与超过上限都为真，未达为假', () => {
    expect(roundCapReached(0, 3)).toBe(false)
    expect(roundCapReached(2, 3)).toBe(false)
    expect(roundCapReached(3, 3)).toBe(true)
    expect(roundCapReached(4, 3)).toBe(true)
    expect(roundCapReached(0, 0)).toBe(true)
  })
})
