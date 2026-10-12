/**
 * 案卷问题条目（DocketIssue）：一条问题从开启到闭合的机器可读记录，以及由
 * planTask 状态机在迁移守卫上执行的三条不变量。
 *
 * 类别词表与「类别 → 默认处置」映射分居两处是有意的：词表是随版本发布的封闭
 * 联集（{@link ISSUE_KINDS}），映射是可单独改的数据行
 * （assets/issue-dispositions.json，载入时逐行校验）。条目可逐条覆盖默认处置与
 * 默认阻塞档位；`status` 与 `round_opened` 由工作流在开启时写入，不由模型决定。
 *
 * 本模块不持有案卷状态：不变量都是纯函数，状态留在状态机与调用方。
 * @module @deepseek-ai/dsh-patent-workflow/docket-issue
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ASSET_URL = new URL('../assets/issue-dispositions.json', import.meta.url)

/** 问题类别词表（封闭联集）：机检形式 / 可克服实质 / 证据缺口 / 范围策略 / 不可克服 / 噪声。 */
export const ISSUE_KINDS = [
  'machine_format',
  'substantive',
  'evidence_gap',
  'scope_strategy',
  'insufficient_disclosure',
  'noise',
] as const

/** 问题类别。 */
export type DocketIssueKind = (typeof ISSUE_KINDS)[number]

/** 处置词表：改申请文件 / 问人 / 忽略。 */
export const ISSUE_DISPOSITIONS = ['application_fix', 'ask_human', 'ignore'] as const

/** 处置：这条问题默认怎么收口。 */
export type DocketIssueDisposition = (typeof ISSUE_DISPOSITIONS)[number]

/** 阻塞档位词表，由轻到重：不阻塞 / 阻塞派工 / 升级为终态。 */
export const ISSUE_BLOCKING_GRADES = ['none', 'blocking', 'terminal'] as const

/**
 * 阻塞档位：这条未闭合的问题对派工与轮次的影响。
 * `none` 不拦住派工；`blocking` 拦住派工直到闭合；`terminal` 让本轮只能收在终态。
 */
export type DocketIssueBlocking = (typeof ISSUE_BLOCKING_GRADES)[number]

/** 条目状态：open 计入不变量，closed 只留痕。 */
export type DocketIssueStatus = 'open' | 'closed'

/** 一条案卷问题条目。 */
export type DocketIssue = {
  /** 案卷内稳定标识。 */
  id: string
  /** 一句话说明缺陷或待决事项。 */
  summary: string
  /** 类别，决定默认处置与默认阻塞档位。 */
  kind: DocketIssueKind
  /** 怎么收口。 */
  disposition: DocketIssueDisposition
  /** 开闭状态。 */
  status: DocketIssueStatus
  /** 对派工与轮次的影响。 */
  blocking: DocketIssueBlocking
  /** 开启该条目的规划轮次（1 起）。 */
  round_opened: number
  /** 可选定位锚（权项号 / 段落号 / 文件路径）。 */
  anchor?: string
}

/**
 * 条目草案：只登记类别与说明；`disposition` 与 `blocking` 缺省时由
 * {@link resolveDocketIssue} 取该类别的资产默认值。
 */
export type DocketIssueDraft = {
  id: string
  summary: string
  kind: DocketIssueKind
  disposition?: DocketIssueDisposition
  blocking?: DocketIssueBlocking
  anchor?: string
}

/** 处置资产的一行：该类别的默认处置、默认阻塞档位与适用条件。 */
export type IssueDispositionRow = {
  kind: DocketIssueKind
  disposition: DocketIssueDisposition
  blocking: DocketIssueBlocking
  /** 什么算作该类别（分类判据，也是资产里唯一的人工说明字段）。 */
  criteria: string
}

/** 已载入的处置资产，按类别索引。 */
export type IssueDispositionTable = ReadonlyMap<DocketIssueKind, IssueDispositionRow>

/** 处置资产加载失败：缺行、未知取值、重复行或空判据。 */
export class IssueDispositionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IssueDispositionError'
  }
}

/** 资产文件的读入结构：逐字段校验前按最宽形状读取（空行与缺字段都在校验里报出）。 */
type IssueDispositionAssetFile = { kinds?: (Partial<IssueDispositionRow> | null)[] }

function isIssueKind(value: string): value is DocketIssueKind {
  return (ISSUE_KINDS as readonly string[]).includes(value)
}

function isIssueDisposition(value: string): value is DocketIssueDisposition {
  return (ISSUE_DISPOSITIONS as readonly string[]).includes(value)
}

function isIssueBlocking(value: string): value is DocketIssueBlocking {
  return (ISSUE_BLOCKING_GRADES as readonly string[]).includes(value)
}

/**
 * 解析并校验处置资产：恰好覆盖词表的每个类别一次，取值在词表内，判据非空。
 * @param raw - 资产文件的 JSON 文本。
 * @param source - 报错信息里的资产来源（文件路径或 URL）。
 * @returns 按类别索引的处置表。
 * @throws IssueDispositionError 缺少 `kinds` 数组、未知或重复的 kind、词表外的取值、空判据、词表缺行。
 */
export function parseIssueDispositions(raw: string, source: string): IssueDispositionTable {
  const parsed = JSON.parse(raw) as IssueDispositionAssetFile
  const rows = Array.isArray(parsed.kinds) ? parsed.kinds : null
  if (rows === null) throw new IssueDispositionError(`${source}: 缺少 kinds 数组`)
  const table = new Map<DocketIssueKind, IssueDispositionRow>()
  for (const row of rows) {
    if (row === null) throw new IssueDispositionError(`${source}: kinds 里有空行`)
    const { kind, disposition, blocking, criteria } = row
    if (typeof kind !== 'string' || !isIssueKind(kind)) {
      throw new IssueDispositionError(`${source}: 词表外的 kind ${JSON.stringify(kind)}`)
    }
    if (typeof disposition !== 'string' || !isIssueDisposition(disposition)) {
      throw new IssueDispositionError(`${source}: ${kind} 的 disposition 取值非法 ${JSON.stringify(disposition)}`)
    }
    if (typeof blocking !== 'string' || !isIssueBlocking(blocking)) {
      throw new IssueDispositionError(`${source}: ${kind} 的 blocking 取值非法 ${JSON.stringify(blocking)}`)
    }
    if (typeof criteria !== 'string' || criteria.trim() === '') {
      throw new IssueDispositionError(`${source}: ${kind} 缺少 criteria`)
    }
    if (table.has(kind)) throw new IssueDispositionError(`${source}: kind ${kind} 重复`)
    table.set(kind, { kind, disposition, blocking, criteria })
  }
  const missing = ISSUE_KINDS.filter(kind => !table.has(kind))
  if (missing.length > 0) throw new IssueDispositionError(`${source}: 缺 kind 行 ${missing.join(', ')}`)
  return table
}

let assetCache: IssueDispositionTable | null = null

/**
 * 载入随包处置资产（assets/issue-dispositions.json），相对本模块解析，故源码运行与
 * 构建产物运行命中同一文件；结果按进程记忆。
 * @returns 按类别索引的处置表。
 * @throws IssueDispositionError 资产缺失或未通过 {@link parseIssueDispositions} 的校验。
 */
export function loadIssueDispositions(): IssueDispositionTable {
  if (assetCache === null) {
    const path = fileURLToPath(ASSET_URL)
    assetCache = parseIssueDispositions(readFileSync(path, 'utf8'), path)
  }
  return assetCache
}

/**
 * 补全一条草案：`disposition` 与 `blocking` 缺省时取该类别的资产默认值，状态置
 * `open`，开启轮次取传入值。
 * @param draft - 只登记类别与说明的条目草案。
 * @param round - 开启该条目的规划轮次（1 起）。
 * @param dispositions - 已载入的处置表。
 * @returns 字段完整的案卷条目。
 * @throws IssueDispositionError 该类别不在处置表内。
 */
export function resolveDocketIssue(
  draft: DocketIssueDraft,
  round: number,
  dispositions: IssueDispositionTable,
): DocketIssue {
  const row = dispositions.get(draft.kind)
  if (row === undefined) throw new IssueDispositionError(`处置表缺少 kind ${draft.kind}`)
  return {
    id: draft.id,
    summary: draft.summary,
    kind: draft.kind,
    disposition: draft.disposition ?? row.disposition,
    status: 'open',
    blocking: draft.blocking ?? row.blocking,
    round_opened: round,
    ...(draft.anchor !== undefined ? { anchor: draft.anchor } : {}),
  }
}

/**
 * 未闭合的阻塞条目：`status` 为 `open` 且 `blocking` 不为 `none`。存在即不得进入
 * 派工态，直到这些条目闭合。
 * @param issues - 案卷当前条目。
 * @returns 命中的条目，按传入顺序。
 */
export function openBlockingIssues(issues: readonly DocketIssue[]): DocketIssue[] {
  return issues.filter(issue => issue.status === 'open' && issue.blocking !== 'none')
}

/**
 * 未闭合的终态条目：`status` 为 `open` 且 `blocking` 为 `terminal`。存在即本轮只能
 * 收在终态，不得再进入派工或重规划。
 * @param issues - 案卷当前条目。
 * @returns 命中的条目，按传入顺序。
 */
export function openTerminalIssues(issues: readonly DocketIssue[]): DocketIssue[] {
  return issues.filter(issue => issue.status === 'open' && issue.blocking === 'terminal')
}

/**
 * 规划轮次是否已达上限。
 * @param rounds - 已完成的规划轮次。
 * @param maxRounds - 允许的规划轮次上限。
 * @returns 已达上限为 true，此时本轮只能收在终态。
 */
export function roundCapReached(rounds: number, maxRounds: number): boolean {
  return rounds >= maxRounds
}
